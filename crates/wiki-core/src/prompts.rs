use std::path::Path;

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
