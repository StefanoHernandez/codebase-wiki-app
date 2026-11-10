use std::path::Path;

/// Workflows the app may build prompts for. Any other name (including paths)
/// is refused so the template lookup cannot read arbitrary files.
pub const WORKFLOWS: &[&str] = &["wiki-sync", "wiki-ingest", "wiki-lint", "wiki-init"];

pub fn build_workflow_prompt(
    workflow: &str,
    target: Option<&str>,
    workflow_dir: &Path,
) -> Result<String, String> {
    let clean_wf = workflow.trim().strip_prefix('/').unwrap_or(workflow.trim());
    if !WORKFLOWS.contains(&clean_wf) {
        return Err(format!("Unknown workflow: '{}'", workflow));
    }
    let file_path = workflow_dir.join(format!("{}.md", clean_wf));
    if !file_path.is_file() {
        return Err(format!(
            "Workflow template not found: '{}' in '{}'",
            workflow,
            workflow_dir.display()
        ));
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn workflow_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../resources/workflows")
    }

    #[test]
    fn workflow_names_are_allow_listed() {
        let dir = workflow_dir();
        for name in ["wiki-sync", "/wiki-sync", "wiki-ingest", "wiki-lint", "wiki-init"] {
            let out = build_workflow_prompt(name, None, &dir);
            assert!(out.is_ok(), "{name} should work: {:?}", out.err());
            assert!(!out.unwrap().is_empty());
        }
    }

    #[test]
    fn traversal_and_absolute_workflow_inputs_are_rejected() {
        let dir = workflow_dir();
        let abs = dir.join("../../default-schema.md");
        for bad in [
            "../default-schema.md",
            "../../../../../../etc/hosts",
            "../../default-schema.md",
            "wiki-sync/../../default-schema.md",
            "wiki-sync.md",
            "",
            abs.to_str().unwrap(),
        ] {
            assert!(build_workflow_prompt(bad, None, &dir).is_err(), "{bad} must be rejected");
        }
    }
}
