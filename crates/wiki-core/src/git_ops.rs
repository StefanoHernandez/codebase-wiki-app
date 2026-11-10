use std::path::Path;
use std::process::Command;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitState {
    pub head_sha: String,
    pub branch: String,
    pub is_dirty: bool,
    pub dirty_files: Vec<String>,
    pub handoff_commits_behind: u32,
}

pub fn inspect_git_state(repo_path: &Path, handoff_rel_path: Option<&str>) -> GitState {
    let head_sha = Command::new("git")
        .args(["-C"])
        .arg(repo_path)
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".into());

    let branch = Command::new("git")
        .args(["-C"])
        .arg(repo_path)
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".into());

    // `-z`: NUL-separated, never quoted. Renames/copies are `XY new\0old\0`.
    let mut dirty_files = Vec::new();
    if let Ok(output) = Command::new("git")
        .args(["-C"])
        .arg(repo_path)
        .args(["status", "--porcelain", "-z"])
        .output()
    {
        if output.status.success() {
            let mut entries = output.stdout.split(|&b| b == 0);
            while let Some(entry) = entries.next() {
                if entry.len() < 4 {
                    continue;
                }
                if entry[..2].iter().any(|&c| c == b'R' || c == b'C') {
                    entries.next();
                }
                dirty_files.push(String::from_utf8_lossy(&entry[3..]).into_owned());
            }
        }
    }
    let is_dirty = !dirty_files.is_empty();

    let mut handoff_commits_behind = 0;
    if let Some(hpath) = handoff_rel_path {
        if repo_path.join(hpath).exists() {
            let log_out = Command::new("git")
                .args(["-C"])
                .arg(repo_path)
                .args(["log", "-1", "--format=%H", "--", hpath])
                .output()
                .ok();

            if let Some(lo) = log_out {
                if lo.status.success() {
                    let last_commit = String::from_utf8_lossy(&lo.stdout).trim().to_string();
                    if !last_commit.is_empty() {
                        let count_out = Command::new("git")
                            .args(["-C"])
                            .arg(repo_path)
                            .args(["rev-list", "--count", &format!("{}..HEAD", last_commit)])
                            .output()
                            .ok();

                        if let Some(co) = count_out {
                            if co.status.success() {
                                let c_str = String::from_utf8_lossy(&co.stdout).trim().to_string();
                                handoff_commits_behind = c_str.parse::<u32>().unwrap_or(0);
                            }
                        }
                    }
                }
            }
        }
    }

    GitState {
        head_sha,
        branch,
        is_dirty,
        dirty_files,
        handoff_commits_behind,
    }
}

/// Resolves `commit` to a full sha if it names a commit that is an ancestor of
/// HEAD. Option-like input is never parsed as a git option.
fn resolve_ancestor_commit(repo_path: &Path, commit: &str) -> Option<String> {
    let out = Command::new("git")
        .args(["-C"])
        .arg(repo_path)
        .args(["rev-parse", "--verify", "--end-of-options", &format!("{}^{{commit}}", commit)])
        .output()
        .ok()
        .filter(|o| o.status.success())?;
    let resolved = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if resolved.is_empty() {
        return None;
    }
    Command::new("git")
        .args(["-C"])
        .arg(repo_path)
        .args(["merge-base", "--is-ancestor", &resolved, "HEAD"])
        .status()
        .ok()
        .filter(|st| st.success())
        .map(|_| resolved)
}

pub fn changed_files_since_commit(
    repo_path: &Path,
    source_commit: &str,
    sources: &[String],
) -> Vec<String> {
    let commit = source_commit.trim();
    if commit.is_empty() || commit.eq_ignore_ascii_case("unknown") {
        return Vec::new();
    }

    let Some(resolved) = resolve_ancestor_commit(repo_path, commit) else {
        return Vec::new();
    };

    let mut cmd = Command::new("git");
    cmd.args(["-C"])
        .arg(repo_path)
        .args(["diff", "--name-only", "-z", &resolved]);

    if !sources.is_empty() {
        cmd.arg("--");
        for src in sources {
            cmd.arg(src);
        }
    }

    let output = match cmd.output() {
        Ok(out) if out.status.success() => out,
        _ => return Vec::new(),
    };

    let mut files: Vec<String> = output
        .stdout
        .split(|&b| b == 0)
        .filter(|p| !p.is_empty())
        .map(|p| String::from_utf8_lossy(p).into_owned())
        .collect();

    files.sort();
    files.dedup();
    files
}

/// Diff of `rel_path` from `source_commit` (or HEAD when empty/"unknown") to the
/// working tree. Returns an empty string when the commit is invalid or not an
/// ancestor of HEAD.
pub fn file_diff_since_commit(repo_path: &Path, source_commit: &str, rel_path: &str) -> String {
    let commit = source_commit.trim();
    let base = if commit.is_empty() || commit.eq_ignore_ascii_case("unknown") {
        "HEAD".to_string()
    } else {
        match resolve_ancestor_commit(repo_path, commit) {
            Some(sha) => sha,
            None => return String::new(),
        }
    };

    match Command::new("git")
        .args(["-C"])
        .arg(repo_path)
        .args(["diff", &base, "--", rel_path])
        .output()
    {
        Ok(out) => String::from_utf8_lossy(&out.stdout).into_owned(),
        Err(_) => String::new(),
    }
}
