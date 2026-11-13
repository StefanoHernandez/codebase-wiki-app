use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;
use wiki_core::{
    build_workflow_prompt, collect_repo_files_recursive, file_diff_since_commit, file_history, FileHistory, inspect_git_state,
    is_git_repo, load_wiki_snapshot, read_repo_file_safe, resolve_wiki_root,
    read_wiki_file_safe, run_structural_lint_with, watch_repo_reporting,
    write_wiki_file_safe, write_wiki_files_safe, LintReport, RepoFilePayload, WatchHandle,
    WikiFileWrite, WikiSnapshot,
};

pub const PYTHON_NOT_FOUND_MSG: &str = "Il controllo strutturale richiede Python 3.10 o più recente. Installalo (python.org, oppure `brew install python` su macOS) o indica il percorso nelle impostazioni.";

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
            let _ = error_emitter.emit(WATCH_ERROR_EVENT, WatchError { repo: error_repo.clone(), message });
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

const PYTHON_VERSION_SNIPPET: &str = "import sys;print(sys.version_info[0],sys.version_info[1])";

#[derive(Clone, Debug, PartialEq, Eq)]
enum ResolvedPython {
    Executable(PathBuf),
    #[cfg(windows)]
    PyDash3,
}

#[derive(Clone, Debug, Default)]
struct PythonCache {
    setting: Option<String>,
    resolved: Option<ResolvedPython>,
    /// Last failed lookup for this setting. Lint now runs on every load, so without this every
    /// watcher event would probe all candidates again; it expires so an install is picked up.
    failed_at: Option<std::time::Instant>,
}

const PYTHON_RETRY_AFTER: std::time::Duration = std::time::Duration::from_secs(60);

static PYTHON_CACHE: OnceLock<Mutex<PythonCache>> = OnceLock::new();

fn python_cache() -> &'static Mutex<PythonCache> {
    PYTHON_CACHE.get_or_init(|| Mutex::new(PythonCache::default()))
}

fn python_meets_minimum(major: u32, minor: u32) -> bool {
    major > 3 || (major == 3 && minor >= 10)
}

fn parse_version_stdout(text: &str) -> Option<(u32, u32)> {
    let parts: Vec<&str> = text.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }
    let major = parts[0].parse().ok()?;
    let minor = parts[1].parse().ok()?;
    Some((major, minor))
}

fn python_version_at(path: &Path) -> Option<(u32, u32)> {
    let output = wiki_core::no_window_command(path)
        .arg("-c")
        .arg(PYTHON_VERSION_SNIPPET)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_version_stdout(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(windows)]
fn python_version_py_dash_3() -> Option<(u32, u32)> {
    let output = wiki_core::no_window_command("py")
        .arg("-3")
        .arg("-c")
        .arg(PYTHON_VERSION_SNIPPET)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_version_stdout(&String::from_utf8_lossy(&output.stdout))
}

/// Returns the first candidate whose reported version is ≥ Python 3.10.
pub fn choose_python(
    candidates: &[PathBuf],
    version: impl Fn(&Path) -> Option<(u32, u32)>,
) -> Option<PathBuf> {
    for path in candidates {
        let Some((major, minor)) = version(path) else {
            continue;
        };
        if python_meets_minimum(major, minor) {
            return Some(path.clone());
        }
    }
    None
}

fn executable_on_path(name: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&paths) {
        let plain = dir.join(name);
        if plain.is_file() {
            return Some(plain);
        }
        #[cfg(windows)]
        {
            let with_exe = dir.join(format!("{name}.exe"));
            if with_exe.is_file() {
                return Some(with_exe);
            }
        }
    }
    None
}

fn push_candidate(list: &mut Vec<PathBuf>, path: PathBuf) {
    let dup = list.iter().any(|existing| {
        match (
            dunce::canonicalize(existing),
            dunce::canonicalize(&path),
        ) {
            (Ok(a), Ok(b)) => a == b,
            _ => existing == &path,
        }
    });
    if !dup {
        list.push(path);
    }
}

fn python_path_candidates(setting: Option<&Path>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(p) = setting {
        if !p.as_os_str().is_empty() {
            push_candidate(&mut out, p.to_path_buf());
        }
    }
    for name in [
        "python3.13",
        "python3.12",
        "python3.11",
        "python3.10",
        "python3",
        "python",
    ] {
        if let Some(p) = executable_on_path(name) {
            push_candidate(&mut out, p);
        }
    }
    for p in ["/opt/homebrew/bin/python3", "/usr/local/bin/python3"] {
        let path = PathBuf::from(p);
        if path.is_file() {
            push_candidate(&mut out, path);
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let shim = PathBuf::from(home).join(".pyenv/shims/python3");
        if shim.is_file() {
            push_candidate(&mut out, shim);
        }
    }
    out
}

fn resolve_python(setting: Option<&str>) -> Result<ResolvedPython, String> {
    let setting_path = setting
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    let candidates = python_path_candidates(setting_path.as_deref());
    if let Some(path) = choose_python(&candidates, python_version_at) {
        return Ok(ResolvedPython::Executable(path));
    }
    #[cfg(windows)]
    if python_version_py_dash_3()
        .map(|(maj, min)| python_meets_minimum(maj, min))
        .unwrap_or(false)
    {
        return Ok(ResolvedPython::PyDash3);
    }
    Err(PYTHON_NOT_FOUND_MSG.to_string())
}

fn find_python(setting: Option<&str>) -> Result<ResolvedPython, String> {
    let normalized = setting
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    let mut cache = python_cache()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if cache.setting == normalized {
        if let Some(resolved) = cache.resolved.clone() {
            return Ok(resolved);
        }
        if cache.failed_at.is_some_and(|t| t.elapsed() < PYTHON_RETRY_AFTER) {
            return Err(PYTHON_NOT_FOUND_MSG.to_string());
        }
    } else {
        cache.setting = normalized.clone();
        cache.resolved = None;
        cache.failed_at = None;
    }
    match resolve_python(normalized.as_deref()) {
        Ok(resolved) => {
            cache.resolved = Some(resolved.clone());
            cache.failed_at = None;
            Ok(resolved)
        }
        Err(e) => {
            cache.failed_at = Some(std::time::Instant::now());
            Err(e)
        }
    }
}

fn run_lint_with_python(
    resolved: &ResolvedPython,
    repo: &Path,
    wiki_root: &str,
    script: &Path,
) -> LintReport {
    match resolved {
        ResolvedPython::Executable(path) => {
            let bin = path.to_string_lossy();
            run_structural_lint_with(&bin, repo, wiki_root, script)
        }
        #[cfg(windows)]
        ResolvedPython::PyDash3 => wiki_core::run_structural_lint_with_args(
            "py",
            &["-3"],
            repo,
            wiki_root,
            script,
        ),
    }
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

/// The app's own bundled sidecar (always the same version as the app); the stable copy in
/// `<data>/bin` is for the agents and may be stale on Windows.
fn rag_bin() -> Result<PathBuf, String> {
    crate::rag_sidecar::rag_sidecar_path().or_else(|e| {
        let stable = rag_core::bin_path();
        if stable.is_file() { Ok(stable) } else { Err(e) }
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
        return Err(err.unwrap_or_else(|| "Comando sidecar fallito".into()));
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
pub async fn rag_status(repo: String) -> Result<serde_json::Value, String> {
    blocking(move || {
        let bin = rag_bin()?;
        let stdout = run_sidecar_output(&bin, &["status", "--repo", &repo, "--json"])?;
        let mut v: serde_json::Value =
            serde_json::from_slice(&stdout).map_err(|e| e.to_string())?;
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
    blocking(move || {
        let bin = rag_bin()?;
        let stdout = run_sidecar_output(&bin, &["models", "list", "--json"])?;
        serde_json::from_slice(&stdout).map_err(|e| e.to_string())
    })
    .await
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
    let bin = rag_bin()?;
    Arc::clone(&jobs).start_index(app, repo, &bin)
}

#[tauri::command]
pub fn rag_index_cancel(
    repo: String,
    jobs: tauri::State<'_, Arc<crate::rag_jobs::RagJobs>>,
) -> Result<(), String> {
    jobs.cancel_index(&repo)
}

/// Deletes this repo's index (db + WAL/SHM). Refused while an index job runs on it.
#[tauri::command]
pub fn rag_index_delete(
    repo: String,
    jobs: tauri::State<'_, Arc<crate::rag_jobs::RagJobs>>,
) -> Result<(), String> {
    if jobs.index_running(&repo) {
        return Err("Indicizzazione in corso: annullala prima di cancellare l'indice".into());
    }
    // Same resolution as the sidecar, so the id matches the index it wrote.
    let root = rag_core::resolve_repo(Some(std::path::Path::new(&repo)))?;
    rag_core::delete_index(&rag_core::index_path(&rag_core::repo_id(&root)))
}

/// Deletes a downloaded model's files. Its catalog row stays, so it can be downloaded again.
/// Refused while a download or any index job runs (both read the model directory).
#[tauri::command]
pub fn rag_model_remove(
    id: String,
    jobs: tauri::State<'_, Arc<crate::rag_jobs::RagJobs>>,
) -> Result<(), String> {
    let safe = !id.is_empty() && id != "." && id != ".." && id.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    if !safe {
        return Err(format!("id modello non valido: {id}"));
    }
    if jobs.pull_running() || jobs.any_index_running() {
        return Err("Download o indicizzazione in corso: aspetta che finisca".into());
    }
    let dir = rag_core::model_dir(&id);
    if !dir.is_dir() {
        return Err(format!("{id} non è installato"));
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
    repo: String,
    query: String,
) -> Result<Vec<RagSearchHit>, String> {
    blocking(move || {
        let bin = rag_bin()?;
        let args = ["search", "--repo", &repo, "-k", "8", "--json", &query];
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
                    .unwrap_or("Ricerca fallita")
                    .to_string());
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

/// Moves the "news since the last visit" baseline of an opened project to now.
#[tauri::command]
pub async fn mark_project_seen(app: AppHandle, repo: String, log_entries: Option<usize>) -> Result<(), String> {
    blocking(move || {
        let canonical = opened_repo(&app, &repo)?;
        with_recents_lock(|| {
            let mut list = read_recents(&app)?;
            for r in list.iter_mut().filter(|r| same_repo_path(&r.path, &canonical.to_string_lossy())) {
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

/// The latest MCP tool calls across every repository, newest first.
#[tauri::command]
pub async fn agent_activity(limit: usize) -> Result<Vec<rag_core::activity::ActivityLine>, String> {
    blocking(move || {
        let mut lines = rag_core::activity::read_all(&rag_core::paths::activity_dir(), limit.min(1000));
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
        other => Err(format!("azione sconosciuta: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn program_names_add_windows_extensions() {
        assert_eq!(program_names("claude", false), vec!["claude"]);
        assert_eq!(program_names("codex", true), vec!["codex.exe", "codex.cmd", "codex.bat"]);
    }

    fn rp(path: &str) -> RecentProject {
        RecentProject {
            path: path.into(),
            name: path.rsplit('/').next().unwrap_or(path).into(),
            ..Default::default()
        }
    }

    #[test]
    fn old_recents_json_loads() {
        let list: Vec<RecentProject> = serde_json::from_str(r#"[{"path":"/p","name":"p"}]"#).unwrap();
        assert_eq!(list[0].last_seen_at, None);
        assert_eq!(list[0].last_seen_commit, None);
    }

    #[test]
    fn with_recent_keeps_baseline() {
        let old = RecentProject { last_seen_commit: Some("abc".into()), last_seen_at: Some(5), ..rp("/p") };
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
        let canon = dunce::canonicalize(&nested).unwrap().to_string_lossy().into_owned();
        let out = with_recent(&[rp(&canon)], rp(&via_dot));
        assert_eq!(out.len(), 1);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn choose_python_skips_below_3_10() {
        let candidates = vec![
            PathBuf::from("/opt/python3.9"),
            PathBuf::from("/opt/python3.11"),
        ];
        let chosen = choose_python(&candidates, |p| {
            if p.ends_with("python3.9") {
                Some((3, 9))
            } else if p.ends_with("python3.11") {
                Some((3, 11))
            } else {
                None
            }
        });
        assert_eq!(chosen, Some(PathBuf::from("/opt/python3.11")));
    }

    #[test]
    fn choose_python_returns_none_when_no_suitable_candidate() {
        let candidates = vec![PathBuf::from("/opt/python3.9")];
        assert_eq!(
            choose_python(&candidates, |_| Some((3, 9))),
            None
        );
        assert_eq!(choose_python(&candidates, |_| None), None);
    }

    #[test]
    fn choose_python_skips_unversioned_then_picks_valid() {
        let candidates = vec![
            PathBuf::from("/missing/settings/python3"),
            PathBuf::from("/opt/python3.11"),
        ];
        let chosen = choose_python(&candidates, |p| {
            if p.ends_with("settings/python3") {
                None
            } else if p.ends_with("python3.11") {
                Some((3, 11))
            } else {
                None
            }
        });
        assert_eq!(chosen, Some(PathBuf::from("/opt/python3.11")));
    }

    #[test]
    fn choose_python_skips_failing_version_probe_then_picks_valid() {
        let candidates = vec![
            PathBuf::from("/broken/python3"),
            PathBuf::from("/opt/python3.12"),
        ];
        let chosen = choose_python(&candidates, |p| {
            if p.ends_with("broken/python3") {
                None
            } else if p.ends_with("python3.12") {
                Some((3, 12))
            } else {
                None
            }
        });
        assert_eq!(chosen, Some(PathBuf::from("/opt/python3.12")));
    }
}

// ---- Plugin install (Impostazioni → Agenti) ----

use rag_core::plugin_install::{self, AgentDirs, PluginPreview, PluginRow, Runner, REPO_URL};

/// Runs agent CLIs and git. A GUI app on macOS starts with a minimal PATH, so the usual
/// install folders are added (also for `#!/usr/bin/env node` wrappers such as `codex`).
struct CliRunner {
    path: std::ffi::OsString,
}

impl CliRunner {
    fn new() -> Self {
        let home = plugin_install::home_dir();
        let mut dirs_list: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default();
        for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
            dirs_list.push(PathBuf::from(extra));
        }
        for extra in [
            ".local/bin",
            ".claude/local",
            ".npm-global/bin",
            ".volta/bin",
            ".asdf/shims",
            ".local/share/mise/shims",
            ".bun/bin",
            ".cargo/bin",
        ] {
            dirs_list.push(home.join(extra));
        }
        // Windows: npm global installs (claude.cmd, codex.cmd) live in %APPDATA%\npm.
        if let Some(appdata) = std::env::var_os("APPDATA") {
            dirs_list.push(PathBuf::from(appdata).join("npm"));
        }
        // nvm keeps one bin folder per node version; any of them serves `env node`.
        if let Ok(versions) = std::fs::read_dir(home.join(".nvm/versions/node")) {
            dirs_list.extend(versions.flatten().map(|v| v.path().join("bin")));
        }
        Self { path: std::env::join_paths(dirs_list).unwrap_or_default() }
    }

    fn resolve(&self, program: &str) -> Option<PathBuf> {
        let names = program_names(program, cfg!(windows));
        std::env::split_paths(&self.path)
            .flat_map(|d| names.iter().map(move |n| d.join(n)).collect::<Vec<_>>())
            .find(|p| p.is_file())
    }
}

/// File names a program can have on disk: on Windows `claude` is `claude.exe` or an npm
/// `claude.cmd` wrapper (Rust runs `.cmd`/`.bat` through cmd.exe with safe quoting).
fn program_names(program: &str, windows: bool) -> Vec<String> {
    if windows {
        ["exe", "cmd", "bat"].iter().map(|ext| format!("{program}.{ext}")).collect()
    } else {
        vec![program.to_string()]
    }
}

impl Runner for CliRunner {
    fn run(&self, args: &[&str]) -> Result<String, String> {
        let (program, rest) = args.split_first().ok_or("comando vuoto")?;
        let exe = self.resolve(program).ok_or_else(|| format!("{program}: comando non trovato"))?;
        let mut cmd = wiki_core::no_window_command(exe);
        let mut child = cmd
            .args(rest)
            .env("PATH", &self.path)
            // Never wait for a person: no stdin, no git credential prompt.
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("{program}: {e}"))?;
        let read = |pipe: Option<Box<dyn std::io::Read + Send>>| {
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                if let Some(mut p) = pipe {
                    let _ = p.read_to_end(&mut buf);
                }
                buf
            })
        };
        let stdout = read(child.stdout.take().map(|p| Box::new(p) as Box<dyn std::io::Read + Send>));
        let stderr = read(child.stderr.take().map(|p| Box::new(p) as Box<dyn std::io::Read + Send>));
        let deadline = std::time::Instant::now() + CLI_TIMEOUT;
        let status = loop {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                break status;
            }
            if std::time::Instant::now() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{program}: nessuna risposta dopo {} s", CLI_TIMEOUT.as_secs()));
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        };
        let out = stdout.join().unwrap_or_default();
        let err = String::from_utf8_lossy(&stderr.join().unwrap_or_default()).trim().to_string();
        if status.success() {
            Ok(String::from_utf8_lossy(&out).into_owned())
        } else {
            Err(if err.is_empty() { format!("{program}: uscita {status}") } else { err })
        }
    }
}

const CLI_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);
const LATEST_RETRY: std::time::Duration = std::time::Duration::from_secs(60);

/// Newest released plugin version, remembered once known. A failed lookup (offline) is retried
/// after a minute; the network call runs without holding the lock.
fn latest_plugin_version(runner: &dyn Runner) -> Option<String> {
    static LATEST: Mutex<(Option<String>, Option<std::time::Instant>)> = Mutex::new((None, None));
    {
        let cached = LATEST.lock().unwrap_or_else(|e| e.into_inner());
        if cached.0.is_some() || cached.1.is_some_and(|t| t.elapsed() < LATEST_RETRY) {
            return cached.0.clone();
        }
    }
    let found = runner
        .run(&["git", "ls-remote", "--tags", REPO_URL])
        .ok()
        .and_then(|out| plugin_install::latest_tag(&out));
    let mut cached = LATEST.lock().unwrap_or_else(|e| e.into_inner());
    *cached = (found.clone(), found.is_none().then(std::time::Instant::now));
    found
}

/// Shallow checkout of the plugin repo at `v<version>` under the data dir.
fn plugin_source(runner: &dyn Runner, version: &str) -> Result<PathBuf, String> {
    let dir = rag_core::paths::data_dir().join("plugin-src");
    let tag = format!("v{version}");
    let d = dir.to_string_lossy().into_owned();
    if dir.join(".git").is_dir() {
        runner.run(&["git", "-C", &d, "fetch", "--depth", "1", "origin", "tag", &tag])?;
        runner.run(&["git", "-C", &d, "checkout", "--force", &tag])?;
        // Files of older versions must not be copied into the agents.
        runner.run(&["git", "-C", &d, "clean", "-fdx"])?;
    } else {
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        }
        runner.run(&["git", "clone", "--depth", "1", "--branch", &tag, REPO_URL, &d])?;
    }
    Ok(dir)
}

#[tauri::command]
pub async fn plugin_state() -> Result<Vec<PluginRow>, String> {
    blocking(|| {
        let runner = CliRunner::new();
        let latest = latest_plugin_version(&runner);
        Ok(plugin_install::plugin_state(&AgentDirs::real(), &runner, latest.as_deref()))
    })
    .await
}

#[tauri::command]
pub async fn plugin_preview(agent: String) -> Result<PluginPreview, String> {
    blocking(move || plugin_install::plugin_preview(&agent, &AgentDirs::real(), &CliRunner::new())).await
}

#[tauri::command]
pub async fn plugin_apply(agent: String) -> Result<(), String> {
    blocking(move || {
        let runner = CliRunner::new();
        let needs_source = matches!(agent.as_str(), "antigravity" | "cursor" | "opencode");
        let latest = latest_plugin_version(&runner);
        let source = match (&latest, needs_source) {
            (Some(v), true) => Some(plugin_source(&runner, v)?),
            (None, true) => return Err("Versione del plugin non disponibile: controlla la connessione e riprova.".into()),
            _ => None,
        };
        plugin_install::plugin_apply(&agent, &AgentDirs::real(), &runner, source.as_deref(), latest.as_deref())
    })
    .await
}
