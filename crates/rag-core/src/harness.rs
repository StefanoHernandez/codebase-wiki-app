use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use toml_edit::{DocumentMut, Item, Table};

use crate::paths::bin_path;

const SERVER_KEY: &str = "codebase-wiki";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HarnessLink {
    Connected,
    Outdated,
    Absent,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessRow {
    pub id: &'static str,
    pub label: &'static str,
    pub status: HarnessLink,
    pub config_path: String,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessPreview {
    pub path: String,
    pub before: String,
    pub after: String,
}

pub fn codex_config_path(home: &Path) -> PathBuf {
    if let Ok(codex) = std::env::var("CODEX_HOME") {
        return PathBuf::from(codex).join("config.toml");
    }
    home.join(".codex").join("config.toml")
}

pub fn cursor_config_path(home: &Path) -> PathBuf {
    home.join(".cursor").join("mcp.json")
}

fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn safe_write(path: &Path, content: &str) -> Result<(), String> {
    match fs::read_to_string(path) {
        Ok(_) => {
            fs::copy(path, sibling_bak(path)).map_err(|e| e.to_string())?;
            let tmp = path.with_extension("tmp");
            fs::write(&tmp, content).map_err(|e| e.to_string())?;
            fs::rename(&tmp, path).map_err(|e| e.to_string())?;
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let tmp = path.with_extension("tmp");
            fs::write(&tmp, content).map_err(|e| e.to_string())?;
            fs::rename(&tmp, path).map_err(|e| e.to_string())?;
            Ok(())
        }
        Err(e) => Err(e.to_string()),
    }
}

fn sibling_bak(path: &Path) -> PathBuf {
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("cfg");
    path.parent()
        .unwrap_or(Path::new("."))
        .join(format!("{name}.bak"))
}

pub fn propose_codex_patch(existing: &str, command: &Path) -> Result<String, String> {
    let mut doc = existing
        .parse::<DocumentMut>()
        .map_err(|e| format!("TOML non valido: {e}"))?;
    let table = doc
        .entry("mcp_servers")
        .or_insert(Item::Table(Table::new()))
        .as_table_mut()
        .ok_or("mcp_servers non è una tabella")?;
    let mut srv = Table::new();
    srv.insert(
        "command",
        Item::Value(toml_edit::Value::from(command.to_string_lossy().as_ref())),
    );
    let mut args = toml_edit::Array::new();
    args.push("serve");
    srv.insert("args", Item::Value(toml_edit::Value::Array(args)));
    table.insert(SERVER_KEY, Item::Table(srv));
    Ok(doc.to_string())
}

pub fn propose_codex_disconnect(existing: &str) -> Result<String, String> {
    let mut doc = existing
        .parse::<DocumentMut>()
        .map_err(|e| format!("TOML non valido: {e}"))?;
    if let Some(table) = doc
        .get_mut("mcp_servers")
        .and_then(|i| i.as_table_mut())
    {
        table.remove(SERVER_KEY);
    }
    Ok(doc.to_string())
}

pub fn propose_cursor_patch(existing: &str, command: &Path) -> Result<String, String> {
    let mut root: Value = if existing.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(existing).map_err(|e| format!("JSON non valido: {e}"))?
    };
    let servers = root
        .as_object_mut()
        .ok_or("root non oggetto")?
        .entry("mcpServers")
        .or_insert(json!({}));
    if !servers.is_object() {
        return Err("mcpServers non è un oggetto".into());
    }
    servers.as_object_mut().unwrap().insert(
        SERVER_KEY.into(),
        json!({
            "command": command.to_string_lossy(),
            "args": ["serve"],
        }),
    );
    serde_json::to_string_pretty(&root).map_err(|e| e.to_string())
}

pub fn propose_cursor_disconnect(existing: &str) -> Result<String, String> {
    let mut root: Value = serde_json::from_str(existing).map_err(|e| format!("JSON non valido: {e}"))?;
    if let Some(servers) = root.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
        servers.remove(SERVER_KEY);
    }
    serde_json::to_string_pretty(&root).map_err(|e| e.to_string())
}

pub fn claude_mcp_json(command: &Path) -> String {
    serde_json::json!({
        "type": "stdio",
        "command": command.to_string_lossy(),
        "args": ["serve"]
    })
    .to_string()
}

pub fn claude_command(bin: &Path) -> String {
    let json = claude_mcp_json(bin);
    format!("claude mcp add-json --scope user {SERVER_KEY} '{json}'")
}

pub fn claude_remove_command() -> &'static str {
    "claude mcp remove --scope user codebase-wiki"
}

pub fn claude_on_path() -> bool {
    Command::new("claude")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn antigravity_block(command: &Path) -> String {
    serde_json::to_string_pretty(&json!({
        "mcpServers": {
            SERVER_KEY: {
                "command": command.to_string_lossy(),
                "args": ["serve"]
            }
        }
    }))
    .unwrap_or_default()
}

fn codex_command_in_toml(text: &str) -> Option<String> {
    let doc = text.parse::<DocumentMut>().ok()?;
    doc.get("mcp_servers")?
        .get(SERVER_KEY)?
        .get("command")?
        .as_str()
        .map(String::from)
}

fn cursor_command_in_json(text: &str) -> Option<String> {
    let root: Value = serde_json::from_str(text).ok()?;
    root.get("mcpServers")?
        .get(SERVER_KEY)?
        .get("command")?
        .as_str()
        .map(String::from)
}

fn classify(command: Option<String>) -> HarnessLink {
    let current = bin_path().to_string_lossy().to_string();
    match command {
        None => HarnessLink::Absent,
        Some(c) if c == current => HarnessLink::Connected,
        Some(_) => HarnessLink::Outdated,
    }
}

pub fn harness_state() -> Vec<HarnessRow> {
    let home = home_dir();
    let codex_path = codex_config_path(&home);
    let cursor_path = cursor_config_path(&home);
    let codex_before = fs::read_to_string(&codex_path).unwrap_or_default();
    let cursor_before = fs::read_to_string(&cursor_path).unwrap_or_default();
    vec![
        HarnessRow {
            id: "codex",
            label: "Codex",
            status: classify(codex_command_in_toml(&codex_before)),
            config_path: codex_path.display().to_string(),
            hint: None,
        },
        HarnessRow {
            id: "cursor",
            label: "Cursor",
            status: classify(cursor_command_in_json(&cursor_before)),
            config_path: cursor_path.display().to_string(),
            hint: Some("Se Cursor non trova il repo, aggiungi \"--repo\", \"${workspaceFolder}\" negli args.".into()),
        },
        HarnessRow {
            id: "claude",
            label: "Claude Code",
            // `claude mcp add --scope user` stores the server in ~/.claude.json (read only here).
            status: classify(
                fs::read_to_string(home.join(".claude.json"))
                    .ok()
                    .and_then(|t| cursor_command_in_json(&t)),
            ),
            config_path: "scope user (claude mcp)".into(),
            hint: None,
        },
        HarnessRow {
            id: "antigravity",
            label: "Antigravity",
            status: HarnessLink::Absent,
            config_path: "Manage MCP servers → View raw config".into(),
            hint: Some("Incollalo in Manage MCP servers → View raw config.".into()),
        },
    ]
    .into_iter()
    .map(|mut row| {
        if row.id == "claude" {
            row.hint = Some(if claude_on_path() {
                "Esegui il comando mostrato o usa Copia.".into()
            } else {
                "Installa Claude Code CLI o copia il comando manualmente.".into()
            });
        }
        row
    })
    .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HarnessAction {
    Connect,
    Disconnect,
    Update,
}

/// Current file text; a missing file is empty, any other read error is refused.
fn read_config_text(path: &Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(t) => Ok(t),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

pub fn harness_preview(harness: &str, action: HarnessAction) -> Result<HarnessPreview, String> {
    let home = home_dir();
    let bin = bin_path();
    match harness {
        "codex" => {
            let path = codex_config_path(&home);
            let before = read_config_text(&path)?;
            let after = match action {
                HarnessAction::Disconnect => propose_codex_disconnect(&before)?,
                HarnessAction::Connect | HarnessAction::Update => propose_codex_patch(&before, &bin)?,
            };
            Ok(HarnessPreview {
                path: path.display().to_string(),
                before,
                after,
            })
        }
        "cursor" => {
            let path = cursor_config_path(&home);
            let before = read_config_text(&path)?;
            let after = match action {
                HarnessAction::Disconnect => {
                    if before.trim().is_empty() {
                        propose_cursor_disconnect("{}")?
                    } else {
                        propose_cursor_disconnect(&before)?
                    }
                }
                HarnessAction::Connect | HarnessAction::Update => propose_cursor_patch(&before, &bin)?,
            };
            Ok(HarnessPreview {
                path: path.display().to_string(),
                before,
                after,
            })
        }
        "claude" => Ok(HarnessPreview {
            path: "claude mcp (scope user)".into(),
            before: String::new(),
            after: if action == HarnessAction::Disconnect {
                claude_remove_command().into()
            } else {
                claude_command(&bin)
            },
        }),
        "antigravity" => Ok(HarnessPreview {
            path: "antigravity raw".into(),
            before: String::new(),
            after: antigravity_block(&bin),
        }),
        other => Err(format!("harness sconosciuto: {other}")),
    }
}

pub fn harness_apply(harness: &str, action: HarnessAction) -> Result<(), String> {
    match harness {
        "codex" | "cursor" => {
            let preview = harness_preview(harness, action)?;
            safe_write(Path::new(&preview.path), &preview.after)
        }
        "claude" => {
            if action == HarnessAction::Disconnect {
                if !claude_on_path() {
                    return Err("claude non è nel PATH".into());
                }
                let status = Command::new("claude")
                    .args(["mcp", "remove", "--scope", "user", SERVER_KEY])
                    .status()
                    .map_err(|e| e.to_string())?;
                if status.success() {
                    Ok(())
                } else {
                    Err("claude mcp remove fallito".into())
                }
            } else if claude_on_path() {
                let bin = bin_path();
                let json = claude_mcp_json(&bin);
                let status = Command::new("claude")
                    .args(["mcp", "add-json", "--scope", "user", SERVER_KEY, &json])
                    .status()
                    .map_err(|e| e.to_string())?;
                if status.success() {
                    Ok(())
                } else {
                    Err("claude mcp add-json fallito".into())
                }
            } else {
                Err("claude non è nel PATH; usa Copia".into())
            }
        }
        "antigravity" => Err("Antigravity: incolla il JSON manualmente".into()),
        other => Err(format!("harness sconosciuto: {other}")),
    }
}

pub fn entry_points_at_current_bin(existing_command: &str) -> bool {
    existing_command == bin_path().to_string_lossy()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_keeps_unrelated_comment() {
        let input = "# comment\n[other]\nx=1\n";
        let out = propose_codex_patch(input, Path::new("/bin/mcp")).unwrap();
        assert!(out.contains("# comment"));
        assert!(out.contains("codebase-wiki"));
    }

    #[test]
    fn codex_keeps_unrelated_table_on_disconnect() {
        let input = "# comment\n[other]\nx=1\n";
        let connected = propose_codex_patch(input, Path::new("/bin/mcp")).unwrap();
        let out = propose_codex_disconnect(&connected).unwrap();
        assert!(out.contains("[other]"));
        assert!(!out.contains(SERVER_KEY));
    }

    #[test]
    fn cursor_keeps_other_servers() {
        let input = r#"{"mcpServers":{"other":{"command":"x"}}}"#;
        let out = propose_cursor_patch(input, Path::new("/bin/mcp")).unwrap();
        assert!(out.contains("other"));
        assert!(out.contains("codebase-wiki"));
    }

    #[test]
    fn cursor_creates_mcp_servers_in_empty_object() {
        let out = propose_cursor_patch("", Path::new("/bin/mcp")).unwrap();
        assert!(out.contains("mcpServers"));
        assert!(out.contains("codebase-wiki"));
    }

    #[test]
    fn invalid_json_refused() {
        assert!(propose_cursor_patch("{", Path::new("/x")).is_err());
    }

    #[test]
    fn disconnect_removes_only_our_key() {
        let input = r#"{"mcpServers":{"other":{"command":"x"},"codebase-wiki":{"command":"y"}}}"#;
        let out = propose_cursor_disconnect(input).unwrap();
        assert!(!out.contains("codebase-wiki"));
        assert!(out.contains("other"));
    }

    #[test]
    fn harness_state_marks_outdated_path() {
        let tmp = tempfile::tempdir().unwrap();
        let cursor = tmp.path().join("mcp.json");
        fs::write(
            &cursor,
            r#"{"mcpServers":{"codebase-wiki":{"command":"/old/path"}}}"#,
        )
        .unwrap();
        let cmd = cursor_command_in_json(&fs::read_to_string(&cursor).unwrap()).unwrap();
        assert_eq!(classify(Some(cmd)), HarnessLink::Outdated);
    }

    #[test]
    fn safe_write_creates_bak() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("mcp.json");
        fs::write(&file, "{}").unwrap();
        safe_write(&file, "{\"mcpServers\":{}}").unwrap();
        assert!(tmp.path().join("mcp.json.bak").is_file());
    }
}
