#[cfg(feature = "download")]
use std::collections::HashMap;
#[cfg(feature = "download")]
use std::fs;
#[cfg(feature = "download")]
use std::io::{Read, Write};
#[cfg(feature = "download")]
use std::sync::{Mutex, OnceLock};
#[cfg(feature = "download")]
use std::time::Duration;

#[cfg(feature = "download")]
use serde::{Deserialize, Serialize};
#[cfg(feature = "download")]
use serde_json::Value;

#[cfg(feature = "download")]
use crate::catalog::{ModelSpec, Pooling};
#[cfg(feature = "download")]
use crate::paths::model_dir;

#[cfg(feature = "download")]
#[derive(Debug, Clone)]
pub struct DownloadEvent {
    pub file: String,
    pub done: u64,
    pub total: u64,
}

#[cfg(feature = "download")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredSpec {
    pub id: String,
    pub hf_repo: String,
    pub files: Vec<(String, String)>,
    pub dims: u32,
    pub pooling: String,
    pub size_mb: u32,
    pub languages: String,
    pub note: String,
    pub tested: bool,
}

#[cfg(feature = "download")]
static CUSTOM_CACHE: OnceLock<Mutex<HashMap<String, &'static ModelSpec>>> = OnceLock::new();

#[cfg(feature = "download")]
fn custom_cache() -> &'static Mutex<HashMap<String, &'static ModelSpec>> {
    CUSTOM_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(feature = "download")]
pub fn installed_ids() -> Vec<String> {
    let root = crate::paths::models_dir();
    let Ok(rd) = fs::read_dir(root) else {
        return Vec::new();
    };
    rd.filter_map(|e| e.ok())
        .filter(|e| e.path().join(".complete").is_file())
        .filter_map(|e| e.file_name().into_string().ok())
        .collect()
}

#[cfg(feature = "download")]
fn hf_base() -> String {
    std::env::var("HF_ENDPOINT")
        .unwrap_or_else(|_| "https://huggingface.co".to_string())
        .trim_end_matches('/')
        .to_string()
}

#[cfg(feature = "download")]
fn http_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(60))
        .build()
}

#[cfg(feature = "download")]
fn fetch_hf_json(hf_repo: &str, rel: &str) -> Result<Value, String> {
    let url = format!("{}/{}/resolve/main/{}", hf_base(), hf_repo, rel);
    let resp = http_agent().get(&url).call().map_err(|e| e.to_string())?;
    serde_json::from_reader(resp.into_reader()).map_err(|e| e.to_string())
}

#[cfg(feature = "download")]
pub fn infer_from_config(config: &Value, pooling_cfg: Option<&Value>) -> Result<(u32, Pooling), String> {
    let dims = config
        .get("hidden_size")
        .and_then(|v| v.as_u64())
        .ok_or("hidden_size mancante in config.json")? as u32;
    let cls = pooling_cfg
        .and_then(|p| p.get("pooling_mode_cls_token"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    Ok((dims, if cls { Pooling::Cls } else { Pooling::Mean }))
}

#[cfg(feature = "download")]
fn pick_onnx_remote(hf_repo: &str) -> Result<String, String> {
    let agent = http_agent();
    for candidate in [
        "onnx/model_quantized.onnx",
        "onnx/model.onnx",
        "model.onnx",
    ] {
        let url = format!("{}/{}/resolve/main/{}", hf_base(), hf_repo, candidate);
        if agent.head(&url).call().is_ok() {
            return Ok(candidate.into());
        }
    }
    Err("Nessun file ONNX trovato nel repo".into())
}

#[cfg(feature = "download")]
fn leak_str(s: &str) -> &'static str {
    Box::leak(s.to_owned().into_boxed_str())
}

#[cfg(feature = "download")]
/// `owner/name` with HF's allowed characters → local id (the name, dots as dashes).
/// Refuses anything else, and names that clash with the curated catalog.
pub fn custom_id(hf_repo: &str) -> Result<String, String> {
    let ok = |p: &str| {
        !p.is_empty()
            && !p.starts_with('.')
            && p.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    };
    let parts: Vec<&str> = hf_repo.split('/').collect();
    if parts.len() != 2 || !parts.iter().all(|p| ok(p)) {
        return Err(format!("repo Hugging Face non valido: {hf_repo} (atteso proprietario/nome)"));
    }
    let id = parts[1].replace('.', "-");
    if crate::catalog::catalog().iter().any(|m| m.id == id) {
        return Err(format!("{id} è già nel catalogo: usa Scarica"));
    }
    Ok(id)
}

#[cfg(feature = "download")]
pub fn add_custom(hf_repo: &str) -> Result<String, String> {
    let id = custom_id(hf_repo)?;
    let config = fetch_hf_json(hf_repo, "config.json")?;
    let pooling = fetch_hf_json(hf_repo, "1_Pooling/config.json").ok();
    let sentence = fetch_hf_json(hf_repo, "sentence_bert_config.json").ok();
    let pooling_cfg = pooling.as_ref().or(sentence.as_ref());
    let (dims, pooling_mode) = infer_from_config(&config, pooling_cfg)?;
    let onnx_remote = pick_onnx_remote(hf_repo)?;
    let spec = StoredSpec {
        id: id.clone(),
        hf_repo: hf_repo.into(),
        files: vec![
            (onnx_remote, "model.onnx".into()),
            ("tokenizer.json".into(), "tokenizer.json".into()),
            ("config.json".into(), "config.json".into()),
            ("special_tokens_map.json".into(), "special_tokens_map.json".into()),
            ("tokenizer_config.json".into(), "tokenizer_config.json".into()),
        ],
        dims,
        pooling: if pooling_mode == Pooling::Cls {
            "cls".into()
        } else {
            "mean".into()
        },
        size_mb: 0,
        languages: "non indicato".into(),
        note: "Modello custom da Hugging Face".into(),
        tested: false,
    };
    let dir = model_dir(&id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&spec).map_err(|e| e.to_string())?;
    fs::write(dir.join("spec.json"), text).map_err(|e| e.to_string())?;
    custom_cache().lock().unwrap().remove(&id);
    Ok(id)
}

#[cfg(feature = "download")]
pub fn custom_catalog_rows() -> Vec<StoredSpec> {
    let root = crate::paths::models_dir();
    let Ok(rd) = fs::read_dir(root) else {
        return Vec::new();
    };
    rd.filter_map(|e| e.ok())
        .filter_map(|e| {
            let spec_path = e.path().join("spec.json");
            if !spec_path.is_file() {
                return None;
            }
            let text = fs::read_to_string(&spec_path).ok()?;
            serde_json::from_str(&text).ok()
        })
        .collect()
}

#[cfg(feature = "download")]
fn stored_to_static(spec: &StoredSpec) -> &'static ModelSpec {
    let pooling = if spec.pooling == "cls" {
        Pooling::Cls
    } else {
        Pooling::Mean
    };
    let files: &'static [(&'static str, &'static str)] = Box::leak(
        spec.files
            .iter()
            .map(|(a, b)| (leak_str(a), leak_str(b)))
            .collect::<Vec<_>>()
            .into_boxed_slice(),
    );
    Box::leak(Box::new(ModelSpec {
        id: leak_str(&spec.id),
        hf_repo: leak_str(&spec.hf_repo),
        files,
        dims: spec.dims,
        pooling,
        normalize: true,
        query_prefix: "",
        passage_prefix: "",
        max_tokens: 512,
        size_mb: spec.size_mb,
        languages: leak_str(&spec.languages),
        note: leak_str(&spec.note),
        tested: spec.tested,
    }))
}

#[cfg(feature = "download")]
pub fn custom_model_spec(id: &str) -> Option<&'static ModelSpec> {
    if let Some(&spec) = custom_cache().lock().unwrap().get(id) {
        return Some(spec);
    }
    let path = model_dir(id).join("spec.json");
    let text = fs::read_to_string(&path).ok()?;
    let stored: StoredSpec = serde_json::from_str(&text).ok()?;
    let leaked = stored_to_static(&stored);
    custom_cache().lock().unwrap().insert(id.to_string(), leaked);
    Some(leaked)
}

#[cfg(feature = "download")]
pub fn pull(
    spec: &ModelSpec,
    mut on_progress: impl FnMut(DownloadEvent),
) -> Result<(), String> {
    let dir = model_dir(spec.id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let complete = dir.join(".complete");
    if complete.is_file() {
        fs::remove_file(&complete).map_err(|e| e.to_string())?;
    }
    let agent = http_agent();
    for (remote, local) in spec.files {
        let url = format!("{}/{}/resolve/main/{}", hf_base(), spec.hf_repo, remote);
        let part = dir.join(format!("{local}.part"));
        let final_path = dir.join(local);
        let resp = agent.get(&url).call().map_err(|e| format!("download {local}: {e}"))?;
        let total = resp
            .header("Content-Length")
            .and_then(|h| h.parse::<u64>().ok())
            .unwrap_or(0);
        let mut file = fs::File::create(&part).map_err(|e| e.to_string())?;
        let mut reader = resp.into_reader();
        let mut done = 0u64;
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            done += n as u64;
            on_progress(DownloadEvent {
                file: local.to_string(),
                done,
                total,
            });
        }
        drop(file);
        if total > 0 && done != total {
            return Err(format!("dimensione scaricata errata per {local}: {done} != {total}"));
        }
        fs::rename(&part, &final_path).map_err(|e| e.to_string())?;
    }
    fs::write(complete, b"ok").map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(feature = "download")]
pub fn is_installed(spec: &ModelSpec) -> bool {
    model_dir(spec.id).join(".complete").is_file()
}

#[cfg(feature = "download")]
pub fn hf_search(query: &str) -> Result<Vec<HfModelHit>, String> {
    let base = std::env::var("HF_ENDPOINT")
        .unwrap_or_else(|_| "https://huggingface.co".to_string());
    let enc: String = query.bytes().map(|b| format!("%{b:02X}")).collect();
    let url = format!(
        "{}/api/models?library=onnx&pipeline_tag=feature-extraction&search={enc}&sort=downloads&limit=20",
        base.trim_end_matches('/')
    );
    let resp = http_agent().get(&url).call().map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_reader(resp.into_reader()).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    if let Some(arr) = v.as_array() {
        for m in arr {
            out.push(HfModelHit {
                id: m.get("id").and_then(|x| x.as_str()).unwrap_or("").into(),
                downloads: m.get("downloads").and_then(|x| x.as_u64()).unwrap_or(0),
            });
        }
    }
    Ok(out)
}

#[cfg(feature = "download")]
#[derive(Debug, Clone, serde::Serialize)]
pub struct HfModelHit {
    pub id: String,
    pub downloads: u64,
}

#[cfg(test)]
#[cfg(feature = "download")]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn complete_marker_required_for_installed() {
        let td = tempfile::tempdir().unwrap();
        let dir = td.path().join("models/m");
        fs::create_dir_all(&dir).unwrap();
        assert!(!dir.join(".complete").exists());
        fs::write(dir.join(".complete"), b"ok").unwrap();
        assert!(dir.join(".complete").is_file());
    }

    #[test]
    fn infer_cls_pooling() {
        let cfg = json!({"hidden_size": 384});
        let pool = json!({"pooling_mode_cls_token": true});
        let (dims, p) = infer_from_config(&cfg, Some(&pool)).unwrap();
        assert_eq!(dims, 384);
        assert_eq!(p, Pooling::Cls);
    }

    #[test]
    fn infer_mean_default() {
        let cfg = json!({"hidden_size": 768});
        let (dims, p) = infer_from_config(&cfg, None).unwrap();
        assert_eq!(dims, 768);
        assert_eq!(p, Pooling::Mean);
    }

    #[test]
    fn custom_id_validates_repo_names() {
        assert_eq!(custom_id("BAAI/bge-m3").unwrap(), "bge-m3");
        assert_eq!(custom_id("org/model.v2").unwrap(), "model-v2");
        for bad in ["bge-m3", "a/b/c", "../x", "org/..", "org/a b", "intfloat/multilingual-e5-small"] {
            assert!(custom_id(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn infer_missing_hidden_size_errors() {
        assert!(infer_from_config(&json!({}), None).is_err());
    }
}
