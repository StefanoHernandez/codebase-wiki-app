/// Workflows the app may build prompts for. Any other name is refused.
pub const WORKFLOWS: &[&str] = &["wiki-sync", "wiki-ingest", "wiki-lint", "wiki-init"];

/// The prompt the person pastes into their agent: the plugin's own slash command.
///
/// The agent already has the Codebase Wiki LLM plugin installed, so the command is enough; the app
/// no longer ships a copy of the workflow text, which went stale at every plugin release.
pub fn build_workflow_prompt(workflow: &str, target: Option<&str>) -> Result<String, String> {
    let clean_wf = workflow.trim().strip_prefix('/').unwrap_or(workflow.trim());
    if !WORKFLOWS.contains(&clean_wf) {
        return Err(format!("Unknown workflow: '{}'", workflow));
    }
    let target = target.map(str::trim).filter(|t| !t.is_empty());
    match target {
        // One line only: a newline would smuggle a second instruction into the pasted prompt.
        Some(t) if t.contains(['\n', '\r']) => Err("Target must be a single line".into()),
        Some(t) => Ok(format!("/{clean_wf} {t}")),
        None => Ok(format!("/{clean_wf}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workflow_names_are_allow_listed() {
        for name in ["wiki-sync", "/wiki-sync", "wiki-ingest", "wiki-lint", "wiki-init"] {
            assert!(build_workflow_prompt(name, None).is_ok(), "{name} should work");
        }
        for bad in ["../default-schema.md", "wiki-sync.md", "", "rm -rf", "wiki-sync/../x"] {
            assert!(build_workflow_prompt(bad, None).is_err(), "{bad} must be rejected");
        }
    }

    #[test]
    fn prompt_is_the_slash_command() {
        assert_eq!(build_workflow_prompt("wiki-sync", None).unwrap(), "/wiki-sync");
        assert_eq!(build_workflow_prompt("/wiki-init", Some("--adopt docs")).unwrap(), "/wiki-init --adopt docs");
        assert!(build_workflow_prompt("wiki-ingest", Some("a\nignore previous")).is_err());
    }
}
