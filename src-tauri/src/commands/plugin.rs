use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rag_core::plugin_install::{self, AgentDirs, PluginPreview, PluginRow, Runner, REPO_URL};

use super::blocking;

/// Runs agent CLIs and git. A GUI app on macOS starts with a minimal PATH, so the usual
/// install folders are added (also for `#!/usr/bin/env node` wrappers such as `codex`).
struct CliRunner {
    path: std::ffi::OsString,
}

impl CliRunner {
    fn new() -> Self {
        let home = plugin_install::home_dir();
        let mut dirs_list: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default();
        for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
            dirs_list.push(PathBuf::from(extra));
        }
        for extra in [
            ".local/bin",
            ".claude/local",
            ".npm-global/bin",
            ".volta/bin",
            ".asdf/shims",
            ".local/share/mise/shims",
            ".bun/bin",
            ".cargo/bin",
        ] {
            dirs_list.push(home.join(extra));
        }
        // Windows: npm global installs (claude.cmd, codex.cmd) live in %APPDATA%\npm.
        if let Some(appdata) = std::env::var_os("APPDATA") {
            dirs_list.push(PathBuf::from(appdata).join("npm"));
        }
        // nvm keeps one bin folder per node version; any of them serves `env node`.
        if let Ok(versions) = std::fs::read_dir(home.join(".nvm/versions/node")) {
            dirs_list.extend(versions.flatten().map(|v| v.path().join("bin")));
        }
        Self {
            path: std::env::join_paths(dirs_list).unwrap_or_default(),
        }
    }

    fn resolve(&self, program: &str) -> Option<PathBuf> {
        let names = program_names(program, cfg!(windows));
        std::env::split_paths(&self.path)
            .flat_map(|d| names.iter().map(move |n| d.join(n)).collect::<Vec<_>>())
            .find(|p| p.is_file())
    }
}

/// File names a program can have on disk: on Windows `claude` is `claude.exe` or an npm
/// `claude.cmd` wrapper (Rust runs `.cmd`/`.bat` through cmd.exe with safe quoting).
fn program_names(program: &str, windows: bool) -> Vec<String> {
    if windows {
        ["exe", "cmd", "bat"]
            .iter()
            .map(|ext| format!("{program}.{ext}"))
            .collect()
    } else {
        vec![program.to_string()]
    }
}

impl Runner for CliRunner {
    fn run(&self, args: &[&str]) -> Result<String, String> {
        let (program, rest) = args
            .split_first()
            .ok_or_else(|| wiki_core::tr("comando vuoto", "empty command"))?;
        let exe = self.resolve(program).ok_or_else(|| {
            wiki_core::tr(
                &format!("{program}: comando non trovato"),
                &format!("{program}: command not found"),
            )
        })?;
        let mut cmd = wiki_core::no_window_command(exe);
        let mut child = cmd
            .args(rest)
            .env("PATH", &self.path)
            // Never wait for a person: no stdin, no git credential prompt.
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("{program}: {e}"))?;
        let read = |pipe: Option<Box<dyn std::io::Read + Send>>| {
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                if let Some(mut p) = pipe {
                    let _ = p.read_to_end(&mut buf);
                }
                buf
            })
        };
        let stdout = read(
            child
                .stdout
                .take()
                .map(|p| Box::new(p) as Box<dyn std::io::Read + Send>),
        );
        let stderr = read(
            child
                .stderr
                .take()
                .map(|p| Box::new(p) as Box<dyn std::io::Read + Send>),
        );
        let deadline = Instant::now() + CLI_TIMEOUT;
        let status = loop {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                break status;
            }
            if Instant::now() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                let secs = CLI_TIMEOUT.as_secs();
                return Err(wiki_core::tr(
                    &format!("{program}: nessuna risposta dopo {secs} s"),
                    &format!("{program}: no response after {secs} s"),
                ));
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        let out = stdout.join().unwrap_or_default();
        let err = String::from_utf8_lossy(&stderr.join().unwrap_or_default())
            .trim()
            .to_string();
        if status.success() {
            Ok(String::from_utf8_lossy(&out).into_owned())
        } else {
            Err(if err.is_empty() {
                wiki_core::tr(
                    &format!("{program}: uscita {status}"),
                    &format!("{program}: exited with {status}"),
                )
            } else {
                err
            })
        }
    }
}

const CLI_TIMEOUT: Duration = Duration::from_secs(120);
const LATEST_TTL: Duration = Duration::from_secs(15 * 60);
const LATEST_RETRY: Duration = Duration::from_secs(60);

#[derive(Clone, Debug)]
struct CachedLatest {
    version: Option<String>,
    checked_at: Instant,
}

fn resolve_latest_with_cache(
    cache: &Mutex<Option<CachedLatest>>,
    now: Instant,
    force: bool,
    fetch: impl FnOnce() -> Option<String>,
) -> Option<String> {
    if !force {
        let guard = cache.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = guard.as_ref() {
            let ttl = if entry.version.is_some() {
                LATEST_TTL
            } else {
                LATEST_RETRY
            };
            if now.saturating_duration_since(entry.checked_at) < ttl {
                return entry.version.clone();
            }
        }
    }
    let found = fetch();
    let mut guard = cache.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(CachedLatest {
        version: found.clone(),
        checked_at: now,
    });
    found
}

/// Newest released plugin version, cached up to 15 min (or 60 s when offline).
/// `force = true` bypasses the cache; network lookup runs without holding the lock.
fn latest_plugin_version(runner: &dyn Runner, force: bool) -> Option<String> {
    static LATEST: Mutex<Option<CachedLatest>> = Mutex::new(None);
    resolve_latest_with_cache(&LATEST, Instant::now(), force, || {
        runner
            .run(&["git", "ls-remote", "--tags", REPO_URL])
            .ok()
            .and_then(|out| plugin_install::latest_tag(&out))
    })
}

/// Shallow checkout of the plugin repo at `v<version>` under the data dir.
fn plugin_source(runner: &dyn Runner, version: &str) -> Result<PathBuf, String> {
    let dir = rag_core::paths::data_dir().join("plugin-src");
    let tag = format!("v{version}");
    let d = dir.to_string_lossy().into_owned();
    if dir.join(".git").is_dir() {
        runner.run(&["git", "-C", &d, "fetch", "--depth", "1", "origin", "tag", &tag])?;
        runner.run(&["git", "-C", &d, "checkout", "--force", &tag])?;
        // Files of older versions must not be copied into the agents.
        runner.run(&["git", "-C", &d, "clean", "-fdx"])?;
    } else {
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        }
        runner.run(&["git", "clone", "--depth", "1", "--branch", &tag, REPO_URL, &d])?;
    }
    Ok(dir)
}

#[tauri::command]
pub async fn plugin_state(force: Option<bool>) -> Result<Vec<PluginRow>, String> {
    blocking(move || {
        let runner = CliRunner::new();
        let latest = latest_plugin_version(&runner, force.unwrap_or(false));
        Ok(plugin_install::plugin_state(
            &AgentDirs::real(),
            &runner,
            latest.as_deref(),
        ))
    })
    .await
}

#[tauri::command]
pub async fn plugin_preview(agent: String) -> Result<PluginPreview, String> {
    blocking(move || {
        plugin_install::plugin_preview(&agent, &AgentDirs::real(), &CliRunner::new())
    })
    .await
}

#[tauri::command]
pub async fn plugin_apply(agent: String) -> Result<(), String> {
    blocking(move || {
        let runner = CliRunner::new();
        let needs_source = matches!(agent.as_str(), "antigravity" | "cursor" | "opencode");
        let latest = latest_plugin_version(&runner, true);
        let source = match (&latest, needs_source) {
            (Some(v), true) => Some(plugin_source(&runner, v)?),
            (None, true) => {
                return Err(wiki_core::tr(
                    "Versione del plugin non disponibile: controlla la connessione e riprova.",
                    "Plugin version not available: check your connection and try again.",
                ))
            }
            _ => None,
        };
        plugin_install::plugin_apply(
            &agent,
            &AgentDirs::real(),
            &runner,
            source.as_deref(),
            latest.as_deref(),
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn program_names_add_windows_extensions() {
        assert_eq!(program_names("claude", false), vec!["claude"]);
        assert_eq!(
            program_names("codex", true),
            vec!["codex.exe", "codex.cmd", "codex.bat"]
        );
    }

    #[test]
    fn latest_cache_respects_ttl_and_force() {
        let cache = Mutex::new(None);
        let t0 = Instant::now();
        let mut calls = 0usize;

        let v1 = resolve_latest_with_cache(&cache, t0, false, || {
            calls += 1;
            Some("0.16.0".into())
        });
        assert_eq!(v1.as_deref(), Some("0.16.0"));
        assert_eq!(calls, 1);

        // Within 15 min TTL: uses cached value without fetching.
        let v2 = resolve_latest_with_cache(&cache, t0 + Duration::from_secs(60), false, || {
            calls += 1;
            Some("0.17.0".into())
        });
        assert_eq!(v2.as_deref(), Some("0.16.0"));
        assert_eq!(calls, 1);

        // `force = true` bypasses TTL immediately.
        let v3 = resolve_latest_with_cache(&cache, t0 + Duration::from_secs(61), true, || {
            calls += 1;
            Some("0.17.0".into())
        });
        assert_eq!(v3.as_deref(), Some("0.17.0"));
        assert_eq!(calls, 2);

        // Past 15 min TTL: refreshes automatically.
        let v4 = resolve_latest_with_cache(&cache, t0 + Duration::from_secs(61) + LATEST_TTL, false, || {
            calls += 1;
            Some("0.18.0".into())
        });
        assert_eq!(v4.as_deref(), Some("0.18.0"));
        assert_eq!(calls, 3);
    }
}
