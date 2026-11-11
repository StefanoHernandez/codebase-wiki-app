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

/// Cursor's app and `cursor-agent` read the same file.
pub fn cursor_config_path(home: &Path) -> PathBuf {
    home.join(".cursor").join("mcp.json")
}

/// The chat in Claude Desktop (not the Code tab, which reads Claude Code's config).
/// `config_dir`: ~/.config on Linux, ~/Library/Application Support on macOS, %APPDATA% on Windows.
pub fn claude_desktop_config_path(home: &Path) -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| home.join(".config"))
        .join("Claude")
        .join("claude_desktop_config.json")
}

/// Antigravity's app and `agy` CLI share it (`agy mcp add` writes here).
pub fn antigravity_config_path(home: &Path) -> PathBuf {
    home.join(".gemini").join("config").join("mcp_config.json")
}

/// OpenCode uses XDG paths on every OS (`opencode mcp add --global` writes here).
pub fn opencode_config_path(home: &Path) -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"))
        .join("opencode")
        .join("opencode.json")
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

fn parse_json_root(existing: &str) -> Result<Value, String> {
    if existing.trim().is_empty() {
        return Ok(json!({}));
    }
    let root: Value = serde_json::from_str(existing).map_err(|e| format!("JSON non valido: {e}"))?;
    if !root.is_object() {
        return Err("il file non contiene un oggetto JSON".into());
    }
    Ok(root)
}

/// The object at `path` inside `root`, created when missing; refused when something else is there.
fn json_object_at<'a>(root: &'a mut Value, path: &[&str]) -> Result<&'a mut serde_json::Map<String, Value>, String> {
    let mut cur = root;
    for key in path {
        cur = cur
            .as_object_mut()
            .ok_or_else(|| format!("{key}: il contenitore non è un oggetto"))?
            .entry(key.to_string())
            .or_insert(json!({}));
        if !cur.is_object() {
            return Err(format!("{key} non è un oggetto"));
        }
    }
    Ok(cur.as_object_mut().expect("checked"))
}

/// `{"mcpServers": {...}}`: Cursor, Claude Desktop, Antigravity.
pub fn propose_cursor_patch(existing: &str, command: &Path) -> Result<String, String> {
    let mut root = parse_json_root(existing)?;
    json_object_at(&mut root, &["mcpServers"])?.insert(
        SERVER_KEY.into(),
        json!({
            "command": command.to_string_lossy(),
            "args": ["serve"],
        }),
    );
    serde_json::to_string_pretty(&root).map_err(|e| e.to_string())
}

pub fn propose_cursor_disconnect(existing: &str) -> Result<String, String> {
    let mut root = parse_json_root(existing)?;
    if let Some(servers) = root.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
        servers.remove(SERVER_KEY);
    }
    serde_json::to_string_pretty(&root).map_err(|e| e.to_string())
}

/// `{"mcp": {"servers": {name: {"type": "local", "command": [bin, "serve"]}}}}`, as written by
/// `opencode mcp add --global`.
pub fn propose_opencode_patch(existing: &str, command: &Path) -> Result<String, String> {
    let mut root = parse_json_root(existing)?;
    json_object_at(&mut root, &["mcp", "servers"])?.insert(
        SERVER_KEY.into(),
        json!({
            "type": "local",
            "command": [command.to_string_lossy(), "serve"],
        }),
    );
    serde_json::to_string_pretty(&root).map_err(|e| e.to_string())
}

pub fn propose_opencode_disconnect(existing: &str) -> Result<String, String> {
    let mut root = parse_json_root(existing)?;
    if let Some(mcp) = root.get_mut("mcp").and_then(|v| v.as_object_mut()) {
        // Older OpenCode configs keep servers directly under `mcp`.
        mcp.remove(SERVER_KEY);
        if let Some(servers) = mcp.get_mut("servers").and_then(|v| v.as_object_mut()) {
            servers.remove(SERVER_KEY);
        }
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

fn opencode_command_in_json(text: &str) -> Option<String> {
    let root: Value = serde_json::from_str(text).ok()?;
    let mcp = root.get("mcp")?;
    let entry = mcp.get("servers").and_then(|s| s.get(SERVER_KEY)).or_else(|| mcp.get(SERVER_KEY))?;
    entry.get("command")?.get(0)?.as_str().map(String::from)
}

fn classify(command: Option<String>) -> HarnessLink {
    let current = bin_path().to_string_lossy().to_string();
    match command {
        None => HarnessLink::Absent,
        Some(c) if c == current => HarnessLink::Connected,
        Some(_) => HarnessLink::Outdated,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Format {
    McpServers,
    CodexToml,
    OpenCode,
}

/// Agents configured by editing one file. Tools that share a file (an app and its CLI) are one
/// row, so the server is never written twice.
struct FileTarget {
    id: &'static str,
    label: &'static str,
    format: Format,
    path: PathBuf,
    hint: Option<&'static str>,
}

fn file_targets(home: &Path) -> Vec<FileTarget> {
    vec![
        FileTarget {
            id: "claude-desktop",
            label: "Claude Desktop (chat)",
            format: Format::McpServers,
            path: claude_desktop_config_path(home),
            hint: Some("Riavvia Claude Desktop. Nei piani Team serve il permesso di un Owner."),
        },
        FileTarget {
            id: "cursor",
            label: "Cursor (app e cursor-agent)",
            format: Format::McpServers,
            path: cursor_config_path(home),
            hint: Some("Se Cursor non trova il repo, aggiungi \"--repo\", \"${workspaceFolder}\" negli args."),
        },
        FileTarget {
            id: "codex",
            label: "Codex (CLI e app)",
            format: Format::CodexToml,
            path: codex_config_path(home),
            hint: None,
        },
        FileTarget {
            id: "antigravity",
            label: "Antigravity (app e agy)",
            format: Format::McpServers,
            path: antigravity_config_path(home),
            hint: Some("Riavvia Antigravity o la sessione agy."),
        },
        FileTarget {
            id: "opencode",
            label: "OpenCode",
            format: Format::OpenCode,
            path: opencode_config_path(home),
            hint: None,
        },
    ]
}

fn command_in(format: Format, text: &str) -> Option<String> {
    match format {
        Format::McpServers => cursor_command_in_json(text),
        Format::CodexToml => codex_command_in_toml(text),
        Format::OpenCode => opencode_command_in_json(text),
    }
}

fn propose(format: Format, before: &str, bin: &Path, action: HarnessAction) -> Result<String, String> {
    if action == HarnessAction::Disconnect && before.trim().is_empty() {
        return Ok(String::new());
    }
    match (format, action) {
        (Format::McpServers, HarnessAction::Disconnect) => propose_cursor_disconnect(before),
        (Format::McpServers, _) => propose_cursor_patch(before, bin),
        (Format::CodexToml, HarnessAction::Disconnect) => propose_codex_disconnect(before),
        (Format::CodexToml, _) => propose_codex_patch(before, bin),
        (Format::OpenCode, HarnessAction::Disconnect) => propose_opencode_disconnect(before),
        (Format::OpenCode, _) => propose_opencode_patch(before, bin),
    }
}

pub fn harness_state() -> Vec<HarnessRow> {
    let home = home_dir();
    let mut rows = vec![HarnessRow {
        id: "claude",
        label: "Claude Code (CLI e scheda Code)",
        // `claude mcp add --scope user` stores the server in ~/.claude.json (read only here).
        status: classify(
            fs::read_to_string(home.join(".claude.json"))
                .ok()
                .and_then(|t| cursor_command_in_json(&t)),
        ),
        config_path: "scope user (claude mcp)".into(),
        hint: Some(if claude_on_path() {
            "Esegui il comando mostrato o usa Copia.".into()
        } else {
            "Installa Claude Code CLI o copia il comando manualmente.".into()
        }),
    }];
    rows.extend(file_targets(&home).into_iter().map(|t| HarnessRow {
        id: t.id,
        label: t.label,
        status: classify(fs::read_to_string(&t.path).ok().and_then(|text| command_in(t.format, &text))),
        config_path: t.path.display().to_string(),
        hint: t.hint.map(String::from),
    }));
    rows
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
    if harness == "claude" {
        return Ok(HarnessPreview {
            path: "claude mcp (scope user)".into(),
            before: String::new(),
            after: if action == HarnessAction::Disconnect {
                claude_remove_command().into()
            } else {
                claude_command(&bin)
            },
        });
    }
    let target = file_targets(&home)
        .into_iter()
        .find(|t| t.id == harness)
        .ok_or_else(|| format!("harness sconosciuto: {harness}"))?;
    if target.format == Format::OpenCode && !target.path.exists() && target.path.with_extension("jsonc").exists() {
        return Err(format!(
            "OpenCode usa opencode.jsonc (con commenti): esegui `opencode mcp add --global {SERVER_KEY} -- {} serve`",
            bin.display()
        ));
    }
    let before = read_config_text(&target.path)?;
    let after = propose(target.format, &before, &bin, action)?;
    Ok(HarnessPreview {
        path: target.path.display().to_string(),
        before,
        after,
    })
}

pub fn harness_apply(harness: &str, action: HarnessAction) -> Result<(), String> {
    if harness != "claude" {
        let preview = harness_preview(harness, action)?;
        if preview.after == preview.before {
            return Ok(());
        }
        return safe_write(Path::new(&preview.path), &preview.after);
    }
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
    fn opencode_patch_matches_opencode_mcp_add() {
        // Shape written by `opencode mcp add --global` (OpenCode 2026-11).
        let out = propose_opencode_patch(r#"{"theme":"system"}"#, Path::new("/x/codebase-wiki-mcp")).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["theme"], "system");
        assert_eq!(v["mcp"]["servers"][SERVER_KEY]["type"], "local");
        assert_eq!(v["mcp"]["servers"][SERVER_KEY]["command"], json!(["/x/codebase-wiki-mcp", "serve"]));
        assert_eq!(opencode_command_in_json(&out).as_deref(), Some("/x/codebase-wiki-mcp"));
        let off = propose_opencode_disconnect(&out).unwrap();
        assert_eq!(opencode_command_in_json(&off), None);
        assert!(off.contains("\"theme\""));
    }

    #[test]
    fn opencode_reads_legacy_layout() {
        let legacy = r#"{"mcp":{"codebase-wiki":{"type":"local","command":["/old/bin","serve"]}}}"#;
        assert_eq!(opencode_command_in_json(legacy).as_deref(), Some("/old/bin"));
        assert_eq!(opencode_command_in_json(&propose_opencode_disconnect(legacy).unwrap()), None);
    }

    #[test]
    fn mcp_servers_patch_on_empty_file_matches_agy_mcp_add() {
        // Antigravity ships an empty mcp_config.json; `agy mcp add` writes {"mcpServers": {...}}.
        let out = propose_cursor_patch("", Path::new("/x/codebase-wiki-mcp")).unwrap();
        assert_eq!(cursor_command_in_json(&out).as_deref(), Some("/x/codebase-wiki-mcp"));
    }

    #[test]
    fn mcp_servers_patch_keeps_key_order_and_other_settings() {
        let input = r#"{"preferences":{"a":1},"coworkUserFilesPath":"/x"}"#;
        let out = propose_cursor_patch(input, Path::new("/bin/mcp")).unwrap();
        let p = out.find("preferences").unwrap();
        assert!(p < out.find("coworkUserFilesPath").unwrap() && out.find("coworkUserFilesPath").unwrap() < out.find("mcpServers").unwrap());
    }

    #[test]
    fn disconnect_on_missing_file_writes_nothing() {
        assert_eq!(propose(Format::OpenCode, "", Path::new("/b"), HarnessAction::Disconnect).unwrap(), "");
        assert_eq!(propose(Format::McpServers, "  \n", Path::new("/b"), HarnessAction::Disconnect).unwrap(), "");
    }

    #[test]
    fn non_object_container_refused() {
        assert!(propose_cursor_patch(r#"{"mcpServers":[]}"#, Path::new("/b")).is_err());
        assert!(propose_opencode_patch(r#"{"mcp":{"servers":"x"}}"#, Path::new("/b")).is_err());
        assert!(propose_cursor_patch("[]", Path::new("/b")).is_err());
    }

    #[test]
    fn every_target_has_a_distinct_id_and_file() {
        let home = Path::new("/home/u");
        let t = file_targets(home);
        let mut ids: Vec<_> = t.iter().map(|t| t.id).collect();
        ids.push("claude");
        let n = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), n);
        let mut paths: Vec<_> = t.iter().map(|t| t.path.clone()).collect();
        paths.sort();
        paths.dedup();
        assert_eq!(paths.len(), t.len());
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
