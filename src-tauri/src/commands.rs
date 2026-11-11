use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;
use wiki_core::{
    build_workflow_prompt, collect_repo_files_recursive, file_diff_since_commit, inspect_git_state,
    is_git_repo, load_wiki_snapshot, read_repo_file_safe, resolve_wiki_root,
    read_wiki_file_safe, run_structural_lint_with, watch_repo, write_wiki_file_safe, LintReport,
    RepoFilePayload,
    WatchHandle, WikiSnapshot,
};

const RECENTS_FILE: &str = "recent.json";
const RECENTS_KEY: &str = "recents";
const MAX_RECENTS: usize = 12;
pub const WIKI_CHANGED_EVENT: &str = "wiki-changed";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiChanged {
    pub repo: String,
    pub paths: Vec<String>,
}

/// Pure recents update: `entry` goes to the front, any older entry with the same
/// path is dropped, and the list is capped at `MAX_RECENTS`.
fn same_repo_path(a: &str, b: &str) -> bool {
    match (
        dunce::canonicalize(Path::new(a)),
        dunce::canonicalize(Path::new(b)),
    ) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

pub fn with_recent(list: &[RecentProject], entry: RecentProject) -> Vec<RecentProject> {
    let mut out = Vec::with_capacity(MAX_RECENTS);
    out.push(entry.clone());
    out.extend(
        list.iter()
            .filter(|r| !same_repo_path(&r.path, &entry.path))
            .cloned(),
    );
    out.truncate(MAX_RECENTS);
    out
}

fn repo_canonical(path: &Path) -> Result<PathBuf, String> {
    dunce::canonicalize(path).map_err(|e| e.to_string())
}

static RECENTS_LOCK: Mutex<()> = Mutex::new(());

fn with_recents_lock<T>(f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _guard = RECENTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    f()
}

fn read_recents(app: &AppHandle) -> Result<Vec<RecentProject>, String> {
    let store = app.store(RECENTS_FILE).map_err(|e| e.to_string())?;
    Ok(store
        .get(RECENTS_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default())
}

fn write_recents(app: &AppHandle, list: &[RecentProject]) -> Result<(), String> {
    let store = app.store(RECENTS_FILE).map_err(|e| e.to_string())?;
    store.set(RECENTS_KEY, serde_json::to_value(list).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())
}

/// Runs blocking work off the async runtime.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

const NOT_OPENED: &str = "Project not opened";

/// True when the canonical `repo` is one of the recent projects (the folders
/// the user picked through `open_project`).
pub fn is_opened(list: &[RecentProject], repo: &Path) -> bool {
    list.iter().any(|r| {
        repo_canonical(Path::new(&r.path))
            .map(|p| p == repo)
            .unwrap_or(false)
    })
}

/// Gate for every command that takes a `repo`: canonicalize it, then require
/// it to be an opened project and still a git repo.
fn opened_repo(app: &AppHandle, repo: &str) -> Result<PathBuf, String> {
    let canonical = repo_canonical(Path::new(repo)).map_err(|_| NOT_OPENED.to_string())?;
    if !is_opened(&read_recents(app)?, &canonical) || !is_git_repo(&canonical) {
        return Err(NOT_OPENED.to_string());
    }
    Ok(canonical)
}

fn wiki_root_of(repo: &Path) -> Result<String, String> {
    resolve_wiki_root(repo)
        .wiki_root
        .ok_or_else(|| "No wiki found in this repository".to_string())
}

fn snapshot_for(repo: &Path) -> Result<WikiSnapshot, String> {
    let resolution = resolve_wiki_root(repo);
    match resolution.wiki_root {
        Some(root) => load_wiki_snapshot(repo, &root),
        None => {
            let mut repo_files = Vec::new();
            collect_repo_files_recursive(repo, repo, &mut repo_files);
            repo_files.sort();
            repo_files.dedup();
            Ok(WikiSnapshot {
                repo_path: repo.to_string_lossy().into_owned(),
                wiki_root: None,
                is_initialized: false,
                warning: resolution.warning,
                git_state: inspect_git_state(repo, None),
                pages: Vec::new(),
                repo_files,
                changed_files_by_page: BTreeMap::new(),
            })
        }
    }
}

/// Replaces the active watcher; dropping the old handle stops it.
fn start_watch(app: &AppHandle, repo: &Path) -> Result<(), String> {
    let emitter = app.clone();
    let repo_str = repo.to_string_lossy().into_owned();
    let handle = watch_repo(repo, move |paths| {
        let _ = emitter.emit(
            WIKI_CHANGED_EVENT,
            WikiChanged {
                repo: repo_str.clone(),
                paths,
            },
        );
    })?;
    let slot = app.state::<Mutex<Option<WatchHandle>>>();
    let mut guard = match slot.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    *guard = Some(handle);
    Ok(())
}

/// Bundled resource under `resources/`; falls back to the repo copy in dev.
fn resource(app: &AppHandle, rel: &str) -> Result<PathBuf, String> {
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("resources").join(rel);
        if p.exists() {
            return Ok(p);
        }
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("resources")
        .join(rel);
    if dev.exists() {
        return Ok(dev);
    }
    Err(format!("Resource not found: resources/{rel}"))
}

static PYTHON_BIN: OnceLock<Option<&'static str>> = OnceLock::new();

/// First working `python3`, then `python` (Windows); both must report Python 3.
fn find_python() -> Option<&'static str> {
    *PYTHON_BIN.get_or_init(|| {
        ["python3", "python"].into_iter().find(|bin| {
            Command::new(bin)
                .arg("--version")
                .output()
                .map(|o| {
                    let text = format!(
                        "{}{}",
                        String::from_utf8_lossy(&o.stdout),
                        String::from_utf8_lossy(&o.stderr)
                    );
                    o.status.success() && text.contains("Python 3")
                })
                .unwrap_or(false)
        })
    })
}

#[tauri::command]
pub async fn open_project(app: AppHandle, path: String) -> Result<WikiSnapshot, String> {
    blocking(move || {
        let repo = repo_canonical(Path::new(&path)).map_err(|e| format!("Cannot open {path}: {e}"))?;
        if !repo.is_dir() {
            return Err(format!("Not a directory: {path}"));
        }
        if !is_git_repo(&repo) {
            return Err("Not a git repository".to_string());
        }
        let snap = snapshot_for(&repo)?;
        with_recents_lock(|| {
            let name = repo
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone());
            let entry = RecentProject {
                path: repo.to_string_lossy().into_owned(),
                name,
            };
            let list = with_recent(&read_recents(&app)?, entry);
            write_recents(&app, &list)?;
            start_watch(&app, &repo)
        })?;
        Ok(snap)
    })
    .await
}

#[tauri::command]
pub async fn list_recent(app: AppHandle) -> Result<Vec<RecentProject>, String> {
    blocking(move || {
        with_recents_lock(|| {
            let list = read_recents(&app)?;
            let kept: Vec<RecentProject> = list
                .iter()
                .filter(|r| Path::new(&r.path).is_dir())
                .cloned()
                .collect();
            if kept.len() != list.len() {
                write_recents(&app, &kept)?;
            }
            Ok(kept)
        })
    })
    .await
}

#[tauri::command]
pub async fn remove_recent(app: AppHandle, path: String) -> Result<(), String> {
    blocking(move || {
        with_recents_lock(|| {
            let mut list = read_recents(&app)?;
            let before = list.len();
            list.retain(|r| !same_repo_path(&r.path, &path));
            if list.len() != before {
                write_recents(&app, &list)?;
            }
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn load_snapshot(app: AppHandle, repo: String) -> Result<WikiSnapshot, String> {
    blocking(move || snapshot_for(&opened_repo(&app, &repo)?)).await
}

#[tauri::command]
pub async fn write_wiki_file(
    app: AppHandle,
    repo: String,
    rel_path: String,
    content: String,
) -> Result<(), String> {
    blocking(move || {
        let repo = opened_repo(&app, &repo)?;
        let root = wiki_root_of(&repo)?;
        write_wiki_file_safe(&repo, &root, &rel_path, &content)
    })
    .await
}

#[tauri::command]
pub async fn read_wiki_file(
    app: AppHandle,
    repo: String,
    rel_path: String,
) -> Result<String, String> {
    blocking(move || {
        let repo = opened_repo(&app, &repo)?;
        let root = wiki_root_of(&repo)?;
        read_wiki_file_safe(&repo, &root, &rel_path)
    })
    .await
}

#[tauri::command]
pub async fn read_source_file(
    app: AppHandle,
    repo: String,
    rel_path: String,
) -> Result<RepoFilePayload, String> {
    blocking(move || read_repo_file_safe(&opened_repo(&app, &repo)?, &rel_path, None)).await
}

#[tauri::command]
pub async fn source_diff(
    app: AppHandle,
    repo: String,
    rel_path: String,
    commit: String,
) -> Result<String, String> {
    blocking(move || Ok(file_diff_since_commit(&opened_repo(&app, &repo)?, &commit, &rel_path))).await
}

#[tauri::command]
pub async fn run_lint(app: AppHandle, repo: String) -> Result<LintReport, String> {
    blocking(move || {
        let repo = opened_repo(&app, &repo)?;
        let root = wiki_root_of(&repo)?;
        let python = find_python().ok_or_else(|| "Python 3 not found".to_string())?;
        let script = resource(&app, "validate-wiki.py")?;
        Ok(run_structural_lint_with(python, &repo, &root, &script))
    })
    .await
}

#[tauri::command]
pub async fn git_user_name(app: AppHandle, repo: String) -> Result<Option<String>, String> {
    blocking(move || Ok(wiki_core::git_user_name(&opened_repo(&app, &repo)?))).await
}

#[tauri::command]
pub async fn workflow_prompt(
    app: AppHandle,
    repo: String,
    workflow: String,
) -> Result<String, String> {
    blocking(move || {
        opened_repo(&app, &repo)?;
        let dir = resource(&app, "workflows")?;
        build_workflow_prompt(&workflow, None, &dir)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rp(path: &str) -> RecentProject {
        RecentProject {
            path: path.into(),
            name: path.rsplit('/').next().unwrap_or(path).into(),
        }
    }

    #[test]
    fn is_opened_matches_only_listed_projects_after_canonicalization() {
        let base = std::env::temp_dir().join(format!("cw_opened_{}", std::process::id()));
        let a = base.join("a");
        let b = base.join("b");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        let a_canon = dunce::canonicalize(&a).unwrap();
        let b_canon = dunce::canonicalize(&b).unwrap();

        let listed = vec![RecentProject {
            path: a_canon.to_string_lossy().into_owned(),
            name: "a".into(),
        }];
        assert!(is_opened(&listed, &a_canon));
        assert!(!is_opened(&listed, &b_canon));
        assert!(!is_opened(&[], &a_canon));

        // A stored entry written in a non-canonical spelling still matches.
        let loose = vec![RecentProject {
            path: format!("{}/./", a.display()),
            name: "a".into(),
        }];
        assert!(is_opened(&loose, &a_canon));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn with_recent_fronts_dedupes_and_caps() {
        let list = vec![rp("/a"), rp("/b")];
        let out = with_recent(&list, rp("/b"));
        assert_eq!(out, vec![rp("/b"), rp("/a")]);

        let full: Vec<RecentProject> = (0..MAX_RECENTS).map(|i| rp(&format!("/p{i}"))).collect();
        let out = with_recent(&full, rp("/new"));
        assert_eq!(out.len(), MAX_RECENTS);
        assert_eq!(out[0], rp("/new"));
        assert_eq!(out.last(), Some(&rp(&format!("/p{}", MAX_RECENTS - 2))));

        let out = with_recent(&full, rp("/p3"));
        assert_eq!(out.len(), MAX_RECENTS);
        assert_eq!(out[0], rp("/p3"));
        assert_eq!(out.iter().filter(|r| r.path == "/p3").count(), 1);

        let base = std::env::temp_dir().join(format!("cw_recent_dunce_{}", std::process::id()));
        let nested = base.join("proj");
        std::fs::create_dir_all(&nested).unwrap();
        let via_dot = format!("{}/./proj", base.display());
        let canon = dunce::canonicalize(&nested).unwrap().to_string_lossy().into_owned();
        let out = with_recent(&[rp(&canon)], rp(&via_dot));
        assert_eq!(out.len(), 1);
        let _ = std::fs::remove_dir_all(&base);
    }
}
