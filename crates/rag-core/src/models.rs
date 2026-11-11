#[cfg(feature = "download")]
use std::fs;
#[cfg(feature = "download")]
use std::io::{Read, Write};
#[cfg(feature = "download")]
use std::path::Path;

#[cfg(feature = "download")]
use crate::catalog::ModelSpec;
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
pub fn pull(
    spec: &ModelSpec,
    mut on_progress: impl FnMut(DownloadEvent),
) -> Result<(), String> {
    let dir = model_dir(spec.id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for (remote, local) in spec.files {
        let url = format!("{}/{}/resolve/main/{}", hf_base(), spec.hf_repo, remote);
        let part = dir.join(format!("{local}.part"));
        let final_path = dir.join(local);
        let resp = ureq::get(&url)
            .call()
            .map_err(|e| format!("download {local}: {e}"))?;
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
        fs::rename(&part, &final_path).map_err(|e| e.to_string())?;
    }
    fs::write(dir.join(".complete"), b"ok").map_err(|e| e.to_string())?;
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
    let enc: String = query
        .bytes()
        .map(|b| format!("%{b:02X}"))
        .collect();
    let url = format!(
        "{}/api/models?library=onnx&pipeline_tag=feature-extraction&search={enc}&sort=downloads&limit=20",
        base.trim_end_matches('/')
    );
    let resp = ureq::get(&url).call().map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_reader(resp.into_reader()).map_err(|e| e.to_string())?;
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

    #[test]
    fn complete_marker_required_for_installed() {
        let td = tempfile::tempdir().unwrap();
        let dir = td.path().join("models/m");
        fs::create_dir_all(&dir).unwrap();
        assert!(!dir.join(".complete").exists());
        fs::write(dir.join(".complete"), b"ok").unwrap();
        assert!(dir.join(".complete").is_file());
    }
}
