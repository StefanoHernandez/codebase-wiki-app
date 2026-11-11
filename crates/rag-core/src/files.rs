use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use wiki_core::{glob_match, is_private_terms_name, parse_excluded_globs};

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

pub fn list_files(
    root: &Path,
    wiki_root: Option<&str>,
    excluded_globs: &[String],
) -> Result<Vec<FileEntry>, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args([
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("git ls-files fallito".into());
    }
    let wiki_prefix = wiki_root.map(|w| format!("{}/", w.trim_end_matches('/')));
    let mut stdout = out.stdout;
    // A wiki the project keeps out of git (`wiki` in .gitignore) is still the wiki: list it too.
    if let Some(w) = wiki_root {
        let ignored = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--"])
            .arg(w)
            .output()
            .map_err(|e| e.to_string())?;
        if ignored.status.success() {
            stdout.push(0);
            stdout.extend(ignored.stdout);
        }
    }
    let mut entries = Vec::new();
    let mut paths: Vec<PathBuf> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for chunk in stdout.split(|&b| b == 0) {
        if chunk.is_empty() || !seen.insert(chunk) {
            continue;
        }
        let rel = String::from_utf8_lossy(chunk).to_string();
        paths.push(PathBuf::from(rel));
    }
    for rel_path in paths {
        let rel_str = rel_path.to_string_lossy().to_string();
        if rel_path
            .components()
            .any(|c| is_private_terms_name(c.as_os_str()))
        {
            continue;
        }
        if is_lock_or_noise(&rel_str) {
            continue;
        }
        let full = root.join(&rel_path);
        // A symlink is never followed: it could point outside the repo (~/.ssh, another project).
        let Ok(meta) = fs::symlink_metadata(&full) else { continue };
        if !meta.file_type().is_file() {
            continue;
        }
        let size = meta.len();
        if size > MAX_BYTES {
            continue;
        }
        let mtime = file_mtime(&meta);
        if is_binary_or_non_utf8(&full).unwrap_or(true) {
            continue;
        }
        let source = if let Some(ref wp) = wiki_prefix {
            if rel_str.starts_with(wp) {
                let wiki_rel = rel_str.strip_prefix(wp).unwrap_or(&rel_str);
                if excluded_globs
                    .iter()
                    .any(|g| glob_match(g, wiki_rel))
                {
                    continue;
                }
                FileSource::Wiki
            } else {
                prose_or_code(&rel_str)
            }
        } else {
            prose_or_code(&rel_str)
        };
        entries.push(FileEntry {
            rel_path: rel_str,
            source,
            size,
            mtime,
        });
    }
    entries.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    Ok(entries)
}

pub fn excluded_globs_from_wiki(root: &Path, wiki_root: &str) -> Vec<String> {
    let schema = root.join(wiki_root).join("SCHEMA.md");
    let Ok(text) = fs::read_to_string(schema) else {
        return Vec::new();
    };
    parse_excluded_globs(&text)
}

/// Prose outside the wiki (README, docs/, plans) is searched with the wiki, not with the code:
/// `search_code` answers "where is it in the code", `search_wiki` "what do the docs say".
fn prose_or_code(rel: &str) -> FileSource {
    let lower = rel.to_lowercase();
    if [".md", ".mdx", ".markdown", ".rst", ".txt", ".adoc"].iter().any(|e| lower.ends_with(e)) {
        FileSource::Wiki
    } else {
        FileSource::Code
    }
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
    false
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
        let globs = excluded_globs_from_wiki(root, "wiki");
        let files = list_files(root, Some("wiki"), &globs).unwrap_or_else(|e| panic!("list_files: {e}"));
        let paths: Vec<_> = files.iter().map(|f| f.rel_path.as_str()).collect();
        assert!(paths.contains(&"tracked.rs"));
        assert!(paths.contains(&"untracked.rs"));
        assert!(!paths.iter().any(|p| p.contains("ignored/")));
        assert!(!paths.contains(&"Cargo.lock"));
        assert!(!paths.contains(&"bin.dat"));
        assert!(!paths.iter().any(|p| p.contains(".private-terms")));
        assert!(!paths.contains(&"wiki/reports/hidden.md"));
        assert!(paths.contains(&"wiki/ok.md"));
        let src = |p: &str| files.iter().find(|f| f.rel_path == p).map(|f| f.source);
        assert_eq!(src("tracked.rs"), Some(FileSource::Code));
    }

    #[test]
    fn gitignored_wiki_is_still_listed() {
        let td = tempfile::tempdir().unwrap();
        let root = td.path();
        git(root, &["init", "-q"]);
        fs::write(root.join(".gitignore"), "wiki\nbuild/\n").unwrap();
        fs::write(root.join("main.rs"), "fn main() {}\n").unwrap();
        fs::create_dir_all(root.join("wiki/project")).unwrap();
        fs::write(root.join("wiki/project/status.md"), "# Status\n").unwrap();
        fs::write(root.join("wiki/.private-terms"), "secret\n").unwrap();
        fs::create_dir_all(root.join("build")).unwrap();
        fs::write(root.join("build/out.rs"), "x").unwrap();
        let files = list_files(root, Some("wiki"), &[]).unwrap();
        let paths: Vec<_> = files.iter().map(|f| f.rel_path.as_str()).collect();
        assert_eq!(paths, [".gitignore", "main.rs", "wiki/project/status.md"]);
        assert_eq!(files[2].source, FileSource::Wiki);
    }

    #[test]
    fn prose_goes_with_the_wiki() {
        assert_eq!(prose_or_code("docs/plan.md"), FileSource::Wiki);
        assert_eq!(prose_or_code("README.MD"), FileSource::Wiki);
        assert_eq!(prose_or_code("src/a.tsx"), FileSource::Code);
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
        let files = list_files(&root, None, &[]).unwrap();
        let paths: Vec<_> = files.iter().map(|f| f.rel_path.as_str()).collect();
        assert_eq!(paths, vec!["real.rs"]);
    }
}
