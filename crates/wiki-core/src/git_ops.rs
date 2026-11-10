use std::path::Path;
use std::process::Command;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

    let mut dirty_files = Vec::new();
    if let Ok(output) = Command::new("git")
        .args(["-C"])
        .arg(repo_path)
        .args(["status", "--porcelain"])
        .output()
    {
        if output.status.success() {
            let out_str = String::from_utf8_lossy(&output.stdout);
            for line in out_str.lines() {
                if line.len() >= 3 {
                    let path_part = line[3..].trim();
                    let final_path = if let Some((_, dest)) = path_part.split_once("->") {
                        dest.trim()
                    } else {
                        path_part
                    };
                    let unquoted = final_path.trim_matches('"');
                    if !unquoted.is_empty() {
                        dirty_files.push(unquoted.to_string());
                    }
                }
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

pub fn changed_files_since_commit(
    repo_path: &Path,
    source_commit: &str,
    sources: &[String],
) -> Vec<String> {
    let commit = source_commit.trim();
    if commit.is_empty() || commit.eq_ignore_ascii_case("unknown") {
        return Vec::new();
    }

    let rev_parse = Command::new("git")
        .args(["-C"])
        .arg(repo_path)
        .args(["rev-parse", "--verify", "--end-of-options", &format!("{}^{{commit}}", commit)])
        .output();

    let resolved = match rev_parse {
        Ok(out) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if s.is_empty() {
                return Vec::new();
            }
            s
        }
        _ => return Vec::new(),
    };

    let is_ancestor = Command::new("git")
        .args(["-C"])
        .arg(repo_path)
        .args(["merge-base", "--is-ancestor", &resolved, "HEAD"])
        .status();

    match is_ancestor {
        Ok(st) if st.success() => {}
        _ => return Vec::new(),
    }

    let mut cmd = Command::new("git");
    cmd.args(["-C"])
        .arg(repo_path)
        .args(["diff", "--name-only", &resolved]);

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

    let text = String::from_utf8_lossy(&output.stdout);
    let mut files: Vec<String> = text
        .lines()
        .map(|l| l.trim().trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .collect();

    files.sort();
    files.dedup();
    files
}

pub fn file_diff_since_commit(repo_path: &Path, source_commit: &str, rel_path: &str) -> String {
    let commit = source_commit.trim();
    let mut cmd = Command::new("git");
    cmd.args(["-C"]).arg(repo_path).arg("diff");

    if commit.is_empty() || commit.eq_ignore_ascii_case("unknown") {
        cmd.args(["HEAD", "--", rel_path]);
    } else {
        cmd.args([commit, "--", rel_path]);
    }

    match cmd.output() {
        Ok(out) => String::from_utf8_lossy(&out.stdout).into_owned(),
        Err(_) => String::new(),
    }
}
