use std::fs;
use std::path::{Path, PathBuf};
use wiki_core::no_window_command;

use serde::{Deserialize, Serialize};
use wiki_core::is_private_terms_name;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileSource {
    Code,
    Wiki,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileEntry {
    pub rel_path: String,
    pub source: FileSource,
    pub size: u64,
    pub mtime: i64,
}

const MAX_BYTES: u64 = 512 * 1024;

/// Source files to index: tracked and untracked-not-ignored, minus the wiki folder, prose
/// (Markdown, text) and data. Only code is searched; the wiki is read through its Core map,
/// where an old plan or a template cannot outrank the page that is current.
pub fn list_files(root: &Path, wiki_root: Option<&str>) -> Result<Vec<FileEntry>, String> {
    let out = no_window_command("git")
        .arg("-C")
        .arg(root)
        .args(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("git ls-files fallito".into());
    }
    let wiki_prefix = wiki_root.map(|w| format!("{}/", w.trim_end_matches('/')));
    let mut entries = Vec::new();
    for chunk in out.stdout.split(|&b| b == 0) {
        if chunk.is_empty() {
            continue;
        }
        let rel_str = String::from_utf8_lossy(chunk).to_string();
        let rel_path = PathBuf::from(&rel_str);
        if rel_path.components().any(|c| is_private_terms_name(c.as_os_str())) {
            continue;
        }
        if wiki_prefix.as_ref().is_some_and(|wp| rel_str.starts_with(wp)) || is_prose(&rel_str) || is_lock_or_noise(&rel_str) {
            continue;
        }
        let full = root.join(&rel_path);
        // A symlink is never followed: it could point outside the repo (~/.ssh, another project).
        let Ok(meta) = fs::symlink_metadata(&full) else { continue };
        if !meta.file_type().is_file() || meta.len() > MAX_BYTES {
            continue;
        }
        if is_binary_or_non_utf8(&full).unwrap_or(true) {
            continue;
        }
        entries.push(FileEntry { rel_path: rel_str, source: FileSource::Code, size: meta.len(), mtime: file_mtime(&meta) });
    }
    entries.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    Ok(entries)
}

fn is_prose(rel: &str) -> bool {
    let lower = rel.to_lowercase();
    [".md", ".mdx", ".markdown", ".rst", ".txt", ".adoc"].iter().any(|e| lower.ends_with(e))
}

fn is_lock_or_noise(rel: &str) -> bool {
    let lower = rel.to_lowercase();
    if lower.ends_with(".lock")
        || lower.ends_with("package-lock.json")
        || lower.ends_with("pnpm-lock.yaml")
        || lower.ends_with("yarn.lock")
        || lower.ends_with("cargo.lock")
    {
        return true;
    }
    if lower.contains(".min.") || lower.ends_with(".map") {
        return true;
    }
    // Data and logs: rows of numbers, not something a question is answered from. A 90 MB
    // benchmark folder turned one repo into 77k chunks and a half-hour index.
    const DATA: [&str; 7] = [".csv", ".tsv", ".jsonl", ".ndjson", ".log", ".err", ".out"];
    DATA.iter().any(|e| lower.ends_with(e))
}

fn file_mtime(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn is_binary_or_non_utf8(path: &Path) -> Result<bool, String> {
    let data = fs::read(path).map_err(|e| e.to_string())?;
    let probe = data.len().min(8192);
    if data[..probe].contains(&0) {
        return Ok(true);
    }
    Ok(std::str::from_utf8(&data).is_err())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(repo: &Path, args: &[&str]) {
        let out = Command::new("git").arg("-C").arg(repo).args(args).output().unwrap();
        assert!(out.status.success(), "{args:?}");
    }

    #[test]
    fn list_files_filters_git_tree() {
        let td = tempfile::tempdir().unwrap();
        let root = td.path();
        git(root, &["init", "-q"]);
        git(root, &["config", "user.email", "t@example.com"]);
        git(root, &["config", "user.name", "t"]);
        fs::write(root.join(".gitignore"), "ignored/\n").unwrap();
        fs::write(root.join("tracked.rs"), "fn main() {}\n").unwrap();
        fs::write(root.join("untracked.rs"), "// u\n").unwrap();
        fs::create_dir_all(root.join("ignored")).unwrap();
        fs::write(root.join("ignored/x.rs"), "x").unwrap();
        fs::write(root.join("Cargo.lock"), "v1").unwrap();
        fs::write(root.join("runs.csv"), "a,b\n1,2\n").unwrap();
        fs::write(root.join("run.err"), "boom\n").unwrap();
        let mut bin = vec![0u8];
        bin.extend_from_slice(b"BIN");
        fs::write(root.join("bin.dat"), &bin).unwrap();
        fs::create_dir_all(root.join("wiki")).unwrap();
        fs::write(root.join("wiki/SCHEMA.md"), "## Excluded paths\n- `reports/**`\n").unwrap();
        fs::write(root.join("wiki/.private-terms"), "secret\n").unwrap();
        fs::write(root.join("wiki/ok.md"), "ok\n").unwrap();
        fs::create_dir_all(root.join("wiki/reports")).unwrap();
        fs::write(root.join("wiki/reports/hidden.md"), "hide\n").unwrap();
        git(root, &["add", "tracked.rs", "wiki/SCHEMA.md", "wiki/ok.md", "wiki/reports/hidden.md"]);
        git(root, &["commit", "-qm", "init"]);
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::write(root.join("docs/plan.md"), "plan\n").unwrap();
        fs::write(root.join("wiki/data.json"), "{}\n").unwrap();
        let files = list_files(root, Some("wiki")).unwrap_or_else(|e| panic!("list_files: {e}"));
        let paths: Vec<_> = files.iter().map(|f| f.rel_path.as_str()).collect();
        assert!(paths.contains(&"tracked.rs"));
        assert!(paths.contains(&"untracked.rs"));
        assert!(!paths.iter().any(|p| p.contains("ignored/")));
        assert!(!paths.contains(&"Cargo.lock"));
        assert!(!paths.contains(&"runs.csv") && !paths.contains(&"run.err"));
        assert!(!paths.contains(&"bin.dat"));
        assert!(!paths.iter().any(|p| p.contains(".private-terms")));
        // Code only: nothing under the wiki folder, no prose anywhere.
        assert!(!paths.iter().any(|p| p.starts_with("wiki/")));
        assert!(!paths.contains(&"docs/plan.md"));
        let src = |p: &str| files.iter().find(|f| f.rel_path == p).map(|f| f.source);
        assert_eq!(src("tracked.rs"), Some(FileSource::Code));
    }

    #[test]
    fn prose_is_not_code() {
        assert!(is_prose("docs/plan.md") && is_prose("README.MD") && is_prose("notes.txt"));
        assert!(!is_prose("src/a.tsx") && !is_prose("config.yaml"));
    }

    #[test]
    #[cfg(unix)]
    fn symlinks_are_not_followed() {
        let td = tempfile::tempdir().unwrap();
        let root = td.path().join("repo");
        fs::create_dir_all(&root).unwrap();
        git(&root, &["init", "-q"]);
        let outside = td.path().join("secret.rs");
        fs::write(&outside, "fn secret() {}").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link.rs")).unwrap();
        fs::write(root.join("real.rs"), "fn real() {}").unwrap();
        let files = list_files(&root, None).unwrap();
        let paths: Vec<_> = files.iter().map(|f| f.rel_path.as_str()).collect();
        assert_eq!(paths, vec!["real.rs"]);
    }
}
