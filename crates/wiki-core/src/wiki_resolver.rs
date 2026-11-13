use std::path::Path;
use std::sync::OnceLock;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiResolution {
    pub wiki_root: Option<String>,
    pub warning: Option<String>,
    pub is_initialized: bool,
}

const RESERVED_NAMES: &[&str] = &[
    ".git",
    ".github",
    ".claude",
    ".codex",
    ".agents",
    ".agent",
    ".gemini",
    ".opencode",
    ".obsidian",
    ".vscode",
    "node_modules",
    ".wikidir",
];

pub const WIKI_OUTSIDE_REPO: &str = "La cartella della wiki punta fuori dal repository.";

/// Canonical wiki directory must lie inside the canonical repository root.
pub fn ensure_wiki_inside_repo(repo_path: &Path, wiki_root: &str) -> Result<(), String> {
    if !is_valid_wiki_folder_name(wiki_root) {
        return Err(format!("Invalid wiki root: {}", wiki_root));
    }
    let wiki_dir = repo_path.join(wiki_root);
    let canon_repo = repo_path
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize repo path: {}", e))?;
    let canon_wiki = wiki_dir
        .canonicalize()
        .map_err(|e| format!("Wiki directory not found: {}", e))?;
    if !canon_wiki.starts_with(&canon_repo) {
        return Err(crate::tr(WIKI_OUTSIDE_REPO, "The wiki folder points outside the repository."));
    }
    Ok(())
}

pub fn is_valid_wiki_folder_name(name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    for reserved in RESERVED_NAMES {
        if reserved.eq_ignore_ascii_case(name) {
            return false;
        }
    }
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"^\.?[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9_-])?$").unwrap()
    });
    re.is_match(name)
}

pub fn resolve_wiki_root(repo_path: &Path) -> WikiResolution {
    let wikidir_path = repo_path.join(".wikidir");
    if wikidir_path.is_file() {
        let raw_bytes = match std::fs::read(&wikidir_path) {
            Ok(b) => b,
            Err(_) => {
                return WikiResolution {
                    wiki_root: None,
                    warning: Some("Codebase Wiki LLM: .wikidir does not contain a valid wiki folder name.".into()),
                    is_initialized: false,
                };
            }
        };

        let mut bytes_slice = raw_bytes.as_slice();
        // Strip UTF-8 BOM (0xEF, 0xBB, 0xBF)
        if bytes_slice.starts_with(&[0xEF, 0xBB, 0xBF]) {
            bytes_slice = &bytes_slice[3..];
        }
        // Strip UTF-16 BOMs (0xFE, 0xFF or 0xFF, 0xFE)
        if bytes_slice.starts_with(&[0xFE, 0xFF]) || bytes_slice.starts_with(&[0xFF, 0xFE]) {
            bytes_slice = &bytes_slice[2..];
        }

        // Strip NUL (0x00) and CR (0x0D)
        let cleaned: Vec<u8> = bytes_slice
            .iter()
            .copied()
            .filter(|&b| b != 0x00 && b != 0x0D)
            .collect();

        let text = String::from_utf8_lossy(&cleaned);
        let first_line = text.lines().map(|l| l.trim()).find(|l| !l.is_empty());

        match first_line {
            Some(value) if is_valid_wiki_folder_name(value) => {
                let folder_path = repo_path.join(value);
                if folder_path.is_dir() {
                    let is_initialized = folder_path.join("SCHEMA.md").is_file();
                    WikiResolution {
                        wiki_root: Some(value.to_string()),
                        warning: None,
                        is_initialized,
                    }
                } else {
                    WikiResolution {
                        wiki_root: None,
                        warning: Some(format!(
                            "Codebase Wiki LLM: .wikidir points to missing directory {}.",
                            value
                        )),
                        is_initialized: false,
                    }
                }
            }
            _ => WikiResolution {
                wiki_root: None,
                warning: Some("Codebase Wiki LLM: .wikidir does not contain a valid wiki folder name.".into()),
                is_initialized: false,
            },
        }
    } else if repo_path.join("wiki").join("SCHEMA.md").is_file() {
        WikiResolution {
            wiki_root: Some("wiki".into()),
            warning: None,
            is_initialized: true,
        }
    } else {
        WikiResolution {
            wiki_root: None,
            warning: None,
            is_initialized: false,
        }
    }
}
