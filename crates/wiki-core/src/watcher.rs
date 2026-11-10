use std::path::Path;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};

const IGNORED_DIRS: [&str; 3] = [".git", "target", "node_modules"];

/// Stops watching when dropped.
pub struct WatchHandle {
    _debouncer: Debouncer<RecommendedWatcher>,
}

/// Recursively watches `repo`, debounced to ~300 ms, and calls `on_change` with
/// the sorted repo-relative (`/`-separated) paths that changed. Paths with a
/// `.git`, `target` or `node_modules` component are ignored; a batch made only
/// of ignored paths produces no call.
pub fn watch_repo(
    repo: &Path,
    on_change: impl Fn(Vec<String>) + Send + 'static,
) -> Result<WatchHandle, String> {
    let root = repo
        .canonicalize()
        .map_err(|e| format!("Cannot watch {}: {}", repo.display(), e))?;
    let base = root.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(300), move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let mut paths: Vec<String> = events
            .iter()
            .filter_map(|e| relative_path(&base, &e.path))
            .collect();
        paths.sort();
        paths.dedup();
        if !paths.is_empty() {
            on_change(paths);
        }
    })
    .map_err(|e| format!("Failed to start watcher: {}", e))?;
    debouncer
        .watcher()
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch {}: {}", root.display(), e))?;
    Ok(WatchHandle { _debouncer: debouncer })
}

fn relative_path(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    if rel.as_os_str().is_empty()
        || rel
            .components()
            .any(|c| IGNORED_DIRS.iter().any(|d| c.as_os_str() == *d))
    {
        return None;
    }
    Some(rel.to_string_lossy().replace('\\', "/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn test_watch_repo_reports_relative_paths_and_ignores_git() {
        let dir = std::env::temp_dir().join(format!("wiki_watch_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::create_dir_all(dir.join("sub")).unwrap();

        let (tx, rx) = mpsc::channel();
        let handle = watch_repo(&dir, move |paths| tx.send(paths).unwrap()).unwrap();
        std::thread::sleep(Duration::from_millis(200));

        fs::write(dir.join(".git/index"), "x").unwrap();
        assert!(
            rx.recv_timeout(Duration::from_millis(1500)).is_err(),
            "a write inside .git/ must not trigger the callback"
        );

        fs::write(dir.join("sub/page.md"), "hello").unwrap();
        let paths = rx.recv_timeout(Duration::from_secs(3)).expect("no change reported");
        assert!(paths.contains(&"sub/page.md".to_string()), "got {:?}", paths);
        assert!(paths.iter().all(|p| !p.starts_with(".git")));

        drop(handle);
        let _ = fs::remove_dir_all(&dir);
    }
}
