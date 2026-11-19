use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::AppHandle;

use super::{blocking, opened_repo};

/// The app's own bundled sidecar (always the same version as the app); the stable copy in
/// `<data>/bin` is for the agents and may be stale on Windows.
fn rag_bin() -> Result<PathBuf, String> {
    crate::rag_sidecar::rag_sidecar_path().or_else(|e| {
        let stable = rag_core::bin_path();
        if stable.is_file() {
            Ok(stable)
        } else {
            Err(e)
        }
    })
}

fn run_sidecar_output(bin: &PathBuf, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut cmd = wiki_core::no_window_command(bin);
    cmd.args(args);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = parse_sidecar_error(&out.stdout).or_else(|| {
            let stderr = String::from_utf8_lossy(&out.stderr);
            if stderr.trim().is_empty() {
                None
            } else {
                Some(stderr.into_owned())
            }
        });
        return Err(err.unwrap_or_else(|| {
            wiki_core::tr("Comando sidecar fallito", "Sidecar command failed")
        }));
    }
    Ok(out.stdout)
}

fn parse_sidecar_error(stdout: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(stdout);
    for line in text.lines() {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if v.get("event").and_then(|e| e.as_str()) == Some("error") {
                return v
                    .get("message")
                    .and_then(|m| m.as_str())
                    .map(String::from);
            }
        }
    }
    None
}

#[tauri::command]
pub async fn rag_status(app: AppHandle, repo: String) -> Result<serde_json::Value, String> {
    blocking(move || {
        let canonical = opened_repo(&app, &repo)?;
        let root = rag_core::resolve_repo(Some(&canonical))?;
        let mut v = rag_core::status_json(&root);
        if let Some(obj) = v.as_object_mut() {
            obj.insert(
                "stale_install".into(),
                crate::rag_sidecar::stale_install().into(),
            );
        }
        Ok(v)
    })
    .await
}

#[tauri::command]
pub async fn rag_models() -> Result<serde_json::Value, String> {
    blocking(|| Ok(rag_core::models_list_json())).await
}

#[tauri::command]
pub fn rag_set_model(id: String) -> Result<(), String> {
    let mut cfg = rag_core::read_config().unwrap_or(rag_core::RagConfig { model: id.clone() });
    cfg.model = id;
    rag_core::write_config(&cfg)
}

#[tauri::command]
pub async fn rag_index_start(
    app: AppHandle,
    repo: String,
    jobs: tauri::State<'_, Arc<crate::rag_jobs::RagJobs>>,
) -> Result<(), String> {
    let canonical = opened_repo(&app, &repo)?;
    let bin = rag_bin()?;
    Arc::clone(&jobs).start_index(app, canonical.to_string_lossy().into_owned(), &bin)
}

#[tauri::command]
pub fn rag_index_cancel(
    app: AppHandle,
    repo: String,
    jobs: tauri::State<'_, Arc<crate::rag_jobs::RagJobs>>,
) -> Result<(), String> {
    let canonical = opened_repo(&app, &repo)?;
    jobs.cancel_index(&canonical.to_string_lossy())
}

/// Deletes this repo's index (db + WAL/SHM). Refused while an index job runs on it.
#[tauri::command]
pub fn rag_index_delete(
    app: AppHandle,
    repo: String,
    jobs: tauri::State<'_, Arc<crate::rag_jobs::RagJobs>>,
) -> Result<(), String> {
    let canonical = opened_repo(&app, &repo)?;
    let key = canonical.to_string_lossy();
    if jobs.index_running(&key) {
        return Err(wiki_core::tr(
            "Indicizzazione in corso: annullala prima di cancellare l'indice",
            "Indexing in progress: cancel it before deleting the index",
        ));
    }
    let root = rag_core::resolve_repo(Some(&canonical))?;
    rag_core::delete_index(&rag_core::index_path(&rag_core::repo_id(&root)))
}

/// Deletes a downloaded model's files. Its catalog row stays, so it can be downloaded again.
/// Refused while a download or any index job runs (both read the model directory).
#[tauri::command]
pub fn rag_model_remove(
    id: String,
    jobs: tauri::State<'_, Arc<crate::rag_jobs::RagJobs>>,
) -> Result<(), String> {
    let safe = !id.is_empty()
        && id != "."
        && id != ".."
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    if !safe {
        return Err(wiki_core::tr(
            &format!("id modello non valido: {id}"),
            &format!("invalid model id: {id}"),
        ));
    }
    if jobs.pull_running() || jobs.any_index_running() {
        return Err(wiki_core::tr(
            "Download o indicizzazione in corso: aspetta che finisca",
            "Download or indexing in progress: wait for it to finish",
        ));
    }
    let dir = rag_core::model_dir(&id);
    if !dir.is_dir() {
        return Err(wiki_core::tr(
            &format!("{id} non è installato"),
            &format!("{id} is not installed"),
        ));
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))
}

#[tauri::command]
pub async fn rag_model_pull(
    app: AppHandle,
    id: String,
    jobs: tauri::State<'_, Arc<crate::rag_jobs::RagJobs>>,
) -> Result<(), String> {
    let bin = rag_bin()?;
    Arc::clone(&jobs).start_pull(app, id, &bin)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchHit {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub source: String,
    pub score: f64,
    pub snippet: String,
    pub bm25_rank: Option<u32>,
    pub vec_rank: Option<u32>,
    pub fused_rank: u32,
    pub reranked: bool,
    pub stale: bool,
}

#[tauri::command]
pub async fn rag_preview(
    app: AppHandle,
    repo: String,
    query: String,
) -> Result<Vec<RagSearchHit>, String> {
    blocking(move || {
        let canonical = opened_repo(&app, &repo)?;
        let repo_str = canonical.to_string_lossy().into_owned();
        let bin = rag_bin()?;
        let args = ["search", "--repo", &repo_str, "-k", "8", "--json", "--", &query];
        let stdout = run_sidecar_output(&bin, &args)?;
        let text = String::from_utf8_lossy(&stdout);
        let mut hits = Vec::new();
        for line in text.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let v: serde_json::Value =
                serde_json::from_str(line).map_err(|e| format!("JSON: {e}"))?;
            if v.get("event").and_then(|e| e.as_str()) == Some("error") {
                return Err(v
                    .get("message")
                    .and_then(|m| m.as_str())
                    .map(String::from)
                    .unwrap_or_else(|| wiki_core::tr("Ricerca fallita", "Search failed")));
            }
            hits.push(RagSearchHit {
                path: v["path"].as_str().unwrap_or("").into(),
                start_line: v["start_line"].as_u64().unwrap_or(0) as u32,
                end_line: v["end_line"].as_u64().unwrap_or(0) as u32,
                source: v["source"].as_str().unwrap_or("").into(),
                score: v["score"].as_f64().unwrap_or(0.0),
                snippet: v["snippet"].as_str().unwrap_or("").into(),
                bm25_rank: v["bm25_rank"].as_u64().map(|n| n as u32),
                vec_rank: v["vec_rank"].as_u64().map(|n| n as u32),
                fused_rank: v["fused_rank"].as_u64().unwrap_or(0) as u32,
                reranked: v["reranked"].as_bool().unwrap_or(false),
                stale: v["stale"].as_bool().unwrap_or(false),
            });
        }
        Ok(hits)
    })
    .await
}

/// The latest MCP tool calls across every repository, newest first.
#[tauri::command]
pub async fn agent_activity(
    limit: usize,
) -> Result<Vec<rag_core::activity::ActivityLine>, String> {
    blocking(move || {
        let mut lines =
            rag_core::activity::read_all(&rag_core::paths::activity_dir(), limit.min(1000));
        // The server logs `std::canonicalize` paths (`\\?\C:\...` on Windows); recents use dunce's
        // `C:\...`. Same spelling here, so the view can compare them as strings.
        for l in &mut lines {
            if let Some(r) = &l.repo {
                l.repo = Some(dunce::simplified(Path::new(r)).to_string_lossy().into_owned());
            }
        }
        Ok(lines)
    })
    .await
}

#[tauri::command]
pub async fn rag_harness_state() -> Result<Vec<rag_core::harness::HarnessRow>, String> {
    blocking(|| Ok(rag_core::harness::harness_state())).await
}

#[tauri::command]
pub async fn rag_harness_preview(
    harness: String,
    action: String,
) -> Result<rag_core::harness::HarnessPreview, String> {
    blocking(move || {
        let act = parse_harness_action(&action)?;
        rag_core::harness::harness_preview(&harness, act)
    })
    .await
}

#[tauri::command]
pub async fn rag_harness_apply(harness: String, action: String) -> Result<(), String> {
    blocking(move || {
        let act = parse_harness_action(&action)?;
        rag_core::harness::harness_apply(&harness, act)
    })
    .await
}

#[tauri::command]
pub async fn rag_models_add(hf_repo: String) -> Result<serde_json::Value, String> {
    blocking(move || {
        let bin = rag_bin()?;
        let stdout = run_sidecar_output(&bin, &["models", "add", &hf_repo, "--json"])?;
        serde_json::from_slice(&stdout).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn rag_models_search(q: String) -> Result<serde_json::Value, String> {
    blocking(move || {
        let bin = rag_bin()?;
        let stdout = run_sidecar_output(&bin, &["models", "search", &q, "--json"])?;
        serde_json::from_slice(&stdout).map_err(|e| e.to_string())
    })
    .await
}

fn parse_harness_action(action: &str) -> Result<rag_core::harness::HarnessAction, String> {
    use rag_core::harness::HarnessAction;
    match action {
        "connect" => Ok(HarnessAction::Connect),
        "disconnect" => Ok(HarnessAction::Disconnect),
        "update" => Ok(HarnessAction::Update),
        other => Err(wiki_core::tr(
            &format!("azione sconosciuta: {other}"),
            &format!("unknown action: {other}"),
        )),
    }
}
