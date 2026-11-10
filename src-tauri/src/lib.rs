pub mod agent_runner;
pub mod git_ops;
pub mod validator;
pub mod wiki_fs;
pub mod wiki_resolver;

pub use agent_runner::{build_workflow_prompt, run_cli_agent_sync};
pub use git_ops::{
    changed_files_since_commit, file_diff_since_commit, inspect_git_state, GitState,
};
pub use validator::{run_structural_lint, LintFinding, LintReport};
pub use wiki_fs::{
    initialize_new_wiki, load_wiki_snapshot, read_repo_file_safe, write_wiki_file_safe,
    InitWikiRequest, RepoFilePayload, WikiPageEntry, WikiSnapshot,
};
pub use wiki_resolver::{is_valid_wiki_folder_name, resolve_wiki_root, WikiResolution};

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
        let res = write_wiki_file_safe(repo, "wiki", "../outside.md", "bad content", false);
        assert!(res.is_err(), "Must reject path traversal in write");

        // 2. Rejection of .private-terms modification
        let res = write_wiki_file_safe(repo, "wiki", ".private-terms", "term", false);
        assert!(res.is_err(), "Must reject writing .private-terms directly");

        // 3. Sensitive data forbidden terms check
        fs::write(wiki_dir.join(".private-terms"), "SECRET_API_KEY\nconfidential\n").unwrap();
        let write_bad = write_wiki_file_safe(
            repo,
            "wiki",
            "page.md",
            "This document has secret_api_key in it.",
            true,
        );
        assert!(write_bad.is_err(), "Must reject write containing forbidden term");
        assert!(write_bad.unwrap_err().contains("SECRET_API_KEY"));

        let write_ok = write_wiki_file_safe(
            repo,
            "wiki",
            "page.md",
            "This document is clean.",
            true,
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
    fn test_initialize_new_wiki_and_lint_validation() {
        let td = TestDir::new("init_and_lint");
        let repo = td.path();

        // Initialize git repo so validate-wiki.py detects the repository boundary properly
        let init_git = Command::new("git")
            .args(["init"])
            .current_dir(repo)
            .output()
            .expect("git init failed");
        assert!(init_git.status.success());

        let req = InitWikiRequest {
            folder: "wiki".into(),
            language: "English".into(),
            project_division: "none".into(),
            topics: vec!["architecture".into(), "testing".into()],
            sensitive_data: false,
            forbidden_terms: vec![],
            agent_entry_file: "none".into(),
            parallel_work: true,
        };

        let default_schema_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("resources")
            .join("default-schema.md");
        let validator_script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("resources")
            .join("validate-wiki.py");

        let init_res = initialize_new_wiki(repo, &req, &default_schema_path);
        assert!(init_res.is_ok(), "initialize_new_wiki failed: {:?}", init_res.err());

        // Run structural lint directly
        let report = run_structural_lint(repo, "wiki", &validator_script);
        assert_eq!(
            report.exit_code, 0,
            "validate-wiki.py failed with findings: {:?}\nRaw: {}",
            report.findings, report.raw_output
        );
        assert!(report.findings.is_empty(), "Findings should be empty: {:?}", report.findings);

        // Load snapshot
        let snapshot = load_wiki_snapshot(repo, "wiki", &validator_script).unwrap();
        assert!(snapshot.is_initialized);
        assert_eq!(snapshot.wiki_root, Some("wiki".into()));
        assert!(snapshot.lint_report.is_some());
        assert_eq!(snapshot.lint_report.unwrap().exit_code, 0);

        // Verify required pages exist in snapshot
        let page_paths: Vec<&str> = snapshot.pages.iter().map(|p| p.wiki_rel_path.as_str()).collect();
        assert!(page_paths.contains(&"SCHEMA.md"));
        assert!(page_paths.contains(&"index.md"));
        assert!(page_paths.contains(&"log.md"));
        assert!(page_paths.contains(&"project/work-tracker.md"));
        assert!(page_paths.contains(&"project/risks.md"));
        assert!(page_paths.contains(&"agent/context.md"));
        assert!(page_paths.contains(&"agent/handoff.md"));
        assert!(page_paths.contains(&"troubleshooting.md"));
        assert!(page_paths.contains(&"glossary.md"));
        assert!(page_paths.contains(&"architecture.md"));
        assert!(page_paths.contains(&"testing.md"));
    }

    #[test]
    fn test_custom_folder_wiki_init_and_lint() {
        let td = TestDir::new("custom_folder_lint");
        let repo = td.path();

        let _ = Command::new("git")
            .args(["init"])
            .current_dir(repo)
            .output();

        let req = InitWikiRequest {
            folder: ".wiki".into(),
            language: "English".into(),
            project_division: "phases/WP".into(),
            topics: vec!["architecture".into()],
            sensitive_data: true,
            forbidden_terms: vec!["RESTRICTED_SECRET".into()],
            agent_entry_file: "AGENTS.md".into(),
            parallel_work: true,
        };

        let default_schema_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("resources")
            .join("default-schema.md");
        let validator_script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("resources")
            .join("validate-wiki.py");

        let init_res = initialize_new_wiki(repo, &req, &default_schema_path);
        assert!(init_res.is_ok());

        assert!(repo.join(".wikidir").is_file());
        assert_eq!(fs::read_to_string(repo.join(".wikidir")).unwrap().trim(), ".wiki");
        assert!(repo.join("AGENTS.md").is_file());
        assert!(repo.join(".wiki").join(".private-terms").is_file());

        let res = resolve_wiki_root(repo);
        assert_eq!(res.wiki_root, Some(".wiki".into()));
        assert!(res.is_initialized);

        let report = run_structural_lint(repo, ".wiki", &validator_script);
        assert_eq!(
            report.exit_code, 0,
            "validate-wiki.py failed on .wiki: {:?}\nRaw: {}",
            report.findings, report.raw_output
        );
        assert!(report.findings.is_empty());
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
    fn test_build_workflow_prompt() {
        let workflow_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("resources")
            .join("workflows");

        let p1 = build_workflow_prompt("wiki-init", None, &workflow_dir);
        assert!(p1.is_ok());
        assert!(p1.unwrap().contains("# /wiki-init"));

        let p2 = build_workflow_prompt("wiki-ingest", Some("src/main.rs"), &workflow_dir);
        assert!(p2.is_ok());
        let p2_str = p2.unwrap();
        assert!(p2_str.contains("# /wiki-ingest src/main.rs") || p2_str.contains("Target: src/main.rs"));

        let p_bad = build_workflow_prompt("nonexistent-wf", None, &workflow_dir);
        assert!(p_bad.is_err());
    }
}
