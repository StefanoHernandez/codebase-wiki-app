use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LintFinding {
    pub wiki_rel_path: String,
    pub line: u32,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LintReport {
    pub exit_code: i32,
    pub findings: Vec<LintFinding>,
    pub infos: Vec<String>,
    pub raw_output: String,
}

pub fn run_structural_lint(
    repo_path: &Path,
    wiki_root: &str,
    validator_script: &Path,
) -> LintReport {
    let target_wiki = repo_path.join(wiki_root);
    let output = Command::new("python3")
        .arg(validator_script)
        .arg(&target_wiki)
        .current_dir(repo_path)
        .output();

    let output = match output {
        Ok(out) => out,
        Err(e) => {
            return LintReport {
                exit_code: -1,
                findings: Vec::new(),
                infos: Vec::new(),
                raw_output: format!("Failed to execute validator: {}", e),
            };
        }
    };

    let exit_code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    let raw_output = if stderr.is_empty() {
        stdout.clone()
    } else if stdout.is_empty() {
        stderr.clone()
    } else {
        format!("{}\n{}", stdout, stderr)
    };

    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^(.+?):(\d+):\s*(.+)$").unwrap());

    let mut infos = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("info:") {
            infos.push(trimmed.to_string());
        }
    }

    let mut findings = Vec::new();
    let canon_target = target_wiki.canonicalize().unwrap_or_else(|_| target_wiki.clone());

    for line in stderr.lines().chain(stdout.lines()) {
        let trimmed = line.trim();
        if let Some(caps) = re.captures(trimmed) {
            let raw_path = &caps[1];
            let line_num: u32 = caps[2].parse().unwrap_or(1);
            let message = caps[3].trim().to_string();

            let p = Path::new(raw_path);
            let wiki_rel_path = if let Ok(rel) = p.strip_prefix(&target_wiki) {
                rel.to_string_lossy().replace('\\', "/")
            } else if let Ok(canon_p) = p.canonicalize() {
                if let Ok(rel) = canon_p.strip_prefix(&canon_target) {
                    rel.to_string_lossy().replace('\\', "/")
                } else {
                    raw_path.replace('\\', "/")
                }
            } else {
                let target_str = target_wiki.to_string_lossy();
                if raw_path.starts_with(target_str.as_ref()) {
                    raw_path[target_str.len()..]
                        .trim_start_matches('/')
                        .trim_start_matches('\\')
                        .replace('\\', "/")
                } else {
                    raw_path.replace('\\', "/")
                }
            };

            findings.push(LintFinding {
                wiki_rel_path,
                line: line_num,
                message,
            });
        }
    }

    LintReport {
        exit_code,
        findings,
        infos,
        raw_output,
    }
}
