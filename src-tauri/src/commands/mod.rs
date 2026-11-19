mod plugin;
mod python;
mod rag;

pub use plugin::*;
pub use rag::*;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;
use wiki_core::{
    build_workflow_prompt, collect_repo_files, file_diff_since_commit, file_history, FileHistory,
    inspect_git_state, is_git_repo, load_wiki_snapshot_opts, read_repo_file_safe,
    read_wiki_file_safe, resolve_wiki_root, watch_repo_reporting, write_wiki_file_safe,
    write_wiki_files_safe, LintReport, RepoFilePayload, WatchHandle, WikiFileWrite, WikiSnapshot,
};

use python::{find_python, run_lint_with_python};

const RECENTS_FILE: &str = "recent.json";
const RECENTS_KEY: &str = "recents";
const MAX_RECENTS: usize = 12;
pub const WIKI_CHANGED_EVENT: &str = "wiki-changed";
pub const WATCH_ERROR_EVENT: &str = "wiki-watch-error";

#[derive(Debug, Clone, Serialize)]
struct WatchError {
    repo: String,
    message: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    /// Baseline for "news since the last visit", set by `mark_project_seen` (epoch ms).
    #[serde(default)]
    pub last_seen_at: Option<u64>,
    #[serde(default)]
    pub last_seen_commit: Option<String>,
    /// Dated entries in the log page at that visit (news for a wiki git does not track).
    #[serde(default)]
    pub last_seen_log_entries: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNews {
    /// Subjects of wiki commits since the last visit; `None` when git cannot tell.
    pub commits: Option<Vec<String>>,
    pub last_seen_log_entries: Option<usize>,
    pub last_seen_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiChanged {
    pub repo: String,
    pub paths: Vec<String>,
}

fn same_repo_path(a: &str, b: &str) -> bool {
    match (
        dunce::canonicalize(Path::new(a)),
        dunce::canonicalize(Path::new(b)),
    ) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// Pure recents update: `entry` goes to the front, any older entry with the same
/// path is dropped, and the list is capped at `MAX_RECENTS`.
pub fn with_recent(list: &[RecentProject], mut entry: RecentProject) -> Vec<RecentProject> {
    // Re-opening keeps the last-seen baseline: only `mark_project_seen` moves it.
    if let Some(old) = list.iter().find(|r| same_repo_path(&r.path, &entry.path)) {
        if entry.last_seen_at.is_none() {
            entry.last_seen_at = old.last_seen_at;
            entry.last_seen_commit = old.last_seen_commit.clone();
            entry.last_seen_log_entries = old.last_seen_log_entries;
        }
    }
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
pub(super) async fn blocking<T: Send + 'static>(
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
pub(super) fn opened_repo(app: &AppHandle, repo: &str) -> Result<PathBuf, String> {
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

fn snapshot_for(repo: &Path, include_repo_files: bool) -> Result<WikiSnapshot, String> {
    let resolution = resolve_wiki_root(repo);
    match resolution.wiki_root {
        Some(root) => load_wiki_snapshot_opts(repo, &root, include_repo_files),
        None => {
            let repo_files = if include_repo_files {
                collect_repo_files(repo)
            } else {
                Vec::new()
            };
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
    let error_emitter = app.clone();
    let error_repo = repo_str.clone();
    let handle = watch_repo_reporting(
        repo,
        move |paths| {
            let _ = emitter.emit(
                WIKI_CHANGED_EVENT,
                WikiChanged {
                    repo: repo_str.clone(),
                    paths,
                },
            );
        },
        move |message| {
            let _ = error_emitter.emit(
                WATCH_ERROR_EVENT,
                WatchError {
                    repo: error_repo.clone(),
                    message,
                },
            );
        },
    )?;
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
        let snap = snapshot_for(&repo, true)?;
        with_recents_lock(|| {
            let name = repo
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone());
            let entry = RecentProject {
                path: repo.to_string_lossy().into_owned(),
                name,
                ..Default::default()
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
pub async fn load_snapshot(
    app: AppHandle,
    repo: String,
    include_repo_files: Option<bool>,
) -> Result<WikiSnapshot, String> {
    blocking(move || snapshot_for(&opened_repo(&app, &repo)?, include_repo_files.unwrap_or(true)))
        .await
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
pub async fn write_wiki_files(
    app: AppHandle,
    repo: String,
    files: Vec<WikiFileWrite>,
) -> Result<(), String> {
    blocking(move || {
        let repo = opened_repo(&app, &repo)?;
        let root = wiki_root_of(&repo)?;
        write_wiki_files_safe(&repo, &root, &files)
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

/// Language of the messages the backend shows ("it" or "en").
#[tauri::command]
pub fn set_language(lang: String) {
    wiki_core::lang::set_english(lang == "en");
}

const RELEASE_PAGE: &str = "https://github.com/StefanoHernandez/codebase-wiki-app/releases/latest";

/// False where the updater cannot replace the app: Linux installed from `.deb`/`.rpm`
/// (only the AppImage self-updates). The banner then offers the release page.
#[tauri::command]
pub fn updater_supported() -> bool {
    !cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some()
}

/// Opens the latest release page in the default browser (fixed URL, nothing from the page).
#[tauri::command]
pub fn open_release_page() -> Result<(), String> {
    let program = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(windows) {
        "explorer"
    } else {
        "xdg-open"
    };
    wiki_core::no_window_command(program)
        .arg(RELEASE_PAGE)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Commits for the graph timeline (Grafo → Storia), oldest first.
#[tauri::command]
pub async fn graph_history(app: AppHandle, repo: String) -> Result<FileHistory, String> {
    blocking(move || Ok(file_history(&opened_repo(&app, &repo)?, 2000))).await
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
pub async fn run_lint(
    app: AppHandle,
    repo: String,
    python_path: Option<String>,
) -> Result<LintReport, String> {
    blocking(move || {
        let repo = opened_repo(&app, &repo)?;
        let root = wiki_root_of(&repo)?;
        let python = find_python(python_path.as_deref())?;
        let script = resource(&app, "validate-wiki.py")?;
        Ok(run_lint_with_python(&python, &repo, &root, &script))
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
        build_workflow_prompt(&workflow, None)
    })
    .await
}

/// Moves the "news since the last visit" baseline of an opened project to now.
#[tauri::command]
pub async fn mark_project_seen(
    app: AppHandle,
    repo: String,
    log_entries: Option<usize>,
) -> Result<(), String> {
    blocking(move || {
        let canonical = opened_repo(&app, &repo)?;
        with_recents_lock(|| {
            let mut list = read_recents(&app)?;
            for r in list
                .iter_mut()
                .filter(|r| same_repo_path(&r.path, &canonical.to_string_lossy()))
            {
                r.last_seen_at = Some(rag_core::activity::now_ms());
                r.last_seen_commit = wiki_core::head_commit(&canonical);
                r.last_seen_log_entries = log_entries;
            }
            write_recents(&app, &list)
        })
    })
    .await
}

/// What changed in the wiki of a recent project since its last visit.
#[tauri::command]
pub async fn project_news(app: AppHandle, repo: String) -> Result<ProjectNews, String> {
    blocking(move || {
        let canonical = opened_repo(&app, &repo)?;
        let entry = read_recents(&app)?
            .into_iter()
            .find(|r| same_repo_path(&r.path, &canonical.to_string_lossy()))
            .unwrap_or_default();
        let wiki = resolve_wiki_root(&canonical).wiki_root;
        let commits = match (&entry.last_seen_commit, &wiki) {
            (Some(c), Some(w)) if !wiki_core::is_ignored(&canonical, w) => {
                wiki_core::wiki_commits_since(&canonical, c, w)
            }
            _ => None,
        };
        Ok(ProjectNews {
            commits,
            last_seen_log_entries: entry.last_seen_log_entries,
            last_seen_at: entry.last_seen_at,
        })
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
            ..Default::default()
        }
    }

    #[test]
    fn old_recents_json_loads() {
        let list: Vec<RecentProject> =
            serde_json::from_str(r#"[{"path":"/p","name":"p"}]"#).unwrap();
        assert_eq!(list[0].last_seen_at, None);
        assert_eq!(list[0].last_seen_commit, None);
    }

    #[test]
    fn with_recent_keeps_baseline() {
        let old = RecentProject {
            last_seen_commit: Some("abc".into()),
            last_seen_at: Some(5),
            ..rp("/p")
        };
        let out = with_recent(&[old], rp("/p"));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].last_seen_commit.as_deref(), Some("abc"));
        assert_eq!(out[0].last_seen_at, Some(5));
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
            ..Default::default()
        }];
        assert!(is_opened(&listed, &a_canon));
        assert!(!is_opened(&listed, &b_canon));
        assert!(!is_opened(&[], &a_canon));

        // A stored entry written in a non-canonical spelling still matches.
        let loose = vec![RecentProject {
            path: format!("{}/./", a.display()),
            name: "a".into(),
            ..Default::default()
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
        let canon = dunce::canonicalize(&nested)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let out = with_recent(&[rp(&canon)], rp(&via_dot));
        assert_eq!(out.len(), 1);
        let _ = std::fs::remove_dir_all(&base);
    }
}
