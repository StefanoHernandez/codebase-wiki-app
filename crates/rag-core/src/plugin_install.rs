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

/// The user's home folder (`USERPROFILE` on Windows, `HOME` elsewhere).
pub fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
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
        let mut d = Self::from_home(&home_dir());
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
                                // One line per step, valid in any shell: add the marketplace, or update it
                                // when it is already there; then install.
                                let (add, update) = (cli_commands(id, false), cli_commands(id, true));
                                row.manual = vec![format!("{} || {}", add[0], update[0]), add[1].clone()];
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPreview {
    pub commands: Vec<String>,
    /// Folders created or replaced.
    pub folders: Vec<String>,
}

/// Claude: `Some(true)` when `stefano-wiki` follows `main`, `Some(false)` when it follows another ref.
fn claude_marketplace(runner: &dyn Runner) -> Option<bool> {
    let out = runner.run(&["claude", "plugin", "marketplace", "list", "--json"]).ok()?;
    let v: serde_json::Value = serde_json::from_str(&out).ok()?;
    let list = v.as_array().or_else(|| v.get("marketplaces").and_then(|m| m.as_array()))?;
    let m = list.iter().find(|m| m.get("name").and_then(|n| n.as_str()) == Some(CLAUDE_MARKETPLACE))?;
    Some(m.get("ref").and_then(|r| r.as_str()).is_none_or(|r| r == "main"))
}

fn codex_marketplace(runner: &dyn Runner) -> bool {
    runner
        .run(&["codex", "plugin", "marketplace", "list"])
        .is_ok_and(|out| out.lines().any(|l| l.split_whitespace().next() == Some(CODEX_MARKETPLACE)))
}

fn folder_targets(id: &str, dirs: &AgentDirs) -> Vec<PathBuf> {
    match id {
        "antigravity" => vec![dirs.antigravity_plugin()],
        _ => dirs.skills_root(id).map(|root| SKILLS.iter().map(|s| root.join(s)).collect()).unwrap_or_default(),
    }
}

/// Source folder inside the plugin checkout for each target folder.
fn folder_sources(id: &str, source: &Path) -> Vec<PathBuf> {
    match id {
        "antigravity" => vec![source.join("plugins/antigravity-codebase-wiki-llm")],
        _ => SKILLS.iter().map(|s| source.join("skills").join(s)).collect(),
    }
}

/// What installing or updating the plugin for `id` will do.
pub fn plugin_preview(id: &str, dirs: &AgentDirs, runner: &dyn Runner) -> Result<PluginPreview, String> {
    let commands = match id {
        "claude" => match claude_marketplace(runner) {
            Some(true) => cli_commands("claude", true),
            Some(false) => {
                let mut c = vec![format!("claude plugin marketplace remove {CLAUDE_MARKETPLACE}")];
                c.extend(cli_commands("claude", false));
                c
            }
            None => cli_commands("claude", false),
        },
        "codex" => cli_commands("codex", codex_marketplace(runner)),
        "antigravity" | "cursor" | "opencode" => Vec::new(),
        other => return Err(format!("Agente sconosciuto: {other}")),
    };
    let folders = folder_targets(id, dirs).iter().map(|p| p.display().to_string()).collect();
    Ok(PluginPreview { commands, folders })
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        // `metadata` follows symlinks: a linked folder is copied as a folder.
        if std::fs::metadata(entry.path())?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn bak(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".bak");
    path.with_file_name(name)
}

/// Replaces each target with its source, then runs `finish` (e.g. the version marker); on any
/// failure only the targets this call touched go back to what they were.
fn replace_folders(pairs: &[(PathBuf, PathBuf)], finish: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    for (src, _) in pairs {
        if !src.is_dir() {
            return Err(format!("Cartella del plugin mancante: {}", src.display()));
        }
    }
    // (target, had a previous version moved to `.bak`)
    let mut touched: Vec<(&PathBuf, bool)> = Vec::new();
    let result = (|| {
        for (src, dst) in pairs {
            let b = bak(dst);
            if b.exists() {
                std::fs::remove_dir_all(&b).map_err(|e| format!("{}: {e}", b.display()))?;
            }
            let existed = dst.exists();
            if existed {
                std::fs::rename(dst, &b).map_err(|e| format!("{}: {e}", dst.display()))?;
            }
            touched.push((dst, existed));
            copy_dir(src, dst).map_err(|e| format!("{}: {e}", dst.display()))?;
        }
        finish()
    })();
    match result {
        Ok(()) => {
            for (dst, existed) in touched {
                if existed {
                    let _ = std::fs::remove_dir_all(bak(dst));
                }
            }
            Ok(())
        }
        Err(e) => {
            for (dst, existed) in touched {
                let _ = std::fs::remove_dir_all(dst);
                if existed {
                    let _ = std::fs::rename(bak(dst), dst);
                }
            }
            Err(e)
        }
    }
}

/// Installs or updates the plugin for `id`. `source` is the plugin checkout (folder agents);
/// `version` is written next to the skills so the state can be read back.
pub fn plugin_apply(
    id: &str,
    dirs: &AgentDirs,
    runner: &dyn Runner,
    source: Option<&Path>,
    version: Option<&str>,
) -> Result<(), String> {
    let preview = plugin_preview(id, dirs, runner)?;
    for cmd in &preview.commands {
        let args: Vec<&str> = cmd.split_whitespace().collect();
        runner.run(&args).map_err(|e| format!("{cmd}: {e}"))?;
    }
    let targets = folder_targets(id, dirs);
    if targets.is_empty() {
        return Ok(());
    }
    let source = source.ok_or_else(|| wiki_core::tr("Copia del plugin non disponibile: controlla la connessione e riprova.", "Plugin copy not available: check your connection and try again."))?;
    let pairs: Vec<(PathBuf, PathBuf)> = folder_sources(id, source).into_iter().zip(targets).collect();
    let marker = dirs.skills_root(id).map(|root| root.join(PLUGIN).join(MARKER));
    replace_folders(&pairs, || match (marker, version) {
        (Some(path), Some(v)) => std::fs::write(&path, format!("{v}\n")).map_err(|e| format!("{}: {e}", path.display())),
        _ => Ok(()),
    })
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

    /// Records every command; answers `marketplace list` from `markets`.
    struct Rec {
        calls: std::cell::RefCell<Vec<String>>,
        markets: HashMap<&'static str, String>,
        fail_on: Option<&'static str>,
    }
    impl Runner for Rec {
        fn run(&self, args: &[&str]) -> Result<String, String> {
            let line = args.join(" ");
            self.calls.borrow_mut().push(line.clone());
            if self.fail_on.is_some_and(|f| line.contains(f)) {
                return Err("boom".into());
            }
            if line.contains("marketplace list") {
                return Ok(self.markets.get(args[0]).cloned().unwrap_or_default());
            }
            Ok(String::new())
        }
    }
    fn rec(markets: &[(&'static str, &str)], fail_on: Option<&'static str>) -> Rec {
        Rec { calls: Default::default(), markets: markets.iter().map(|(k, v)| (*k, v.to_string())).collect(), fail_on }
    }

    fn fake_source() -> tempfile::TempDir {
        let src = tempfile::tempdir().unwrap();
        for s in SKILLS {
            let d = src.path().join("skills").join(s);
            fs::create_dir_all(d.join("references")).unwrap();
            fs::write(d.join("SKILL.md"), format!("---\nname: {s}\n---\n")).unwrap();
            fs::write(d.join("references/x.md"), "x").unwrap();
        }
        let ag = src.path().join("plugins/antigravity-codebase-wiki-llm");
        fs::create_dir_all(&ag).unwrap();
        fs::write(ag.join("plugin.json"), r#"{"version":"0.14.0"}"#).unwrap();
        src
    }

    #[test]
    fn claude_preview_follows_the_marketplace() {
        let home = tempfile::tempdir().unwrap();
        let d = AgentDirs::from_home(home.path());
        let none = plugin_preview("claude", &d, &rec(&[("claude", "[]")], None)).unwrap();
        assert_eq!(none.commands, vec![
            "claude plugin marketplace add https://github.com/StefanoHernandez/codebase-wiki-llm.git#main".to_string(),
            "claude plugin install codebase-wiki-llm@stefano-wiki".to_string(),
        ]);
        let main = r#"[{"name":"stefano-wiki","ref":"main"}]"#;
        let on_main = plugin_preview("claude", &d, &rec(&[("claude", main)], None)).unwrap();
        assert_eq!(on_main.commands[0], "claude plugin marketplace update stefano-wiki");
        let dev = r#"[{"name":"stefano-wiki","ref":"dev"}]"#;
        let on_dev = plugin_preview("claude", &d, &rec(&[("claude", dev)], None)).unwrap();
        assert_eq!(on_dev.commands[0], "claude plugin marketplace remove stefano-wiki");
        assert_eq!(on_dev.commands.len(), 3);
    }

    #[test]
    fn codex_preview_uses_its_marketplace_name() {
        let home = tempfile::tempdir().unwrap();
        let d = AgentDirs::from_home(home.path());
        let fresh = plugin_preview("codex", &d, &rec(&[("codex", "MARKETPLACE ROOT\nponytail /x\n")], None)).unwrap();
        assert_eq!(fresh.commands[0], "codex plugin marketplace add StefanoHernandez/codebase-wiki-llm --ref main");
        let there = plugin_preview("codex", &d, &rec(&[("codex", "MARKETPLACE ROOT\ncodebase-wiki-llm /y\n")], None)).unwrap();
        assert_eq!(there.commands, vec![
            "codex plugin marketplace upgrade codebase-wiki-llm".to_string(),
            "codex plugin add codebase-wiki-llm@codebase-wiki-llm".to_string(),
        ]);
    }

    #[test]
    fn cursor_apply_copies_skills_and_spares_others() {
        let home = tempfile::tempdir().unwrap();
        let d = AgentDirs::from_home(home.path());
        let other = d.cursor.join("skills/other");
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("SKILL.md"), "mine").unwrap();
        let stale = d.cursor.join("skills/codebase-wiki-sync.bak");
        fs::create_dir_all(&stale).unwrap();
        let src = fake_source();
        let r = rec(&[], None);
        plugin_apply("cursor", &d, &r, Some(src.path()), Some("0.14.0")).unwrap();
        plugin_apply("cursor", &d, &r, Some(src.path()), Some("0.14.0")).unwrap();
        for s in SKILLS {
            assert!(d.cursor.join("skills").join(s).join("references/x.md").is_file(), "{s}");
            assert!(!d.cursor.join("skills").join(format!("{s}.bak")).exists(), "{s}.bak");
        }
        assert_eq!(fs::read_to_string(other.join("SKILL.md")).unwrap(), "mine");
        assert_eq!(read_trimmed(&d.cursor.join("skills/codebase-wiki-llm/.installed-version")).as_deref(), Some("0.14.0"));
        assert!(r.calls.borrow().is_empty());
    }

    #[test]
    fn missing_source_folder_leaves_install_untouched() {
        let home = tempfile::tempdir().unwrap();
        let d = AgentDirs::from_home(home.path());
        let src = fake_source();
        plugin_apply("opencode", &d, &rec(&[], None), Some(src.path()), Some("0.13.0")).unwrap();
        fs::remove_dir_all(src.path().join("skills/codebase-wiki-lint")).unwrap();
        let err = plugin_apply("opencode", &d, &rec(&[], None), Some(src.path()), Some("0.14.0")).unwrap_err();
        assert!(err.contains("codebase-wiki-lint"), "{err}");
        for s in SKILLS {
            assert!(d.opencode.join("skills").join(s).join("SKILL.md").is_file(), "{s}");
        }
        assert_eq!(read_trimmed(&d.opencode.join("skills/codebase-wiki-llm/.installed-version")).as_deref(), Some("0.13.0"));
    }

    #[test]
    fn failed_copy_restores_previous_folders() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        let (a_src, b_src) = (src.path().join("a"), src.path().join("b"));
        fs::create_dir_all(&a_src).unwrap();
        fs::write(a_src.join("f"), "new").unwrap();
        fs::create_dir_all(&b_src).unwrap();
        let (a, b) = (dst.path().join("a"), dst.path().join("b"));
        fs::create_dir_all(&a).unwrap();
        fs::write(a.join("f"), "old").unwrap();
        // `b`'s parent is a file: creating it fails after `a` was already replaced.
        fs::write(dst.path().join("blocker"), "").unwrap();
        let bad = dst.path().join("blocker/b");
        let err = replace_folders(&[(a_src, a.clone()), (b_src, bad)], || Ok(()));
        assert!(err.is_err());
        assert_eq!(fs::read_to_string(a.join("f")).unwrap(), "old");
        assert!(!dst.path().join("a.bak").exists());
        let _ = b;
    }

    #[test]
    fn failure_in_the_middle_keeps_later_folders() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        let mut pairs = Vec::new();
        for name in ["a", "b", "c"] {
            let s = src.path().join(name);
            fs::create_dir_all(&s).unwrap();
            fs::write(s.join("f"), "new").unwrap();
            let d = dst.path().join(name);
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join("f"), "old").unwrap();
            pairs.push((s, d));
        }
        // `b`'s source holds an unreadable file: the copy fails on the second pair.
        let locked = src.path().join("b/locked");
        fs::write(&locked, "x").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        }
        let err = replace_folders(&pairs, || Ok(()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&locked, fs::Permissions::from_mode(0o644)).unwrap();
        }
        assert!(err.is_err());
        for name in ["a", "b", "c"] {
            assert_eq!(fs::read_to_string(dst.path().join(name).join("f")).unwrap(), "old", "{name}");
            assert!(!dst.path().join(format!("{name}.bak")).exists(), "{name}.bak");
        }
    }

    #[test]
    fn antigravity_apply_copies_the_plugin_folder() {
        let home = tempfile::tempdir().unwrap();
        let d = AgentDirs::from_home(home.path());
        let src = fake_source();
        plugin_apply("antigravity", &d, &rec(&[], None), Some(src.path()), Some("0.14.0")).unwrap();
        assert!(d.gemini.join("config/plugins/codebase-wiki-llm/plugin.json").is_file());
    }

    #[test]
    fn cli_apply_runs_the_preview_and_stops_at_first_error() {
        let home = tempfile::tempdir().unwrap();
        let d = AgentDirs::from_home(home.path());
        let ok = rec(&[("claude", "[]")], None);
        plugin_apply("claude", &d, &ok, None, None).unwrap();
        assert_eq!(ok.calls.borrow()[1..], [
            "claude plugin marketplace add https://github.com/StefanoHernandez/codebase-wiki-llm.git#main".to_string(),
            "claude plugin install codebase-wiki-llm@stefano-wiki".to_string(),
        ]);
        let failing = rec(&[("claude", "[]")], Some("marketplace add"));
        let err = plugin_apply("claude", &d, &failing, None, None).unwrap_err();
        assert!(err.contains("boom"));
        assert!(!failing.calls.borrow().iter().any(|c| c.contains("plugin install")));
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
            "codex plugin marketplace add StefanoHernandez/codebase-wiki-llm --ref main || codex plugin marketplace upgrade codebase-wiki-llm".to_string(),
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
