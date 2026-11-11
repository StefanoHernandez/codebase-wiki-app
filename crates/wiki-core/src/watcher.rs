use std::path::Path;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

const IGNORED_DIRS: [&str; 3] = [".git", "target", "node_modules"];
const DEBOUNCE: Duration = Duration::from_millis(300);

/// Stops watching when dropped (the debounce thread ends with the watcher's channel).
pub struct WatchHandle {
    _watcher: RecommendedWatcher,
}

/// Recursively watches `repo`, debounced to ~300 ms, and calls `on_change` with
/// the sorted repo-relative (`/`-separated) paths that changed. Paths whose
/// first component is `.git`, `target` or `node_modules` are ignored; a batch made
/// only of ignored paths produces no call.
///
/// Access events (a file or folder opened or closed for reading) are dropped: inotify
/// reports every read, and the app reading the wiki would otherwise reload itself forever.
pub fn watch_repo(
    repo: &Path,
    on_change: impl Fn(Vec<String>) + Send + 'static,
) -> Result<WatchHandle, String> {
    let root = repo
        .canonicalize()
        .map_err(|e| format!("Cannot watch {}: {}", repo.display(), e))?;
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = notify::recommended_watcher(tx).map_err(|e| format!("Failed to start watcher: {}", e))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch {}: {}", root.display(), e))?;
    std::thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut batch = vec![first];
            let deadline = Instant::now() + DEBOUNCE;
            while let Some(left) = deadline.checked_duration_since(Instant::now()) {
                match rx.recv_timeout(left) {
                    Ok(e) => batch.push(e),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            let mut paths: Vec<String> = batch
                .into_iter()
                .filter_map(|r| r.map_err(|e| eprintln!("wiki watcher error: {e}")).ok())
                .filter(|e| !matches!(e.kind, EventKind::Access(_)))
                .flat_map(|e| e.paths)
                .filter_map(|p| relative_path(&root, &p))
                .collect();
            paths.sort();
            paths.dedup();
            if !paths.is_empty() {
                on_change(paths);
            }
        }
    });
    Ok(WatchHandle { _watcher: watcher })
}

fn relative_path(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    if rel.as_os_str().is_empty() {
        return None;
    }
    let first_ignored = rel.components().next().is_some_and(|c| {
        IGNORED_DIRS.iter().any(|d| c.as_os_str() == *d)
    });
    if first_ignored {
        return None;
    }
    Some(rel.to_string_lossy().replace('\\', "/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    fn temp_watch_dir() -> tempfile::TempDir {
        tempfile::Builder::new()
            .prefix("wiki_watch_")
            .tempdir()
            .expect("tempdir")
    }

    #[test]
    fn test_watch_repo_reports_relative_paths_and_ignores_git() {
        let tmp = temp_watch_dir();
        let dir = tmp.path();
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::create_dir_all(dir.join("sub")).unwrap();

        let (tx, rx) = mpsc::channel();
        let handle = watch_repo(dir, move |paths| tx.send(paths).unwrap()).unwrap();
        std::thread::sleep(Duration::from_millis(500));
        while rx.try_recv().is_ok() {}

        fs::write(dir.join(".git/index"), "x").unwrap();
        assert!(
            rx.recv_timeout(Duration::from_millis(800)).is_err(),
            "a write inside .git/ must not trigger the callback"
        );
        while rx.try_recv().is_ok() {}

        fs::write(dir.join("sub/page.md"), "hello").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let paths = loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match rx.recv_timeout(left.min(Duration::from_millis(200))) {
                Ok(p) => break p,
                Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() >= deadline => {
                    panic!("no change reported within 5s");
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => panic!("watcher channel closed"),
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
            }
        };
        assert!(paths.contains(&"sub/page.md".to_string()), "got {:?}", paths);
        assert!(paths.iter().all(|p| !p.starts_with(".git")));

        drop(handle);
    }

    #[test]
    fn test_watch_repo_ignores_reads() {
        let tmp = temp_watch_dir();
        let dir = tmp.path();
        fs::create_dir_all(dir.join("docs")).unwrap();
        fs::write(dir.join("docs/page.md"), "x").unwrap();

        let (tx, rx) = mpsc::channel();
        let handle = watch_repo(dir, move |paths| tx.send(paths).unwrap()).unwrap();
        std::thread::sleep(Duration::from_millis(500));
        while rx.try_recv().is_ok() {}

        fs::read_to_string(dir.join("docs/page.md")).unwrap();
        fs::read_dir(dir.join("docs")).unwrap().for_each(drop);
        assert!(
            rx.recv_timeout(Duration::from_millis(800)).is_err(),
            "reading files must not trigger the callback"
        );

        drop(handle);
    }

    #[test]
    fn test_watch_repo_does_not_ignore_nested_git_dir_name() {
        let tmp = temp_watch_dir();
        let dir = tmp.path();
        fs::create_dir_all(dir.join("sub/.git")).unwrap();

        let (tx, rx) = mpsc::channel();
        let handle = watch_repo(dir, move |paths| tx.send(paths).unwrap()).unwrap();
        std::thread::sleep(Duration::from_millis(500));

        fs::write(dir.join("sub/.git/config"), "x").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let paths = loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match rx.recv_timeout(left.min(Duration::from_millis(200))) {
                Ok(p) => break p,
                Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() >= deadline => {
                    panic!("nested .git path should be reported");
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => panic!("watcher channel closed"),
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
            }
        };
        assert!(
            paths.iter().any(|p| p.contains("sub/.git")),
            "expected nested .git change, got {:?}",
            paths
        );

        drop(handle);
    }
}
