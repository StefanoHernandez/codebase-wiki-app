use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use toml_edit::{DocumentMut, Item, Table};

use crate::paths::bin_path;

const SERVER_KEY: &str = "codebase-wiki";

pub fn codex_config_path(home: &Path) -> PathBuf {
    if let Ok(codex) = std::env::var("CODEX_HOME") {
        return PathBuf::from(codex).join("config.toml");
    }
    home.join(".codex").join("config.toml")
}

pub fn cursor_config_path(home: &Path) -> PathBuf {
    home.join(".cursor").join("mcp.json")
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
    srv.insert("command", Item::Value(toml_edit::Value::from(command.to_string_lossy().as_ref())));
    let mut args = toml_edit::Array::new();
    args.push("serve");
    srv.insert("args", Item::Value(toml_edit::Value::Array(args)));
    table.insert(SERVER_KEY, Item::Table(srv));
    Ok(doc.to_string())
}

pub fn propose_cursor_patch(existing: &str, command: &Path, per_project: bool, workspace: &str) -> Result<String, String> {
    let mut root: Value = serde_json::from_str(existing).map_err(|e| format!("JSON non valido: {e}"))?;
    let servers = root
        .get_mut("mcpServers")
        .and_then(|v| v.as_object_mut())
        .ok_or("mcpServers mancante o non oggetto")?;
    let mut args = vec![json!("serve")];
    if per_project {
        args.push(json!("--repo"));
        args.push(json!(workspace));
    }
    servers.insert(
        SERVER_KEY.into(),
        json!({
            "command": command.to_string_lossy(),
            "args": args,
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

pub fn write_codex_connect(home: &Path, command: &Path) -> Result<String, String> {
    let path = codex_config_path(home);
    let before = fs::read_to_string(&path).unwrap_or_default();
    let after = propose_codex_patch(&before, command)?;
    fs::create_dir_all(path.parent().unwrap()).ok();
    if path.is_file() {
        fs::copy(&path, path.with_extension("toml.bak")).ok();
    }
    fs::write(&path, &after).map_err(|e| e.to_string())?;
    Ok(after)
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
    fn cursor_keeps_other_servers() {
        let input = r#"{"mcpServers":{"other":{"command":"x"}}}"#;
        let out = propose_cursor_patch(input, Path::new("/bin/mcp"), false, "").unwrap();
        assert!(out.contains("other"));
        assert!(out.contains("codebase-wiki"));
    }

    #[test]
    fn invalid_json_refused() {
        assert!(propose_cursor_patch("{", Path::new("/x"), false, "").is_err());
    }

    #[test]
    fn disconnect_removes_only_our_key() {
        let input = r#"{"mcpServers":{"other":{"command":"x"},"codebase-wiki":{"command":"y"}}}"#;
        let out = propose_cursor_disconnect(input).unwrap();
        assert!(!out.contains("codebase-wiki"));
        assert!(out.contains("other"));
    }
}
