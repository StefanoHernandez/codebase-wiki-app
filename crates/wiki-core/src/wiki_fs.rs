use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Component, Path};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::git_ops::{self, GitState};
use crate::wiki_resolver;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiPageEntry {
    pub wiki_rel_path: String,
    pub content: String,
    pub size_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read_error: Option<String>,
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

const PRIVATE_TERMS_SYMLINK_MSG: &str =
    "`.private-terms` è un collegamento simbolico: scrittura rifiutata.";
const FORBIDDEN_TERM_MSG: &str = "Il testo contiene un termine vietato da .private-terms.";
const SHA_MISMATCH_MSG: &str =
    "Il file è cambiato sul disco dopo la lettura; modifica annullata.";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiFileWrite {
    pub rel_path: String,
    pub content: String,
    pub expected_sha256: String,
}

fn sha256_hex_utf8(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn wiki_content_sha256(content: &str) -> String {
    sha256_hex_utf8(content)
}

fn current_target_sha256(target_path: &Path) -> Result<String, String> {
    match fs::read_to_string(target_path) {
        Ok(text) => Ok(sha256_hex_utf8(&text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(sha256_hex_utf8("")),
        Err(e) => Err(format!(
            "Failed to read {} before write: {}",
            target_path.display(),
            e
        )),
    }
}

fn read_private_terms(wiki_dir: &Path) -> Result<Option<String>, String> {
    let private_terms_path = wiki_dir.join(".private-terms");
    match fs::symlink_metadata(&private_terms_path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            return Err(PRIVATE_TERMS_SYMLINK_MSG.into());
        }
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Cannot read .private-terms, write refused: {}", e)),
    }
    match fs::read_to_string(&private_terms_path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Cannot read .private-terms, write refused: {}", e)),
    }
}

fn content_has_forbidden_term(terms_content: &str, content: &str) -> bool {
    let terms_content = terms_content.trim_start_matches('\u{feff}');
    let lower_content = content.to_lowercase();
    for line in terms_content.lines() {
        let term = line.trim();
        if term.is_empty() || term.starts_with('#') {
            continue;
        }
        if lower_content.contains(&term.to_lowercase()) {
            return true;
        }
    }
    false
}

struct PendingWrite {
    target_path: std::path::PathBuf,
    tmp_path: std::path::PathBuf,
    expected_sha256: String,
}

fn remove_pending_temps(pending: &[PendingWrite]) {
    for p in pending {
        let _ = fs::remove_file(&p.tmp_path);
    }
}

/// Validates, writes temp files, checks on-disk hashes, then renames in order.
pub fn write_wiki_files_safe(
    repo_path: &Path,
    wiki_root: &str,
    files: &[WikiFileWrite],
) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }

    let wiki_dir = repo_path.join(wiki_root);
    let terms_content = read_private_terms(&wiki_dir)?;

    let mut plans = Vec::with_capacity(files.len());
    for file in files {
        let target_path = resolve_wiki_target(repo_path, wiki_root, &file.rel_path, "written")?;
        if let Some(ref terms) = terms_content {
            if content_has_forbidden_term(terms, &file.content) {
                return Err(FORBIDDEN_TERM_MSG.into());
            }
        }

        let file_name = target_path
            .file_name()
            .ok_or("Invalid wiki file name")?
            .to_string_lossy();
        let parent = target_path.parent().ok_or("Invalid wiki file path")?;
        let pid = std::process::id();
        let tmp_name = format!(".{}.tmp-{}", file_name, pid);
        let tmp_path = parent.join(&tmp_name);

        plans.push((
            file.content.clone(),
            PendingWrite {
                target_path,
                tmp_path,
                expected_sha256: file.expected_sha256.clone(),
            },
        ));
    }

    let mut pending = Vec::with_capacity(plans.len());
    for (content, plan) in plans {
        if let Some(parent) = plan.target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directories: {}", e))?;
        }

        let tmp_path = plan.tmp_path.clone();
        let write_result = (|| -> Result<(), String> {
            let mut f = File::create(&tmp_path)
                .map_err(|e| format!("Failed to write temp file {}: {}", tmp_path.display(), e))?;
            f.write_all(content.as_bytes())
                .map_err(|e| format!("Failed to write temp file {}: {}", tmp_path.display(), e))?;
            f.sync_all()
                .map_err(|e| format!("Failed to sync temp file {}: {}", tmp_path.display(), e))?;
            Ok(())
        })();

        if let Err(e) = write_result {
            remove_pending_temps(&pending);
            return Err(e);
        }

        pending.push(plan);
    }

    for p in &pending {
        let actual = current_target_sha256(&p.target_path)?;
        if actual != p.expected_sha256 {
            remove_pending_temps(&pending);
            return Err(SHA_MISMATCH_MSG.into());
        }
    }

    let mut renamed = 0usize;
    for p in &pending {
        if let Err(e) = fs::rename(&p.tmp_path, &p.target_path) {
            for rest in &pending[renamed..] {
                let _ = fs::remove_file(&rest.tmp_path);
            }
            return Err(format!(
                "Failed to write file {}: {}",
                p.target_path.display(),
                e
            ));
        }
        renamed += 1;
    }

    Ok(())
}

fn resolve_wiki_target(
    repo_path: &Path,
    wiki_root: &str,
    wiki_rel_path: &str,
    access: &str,
) -> Result<std::path::PathBuf, String> {
    wiki_resolver::ensure_wiki_inside_repo(repo_path, wiki_root)?;
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
    let expected_sha256 = current_target_sha256(&target_path)?;
    write_wiki_files_safe(
        repo_path,
        wiki_root,
        &[WikiFileWrite {
            rel_path: wiki_rel_path.to_string(),
            content: content.to_string(),
            expected_sha256,
        }],
    )
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

    fn tmp_leftovers(wiki: &Path) -> Vec<String> {
        let pid = std::process::id();
        let mut leftovers = Vec::new();
        for entry in fs::read_dir(wiki).unwrap() {
            let name = entry.unwrap().file_name().to_string_lossy().into_owned();
            if name.contains(&format!(".tmp-{}", pid)) {
                leftovers.push(name);
            }
        }
        leftovers
    }

    #[test]
    fn batch_forbidden_in_second_file_skips_first() {
        let td = TestDir::new("batch_forbidden");
        let repo = td.path();
        let wiki = repo.join("wiki");
        fs::create_dir_all(&wiki).unwrap();
        fs::write(wiki.join("a.md"), "keep-a").unwrap();
        fs::write(wiki.join("b.md"), "keep-b").unwrap();
        fs::write(wiki.join(".private-terms"), "secret\n").unwrap();

        let err = write_wiki_files_safe(
            repo,
            "wiki",
            &[
                WikiFileWrite {
                    rel_path: "a.md".into(),
                    content: "new-a".into(),
                    expected_sha256: wiki_content_sha256("keep-a"),
                },
                WikiFileWrite {
                    rel_path: "b.md".into(),
                    content: "leak secret".into(),
                    expected_sha256: wiki_content_sha256("keep-b"),
                },
            ],
        )
        .unwrap_err();
        assert_eq!(err, FORBIDDEN_TERM_MSG);
        assert_eq!(fs::read_to_string(wiki.join("a.md")).unwrap(), "keep-a");
        assert_eq!(fs::read_to_string(wiki.join("b.md")).unwrap(), "keep-b");
        assert!(tmp_leftovers(&wiki).is_empty());
    }

    #[test]
    fn batch_sha_mismatch_aborts_without_tmp() {
        let td = TestDir::new("batch_sha");
        let repo = td.path();
        let wiki = repo.join("wiki");
        fs::create_dir_all(&wiki).unwrap();
        fs::write(wiki.join("a.md"), "on-disk").unwrap();

        let err = write_wiki_files_safe(
            repo,
            "wiki",
            &[WikiFileWrite {
                rel_path: "a.md".into(),
                content: "wanted".into(),
                expected_sha256: wiki_content_sha256("stale-read"),
            }],
        )
        .unwrap_err();
        assert_eq!(err, SHA_MISMATCH_MSG);
        assert_eq!(fs::read_to_string(wiki.join("a.md")).unwrap(), "on-disk");
        assert!(tmp_leftovers(&wiki).is_empty());
    }

    #[test]
    fn batch_success_leaves_no_tmp_files() {
        let td = TestDir::new("batch_ok");
        let repo = td.path();
        let wiki = repo.join("wiki");
        fs::create_dir_all(&wiki).unwrap();
        fs::write(wiki.join("a.md"), "v1").unwrap();
        fs::write(wiki.join("log.md"), "old-log").unwrap();

        write_wiki_files_safe(
            repo,
            "wiki",
            &[
                WikiFileWrite {
                    rel_path: "a.md".into(),
                    content: "v2".into(),
                    expected_sha256: wiki_content_sha256("v1"),
                },
                WikiFileWrite {
                    rel_path: "log.md".into(),
                    content: "new-log".into(),
                    expected_sha256: wiki_content_sha256("old-log"),
                },
            ],
        )
        .unwrap();

        assert_eq!(fs::read_to_string(wiki.join("a.md")).unwrap(), "v2");
        assert_eq!(fs::read_to_string(wiki.join("log.md")).unwrap(), "new-log");
        assert!(tmp_leftovers(&wiki).is_empty());
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

    #[test]
    fn wiki_symlink_outside_repo_is_rejected() {
        let td = TestDir::new("wiki_outside");
        let repo = td.path();
        #[cfg(unix)]
        {
            let outside = td.path().parent().unwrap().join(format!(
                "outside_wiki_{}_{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            let _ = fs::remove_dir_all(&outside);
            fs::create_dir_all(&outside).unwrap();
            fs::write(outside.join("SCHEMA.md"), "# Schema\n").unwrap();
            std::os::unix::fs::symlink(&outside, repo.join("wiki")).unwrap();
            let err = load_wiki_snapshot(repo, "wiki").unwrap_err();
            assert_eq!(err, wiki_resolver::WIKI_OUTSIDE_REPO);
        }
    }

    #[test]
    fn private_terms_symlink_refuses_write() {
        let td = TestDir::new("terms_symlink");
        let repo = td.path();
        let wiki = repo.join("wiki");
        fs::create_dir_all(&wiki).unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(wiki.join("terms.txt"), wiki.join(".private-terms")).unwrap();
            fs::write(wiki.join("terms.txt"), "secret\n").unwrap();
            let err = write_wiki_file_safe(repo, "wiki", "p.md", "clean").unwrap_err();
            assert_eq!(err, PRIVATE_TERMS_SYMLINK_MSG);
        }
    }

    #[test]
    fn forbidden_term_error_never_contains_term() {
        let td = TestDir::new("term_leak");
        let repo = td.path();
        let wiki = repo.join("wiki");
        fs::create_dir_all(&wiki).unwrap();
        fs::write(wiki.join(".private-terms"), "ULTRA_SECRET_CODENAME\n").unwrap();
        let err =
            write_wiki_file_safe(repo, "wiki", "p.md", "mentions ULTRA_SECRET_CODENAME here")
                .unwrap_err();
        assert_eq!(err, FORBIDDEN_TERM_MSG);
        assert!(!err.to_lowercase().contains("ultra_secret"));
    }

    #[cfg(unix)]
    #[test]
    fn snapshot_skips_symlink_whose_target_is_private_terms() {
        let td = TestDir::new("snap_terms_link");
        let repo = td.path();
        let wiki = repo.join("wiki");
        fs::create_dir_all(&wiki).unwrap();
        fs::write(wiki.join("SCHEMA.md"), "# Schema\n").unwrap();
        fs::write(wiki.join(".private-terms"), "secret\n").unwrap();
        std::os::unix::fs::symlink(wiki.join(".private-terms"), wiki.join("alias.md")).unwrap();
        let snapshot = load_wiki_snapshot(repo, "wiki").unwrap();
        let paths: Vec<_> = snapshot.pages.iter().map(|p| p.wiki_rel_path.as_str()).collect();
        assert!(!paths.iter().any(|p| *p == "alias.md"));
        assert!(!paths.iter().any(|p| *p == ".private-terms"));
    }

    #[test]
    fn snapshot_lists_unreadable_page_with_read_error() {
        let td = TestDir::new("snap_read_err");
        let repo = td.path();
        let wiki = repo.join("wiki");
        fs::create_dir_all(&wiki).unwrap();
        fs::write(wiki.join("SCHEMA.md"), "# Schema\n").unwrap();
        fs::write(wiki.join("bad.md"), [0xFF, 0xFE, b'x', 0]).unwrap();
        let snapshot = load_wiki_snapshot(repo, "wiki").unwrap();
        let bad = snapshot
            .pages
            .iter()
            .find(|p| p.wiki_rel_path == "bad.md")
            .expect("bad.md listed");
        assert!(bad.read_error.is_some());
        assert_eq!(bad.content, "");
    }

    #[test]
    fn symlinked_dir_outside_wiki_is_not_snapshotted() {
        let td = TestDir::new("snap_symlink");
        let repo = td.path();
        let wiki = repo.join("wiki");
        fs::create_dir_all(&wiki).unwrap();
        fs::write(wiki.join("SCHEMA.md"), "# Schema\n").unwrap();
        fs::write(wiki.join("inside.md"), "in").unwrap();
        #[cfg(unix)]
        {
            let outside = repo.parent().unwrap().join(format!(
                "leak_{}_{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            let _ = fs::remove_dir_all(&outside);
            fs::create_dir_all(&outside).unwrap();
            fs::write(outside.join("leaked.md"), "oops").unwrap();
            std::os::unix::fs::symlink(&outside, wiki.join("link")).unwrap();
            let snapshot = load_wiki_snapshot(repo, "wiki").unwrap();
            let paths: Vec<_> = snapshot.pages.iter().map(|p| p.wiki_rel_path.as_str()).collect();
            assert!(paths.iter().any(|p| *p == "inside.md"));
            assert!(!paths.iter().any(|p| p.contains("leaked")));
        }
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

    let canon_base = base_dir.canonicalize().ok();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.file_name().map(|n| n == ".private-terms").unwrap_or(false) {
            continue;
        }
        let is_symlink = fs::symlink_metadata(&path)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false);
        if is_symlink {
            if fs::metadata(&path).map(|m| m.is_dir()).unwrap_or(false) {
                continue;
            }
            if !path.extension().map(|ext| ext == "md").unwrap_or(false) {
                continue;
            }
        } else if path.is_dir() {
            collect_wiki_pages_recursive(&path, base_dir, pages);
            continue;
        } else if !path.is_file() || !path.extension().map(|ext| ext == "md").unwrap_or(false) {
            continue;
        }

        let keep = match (&canon_base, path.canonicalize()) {
            (Some(base), Ok(canon_path)) => canon_path.starts_with(base),
            _ => false,
        };
        if !keep {
            continue;
        }
        if let Ok(canon_path) = path.canonicalize() {
            if canon_path
                .components()
                .any(|c| is_private_terms_name(c.as_os_str()))
            {
                continue;
            }
        }
        if let Ok(rel) = path.strip_prefix(base_dir) {
            let wiki_rel_path = rel.to_string_lossy().replace('\\', "/");
            let size_bytes = path.metadata().map(|m| m.len()).unwrap_or(0);
            let (content, read_error) = match fs::read_to_string(&path) {
                Ok(text) => (text, None),
                Err(e) => (String::new(), Some(format!("Failed to read wiki page: {}", e))),
            };
            pages.push(WikiPageEntry {
                wiki_rel_path,
                content,
                size_bytes,
                read_error,
            });
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
    wiki_resolver::ensure_wiki_inside_repo(repo_path, wiki_root)?;
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
