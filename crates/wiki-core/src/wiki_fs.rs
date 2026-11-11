use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path};
use serde::{Deserialize, Serialize};

use crate::git_ops::{self, GitState};
use crate::wiki_resolver;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiPageEntry {
    pub wiki_rel_path: String,
    pub content: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiSnapshot {
    pub repo_path: String,
    pub wiki_root: Option<String>,
    pub is_initialized: bool,
    pub warning: Option<String>,
    pub git_state: GitState,
    pub pages: Vec<WikiPageEntry>,
    pub repo_files: Vec<String>,
    pub changed_files_by_page: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoFilePayload {
    pub rel_path: String,
    pub content: String,
    pub diff: String,
}

/// True for any spelling the OS may resolve to `.private-terms`: case-insensitive
/// (APFS/NTFS) and ignoring trailing dots/spaces (Windows).
fn is_private_terms_name(name: &std::ffi::OsStr) -> bool {
    name.to_string_lossy()
        .trim_end_matches(['.', ' '])
        .eq_ignore_ascii_case(".private-terms")
}

fn is_safe_relative_path(path_str: &str) -> bool {
    let p = Path::new(path_str);
    if p.is_absolute() {
        return false;
    }
    for comp in p.components() {
        match comp {
            Component::ParentDir => return false,
            Component::Normal(s) => {
                // `:` would allow NTFS alternate data streams (`.private-terms::$DATA`).
                if is_private_terms_name(s) || s.to_string_lossy().contains(':') {
                    return false;
                }
            }
            Component::RootDir | Component::Prefix(_) => return false,
            _ => {}
        }
    }
    true
}

pub fn read_repo_file_safe(
    repo_path: &Path,
    rel_path: &str,
    source_commit: Option<&str>,
) -> Result<RepoFilePayload, String> {
    if !is_safe_relative_path(rel_path) {
        return Err("Unsafe file path: path traversal or sensitive file access blocked".into());
    }

    let full_path = repo_path.join(rel_path);
    if !full_path.is_file() {
        return Err(format!("File not found: {}", rel_path));
    }

    let canon_repo = repo_path
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize repo path: {}", e))?;
    let canon_file = full_path
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize target file: {}", e))?;

    if !canon_file.starts_with(&canon_repo) {
        return Err("Access denied: path escapes repository root".into());
    }

    if canon_file
        .components()
        .any(|c| is_private_terms_name(c.as_os_str()))
    {
        return Err("Access denied: .private-terms cannot be read".into());
    }

    let content = fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    let diff = git_ops::file_diff_since_commit(repo_path, source_commit.unwrap_or(""), rel_path);

    Ok(RepoFilePayload {
        rel_path: rel_path.to_string(),
        content,
        diff,
    })
}

fn resolve_wiki_target(
    repo_path: &Path,
    wiki_root: &str,
    wiki_rel_path: &str,
    access: &str,
) -> Result<std::path::PathBuf, String> {
    if !wiki_resolver::is_valid_wiki_folder_name(wiki_root) {
        return Err(format!("Invalid wiki root: {}", wiki_root));
    }
    if !is_safe_relative_path(wiki_rel_path) {
        return Err("Unsafe wiki path: path traversal or sensitive file access blocked".into());
    }

    let wiki_dir = repo_path.join(wiki_root);
    let target_path = wiki_dir.join(wiki_rel_path);

    let canon_wiki = wiki_dir
        .canonicalize()
        .map_err(|e| format!("Wiki directory not found: {}", e))?;
    let mut probe = target_path.as_path();
    while probe.symlink_metadata().is_err() {
        probe = probe.parent().ok_or("Target path escapes wiki root")?;
    }
    match probe.canonicalize() {
        Ok(canon) if canon.starts_with(&canon_wiki) => {
            if canon.components().any(|c| is_private_terms_name(c.as_os_str())) {
                return Err(format!("Access denied: .private-terms cannot be {}", access));
            }
        }
        _ => return Err("Target path escapes wiki root".into()),
    }

    Ok(target_path)
}

/// Reads `<repo>/<wiki_root>/<wiki_rel_path>` with the same confinement rules as
/// [`write_wiki_file_safe`]. Refuses `.private-terms` and non-UTF-8 content.
pub fn read_wiki_file_safe(
    repo_path: &Path,
    wiki_root: &str,
    wiki_rel_path: &str,
) -> Result<String, String> {
    let target_path = resolve_wiki_target(repo_path, wiki_root, wiki_rel_path, "read")?;
    fs::read_to_string(&target_path).map_err(|e| format!("Failed to read file {}: {}", wiki_rel_path, e))
}

/// Writes `content` to `<repo>/<wiki_root>/<wiki_rel_path>`. Refuses paths that
/// escape the wiki root, any `.private-terms` target, and content containing a
/// term listed in `<wiki_root>/.private-terms` (case-insensitive).
pub fn write_wiki_file_safe(
    repo_path: &Path,
    wiki_root: &str,
    wiki_rel_path: &str,
    content: &str,
) -> Result<(), String> {
    let target_path = resolve_wiki_target(repo_path, wiki_root, wiki_rel_path, "written")?;
    let wiki_dir = repo_path.join(wiki_root);

    // `.private-terms` in the wiki root is the source of truth for forbidden terms.
    let private_terms_path = wiki_dir.join(".private-terms");
    // Fail closed: an existing but unreadable terms file refuses the write.
    let terms_content = match fs::read_to_string(&private_terms_path) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Cannot read .private-terms, write refused: {}", e)),
    };
    if let Some(terms_content) = terms_content {
        let terms_content = terms_content.trim_start_matches('\u{feff}');
        let lower_content = content.to_lowercase();
        for line in terms_content.lines() {
            let term = line.trim();
            if term.is_empty() || term.starts_with('#') {
                continue;
            }
            if lower_content.contains(&term.to_lowercase()) {
                return Err(format!("Content contains forbidden sensitive term: '{}'", term));
            }
        }
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directories: {}", e))?;
    }

    let file_name = target_path
        .file_name()
        .ok_or("Invalid wiki file name")?
        .to_string_lossy();
    let parent = target_path
        .parent()
        .ok_or("Invalid wiki file path")?;
    let pid = std::process::id();
    let tmp_name = format!(".{}.tmp-{}", file_name, pid);
    let tmp_path = parent.join(&tmp_name);

    fs::write(&tmp_path, content.as_bytes())
        .map_err(|e| format!("Failed to write temp file {}: {}", tmp_path.display(), e))?;
    fs::rename(&tmp_path, &target_path)
        .map_err(|e| format!("Failed to write file {}: {}", target_path.display(), e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(200);
            let count = COUNTER.fetch_add(1, Ordering::SeqCst);
            let dir = std::env::temp_dir().join(format!(
                "wiki_fs_{}_{}_{}",
                name,
                std::process::id(),
                count
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Self { path: dir }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    impl TestDir {
        fn path(&self) -> &Path {
            &self.path
        }
    }

    #[test]
    fn read_wiki_refuses_private_terms_and_escape() {
        let td = TestDir::new("read_guard");
        let repo = td.path();
        let wiki = repo.join("wiki");
        fs::create_dir_all(&wiki).unwrap();
        fs::write(wiki.join("ok.md"), "hello").unwrap();
        fs::write(wiki.join(".private-terms"), "secret\n").unwrap();

        assert_eq!(read_wiki_file_safe(repo, "wiki", "ok.md").unwrap(), "hello");
        assert!(read_wiki_file_safe(repo, "wiki", ".private-terms").is_err());
        assert!(read_wiki_file_safe(repo, "wiki", "../outside.md").is_err());
    }

    #[test]
    fn read_wiki_rejects_non_utf8() {
        let td = TestDir::new("read_utf8");
        let repo = td.path();
        let wiki = repo.join("wiki");
        fs::create_dir_all(&wiki).unwrap();
        let path = wiki.join("bin.md");
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(&[0xFF, 0xFE, 0x41]).unwrap();
        assert!(read_wiki_file_safe(repo, "wiki", "bin.md").is_err());
    }

    #[test]
    fn write_wiki_atomic_leaves_no_tmp_file() {
        let td = TestDir::new("atomic");
        let repo = td.path();
        let wiki = repo.join("wiki");
        fs::create_dir_all(&wiki).unwrap();
        let pid = std::process::id();

        write_wiki_file_safe(repo, "wiki", "log.md", "v1").unwrap();
        write_wiki_file_safe(repo, "wiki", "log.md", "v2").unwrap();
        assert_eq!(fs::read_to_string(wiki.join("log.md")).unwrap(), "v2");

        let mut leftovers = Vec::new();
        for entry in fs::read_dir(&wiki).unwrap() {
            let name = entry.unwrap().file_name().to_string_lossy().into_owned();
            if name.contains(&format!(".tmp-{}", pid)) {
                leftovers.push(name);
            }
        }
        assert!(leftovers.is_empty(), "temp files left behind: {:?}", leftovers);
    }
}

fn clean_source_path(raw: &str) -> String {
    let without_hash = raw.split('#').next().unwrap_or(raw).trim();
    static LINE_RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = LINE_RE.get_or_init(|| regex::Regex::new(r":\d+(?::\d+)?$").unwrap());
    re.replace(without_hash, "").trim().to_string()
}

fn extract_frontmatter_sources_and_commit(content: &str) -> (Option<String>, Vec<String>) {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() || lines[0].trim() != "---" {
        return (None, Vec::new());
    }

    let end_idx = match lines[1..].iter().position(|l| l.trim() == "---") {
        Some(idx) => idx + 1,
        None => return (None, Vec::new()),
    };

    let mut source_commit = None;
    let mut sources = Vec::new();
    let mut in_sources = false;

    for line in &lines[1..end_idx] {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("source_commit:") {
            let c = rest.trim().trim_matches('"').trim_matches('\'');
            if !c.is_empty() {
                source_commit = Some(c.to_string());
            }
            in_sources = false;
        } else if trimmed.starts_with("sources:") {
            in_sources = true;
        } else if in_sources && line.starts_with("  - ") {
            let item = line[4..].trim().trim_matches('"').trim_matches('\'');
            let cleaned = clean_source_path(item);
            if !cleaned.is_empty() {
                sources.push(cleaned);
            }
        } else if !line.starts_with("  ") {
            in_sources = false;
        }
    }

    (source_commit, sources)
}

fn collect_wiki_pages_recursive(
    dir: &Path,
    base_dir: &Path,
    pages: &mut Vec<WikiPageEntry>,
) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.file_name().map(|n| n == ".private-terms").unwrap_or(false) {
            continue;
        }
        if path.is_dir() {
            collect_wiki_pages_recursive(&path, base_dir, pages);
        } else if path.is_file() && path.extension().map(|ext| ext == "md").unwrap_or(false) {
            if let Ok(canon_base) = base_dir.canonicalize() {
                if let Ok(canon_path) = path.canonicalize() {
                    if !canon_path.starts_with(&canon_base) {
                        continue;
                    }
                }
            }
            if let Ok(rel) = path.strip_prefix(base_dir) {
                let wiki_rel_path = rel.to_string_lossy().replace('\\', "/");
                let content = fs::read_to_string(&path).unwrap_or_default();
                let size_bytes = path.metadata().map(|m| m.len()).unwrap_or(0);
                pages.push(WikiPageEntry {
                    wiki_rel_path,
                    content,
                    size_bytes,
                });
            }
        }
    }
}

pub fn collect_repo_files_recursive(
    dir: &Path,
    repo_path: &Path,
    files: &mut Vec<String>,
) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(file_name) = path.file_name() {
            let name_str = file_name.to_string_lossy();
            if name_str.starts_with('.')
                || name_str == "node_modules"
                || name_str == "target"
            {
                continue;
            }
        }

        if path.is_dir() {
            collect_repo_files_recursive(&path, repo_path, files);
        } else if path.is_file() {
            if let Ok(canon_repo) = repo_path.canonicalize() {
                if let Ok(canon_path) = path.canonicalize() {
                    if !canon_path.starts_with(&canon_repo) {
                        continue;
                    }
                }
            }
            if let Ok(rel) = path.strip_prefix(repo_path) {
                files.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
}

/// Reads every wiki page plus git/drift state. Lint is not run here; call
/// `validator::run_structural_lint` separately.
pub fn load_wiki_snapshot(repo_path: &Path, wiki_root: &str) -> Result<WikiSnapshot, String> {
    let wiki_dir = repo_path.join(wiki_root);
    if !wiki_dir.is_dir() {
        return Err(format!("Wiki directory '{}' not found", wiki_root));
    }

    let mut pages = Vec::new();
    collect_wiki_pages_recursive(&wiki_dir, &wiki_dir, &mut pages);
    pages.sort_by(|a, b| a.wiki_rel_path.cmp(&b.wiki_rel_path));

    let mut repo_files = Vec::new();
    collect_repo_files_recursive(repo_path, repo_path, &mut repo_files);
    repo_files.sort();
    repo_files.dedup();

    let mut changed_files_by_page = BTreeMap::new();
    for page in &pages {
        let (source_commit, sources) = extract_frontmatter_sources_and_commit(&page.content);
        if let Some(commit) = source_commit {
            if !sources.is_empty() {
                let changed = git_ops::changed_files_since_commit(repo_path, &commit, &sources);
                changed_files_by_page.insert(page.wiki_rel_path.clone(), changed);
            }
        }
    }

    let handoff_path = format!("{}/agent/handoff.md", wiki_root);
    let git_state = git_ops::inspect_git_state(repo_path, Some(&handoff_path));
    let resolution = wiki_resolver::resolve_wiki_root(repo_path);

    Ok(WikiSnapshot {
        repo_path: repo_path.to_string_lossy().into_owned(),
        wiki_root: Some(wiki_root.to_string()),
        is_initialized: resolution.is_initialized,
        warning: resolution.warning,
        git_state,
        pages,
        repo_files,
        changed_files_by_page,
    })
}
