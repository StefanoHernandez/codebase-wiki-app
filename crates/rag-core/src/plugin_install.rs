//! Codebase Wiki LLM plugin per agent: what is installed, and how to install or update it.
//! Home directories and the command runner are injected, so tests never touch real configs.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// Runs a command (`args[0]` is the program) and returns its stdout.
pub trait Runner {
    fn run(&self, args: &[&str]) -> Result<String, String>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginStatus {
    Missing,
    Outdated,
    Current,
    /// Installed, latest version not known (offline).
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRow {
    pub id: &'static str,
    pub installed: Option<String>,
    pub latest: Option<String>,
    pub status: PluginStatus,
    /// Cursor and OpenCode get the skills only, without hooks.
    pub skills_only: bool,
    pub agent_found: bool,
    pub error: Option<String>,
    /// Commands to run by hand when the CLI fails.
    pub manual: Vec<String>,
}

/// Where each agent keeps its files.
#[derive(Debug, Clone)]
pub struct AgentDirs {
    pub claude: PathBuf,
    pub codex: PathBuf,
    pub gemini: PathBuf,
    pub cursor: PathBuf,
    pub opencode: PathBuf,
}

impl AgentDirs {
    /// Default layout under `home`, ignoring environment overrides (tests).
    pub fn from_home(home: &Path) -> Self {
        Self {
            claude: home.join(".claude"),
            codex: home.join(".codex"),
            gemini: home.join(".gemini"),
            cursor: home.join(".cursor"),
            opencode: home.join(".config/opencode"),
        }
    }

    /// The real layout: `CODEX_HOME` and `XDG_CONFIG_HOME` honoured.
    pub fn real() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let mut d = Self::from_home(&home);
        if let Some(codex) = std::env::var_os("CODEX_HOME") {
            d.codex = PathBuf::from(codex);
        }
        if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
            d.opencode = PathBuf::from(xdg).join("opencode");
        }
        d
    }

    fn antigravity_plugin(&self) -> PathBuf {
        self.gemini.join("config/plugins").join(PLUGIN)
    }

    fn skills_root(&self, id: &str) -> Option<PathBuf> {
        match id {
            "cursor" => Some(self.cursor.join("skills")),
            "opencode" => Some(self.opencode.join("skills")),
            _ => None,
        }
    }
}

pub const REPO_URL: &str = "https://github.com/StefanoHernandez/codebase-wiki-llm.git";
const REPO_SHORT: &str = "StefanoHernandez/codebase-wiki-llm";
const PLUGIN: &str = "codebase-wiki-llm";
const CLAUDE_MARKETPLACE: &str = "stefano-wiki";
const CLAUDE_ID: &str = "codebase-wiki-llm@stefano-wiki";
const CODEX_MARKETPLACE: &str = "codebase-wiki-llm";
const CODEX_ID: &str = "codebase-wiki-llm@codebase-wiki-llm";
pub const SKILLS: [&str; 6] = [
    "codebase-wiki-llm",
    "codebase-wiki-context",
    "codebase-wiki-init",
    "codebase-wiki-ingest",
    "codebase-wiki-sync",
    "codebase-wiki-lint",
];
const MARKER: &str = ".installed-version";

/// Agents that get the plugin, in display order.
pub const AGENTS: [&str; 5] = ["claude", "codex", "antigravity", "cursor", "opencode"];

/// Highest `vX.Y.Z` tag in `git ls-remote --tags` output, without the `v`.
pub fn latest_tag(ls_remote: &str) -> Option<String> {
    ls_remote
        .lines()
        .filter_map(|l| l.split_whitespace().nth(1))
        .filter_map(|r| r.strip_prefix("refs/tags/v"))
        .filter(|t| !t.ends_with("^{}"))
        .filter_map(|t| parse_version(t).map(|v| (v, t.to_string())))
        .max_by_key(|(v, _)| *v)
        .map(|(_, t)| t)
}

fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let mut it = v.trim().split('.').map(|p| p.parse::<u64>().ok());
    let out = (it.next()??, it.next()??, it.next()??);
    it.next().is_none().then_some(out)
}

fn status_of(installed: Option<&str>, latest: Option<&str>) -> PluginStatus {
    match (installed.and_then(parse_version), latest.and_then(parse_version)) {
        (None, _) if installed.is_none() => PluginStatus::Missing,
        (Some(i), Some(l)) if i < l => PluginStatus::Outdated,
        (Some(_), Some(_)) => PluginStatus::Current,
        _ => PluginStatus::Unknown,
    }
}

fn claude_installed(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let list = v.as_array().or_else(|| v.get("plugins").and_then(|p| p.as_array()))?;
    list.iter()
        .find(|p| p.get("id").and_then(|i| i.as_str()) == Some(CLAUDE_ID))
        .and_then(|p| p.get("version")?.as_str().map(String::from))
}

fn codex_installed(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    v.get("installed")?
        .as_array()?
        .iter()
        .find(|p| p.get("pluginId").and_then(|i| i.as_str()) == Some(CODEX_ID))
        .and_then(|p| p.get("version")?.as_str().map(String::from))
}

fn read_trimmed(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn antigravity_installed(dirs: &AgentDirs) -> Option<String> {
    let text = std::fs::read_to_string(dirs.antigravity_plugin().join("plugin.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    v.get("version")?.as_str().map(String::from)
}

/// Commands that install or update the plugin through an agent's CLI.
fn cli_commands(id: &str, marketplace_present: bool) -> Vec<String> {
    match (id, marketplace_present) {
        ("claude", false) => vec![
            format!("claude plugin marketplace add {REPO_URL}#main"),
            format!("claude plugin install {CLAUDE_ID}"),
        ],
        ("claude", true) => vec![
            format!("claude plugin marketplace update {CLAUDE_MARKETPLACE}"),
            format!("claude plugin install {CLAUDE_ID}"),
        ],
        ("codex", false) => vec![
            format!("codex plugin marketplace add {REPO_SHORT} --ref main"),
            format!("codex plugin add {CODEX_ID}"),
        ],
        ("codex", true) => vec![
            format!("codex plugin marketplace upgrade {CODEX_MARKETPLACE}"),
            format!("codex plugin add {CODEX_ID}"),
        ],
        _ => Vec::new(),
    }
}

/// State of the plugin for every agent. `latest` is the newest released version, if known.
pub fn plugin_state(dirs: &AgentDirs, runner: &dyn Runner, latest: Option<&str>) -> Vec<PluginRow> {
    AGENTS
        .iter()
        .map(|&id| {
            let mut row = PluginRow {
                id,
                installed: None,
                latest: latest.map(String::from),
                status: PluginStatus::Missing,
                skills_only: matches!(id, "cursor" | "opencode"),
                agent_found: false,
                error: None,
                manual: Vec::new(),
            };
            match id {
                "claude" | "codex" => {
                    let (program, dir) = if id == "claude" { ("claude", &dirs.claude) } else { ("codex", &dirs.codex) };
                    match runner.run(&[program, "plugin", "list", "--json"]) {
                        Ok(out) => {
                            row.agent_found = true;
                            row.installed = if id == "claude" { claude_installed(&out) } else { codex_installed(&out) };
                        }
                        Err(e) => {
                            row.agent_found = dir.is_dir();
                            if row.agent_found {
                                row.error = Some(e);
                                row.manual = cli_commands(id, false);
                            }
                        }
                    }
                }
                "antigravity" => {
                    row.agent_found = dirs.gemini.is_dir();
                    row.installed = antigravity_installed(dirs);
                }
                _ => {
                    let root = dirs.skills_root(id).expect("skills agent");
                    row.agent_found = root.parent().is_some_and(Path::is_dir);
                    row.installed = read_trimmed(&root.join(PLUGIN).join(MARKER));
                }
            }
            row.status = status_of(row.installed.as_deref(), latest);
            row
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::fs;

    /// Canned stdout (or error) per program.
    struct Fake(HashMap<&'static str, Result<String, String>>);
    impl Runner for Fake {
        fn run(&self, args: &[&str]) -> Result<String, String> {
            self.0.get(args[0]).cloned().unwrap_or_else(|| Err(format!("{}: not found", args[0])))
        }
    }

    fn row<'a>(rows: &'a [PluginRow], id: &str) -> &'a PluginRow {
        rows.iter().find(|r| r.id == id).unwrap()
    }

    #[test]
    fn latest_tag_is_highest_semver() {
        let out = "a\trefs/tags/v0.9.2\nb\trefs/tags/v0.14.0\nc\trefs/tags/v0.14.0^{}\nd\trefs/tags/foo\ne\trefs/tags/v0.13.1\n";
        assert_eq!(latest_tag(out).as_deref(), Some("0.14.0"));
        assert_eq!(latest_tag(""), None);
    }

    #[test]
    fn claude_counts_only_our_marketplace() {
        let home = tempfile::tempdir().unwrap();
        let dirs = AgentDirs::from_home(home.path());
        let json = r#"[{"id":"codebase-wiki-llm@other","version":"9.0.0"},{"id":"codebase-wiki-llm@stefano-wiki","version":"0.13.0"}]"#;
        let fake = Fake(HashMap::from([("claude", Ok(json.to_string()))]));
        let rows = plugin_state(&dirs, &fake, Some("0.14.0"));
        let r = row(&rows, "claude");
        assert_eq!(r.installed.as_deref(), Some("0.13.0"));
        assert_eq!(r.status, PluginStatus::Outdated);
        assert!(r.agent_found);
    }

    #[test]
    fn missing_cli_and_folder_means_agent_not_found() {
        let home = tempfile::tempdir().unwrap();
        let rows = plugin_state(&AgentDirs::from_home(home.path()), &Fake(HashMap::new()), Some("0.14.0"));
        let r = row(&rows, "claude");
        assert!(!r.agent_found);
        assert_eq!(r.status, PluginStatus::Missing);
        assert!(r.error.is_none());
    }

    #[test]
    fn codex_json_and_broken_cli() {
        let home = tempfile::tempdir().unwrap();
        let dirs = AgentDirs::from_home(home.path());
        let json = r#"{"installed":[{"pluginId":"codebase-wiki-llm@codebase-wiki-llm","version":"0.11.0","enabled":true}],"available":[]}"#;
        let rows = plugin_state(&dirs, &Fake(HashMap::from([("codex", Ok(json.to_string()))])), Some("0.14.0"));
        assert_eq!(row(&rows, "codex").status, PluginStatus::Outdated);

        fs::create_dir_all(&dirs.codex).unwrap();
        let broken = Fake(HashMap::from([("codex", Err("spawn codex ENOENT".to_string()))]));
        let r = row(&plugin_state(&dirs, &broken, Some("0.14.0")), "codex").clone();
        assert!(r.agent_found);
        assert_eq!(r.error.as_deref(), Some("spawn codex ENOENT"));
        assert_eq!(r.manual, vec![
            "codex plugin marketplace add StefanoHernandez/codebase-wiki-llm --ref main".to_string(),
            "codex plugin add codebase-wiki-llm@codebase-wiki-llm".to_string(),
        ]);
    }

    #[test]
    fn folder_agents_read_their_version() {
        let home = tempfile::tempdir().unwrap();
        let dirs = AgentDirs::from_home(home.path());
        let ag = dirs.gemini.join("config/plugins/codebase-wiki-llm");
        fs::create_dir_all(&ag).unwrap();
        fs::write(ag.join("plugin.json"), r#"{"name":"codebase-wiki-llm","version":"0.14.0"}"#).unwrap();
        let cur = dirs.cursor.join("skills/codebase-wiki-llm");
        fs::create_dir_all(&cur).unwrap();
        fs::write(cur.join(".installed-version"), "0.13.0\n").unwrap();
        fs::create_dir_all(&dirs.opencode).unwrap();

        let rows = plugin_state(&dirs, &Fake(HashMap::new()), Some("0.14.0"));
        assert_eq!(row(&rows, "antigravity").status, PluginStatus::Current);
        let c = row(&rows, "cursor");
        assert_eq!((c.status, c.skills_only), (PluginStatus::Outdated, true));
        let o = row(&rows, "opencode");
        assert_eq!((o.status, o.agent_found), (PluginStatus::Missing, true));
    }

    #[test]
    fn unknown_latest_keeps_installed_version() {
        let home = tempfile::tempdir().unwrap();
        let dirs = AgentDirs::from_home(home.path());
        let cur = dirs.cursor.join("skills/codebase-wiki-llm");
        fs::create_dir_all(&cur).unwrap();
        fs::write(cur.join(".installed-version"), "0.14.0").unwrap();
        let r = row(&plugin_state(&dirs, &Fake(HashMap::new()), None), "cursor").clone();
        assert_eq!((r.status, r.installed.as_deref()), (PluginStatus::Unknown, Some("0.14.0")));
    }
}
