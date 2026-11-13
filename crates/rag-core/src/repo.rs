use std::path::{Path, PathBuf};
use wiki_core::no_window_command;

use sha2::{Digest, Sha256};
use wiki_core::{ensure_wiki_inside_repo, resolve_wiki_root};

pub fn resolve_repo(arg: Option<&Path>) -> Result<PathBuf, String> {
    let start = if let Some(p) = arg {
        p.to_path_buf()
    } else if let Ok(env) = std::env::var("CODEBASE_WIKI_REPO") {
        if !env.is_empty() {
            PathBuf::from(env)
        } else {
            std::env::current_dir().map_err(|e| e.to_string())?
        }
    } else {
        std::env::current_dir().map_err(|e| e.to_string())?
    };
    find_git_root(start).ok_or_else(|| "Repository git non trovato".into())
}

fn find_git_root(mut dir: PathBuf) -> Option<PathBuf> {
    loop {
        if dir.join(".git").exists() {
            return dir.canonicalize().ok();
        }
        if !dir.pop() {
            return None;
        }
    }
}

pub fn repo_id(root: &Path) -> String {
    let canon = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut s = canon.display().to_string();
    if cfg!(any(target_os = "macos", target_os = "windows")) {
        s = s.to_lowercase();
    }
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    let hex = format!("{:x}", hasher.finalize());
    hex[..16].to_string()
}

pub fn head_sha(root: &Path) -> Option<String> {
    let out = no_window_command("git")
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

pub fn wiki_root(root: &Path) -> Option<String> {
    let res = resolve_wiki_root(root);
    let wiki = res.wiki_root?;
    ensure_wiki_inside_repo(root, &wiki).ok()?;
    Some(wiki)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(repo: &Path, args: &[&str]) {
        let out = Command::new("git").arg("-C").arg(repo).args(args).output().unwrap();
        assert!(out.status.success());
    }

    #[test]
    fn repo_id_is_stable_16_hex() {
        let td = tempfile::tempdir().unwrap();
        git(td.path(), &["init", "-q"]);
        let id1 = repo_id(td.path());
        let id2 = repo_id(td.path());
        assert_eq!(id1, id2);
        assert_eq!(id1.len(), 16);
        assert!(id1.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
