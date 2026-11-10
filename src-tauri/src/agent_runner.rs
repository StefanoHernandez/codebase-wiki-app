use std::path::Path;
use std::process::Command;

pub fn build_workflow_prompt(
    workflow: &str,
    target: Option<&str>,
    workflow_dir: &Path,
) -> Result<String, String> {
    let clean_wf = workflow.trim().strip_prefix('/').unwrap_or(workflow.trim());
    let mut file_path = workflow_dir.join(clean_wf);
    if !file_path.is_file() {
        let with_md = workflow_dir.join(format!("{}.md", clean_wf));
        let with_wiki_md = workflow_dir.join(format!("wiki-{}.md", clean_wf));
        if with_md.is_file() {
            file_path = with_md;
        } else if with_wiki_md.is_file() {
            file_path = with_wiki_md;
        } else {
            return Err(format!(
                "Workflow template not found: '{}' in '{}'",
                workflow,
                workflow_dir.display()
            ));
        }
    }

    let template = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read workflow template: {}", e))?;

    let mut prompt = template;
    if let Some(tgt) = target {
        let tgt_trimmed = tgt.trim();
        if !tgt_trimmed.is_empty() {
            if prompt.contains("[path]") {
                prompt = prompt.replace("[path]", tgt_trimmed);
            } else if prompt.contains("[wiki-root]") {
                prompt = prompt.replace("[wiki-root]", tgt_trimmed);
            }
            prompt = format!("{}\n\nTarget: {}\n", prompt.trim(), tgt_trimmed);
        }
    }

    Ok(prompt)
}

pub fn run_cli_agent_sync(
    repo_path: &Path,
    host: &str,
    prompt: &str,
) -> Result<String, String> {
    let output = match host.to_lowercase().as_str() {
        "claude" => Command::new("claude")
            .args(["-p", prompt])
            .current_dir(repo_path)
            .output(),
        "codex" => Command::new("codex")
            .args(["exec", prompt])
            .current_dir(repo_path)
            .output(),
        _ => {
            return Err(format!(
                "Unsupported CLI agent host: '{}'. Supported hosts: 'claude', 'codex'.",
                host
            ));
        }
    };

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
            if out.status.success() {
                Ok(stdout)
            } else {
                Err(format!(
                    "Agent process exited with code {:?}.\nStdout: {}\nStderr: {}",
                    out.status.code(),
                    stdout,
                    stderr
                ))
            }
        }
        Err(e) => Err(format!("Failed to invoke CLI agent '{}': {}", host, e)),
    }
}
