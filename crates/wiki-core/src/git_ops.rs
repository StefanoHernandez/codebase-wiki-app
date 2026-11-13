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

/// True when `repo_path` is a directory inside a git work tree.
pub fn is_git_repo(repo_path: &Path) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false)
}

/// `git config user.name` of the repo, if set.
pub fn git_user_name(repo_path: &Path) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(["config", "user.name"])
        .output()
        .ok()?;
    let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !name.is_empty()).then_some(name)
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

/// Subjects of the commits after `since` (up to HEAD) that touch `wiki_rel`, newest first,
/// at most 20. `None` when `since` is not an ancestor of HEAD (unknown, rebased away, other
/// branch) or git fails: then git cannot tell what is new.
pub fn wiki_commits_since(repo: &Path, since: &str, wiki_rel: &str) -> Option<Vec<String>> {
    let ancestor = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["merge-base", "--is-ancestor", since, "HEAD"])
        .status()
        .ok()?;
    if !ancestor.success() {
        return None;
    }
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["log", "--format=%s", "-n", "20", &format!("{since}..HEAD"), "--", wiki_rel])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).lines().map(str::to_string).collect())
}

/// True when git ignores the directory `rel_dir` (a local-only wiki).
pub fn is_ignored(repo: &Path, rel_dir: &str) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["check-ignore", "-q", &format!("{rel_dir}/")])
        .status()
        .is_ok_and(|s| s.success())
}

/// HEAD commit sha, if any.
pub fn head_commit(repo: &Path) -> Option<String> {
    let out = Command::new("git").arg("-C").arg(repo).args(["rev-parse", "HEAD"]).output().ok()?;
    let sha = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !sha.is_empty()).then_some(sha)
}

/// One commit of the graph timeline: files it added or modified (repo-relative).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCommit {
    pub sha: String,
    pub date: String,
    pub subject: String,
    pub added: Vec<String>,
    pub modified: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistory {
    /// Oldest first.
    pub commits: Vec<HistoryCommit>,
    /// True when older commits were left out (`max` reached).
    pub truncated: bool,
}

/// The last `max` commits of HEAD with their added and modified files, oldest first.
/// Renames count as delete + add; deletions and merge commits carry no files.
pub fn file_history(repo: &Path, max: usize) -> FileHistory {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["-c", "core.quotePath=false", "log", "--no-renames", "--name-status"])
        .arg(format!("--max-count={}", max + 1))
        .arg("--format=%x1e%H%x1f%cI%x1f%s")
        .output();
    let Some(out) = out.ok().filter(|o| o.status.success()) else {
        return FileHistory { commits: Vec::new(), truncated: false };
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut commits: Vec<HistoryCommit> = text
        .split('\x1e')
        .filter(|chunk| !chunk.trim().is_empty())
        .filter_map(|chunk| {
            let mut lines = chunk.lines();
            let mut head = lines.next()?.splitn(3, '\x1f');
            let mut c = HistoryCommit {
                sha: head.next()?.to_string(),
                date: head.next()?.to_string(),
                subject: head.next().unwrap_or("").to_string(),
                added: Vec::new(),
                modified: Vec::new(),
            };
            for line in lines {
                match line.split_once('\t') {
                    Some(("A", path)) => c.added.push(path.to_string()),
                    Some((status, path)) if status != "D" => c.modified.push(path.to_string()),
                    _ => {}
                }
            }
            Some(c)
        })
        .collect();
    let truncated = commits.len() > max;
    commits.truncate(max);
    commits.reverse();
    FileHistory { commits, truncated }
}

#[cfg(test)]
mod news_tests {
    use super::*;

    fn git(repo: &Path, args: &[&str]) {
        let ok = Command::new("git").arg("-C").arg(repo).args(args).status().unwrap().success();
        assert!(ok, "git {args:?}");
    }

    fn commit(repo: &Path, file: &str, msg: &str) -> String {
        let p = repo.join(file);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, msg).unwrap();
        git(repo, &["add", file]);
        git(repo, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg]);
        head_commit(repo).unwrap()
    }

    #[test]
    fn file_history_lists_added_and_modified_oldest_first() {
        let d = tempfile::tempdir().unwrap();
        git(d.path(), &["init", "-q"]);
        commit(d.path(), "wiki/a.md", "first");
        commit(d.path(), "src/b.rs", "second");
        commit(d.path(), "wiki/a.md", "third");
        let h = file_history(d.path(), 10);
        assert!(!h.truncated);
        let subjects: Vec<_> = h.commits.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(subjects, ["first", "second", "third"]);
        assert_eq!(h.commits[0].added, ["wiki/a.md"]);
        assert_eq!(h.commits[2].modified, ["wiki/a.md"]);
        assert!(!h.commits[2].date.is_empty());

        let last = file_history(d.path(), 2);
        assert!(last.truncated);
        assert_eq!(last.commits.len(), 2);
        assert_eq!(last.commits[0].subject, "second");
    }

    #[test]
    fn file_history_outside_git_is_empty() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(file_history(d.path(), 10).commits.len(), 0);
    }

    #[test]
    fn wiki_commits_since_lists_wiki_only() {
        let d = tempfile::tempdir().unwrap();
        git(d.path(), &["init", "-q"]);
        let a = commit(d.path(), "README.md", "start");
        commit(d.path(), "wiki/x.md", "wiki change");
        commit(d.path(), "src.rs", "code change");
        assert_eq!(wiki_commits_since(d.path(), &a, "wiki"), Some(vec!["wiki change".to_string()]));
    }

    #[test]
    fn wiki_commits_since_other_branch_is_none() {
        let d = tempfile::tempdir().unwrap();
        git(d.path(), &["init", "-q", "-b", "main"]);
        commit(d.path(), "README.md", "start");
        git(d.path(), &["switch", "-q", "-c", "side"]);
        let side = commit(d.path(), "wiki/a.md", "side wiki");
        git(d.path(), &["switch", "-q", "main"]);
        commit(d.path(), "wiki/b.md", "main wiki");
        assert_eq!(wiki_commits_since(d.path(), &side, "wiki"), None);
    }

    #[test]
    fn wiki_commits_since_unknown_commit() {
        let d = tempfile::tempdir().unwrap();
        git(d.path(), &["init", "-q"]);
        commit(d.path(), "README.md", "start");
        assert_eq!(wiki_commits_since(d.path(), "deadbeef", "wiki"), None);
    }
}
