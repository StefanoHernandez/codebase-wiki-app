use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RagConfig {
    #[serde(default = "default_model")]
    pub model: String,
}

fn default_model() -> String {
    "multilingual-e5-small".into()
}

pub fn data_dir() -> PathBuf {
    if let Ok(override_dir) = std::env::var("CODEBASE_WIKI_DATA_DIR") {
        if !override_dir.is_empty() {
            return PathBuf::from(override_dir);
        }
    }
  dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.codebasewiki.app")
        .join("rag")
}

pub fn activity_dir() -> PathBuf {
    data_dir().join("activity")
}

pub fn models_dir() -> PathBuf {
    data_dir().join("models")
}

pub fn model_dir(id: &str) -> PathBuf {
    models_dir().join(id)
}

pub fn index_path(repo_id: &str) -> PathBuf {
    data_dir().join("indexes").join(format!("{repo_id}.sqlite"))
}

pub fn bin_path() -> PathBuf {
    data_dir().join("bin").join(platform_bin_name())
}

fn platform_bin_name() -> &'static str {
    if cfg!(windows) {
        "codebase-wiki-mcp.exe"
    } else {
        "codebase-wiki-mcp"
    }
}

pub fn config_path() -> PathBuf {
    data_dir().join("config.json")
}

pub fn read_config() -> Result<RagConfig, String> {
    let path = config_path();
    if !path.is_file() {
        return Ok(RagConfig {
            model: default_model(),
        });
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("config.json: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("config.json: {e}"))
}

pub fn write_config(cfg: &RagConfig) -> Result<(), String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    let tmp = dir.join(".config.json.tmp");
    fs::write(&tmp, &text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, config_path()).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn ensure_data_dirs() -> Result<(), String> {
    for d in [
        data_dir(),
        models_dir(),
        data_dir().join("indexes"),
        data_dir().join("bin"),
    ] {
        fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_dir_respects_override() {
        let td = tempfile::tempdir().unwrap();
        let prev = std::env::var("CODEBASE_WIKI_DATA_DIR").ok();
        std::env::set_var("CODEBASE_WIKI_DATA_DIR", td.path());
        assert_eq!(data_dir(), td.path());
        match prev {
            Some(v) => std::env::set_var("CODEBASE_WIKI_DATA_DIR", v),
            None => std::env::remove_var("CODEBASE_WIKI_DATA_DIR"),
        }
    }
}
