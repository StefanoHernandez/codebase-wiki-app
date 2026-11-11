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
pub fn load_embedder(spec: &'static ModelSpec, model_dir: &Path) -> Result<Embedder, String> {
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
