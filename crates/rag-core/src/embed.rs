#[cfg(feature = "embed")]
use std::fs;
#[cfg(feature = "embed")]
use std::path::Path;

#[cfg(feature = "embed")]
use fastembed::{
    InitOptionsUserDefined, Pooling as FPooling, TextEmbedding, TokenizerFiles,
    UserDefinedEmbeddingModel,
};

#[cfg(feature = "embed")]
use crate::catalog::{ModelSpec, Pooling};

#[cfg(feature = "embed")]
pub struct Embedder {
    inner: TextEmbedding,
    spec: &'static ModelSpec,
}

#[cfg(feature = "embed")]
fn map_pooling(p: Pooling) -> FPooling {
    match p {
        Pooling::Mean => FPooling::Mean,
        Pooling::Cls => FPooling::Cls,
    }
}

#[cfg(feature = "embed")]
fn read_model_files(model_dir: &Path) -> Result<(Vec<u8>, TokenizerFiles), String> {
    let onnx = fs::read(model_dir.join("model.onnx")).map_err(|e| e.to_string())?;
    let read_opt = |name: &str| -> Vec<u8> {
        fs::read(model_dir.join(name)).unwrap_or_default()
    };
    let tokenizer_files = TokenizerFiles {
        tokenizer_file: fs::read(model_dir.join("tokenizer.json")).map_err(|e| e.to_string())?,
        config_file: read_opt("config.json"),
        special_tokens_map_file: read_opt("special_tokens_map.json"),
        tokenizer_config_file: read_opt("tokenizer_config.json"),
    };
    Ok((onnx, tokenizer_files))
}

#[cfg(feature = "embed")]
pub fn load_embedder(spec: &'static ModelSpec, model_dir: &Path) -> Result<Embedder, String> {
    let (onnx, tokenizer_files) = read_model_files(model_dir)?;
    let udm = UserDefinedEmbeddingModel::new(onnx, tokenizer_files)
        .with_pooling(map_pooling(spec.pooling));
    let model = TextEmbedding::try_new_from_user_defined(
        udm,
        InitOptionsUserDefined::default(),
    )
    .map_err(|e| e.to_string())?;
    Ok(Embedder { inner: model, spec })
}

#[cfg(feature = "embed")]
fn normalize(v: &mut [f32]) {
    let n: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if n > 0.0 {
        for x in v.iter_mut() {
            *x /= n;
        }
    }
}

#[cfg(feature = "embed")]
impl Embedder {
    pub fn embed_passages(&mut self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let prefixed: Vec<String> = texts
            .iter()
            .map(|t| format!("{}{}", self.spec.passage_prefix, t))
            .collect();
        self.embed_batch(&prefixed)
    }

    pub fn embed_query(&mut self, query: &str) -> Result<Vec<f32>, String> {
        let q = format!("{}{}", self.spec.query_prefix, query);
        let mut v = self.embed_batch(&[q])?.pop().ok_or("empty embed")?;
        if self.spec.normalize {
            normalize(&mut v);
        }
        Ok(v)
    }

    fn embed_batch(&mut self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        const BATCH: usize = 32;
        let mut out = Vec::new();
        for chunk in texts.chunks(BATCH) {
            let refs: Vec<&str> = chunk.iter().map(String::as_str).collect();
            let mut batch = self
                .inner
                .embed(refs, None)
                .map_err(|e| e.to_string())?;
            if self.spec.normalize {
                for v in &mut batch {
                    normalize(v);
                }
            }
            out.extend(batch);
        }
        Ok(out)
    }
}

/// Cross-encoder over (query, chunk) pairs; re-orders the RRF candidates.
#[cfg(feature = "embed")]
pub struct Reranker(fastembed::TextRerank);

/// Candidates fetched from the hybrid search before the reranker picks the top k.
#[cfg(feature = "embed")]
pub const RERANK_POOL: usize = 20;

/// The reranker when its model is installed, `None` otherwise (search keeps the RRF order).
#[cfg(feature = "embed")]
pub fn load_installed_reranker() -> Result<Option<Reranker>, String> {
    let dir = crate::paths::model_dir(crate::catalog::reranker_spec().id);
    if !dir.join(".complete").is_file() {
        return Ok(None);
    }
    let (onnx, tokenizer_files) = read_model_files(&dir)?;
    let model = fastembed::TextRerank::try_new_from_user_defined(
        fastembed::UserDefinedRerankingModel::new(onnx, tokenizer_files),
        fastembed::RerankInitOptionsUserDefined::default(),
    )
    .map_err(|e| e.to_string())?;
    Ok(Some(Reranker(model)))
}

/// Hybrid search, then (if a reranker is given) cross-encoder re-ordering of the top candidates.
#[cfg(feature = "embed")]
pub fn search_reranked(
    store: &crate::Store,
    reranker: Option<&mut Reranker>,
    query_vec: &[f32],
    query: &str,
    source: crate::FileSource,
    k: usize,
    path_glob: Option<&str>,
) -> Result<Vec<crate::Hit>, String> {
    let Some(r) = reranker else {
        return store.search(query_vec, query, source, k, path_glob);
    };
    let hits = store.search(query_vec, query, source, RERANK_POOL.max(k), path_glob)?;
    let texts: Vec<&str> = hits.iter().map(|h| h.text.as_str()).collect();
    let order = r
        .0
        .rerank(query, texts.as_slice(), false, None)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|x| (x.index, x.score))
        .collect::<Vec<_>>();
    Ok(apply_order(hits, &order, k))
}

#[cfg_attr(not(feature = "embed"), allow(dead_code))]
/// Takes hits in the reranker's order (already sorted by score), keeps k, stores the new score.
fn apply_order(hits: Vec<crate::Hit>, order: &[(usize, f32)], k: usize) -> Vec<crate::Hit> {
    let mut slots: Vec<Option<crate::Hit>> = hits.into_iter().map(Some).collect();
    order
        .iter()
        .filter_map(|&(i, score)| {
            let mut h = slots.get_mut(i)?.take()?;
            h.score = score as f64;
            Some(h)
        })
        .take(k)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(path: &str) -> crate::Hit {
        crate::Hit { path: path.into(), start_line: 1, end_line: 1, source: crate::FileSource::Code, score: 0.0, text: String::new(), chunk_id: 0, bm25_rank: None, vec_rank: None, fused_rank: 1 }
    }

    #[test]
    fn apply_order_follows_reranker_and_truncates() {
        let out = apply_order(vec![hit("a"), hit("b"), hit("c")], &[(2, 0.9), (0, 0.5), (1, 0.1)], 2);
        assert_eq!(out.iter().map(|h| h.path.as_str()).collect::<Vec<_>>(), ["c", "a"]);
        assert_eq!(out[0].score, 0.9f32 as f64);
        // Out-of-range or repeated indices are ignored.
        assert_eq!(apply_order(vec![hit("a")], &[(5, 1.0), (0, 0.2), (0, 0.1)], 3).len(), 1);
    }
}
