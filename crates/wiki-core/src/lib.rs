pub mod git_ops;
pub mod prompts;
pub mod validator;
pub mod watcher;
pub mod wiki_fs;
pub mod wiki_resolver;
pub mod wiki_schema;

pub use prompts::build_workflow_prompt;
pub use git_ops::{
    changed_files_since_commit, file_diff_since_commit, git_user_name, inspect_git_state,
    is_git_repo, GitState,
};
pub use validator::{
    parse_lint_output, run_structural_lint, run_structural_lint_with, run_structural_lint_with_args,
    LintFinding, LintInfo, LintReport, LintUpgrade,
};
pub use watcher::{watch_repo, WatchHandle};
pub use wiki_fs::{
    collect_repo_files_recursive, content_has_forbidden_term, is_private_terms_name,
    load_wiki_snapshot, read_private_terms, read_repo_file_safe, read_wiki_file_safe,
    write_wiki_file_safe, write_wiki_files_safe, wiki_content_sha256, RepoFilePayload,
    WikiFileWrite, WikiPageEntry, WikiSnapshot,
};
pub use wiki_schema::{glob_match, parse_excluded_globs};
pub use wiki_resolver::{
    ensure_wiki_inside_repo, is_valid_wiki_folder_name, resolve_wiki_root, WikiResolution,
    WIKI_OUTSIDE_REPO,
};

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(100);
            let count = COUNTER.fetch_add(1, Ordering::SeqCst);
            let dir = std::env::temp_dir().join(format!("wiki_test_{}_{}_{}", name, std::process::id(), count));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Self { path: dir }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn test_is_valid_wiki_folder_name() {
        assert!(is_valid_wiki_folder_name("wiki"));
        assert!(is_valid_wiki_folder_name(".wiki"));
        assert!(is_valid_wiki_folder_name("docs"));
        assert!(is_valid_wiki_folder_name("my-wiki"));
        assert!(is_valid_wiki_folder_name("wiki_123"));

        // Reserved names (case-insensitive)
        assert!(!is_valid_wiki_folder_name(".git"));
        assert!(!is_valid_wiki_folder_name(".GIT"));
        assert!(!is_valid_wiki_folder_name(".github"));
        assert!(!is_valid_wiki_folder_name(".claude"));
        assert!(!is_valid_wiki_folder_name(".codex"));
        assert!(!is_valid_wiki_folder_name(".agents"));
        assert!(!is_valid_wiki_folder_name(".agent"));
        assert!(!is_valid_wiki_folder_name(".gemini"));
        assert!(!is_valid_wiki_folder_name(".opencode"));
        assert!(!is_valid_wiki_folder_name(".obsidian"));
        assert!(!is_valid_wiki_folder_name(".vscode"));
        assert!(!is_valid_wiki_folder_name("node_modules"));
        assert!(!is_valid_wiki_folder_name(".wikidir"));

        // Invalid regex patterns
        assert!(!is_valid_wiki_folder_name(""));
        assert!(!is_valid_wiki_folder_name("."));
        assert!(!is_valid_wiki_folder_name(".."));
        assert!(!is_valid_wiki_folder_name("wiki/sub"));
        assert!(!is_valid_wiki_folder_name("wiki\\sub"));
    }

    #[test]
    fn test_resolve_wiki_root_bom_crlf_and_fallbacks() {
        let td = TestDir::new("resolver");
        let repo = td.path();

        // 1. Uninitialized repo
        let res = resolve_wiki_root(repo);
        assert_eq!(
            res,
            WikiResolution {
                wiki_root: None,
                warning: None,
                is_initialized: false
            }
        );

        // 2. Fallback to wiki/SCHEMA.md
        let wiki_dir = repo.join("wiki");
        fs::create_dir_all(&wiki_dir).unwrap();
        fs::write(wiki_dir.join("SCHEMA.md"), "# Schema").unwrap();
        let res = resolve_wiki_root(repo);
        assert_eq!(
            res,
            WikiResolution {
                wiki_root: Some("wiki".into()),
                warning: None,
                is_initialized: true
            }
        );

        // 3. .wikidir pointing to missing directory
        fs::write(repo.join(".wikidir"), "custom-wiki\n").unwrap();
        let res = resolve_wiki_root(repo);
        assert_eq!(
            res,
            WikiResolution {
                wiki_root: None,
                warning: Some("Codebase Wiki LLM: .wikidir points to missing directory custom-wiki.".into()),
                is_initialized: false
            }
        );

        // 4. .wikidir with UTF-8 BOM + CRLF pointing to existing folder with SCHEMA.md
        let custom_dir = repo.join("custom-wiki");
        fs::create_dir_all(&custom_dir).unwrap();
        fs::write(custom_dir.join("SCHEMA.md"), "# Schema").unwrap();
        let mut bom_bytes = vec![0xEF, 0xBB, 0xBF];
        bom_bytes.extend_from_slice(b"custom-wiki\r\n");
        fs::write(repo.join(".wikidir"), bom_bytes).unwrap();
        let res = resolve_wiki_root(repo);
        assert_eq!(
            res,
            WikiResolution {
                wiki_root: Some("custom-wiki".into()),
                warning: None,
                is_initialized: true
            }
        );

        // 5. .wikidir with reserved name
        fs::write(repo.join(".wikidir"), ".git\n").unwrap();
        let res = resolve_wiki_root(repo);
        assert_eq!(
            res,
            WikiResolution {
                wiki_root: None,
                warning: Some("Codebase Wiki LLM: .wikidir does not contain a valid wiki folder name.".into()),
                is_initialized: false
            }
        );
    }

    #[test]
    fn test_guardrailed_file_ops() {
        let td = TestDir::new("guardrails");
        let repo = td.path();
        let wiki_dir = repo.join("wiki");
        fs::create_dir_all(&wiki_dir).unwrap();

        // 1. Path traversal write rejection
        let res = write_wiki_file_safe(repo, "wiki", "../outside.md", "bad content");
        assert!(res.is_err(), "Must reject path traversal in write");

        // 2. Rejection of .private-terms modification
        let res = write_wiki_file_safe(repo, "wiki", ".private-terms", "term");
        assert!(res.is_err(), "Must reject writing .private-terms directly");

        // 3. Sensitive data forbidden terms check
        fs::write(wiki_dir.join(".private-terms"), "SECRET_API_KEY\nconfidential\n").unwrap();
        let write_bad = write_wiki_file_safe(
            repo,
            "wiki",
            "page.md",
            "This document has secret_api_key in it.",
        );
        assert!(write_bad.is_err(), "Must reject write containing forbidden term");
        assert_eq!(write_bad.unwrap_err(), "Il testo contiene un termine vietato da .private-terms.");

        let write_ok = write_wiki_file_safe(
            repo,
            "wiki",
            "page.md",
            "This document is clean.",
        );
        assert!(write_ok.is_ok(), "Must allow safe write");

        // 4. Safe read
        let read_res = read_repo_file_safe(repo, "wiki/page.md", None);
        assert!(read_res.is_ok());
        let payload = read_res.unwrap();
        assert_eq!(payload.content, "This document is clean.");

        // 5. Read rejection of path traversal and .private-terms
        let read_bad1 = read_repo_file_safe(repo, "../outside.md", None);
        assert!(read_bad1.is_err());

        let read_bad2 = read_repo_file_safe(repo, "wiki/.private-terms", None);
        assert!(read_bad2.is_err(), "Must reject reading .private-terms");
    }

    #[test]
    fn test_git_ops_state_and_changed_files() {
        let td = TestDir::new("git_ops");
        let repo = td.path();

        let run_cmd = |args: &[&str]| {
            let out = Command::new("git")
                .args(["-C"])
                .arg(repo)
                .args(args)
                .output()
                .expect("git cmd failed");
            assert!(out.status.success(), "Git cmd failed: {:?}", args);
            out
        };

        run_cmd(&["init"]);
        run_cmd(&["config", "user.email", "agent@example.com"]);
        run_cmd(&["config", "user.name", "Agent"]);

        // Create an initial commit
        fs::write(repo.join("src_file.rs"), "fn main() {}\n").unwrap();
        run_cmd(&["add", "src_file.rs"]);
        run_cmd(&["commit", "-m", "Initial commit"]);

        let initial_sha = String::from_utf8_lossy(&run_cmd(&["rev-parse", "HEAD"]).stdout)
            .trim()
            .to_string();

        let state1 = inspect_git_state(repo, None);
        assert_eq!(state1.is_dirty, false);
        assert!(!state1.head_sha.is_empty());
        assert_eq!(state1.handoff_commits_behind, 0);

        // Make a second commit modifying src_file.rs and adding handoff.md
        fs::write(repo.join("src_file.rs"), "fn main() { println!(\"updated\"); }\n").unwrap();
        fs::create_dir_all(repo.join("wiki/agent")).unwrap();
        fs::write(repo.join("wiki/agent/handoff.md"), "# Handoff\n").unwrap();
        run_cmd(&["add", "."]);
        run_cmd(&["commit", "-m", "Update source and add handoff"]);

        // Now modify src_file.rs in a third commit
        fs::write(repo.join("src_file.rs"), "fn main() { println!(\"v3\"); }\n").unwrap();
        run_cmd(&["add", "src_file.rs"]);
        run_cmd(&["commit", "-m", "Third commit"]);

        // Check handoff commits behind: handoff was committed in commit 2, now at commit 3, so 1 commit behind!
        let state2 = inspect_git_state(repo, Some("wiki/agent/handoff.md"));
        assert_eq!(state2.handoff_commits_behind, 1);

        // Check changed files since initial commit
        let changed = changed_files_since_commit(
            repo,
            &initial_sha,
            &["src_file.rs".to_string()],
        );
        assert_eq!(changed, vec!["src_file.rs".to_string()]);

        // Check diff
        let diff = file_diff_since_commit(repo, &initial_sha, "src_file.rs");
        assert!(diff.contains("+fn main() { println!(\"v3\"); }"));
    }

    #[test]
    fn test_frontmatter_source_cleaning_in_snapshot() {
        let td = TestDir::new("clean_sources");
        let repo = td.path();

        let run_cmd = |args: &[&str]| {
            let out = Command::new("git")
                .args(["-C"])
                .arg(repo)
                .args(args)
                .output()
                .expect("git cmd failed");
            assert!(out.status.success());
            out
        };

        run_cmd(&["init"]);
        run_cmd(&["config", "user.email", "agent@example.com"]);
        run_cmd(&["config", "user.name", "Agent"]);

        fs::write(repo.join("file1.rs"), "fn one() {}\n").unwrap();
        run_cmd(&["add", "file1.rs"]);
        run_cmd(&["commit", "-m", "Initial commit"]);

        let initial_sha = String::from_utf8_lossy(&run_cmd(&["rev-parse", "HEAD"]).stdout)
            .trim()
            .to_string();

        // Create wiki page with fragment and line numbers in sources
        let wiki_dir = repo.join("wiki");
        fs::create_dir_all(&wiki_dir).unwrap();
        let page_content = format!(
r#"---
type: Topic
title: My Page
description: Page with line-scoped sources.
updated: 2026-11-10
confidence: high
source_commit: {initial_sha}
sources:
  - file1.rs#L1-L10
  - file1.rs:42:15
---

# Topic
"#,
            initial_sha = initial_sha
        );
        fs::write(wiki_dir.join("topic.md"), page_content).unwrap();
        fs::write(wiki_dir.join("SCHEMA.md"), "# Schema\n").unwrap();

        // Second commit modifies file1.rs
        fs::write(repo.join("file1.rs"), "fn one() { println!(\"mod\"); }\n").unwrap();
        run_cmd(&["add", "file1.rs"]);
        run_cmd(&["commit", "-m", "Second commit"]);

        let snapshot = load_wiki_snapshot(repo, "wiki").unwrap();
        let changed = snapshot.changed_files_by_page.get("topic.md");
        assert!(changed.is_some(), "Changed files should be present for topic.md");
        assert_eq!(changed.unwrap(), &vec!["file1.rs".to_string()]);
    }

    fn git(repo: &Path, args: &[&str]) -> String {
        let out = Command::new("git").arg("-C").arg(repo).args(args).output().unwrap();
        assert!(out.status.success(), "git {:?} failed", args);
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn init_repo(repo: &Path) -> String {
        git(repo, &["init", "-q"]);
        git(repo, &["config", "user.email", "agent@example.com"]);
        git(repo, &["config", "user.name", "Agent"]);
        fs::write(repo.join("a.txt"), "one\n").unwrap();
        git(repo, &["add", "."]);
        git(repo, &["commit", "-qm", "init"]);
        git(repo, &["rev-parse", "HEAD"])
    }

    #[test]
    fn test_file_diff_rejects_option_like_commit() {
        let td = TestDir::new("diff_opt");
        let repo = td.path();
        init_repo(repo);
        fs::write(repo.join("a.txt"), "two\n").unwrap();
        let out_file = repo.join("pwned");
        let evil = format!("--output={}", out_file.display());
        let diff = file_diff_since_commit(repo, &evil, "a.txt");
        assert_eq!(diff, "");
        assert!(!out_file.exists(), "source_commit was parsed as a git option");
        // A non-ancestor / unknown commit also yields an empty diff.
        assert_eq!(file_diff_since_commit(repo, "deadbeef", "a.txt"), "");
        // Empty commit still diffs against HEAD.
        assert!(file_diff_since_commit(repo, "", "a.txt").contains("+two"));
    }

    #[test]
    fn test_git_paths_with_spaces_and_unicode_are_unquoted() {
        let td = TestDir::new("git_quote");
        let repo = td.path();
        let base = init_repo(repo);
        fs::create_dir_all(repo.join("dir")).unwrap();
        let name = "dir/a b \u{e8}.md";
        fs::write(repo.join(name), "x\n").unwrap();
        git(repo, &["add", "."]);
        git(repo, &["commit", "-qm", "add"]);
        fs::write(repo.join(name), "y\n").unwrap();
        git(repo, &["mv", "a.txt", "b c.txt"]);

        let state = inspect_git_state(repo, None);
        let mut dirty = state.dirty_files.clone();
        dirty.sort();
        assert_eq!(dirty, vec!["b c.txt".to_string(), name.to_string()]);

        let changed = changed_files_since_commit(repo, &base, &["dir".to_string()]);
        assert_eq!(changed, vec![name.to_string()]);
    }

    #[test]
    fn test_write_outside_wiki_creates_no_directory() {
        let td = TestDir::new("write_escape");
        let repo = td.path();
        fs::create_dir_all(repo.join("wiki")).unwrap();
        assert!(write_wiki_file_safe(repo, "wiki", "../outside/x.md", "x").is_err());
        assert!(!repo.join("outside").exists());
        // Escaping through the wiki_root argument is refused too.
        fs::create_dir_all(repo.join("sibling")).unwrap();
        assert!(write_wiki_file_safe(&repo.join("wiki"), "../sibling", "new/x.md", "x").is_err());
        assert!(!repo.join("sibling/new").exists());
        // Escaping through a symlinked directory inside the wiki is refused.
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(repo.join("sibling"), repo.join("wiki/link")).unwrap();
            assert!(write_wiki_file_safe(repo, "wiki", "link/new/x.md", "x").is_err());
            assert!(!repo.join("sibling/new").exists());
        }
        // Nested new directories inside the wiki are still created.
        write_wiki_file_safe(repo, "wiki", "new/deep/x.md", "x").unwrap();
        assert!(repo.join("wiki/new/deep/x.md").is_file());
    }

    #[test]
    fn test_private_terms_file_drives_forbidden_terms() {
        let td = TestDir::new("private_terms");
        let repo = td.path();
        let wiki = repo.join("wiki");
        fs::create_dir_all(&wiki).unwrap();
        assert!(write_wiki_file_safe(repo, "wiki", "p.md", "Acme inc").is_ok());
        fs::write(wiki.join(".private-terms"), "# comment\nacme\n").unwrap();
        let err = write_wiki_file_safe(repo, "wiki", "p.md", "Acme inc").unwrap_err();
        assert_eq!(err, "Il testo contiene un termine vietato da .private-terms.");
        assert!(write_wiki_file_safe(repo, "wiki", "p.md", "clean").is_ok());
        assert!(write_wiki_file_safe(repo, "wiki", ".private-terms", "x").is_err());
        assert!(write_wiki_file_safe(repo, "wiki", "sub/.private-terms", "x").is_err());
    }

    #[test]
    fn test_private_terms_name_variants_are_refused() {
        let td = TestDir::new("terms_variants");
        let repo = td.path();
        let wiki = repo.join("wiki");
        fs::create_dir_all(&wiki).unwrap();
        fs::write(wiki.join(".private-terms"), "acme\n").unwrap();
        for name in [".PRIVATE-TERMS", ".Private-Terms", ".private-terms.", ".private-terms. ", ".private-terms::$DATA", "a:b.md"] {
            assert!(write_wiki_file_safe(repo, "wiki", name, "").is_err(), "write {name}");
            assert!(read_repo_file_safe(repo, &format!("wiki/{name}"), None).is_err(), "read {name}");
        }
        assert_eq!(fs::read_to_string(wiki.join(".private-terms")).unwrap(), "acme\n");
        // A symlink inside the wiki pointing at .private-terms is refused too.
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(wiki.join(".private-terms"), wiki.join("alias.md")).unwrap();
            assert!(write_wiki_file_safe(repo, "wiki", "alias.md", "").is_err());
            assert_eq!(fs::read_to_string(wiki.join(".private-terms")).unwrap(), "acme\n");
        }
    }

    #[test]
    fn test_private_terms_bom_and_unreadable_file() {
        let td = TestDir::new("terms_bom");
        let repo = td.path();
        let wiki = repo.join("wiki");
        fs::create_dir_all(&wiki).unwrap();
        fs::write(wiki.join(".private-terms"), "\u{feff}acme\n").unwrap();
        assert!(write_wiki_file_safe(repo, "wiki", "p.md", "ACME").is_err(), "BOM must not hide first term");
        // UTF-16 LE (invalid UTF-8): refuse instead of skipping the check.
        fs::write(wiki.join(".private-terms"), [0xFF, 0xFE, b'a', 0, b'c', 0]).unwrap();
        assert!(write_wiki_file_safe(repo, "wiki", "p.md", "clean").is_err());
        assert!(!wiki.join("p.md").exists());
    }

    #[test]
    fn test_snapshot_has_no_lint_and_camel_case_json() {
        let td = TestDir::new("snapshot_json");
        let repo = td.path();
        init_repo(repo);
        fs::create_dir_all(repo.join("wiki")).unwrap();
        fs::write(repo.join("wiki/SCHEMA.md"), "# Schema\n").unwrap();
        let snapshot = load_wiki_snapshot(repo, "wiki").unwrap();
        let json = serde_json::to_value(&snapshot).unwrap();
        let obj = json.as_object().unwrap();
        assert!(!obj.contains_key("lintReport") && !obj.contains_key("lint_report"));
        for key in ["repoPath", "wikiRoot", "isInitialized", "gitState", "repoFiles", "changedFilesByPage"] {
            assert!(obj.contains_key(key), "missing {key}");
        }
        assert!(json["gitState"].get("headSha").is_some());
        assert!(json["gitState"].get("handoffCommitsBehind").is_some());
        assert!(json["pages"][0].get("wikiRelPath").is_some());
        assert!(json["pages"][0].get("sizeBytes").is_some());

        let payload = read_repo_file_safe(repo, "a.txt", None).unwrap();
        assert!(serde_json::to_value(&payload).unwrap().get("relPath").is_some());
        let res = serde_json::to_value(resolve_wiki_root(repo)).unwrap();
        assert!(res.get("isInitialized").is_some());
        let report = LintReport {
            exit_code: 0,
            findings: vec![LintFinding { wiki_rel_path: "x.md".into(), line: 1, message: "m".into() }],
            ..LintReport::default()
        };
        let report = serde_json::to_value(&report).unwrap();
        assert!(report.get("exitCode").is_some() && report.get("rawOutput").is_some());
        assert!(report["findings"][0].get("wikiRelPath").is_some());
    }
}
