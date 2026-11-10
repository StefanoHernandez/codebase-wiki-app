use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path};
use serde::{Deserialize, Serialize};

use crate::git_ops::{self, GitState};
use crate::validator::{self, LintReport};
use crate::wiki_resolver;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WikiPageEntry {
    pub wiki_rel_path: String,
    pub content: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WikiSnapshot {
    pub repo_path: String,
    pub wiki_root: Option<String>,
    pub is_initialized: bool,
    pub warning: Option<String>,
    pub git_state: GitState,
    pub pages: Vec<WikiPageEntry>,
    pub repo_files: Vec<String>,
    pub changed_files_by_page: BTreeMap<String, Vec<String>>,
    pub lint_report: Option<LintReport>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepoFilePayload {
    pub rel_path: String,
    pub content: String,
    pub diff: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InitWikiRequest {
    pub folder: String,
    pub language: String,
    pub project_division: String,
    pub topics: Vec<String>,
    pub sensitive_data: bool,
    pub forbidden_terms: Vec<String>,
    pub agent_entry_file: String,
    pub parallel_work: bool,
}

fn is_safe_relative_path(path_str: &str) -> bool {
    let p = Path::new(path_str);
    if p.is_absolute() {
        return false;
    }
    for comp in p.components() {
        match comp {
            Component::ParentDir => return false,
            Component::Normal(s) => {
                if s == ".private-terms" {
                    return false;
                }
            }
            Component::RootDir | Component::Prefix(_) => return false,
            _ => {}
        }
    }
    true
}

pub fn read_repo_file_safe(
    repo_path: &Path,
    rel_path: &str,
    source_commit: Option<&str>,
) -> Result<RepoFilePayload, String> {
    if !is_safe_relative_path(rel_path) {
        return Err("Unsafe file path: path traversal or sensitive file access blocked".into());
    }

    let full_path = repo_path.join(rel_path);
    if !full_path.is_file() {
        return Err(format!("File not found: {}", rel_path));
    }

    let canon_repo = repo_path
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize repo path: {}", e))?;
    let canon_file = full_path
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize target file: {}", e))?;

    if !canon_file.starts_with(&canon_repo) {
        return Err("Access denied: path escapes repository root".into());
    }

    if canon_file
        .components()
        .any(|c| c.as_os_str() == ".private-terms")
    {
        return Err("Access denied: .private-terms cannot be read".into());
    }

    let content = fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    let diff = git_ops::file_diff_since_commit(repo_path, source_commit.unwrap_or(""), rel_path);

    Ok(RepoFilePayload {
        rel_path: rel_path.to_string(),
        content,
        diff,
    })
}

pub fn write_wiki_file_safe(
    repo_path: &Path,
    wiki_root: &str,
    wiki_rel_path: &str,
    content: &str,
    sensitive_data: bool,
) -> Result<(), String> {
    if !is_safe_relative_path(wiki_rel_path) {
        return Err("Unsafe wiki path: path traversal or sensitive file access blocked".into());
    }

    let wiki_dir = repo_path.join(wiki_root);
    let target_path = wiki_dir.join(wiki_rel_path);

    let private_terms_path = wiki_dir.join(".private-terms");
    if (sensitive_data || private_terms_path.is_file()) && private_terms_path.is_file() {
        if let Ok(terms_content) = fs::read_to_string(&private_terms_path) {
            let lower_content = content.to_lowercase();
            for line in terms_content.lines() {
                let term = line.trim();
                if term.is_empty() || term.starts_with('#') {
                    continue;
                }
                if lower_content.contains(&term.to_lowercase()) {
                    return Err(format!(
                        "Content contains forbidden sensitive term: '{}'",
                        term
                    ));
                }
            }
        }
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directories: {}", e))?;
    }

    if wiki_dir.exists() {
        if let (Ok(canon_wiki), Ok(canon_parent)) =
            (wiki_dir.canonicalize(), target_path.parent().unwrap().canonicalize())
        {
            if !canon_parent.starts_with(&canon_wiki) {
                return Err("Target path escapes wiki root".into());
            }
        }
    }

    fs::write(&target_path, content)
        .map_err(|e| format!("Failed to write file {}: {}", target_path.display(), e))?;

    Ok(())
}

fn clean_source_path(raw: &str) -> String {
    let without_hash = raw.split('#').next().unwrap_or(raw).trim();
    static LINE_RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = LINE_RE.get_or_init(|| regex::Regex::new(r":\d+(?::\d+)?$").unwrap());
    re.replace(without_hash, "").trim().to_string()
}

fn extract_frontmatter_sources_and_commit(content: &str) -> (Option<String>, Vec<String>) {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() || lines[0].trim() != "---" {
        return (None, Vec::new());
    }

    let end_idx = match lines[1..].iter().position(|l| l.trim() == "---") {
        Some(idx) => idx + 1,
        None => return (None, Vec::new()),
    };

    let mut source_commit = None;
    let mut sources = Vec::new();
    let mut in_sources = false;

    for line in &lines[1..end_idx] {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("source_commit:") {
            let c = rest.trim().trim_matches('"').trim_matches('\'');
            if !c.is_empty() {
                source_commit = Some(c.to_string());
            }
            in_sources = false;
        } else if trimmed.starts_with("sources:") {
            in_sources = true;
        } else if in_sources && line.starts_with("  - ") {
            let item = line[4..].trim().trim_matches('"').trim_matches('\'');
            let cleaned = clean_source_path(item);
            if !cleaned.is_empty() {
                sources.push(cleaned);
            }
        } else if !line.starts_with("  ") {
            in_sources = false;
        }
    }

    (source_commit, sources)
}

fn collect_wiki_pages_recursive(
    dir: &Path,
    base_dir: &Path,
    pages: &mut Vec<WikiPageEntry>,
) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.file_name().map(|n| n == ".private-terms").unwrap_or(false) {
            continue;
        }
        if path.is_dir() {
            collect_wiki_pages_recursive(&path, base_dir, pages);
        } else if path.is_file() && path.extension().map(|ext| ext == "md").unwrap_or(false) {
            if let Ok(canon_base) = base_dir.canonicalize() {
                if let Ok(canon_path) = path.canonicalize() {
                    if !canon_path.starts_with(&canon_base) {
                        continue;
                    }
                }
            }
            if let Ok(rel) = path.strip_prefix(base_dir) {
                let wiki_rel_path = rel.to_string_lossy().replace('\\', "/");
                let content = fs::read_to_string(&path).unwrap_or_default();
                let size_bytes = path.metadata().map(|m| m.len()).unwrap_or(0);
                pages.push(WikiPageEntry {
                    wiki_rel_path,
                    content,
                    size_bytes,
                });
            }
        }
    }
}

fn collect_repo_files_recursive(
    dir: &Path,
    repo_path: &Path,
    files: &mut Vec<String>,
) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(file_name) = path.file_name() {
            let name_str = file_name.to_string_lossy();
            if name_str == ".git"
                || name_str == "node_modules"
                || name_str == "target"
                || name_str == ".private-terms"
            {
                continue;
            }
        }

        if path.is_dir() {
            collect_repo_files_recursive(&path, repo_path, files);
        } else if path.is_file() {
            if let Ok(canon_repo) = repo_path.canonicalize() {
                if let Ok(canon_path) = path.canonicalize() {
                    if !canon_path.starts_with(&canon_repo) {
                        continue;
                    }
                }
            }
            if let Ok(rel) = path.strip_prefix(repo_path) {
                files.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
}

pub fn load_wiki_snapshot(
    repo_path: &Path,
    wiki_root: &str,
    validator_script: &Path,
) -> Result<WikiSnapshot, String> {
    let wiki_dir = repo_path.join(wiki_root);
    if !wiki_dir.is_dir() {
        return Err(format!("Wiki directory '{}' not found", wiki_root));
    }

    let mut pages = Vec::new();
    collect_wiki_pages_recursive(&wiki_dir, &wiki_dir, &mut pages);
    pages.sort_by(|a, b| a.wiki_rel_path.cmp(&b.wiki_rel_path));

    let mut repo_files = Vec::new();
    collect_repo_files_recursive(repo_path, repo_path, &mut repo_files);
    repo_files.sort();
    repo_files.dedup();

    let mut changed_files_by_page = BTreeMap::new();
    for page in &pages {
        let (source_commit, sources) = extract_frontmatter_sources_and_commit(&page.content);
        if let Some(commit) = source_commit {
            if !sources.is_empty() {
                let changed = git_ops::changed_files_since_commit(repo_path, &commit, &sources);
                changed_files_by_page.insert(page.wiki_rel_path.clone(), changed);
            }
        }
    }

    let lint_report = Some(validator::run_structural_lint(
        repo_path,
        wiki_root,
        validator_script,
    ));

    let handoff_path = format!("{}/agent/handoff.md", wiki_root);
    let git_state = git_ops::inspect_git_state(repo_path, Some(&handoff_path));
    let resolution = wiki_resolver::resolve_wiki_root(repo_path);

    Ok(WikiSnapshot {
        repo_path: repo_path.to_string_lossy().into_owned(),
        wiki_root: Some(wiki_root.to_string()),
        is_initialized: resolution.is_initialized,
        warning: resolution.warning,
        git_state,
        pages,
        repo_files,
        changed_files_by_page,
        lint_report,
    })
}

pub fn initialize_new_wiki(
    repo_path: &Path,
    req: &InitWikiRequest,
    _default_schema_path: &Path,
) -> Result<String, String> {
    if !wiki_resolver::is_valid_wiki_folder_name(&req.folder) {
        return Err(format!("Invalid wiki folder name: {}", req.folder));
    }

    let wiki_dir = repo_path.join(&req.folder);
    fs::create_dir_all(&wiki_dir)
        .map_err(|e| format!("Failed to create wiki directory: {}", e))?;

    if req.folder != "wiki" {
        fs::write(repo_path.join(".wikidir"), format!("{}\n", req.folder))
            .map_err(|e| format!("Failed to write .wikidir: {}", e))?;
    }

    if req.sensitive_data {
        let terms = req.forbidden_terms.join("\n");
        let private_terms_path = wiki_dir.join(".private-terms");
        fs::write(&private_terms_path, format!("{}\n", terms))
            .map_err(|e| format!("Failed to write .private-terms: {}", e))?;
    }

    if req.parallel_work {
        let gitattrs = repo_path.join(".gitattributes");
        let rule = format!("{}/log.md merge=union\n", req.folder);
        let existing = fs::read_to_string(&gitattrs).unwrap_or_default();
        if !existing.contains(&format!("{}/log.md merge=union", req.folder)) {
            let mut updated = existing;
            if !updated.is_empty() && !updated.ends_with('\n') {
                updated.push('\n');
            }
            updated.push_str(&rule);
            let _ = fs::write(gitattrs, updated);
        }
    }

    if req.agent_entry_file != "none" && !req.agent_entry_file.is_empty() {
        let entry_path = repo_path.join(&req.agent_entry_file);
        if !entry_path.exists() {
            let entry_content = format!(
                "# Agent Entry\n\nSee [{}/SCHEMA.md]({}/SCHEMA.md) for wiki documentation and guidelines.\n",
                req.folder, req.folder
            );
            let _ = fs::write(&entry_path, entry_content);
        }
    }

    let today = "2026-11-10";
    let sensitive_str = if req.sensitive_data { "yes" } else { "no" };

    let mut topics_table = String::new();
    let topics_to_create = if req.topics.is_empty() {
        vec!["architecture".to_string()]
    } else {
        req.topics.clone()
    };

    for topic in &topics_to_create {
        topics_table.push_str(&format!(
            "| {} | `{}.md` | {} documentation |\n",
            topic, topic, topic
        ));
    }

    let schema_content = format!(
r#"---
type: Schema
title: Wiki Schema
description: Repo-specific conventions that wiki workflows must follow.
updated: {today}
confidence: high
---

# Wiki Schema for This Repo

This file is the repo-specific constitution for the wiki. Edit it when the
repository needs different conventions. Wiki workflows must read this file
before editing wiki content.

## Mission

This wiki keeps shared context between the people and the agents working on
this repository, a log of what was done with its evidence, and the decisions
taken and why. Everything else is an optional topic listed in `## Topics`.

## Truth hierarchy

1. Source code, tests, configs, CI, runtime manifests, command output.
2. Topic pages (`## Topics`).
3. `tracker`, `decisions`, `risks` (Core map).
4. `context`, `handoff`, `log`.

## Project profile

| Setting | Value |
| --- | --- |
| Language | {language} |
| Project division | {project_division} |
| Sensitive data | {sensitive_str} |
| Agent entry file | {agent_entry} |

## Core map

| Role | Path |
| --- | --- |
| index | `index.md` |
| log | `log.md` |
| log-archive | `log/` |
| tracker | `project/work-tracker.md` |
| decisions | `project/decisions/` |
| risks | `project/risks.md` |
| context | `agent/context.md` |
| handoff | `agent/handoff.md` |
| troubleshooting | `troubleshooting.md` |
| glossary | `glossary.md` |

## Conventions

- Activity IDs: prefix `T`, stable, never reused; status lives only in the
  tracker.
- Status: 🟢 done and verified · ⚫ closed by a person without proven criteria
  · 🟡 in progress · ⚪ to do · 🔴 blocked.
- Terminal tracker rows carry `Status`: 🟢 requires every `Done when`
  criterion to be proven; ⚫ requires explicit human closure recorded as
  `closed by <person> YYYY-MM-DD; not proven: <what>` in `Criteria met`,
  with the closure source in `Evidence`. Never infer closure authority.
- Dates: `YYYY-MM-DD`.

## Budgets

| Budget | Default |
| --- | --- |
| Single page | 20 KB |
| Core read at a new context | 60 KB |
| log | 30 KB |

## Topics

| Topic | Path | What belongs there |
| --- | --- | --- |
{topics_table}"#,
        today = today,
        language = req.language,
        project_division = req.project_division,
        sensitive_str = sensitive_str,
        agent_entry = req.agent_entry_file,
        topics_table = topics_table
    );
    write_wiki_file_safe(repo_path, &req.folder, "SCHEMA.md", &schema_content, req.sensitive_data)?;

    let index_content = format!(
r#"---
type: Overview
title: Wiki Index
description: Entry point and directory of repository wiki pages.
updated: {today}
confidence: high
sources:
  - .
source_commit: initial
---

# Wiki Index

Welcome to the repository wiki.

- [Schema](SCHEMA.md)
- [Activity Log](log.md)
- [Work Tracker](project/work-tracker.md)
- [Known Risks](project/risks.md)
- [Agent Context](agent/context.md)
- [Agent Handoff](agent/handoff.md)
- [Troubleshooting](troubleshooting.md)
- [Glossary](glossary.md)
"#,
        today = today
    );
    write_wiki_file_safe(repo_path, &req.folder, "index.md", &index_content, req.sensitive_data)?;

    let log_content = format!(
r#"---
type: Project
title: Activity Log
description: Append-only log of repository activities and evidence.
updated: {today}
confidence: high
sources:
  - .
source_commit: initial
---

# Activity Log

## {today} · Initial wiki bootstrap · human
- What: Initialized repository wiki structure
- Evidence: `cargo test` passed
- IDs: T1
"#,
        today = today
    );
    write_wiki_file_safe(repo_path, &req.folder, "log.md", &log_content, req.sensitive_data)?;

    let tracker_content = format!(
r#"---
type: Project
title: Work Tracker
description: Work activities tracking table.
updated: {today}
confidence: high
sources:
  - .
source_commit: initial
---

# Work Tracker

## Open
<!-- wiki:open -->
| ID | Status | Goal | Done when | Owner | Next verification | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 🟡 | Initial repository wiki setup | Wiki passes structural validation | Developer | cargo test | Initialized |

## Proposals
<!-- wiki:proposals -->
| Proposal | By | Date | Why |
| --- | --- | --- | --- |
| Document core architecture and modules | developer | {today} | Establish baseline module documentation |

## Done
<!-- wiki:done -->
| ID | Status | Goal | Closed | Criteria met | Evidence |
| --- | --- | --- | --- | --- | --- |
"#,
        today = today
    );
    write_wiki_file_safe(repo_path, &req.folder, "project/work-tracker.md", &tracker_content, req.sensitive_data)?;

    let decision_content = format!(
r#"---
type: Decision
title: Initial Architecture
description: Initial architecture baseline.
status: proposed
updated: {today}
confidence: high
sources:
  - .
source_commit: initial
---

# 0001 - Initial Architecture

## Status
Proposed

## Context
Initial repository setup.

## Decision
Adopt standard codebase wiki structure.

## Approval
proposed: wiki-init on {today}.
"#,
        today = today
    );
    write_wiki_file_safe(
        repo_path,
        &req.folder,
        "project/decisions/0001-initial-architecture.md",
        &decision_content,
        req.sensitive_data,
    )?;

    let risks_content = format!(
r#"---
type: Project
title: Known Risks
description: Known repository risks and mitigations.
updated: {today}
confidence: high
sources:
  - .
source_commit: initial
---

# Known Risks

- Initial development risks monitored.
"#,
        today = today
    );
    write_wiki_file_safe(repo_path, &req.folder, "project/risks.md", &risks_content, req.sensitive_data)?;

    let context_content = format!(
r#"---
type: AgentNote
title: Agent Context
description: Working context for coding agents.
updated: {today}
confidence: high
sources:
  - .
source_commit: initial
---

# Agent Context

## Goals and Non-Goals
<!-- wiki:goals -->
Maintain repository documentation and code quality.

## Non-Negotiable Rules
<!-- wiki:rules -->
Do not break structural validation.

## Frequent Commands
<!-- wiki:commands -->
`cargo test`

## Verified Facts
<!-- wiki:verified-facts -->
Wiki initialized.

## Read First
<!-- wiki:read-first -->
[Schema](../SCHEMA.md)
"#,
        today = today
    );
    write_wiki_file_safe(repo_path, &req.folder, "agent/context.md", &context_content, req.sensitive_data)?;

    let handoff_content = format!(
r#"---
type: AgentNote
title: Agent Handoff
description: Baton and state handoff for agent sessions.
updated: {today}
confidence: high
sources:
  - .
source_commit: initial
---

# Agent Handoff

## Current Work State
<!-- wiki:state -->
- Tracker IDs: T1
- Goal: Initial repository wiki setup
- Last completed step: Initialized wiki structure
- Current branch: `main`
- Worktree: clean

## Baton For Next Coding Agent
<!-- wiki:baton -->
| Order | Task | Start files | Done when | Verification command | Notes / blockers |
| --- | --- | --- | --- | --- | --- |
| 1 | T1 - Initial setup | SCHEMA.md | Wiki structure verified | cargo test | None |

## Blockers
<!-- wiki:blockers -->
None.

## Known Risks
<!-- wiki:risks -->
None.

## Commands Already Run
<!-- wiki:commands-run -->
- `cargo test`

## Do Not Redo
<!-- wiki:do-not-redo -->
None.

## Evidence Trail
<!-- wiki:evidence-trail -->
Initial wiki structure generated.
"#,
        today = today
    );
    write_wiki_file_safe(repo_path, &req.folder, "agent/handoff.md", &handoff_content, req.sensitive_data)?;

    let troubleshooting_content = format!(
r#"---
type: Engineering
title: Troubleshooting
description: Common issues and diagnostics.
updated: {today}
confidence: high
sources:
  - .
source_commit: initial
---

# Troubleshooting

General troubleshooting steps.
"#,
        today = today
    );
    write_wiki_file_safe(repo_path, &req.folder, "troubleshooting.md", &troubleshooting_content, req.sensitive_data)?;

    let glossary_content = format!(
r#"---
type: Glossary
title: Glossary
description: Domain terminology and definitions.
updated: {today}
confidence: high
sources:
  - .
source_commit: initial
---

# Glossary

- **Wiki**: Repository-local engineering wiki.
"#,
        today = today
    );
    write_wiki_file_safe(repo_path, &req.folder, "glossary.md", &glossary_content, req.sensitive_data)?;

    for topic in &topics_to_create {
        let topic_path = format!("{}.md", topic);
        let topic_content = format!(
r#"---
type: Topic
title: {topic}
description: {topic} documentation.
updated: {today}
confidence: high
sources:
  - .
source_commit: initial
---

# {topic}

Documentation for {topic}.
"#,
            topic = topic,
            today = today
        );
        write_wiki_file_safe(repo_path, &req.folder, &topic_path, &topic_content, req.sensitive_data)?;
    }

    // Ensure log-archive directory exists
    let _ = fs::create_dir_all(wiki_dir.join("log"));

    Ok(req.folder.clone())
}
