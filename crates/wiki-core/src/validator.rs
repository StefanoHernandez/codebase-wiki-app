use std::path::Path;
use std::process::Command;
use serde::{Deserialize, Deserializer, Serialize};

/// `null` in the validator JSON becomes the type's default (empty path, line 0).
fn null_default<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(d)?.unwrap_or_default())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LintFinding {
    #[serde(alias = "path", deserialize_with = "null_default")]
    pub wiki_rel_path: String,
    #[serde(default, deserialize_with = "null_default")]
    pub line: u32,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LintUpgrade {
    #[serde(alias = "path", default)]
    pub wiki_rel_path: Option<String>,
    #[serde(default)]
    pub line: Option<u32>,
    pub code: String,
    pub message: String,
    /// "adopt" or "update-plugin".
    #[serde(default)]
    pub fix: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LintInfo {
    #[serde(alias = "path", default)]
    pub wiki_rel_path: Option<String>,
    #[serde(default)]
    pub line: Option<u32>,
    pub code: String,
    pub message: String,
}

/// The `--json` document of validate-wiki.py 0.13.0, plus the process exit code and raw output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LintReport {
    #[serde(alias = "exit")]
    pub exit_code: i32,
    #[serde(default)]
    pub validator: Option<String>,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub wiki: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub findings: Vec<LintFinding>,
    #[serde(default)]
    pub upgrades: Vec<LintUpgrade>,
    #[serde(default)]
    pub infos: Vec<LintInfo>,
    #[serde(default)]
    pub raw_output: String,
}

/// Builds the report from the validator's stdout. Anything that is not one JSON
/// document (a crash, an older script) becomes `error` with empty lists.
pub fn parse_lint_output(exit_code: i32, stdout: &str, stderr: &str) -> LintReport {
    let raw_output = [stdout.trim(), stderr.trim()]
        .iter()
        .filter(|s| !s.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");
    match serde_json::from_str::<LintReport>(stdout.trim()) {
        Ok(report) => LintReport { exit_code, raw_output, ..report },
        Err(_) => LintReport {
            exit_code,
            error: Some(if raw_output.is_empty() {
                format!("Il validatore non ha prodotto output (codice {exit_code}).")
            } else {
                raw_output.clone()
            }),
            raw_output,
            ..LintReport::default()
        },
    }
}

pub fn run_structural_lint(
    repo_path: &Path,
    wiki_root: &str,
    validator_script: &Path,
) -> LintReport {
    run_structural_lint_with("python3", repo_path, wiki_root, validator_script)
}

/// Same as `run_structural_lint` but runs the validator with the given Python
/// executable (e.g. `python` on Windows when `python3` is absent).
pub fn run_structural_lint_with(
    python: &str,
    repo_path: &Path,
    wiki_root: &str,
    validator_script: &Path,
) -> LintReport {
    run_structural_lint_with_args(python, &[], repo_path, wiki_root, validator_script)
}

/// Like `run_structural_lint_with`, but allows a prefix before the script (e.g. `py -3` on Windows).
pub fn run_structural_lint_with_args(
    python: &str,
    python_args: &[&str],
    repo_path: &Path,
    wiki_root: &str,
    validator_script: &Path,
) -> LintReport {
    let output = Command::new(python)
        .args(python_args)
        .arg(validator_script)
        .arg("--json")
        .arg(repo_path.join(wiki_root))
        .current_dir(repo_path)
        .output();
    match output {
        Ok(out) => parse_lint_output(
            out.status.code().unwrap_or(-1),
            &String::from_utf8_lossy(&out.stdout),
            &String::from_utf8_lossy(&out.stderr),
        ),
        Err(e) => {
            let msg = format!("Impossibile eseguire il validatore: {e}");
            LintReport { exit_code: -1, error: Some(msg.clone()), raw_output: msg, ..LintReport::default() }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn parses_captured_json_fixture() {
        let json = include_str!("../../../tests/fixtures/validator-0.13.json");
        let r = parse_lint_output(1, json, "");
        assert_eq!(r.error, None);
        assert_eq!(r.validator.as_deref(), Some("0.13.0"));
        assert_eq!(r.format.as_deref(), Some("0.12.0"));
        assert_eq!(r.findings[0], LintFinding { wiki_rel_path: "log.md".into(), line: 5, message: r.findings[0].message.clone() });
        let up = r.upgrades.iter().find(|u| u.code == "format-version-missing").unwrap();
        assert_eq!(up.wiki_rel_path.as_deref(), Some("SCHEMA.md"));
        assert_eq!(up.fix, "adopt");
        let info = r.infos.iter().find(|i| i.code == "handoff-no-open-work-stale").unwrap();
        assert_eq!(info.wiki_rel_path.as_deref(), Some("agent/handoff.md"));
        assert!(r.infos.iter().any(|i| i.wiki_rel_path.is_none() && i.line.is_none()));
        let out = serde_json::to_value(&r).unwrap();
        assert!(out.get("exitCode").is_some() && out.get("rawOutput").is_some());
        assert!(out["findings"][0].get("wikiRelPath").is_some());
        assert!(out["upgrades"][0].get("wikiRelPath").is_some());
    }

    #[test]
    fn error_document_and_non_json_output() {
        let r = parse_lint_output(2, r#"{"validator":"0.13.0","format":"0.12.0","wiki":null,"exit":2,"error":"requires Python 3.10+","findings":[],"upgrades":[],"infos":[]}"#, "requires Python 3.10+");
        assert_eq!(r.error.as_deref(), Some("requires Python 3.10+"));
        assert_eq!(r.exit_code, 2);
        let r = parse_lint_output(1, "Traceback (most recent call last):\n  boom\n", "");
        assert_eq!(r.error.as_deref(), Some("Traceback (most recent call last):\n  boom"));
        assert!(r.findings.is_empty() && r.upgrades.is_empty() && r.infos.is_empty());
    }

    #[test]
    fn test_run_structural_lint_parses_report() {
        // The workspace root holds the validator copy the app bundles.
        let workspace = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(2).unwrap();
        let script = workspace.join("resources/validate-wiki.py");
        let python = ["/opt/homebrew/bin/python3", "python3"].into_iter().find(|p| {
            Command::new(p)
                .args(["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"])
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        });
        let Some(python) = python.filter(|_| script.is_file()) else {
            println!("note: skipping lint test (python 3.10+ or validator script missing)");
            return;
        };
        let repo = std::env::temp_dir().join(format!("wiki_lint_{}", std::process::id()));
        let _ = fs::remove_dir_all(&repo);
        fs::create_dir_all(repo.join("wiki")).unwrap();
        fs::write(repo.join("wiki/SCHEMA.md"), "# Schema\n").unwrap();
        fs::write(repo.join("wiki/topic.md"), "# Topic\nbody\n").unwrap();

        let report = run_structural_lint_with(python, &repo, "wiki", &script);
        let _ = fs::remove_dir_all(&repo);
        assert_eq!(report.error, None, "{}", report.raw_output);
        assert_eq!(report.validator.as_deref(), Some("0.14.1"));
        assert!(report.upgrades.iter().any(|u| u.code == "core-map-missing"));
    }
}
