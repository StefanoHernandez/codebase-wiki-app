use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use wiki_core::{run_structural_lint_with, LintReport};

pub const PYTHON_NOT_FOUND_MSG_EN: &str = "Structural check needs Python 3.10 or newer. Install it (python.org, or `brew install python` on macOS) or set the path in settings.";
pub const PYTHON_NOT_FOUND_MSG: &str = "Il controllo strutturale richiede Python 3.10 o più recente. Installalo (python.org, oppure `brew install python` su macOS) o indica il percorso nelle impostazioni.";

const PYTHON_VERSION_SNIPPET: &str = "import sys;print(sys.version_info[0],sys.version_info[1])";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum ResolvedPython {
    Executable(PathBuf),
    #[cfg(windows)]
    PyDash3,
}

#[derive(Clone, Debug, Default)]
struct PythonCache {
    setting: Option<String>,
    resolved: Option<ResolvedPython>,
    /// Last failed lookup for this setting. Lint now runs on every load, so without this every
    /// watcher event would probe all candidates again; it expires so an install is picked up.
    failed_at: Option<std::time::Instant>,
}

const PYTHON_RETRY_AFTER: std::time::Duration = std::time::Duration::from_secs(60);

static PYTHON_CACHE: OnceLock<Mutex<PythonCache>> = OnceLock::new();

fn python_cache() -> &'static Mutex<PythonCache> {
    PYTHON_CACHE.get_or_init(|| Mutex::new(PythonCache::default()))
}

fn python_meets_minimum(major: u32, minor: u32) -> bool {
    major > 3 || (major == 3 && minor >= 10)
}

fn parse_version_stdout(text: &str) -> Option<(u32, u32)> {
    let parts: Vec<&str> = text.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }
    let major = parts[0].parse().ok()?;
    let minor = parts[1].parse().ok()?;
    Some((major, minor))
}

fn python_version_at(path: &Path) -> Option<(u32, u32)> {
    let output = wiki_core::no_window_command(path)
        .arg("-c")
        .arg(PYTHON_VERSION_SNIPPET)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_version_stdout(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(windows)]
fn python_version_py_dash_3() -> Option<(u32, u32)> {
    let output = wiki_core::no_window_command("py")
        .arg("-3")
        .arg("-c")
        .arg(PYTHON_VERSION_SNIPPET)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_version_stdout(&String::from_utf8_lossy(&output.stdout))
}

/// Returns the first candidate whose reported version is ≥ Python 3.10.
pub fn choose_python(
    candidates: &[PathBuf],
    version: impl Fn(&Path) -> Option<(u32, u32)>,
) -> Option<PathBuf> {
    for path in candidates {
        let Some((major, minor)) = version(path) else {
            continue;
        };
        if python_meets_minimum(major, minor) {
            return Some(path.clone());
        }
    }
    None
}

fn executable_on_path(name: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&paths) {
        let plain = dir.join(name);
        if plain.is_file() {
            return Some(plain);
        }
        #[cfg(windows)]
        {
            let with_exe = dir.join(format!("{name}.exe"));
            if with_exe.is_file() {
                return Some(with_exe);
            }
        }
    }
    None
}

fn push_candidate(list: &mut Vec<PathBuf>, path: PathBuf) {
    let dup = list.iter().any(|existing| {
        match (
            dunce::canonicalize(existing),
            dunce::canonicalize(&path),
        ) {
            (Ok(a), Ok(b)) => a == b,
            _ => existing == &path,
        }
    });
    if !dup {
        list.push(path);
    }
}

fn python_path_candidates(setting: Option<&Path>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(p) = setting {
        if !p.as_os_str().is_empty() {
            push_candidate(&mut out, p.to_path_buf());
        }
    }
    for name in [
        "python3.13",
        "python3.12",
        "python3.11",
        "python3.10",
        "python3",
        "python",
    ] {
        if let Some(p) = executable_on_path(name) {
            push_candidate(&mut out, p);
        }
    }
    for p in ["/opt/homebrew/bin/python3", "/usr/local/bin/python3"] {
        let path = PathBuf::from(p);
        if path.is_file() {
            push_candidate(&mut out, path);
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let shim = PathBuf::from(home).join(".pyenv/shims/python3");
        if shim.is_file() {
            push_candidate(&mut out, shim);
        }
    }
    out
}

fn resolve_python(setting: Option<&str>) -> Result<ResolvedPython, String> {
    let setting_path = setting
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    let candidates = python_path_candidates(setting_path.as_deref());
    if let Some(path) = choose_python(&candidates, python_version_at) {
        return Ok(ResolvedPython::Executable(path));
    }
    #[cfg(windows)]
    if python_version_py_dash_3()
        .map(|(maj, min)| python_meets_minimum(maj, min))
        .unwrap_or(false)
    {
        return Ok(ResolvedPython::PyDash3);
    }
    Err(wiki_core::tr(PYTHON_NOT_FOUND_MSG, PYTHON_NOT_FOUND_MSG_EN))
}

pub(super) fn find_python(setting: Option<&str>) -> Result<ResolvedPython, String> {
    let normalized = setting
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    let mut cache = python_cache()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if cache.setting == normalized {
        if let Some(resolved) = cache.resolved.clone() {
            return Ok(resolved);
        }
        if cache.failed_at.is_some_and(|t| t.elapsed() < PYTHON_RETRY_AFTER) {
            return Err(wiki_core::tr(PYTHON_NOT_FOUND_MSG, PYTHON_NOT_FOUND_MSG_EN));
        }
    } else {
        cache.setting = normalized.clone();
        cache.resolved = None;
        cache.failed_at = None;
    }
    match resolve_python(normalized.as_deref()) {
        Ok(resolved) => {
            cache.resolved = Some(resolved.clone());
            cache.failed_at = None;
            Ok(resolved)
        }
        Err(e) => {
            cache.failed_at = Some(std::time::Instant::now());
            Err(e)
        }
    }
}

pub(super) fn run_lint_with_python(
    resolved: &ResolvedPython,
    repo: &Path,
    wiki_root: &str,
    script: &Path,
) -> LintReport {
    match resolved {
        ResolvedPython::Executable(path) => {
            let bin = path.to_string_lossy();
            run_structural_lint_with(&bin, repo, wiki_root, script)
        }
        #[cfg(windows)]
        ResolvedPython::PyDash3 => wiki_core::run_structural_lint_with_args(
            "py",
            &["-3"],
            repo,
            wiki_root,
            script,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choose_python_skips_below_3_10() {
        let candidates = vec![
            PathBuf::from("/opt/python3.9"),
            PathBuf::from("/opt/python3.11"),
        ];
        let chosen = choose_python(&candidates, |p| {
            if p.ends_with("python3.9") {
                Some((3, 9))
            } else if p.ends_with("python3.11") {
                Some((3, 11))
            } else {
                None
            }
        });
        assert_eq!(chosen, Some(PathBuf::from("/opt/python3.11")));
    }

    #[test]
    fn choose_python_returns_none_when_no_suitable_candidate() {
        let candidates = vec![PathBuf::from("/opt/python3.9")];
        assert_eq!(choose_python(&candidates, |_| Some((3, 9))), None);
        assert_eq!(choose_python(&candidates, |_| None), None);
    }

    #[test]
    fn choose_python_skips_unversioned_then_picks_valid() {
        let candidates = vec![
            PathBuf::from("/missing/settings/python3"),
            PathBuf::from("/opt/python3.11"),
        ];
        let chosen = choose_python(&candidates, |p| {
            if p.ends_with("settings/python3") {
                None
            } else if p.ends_with("python3.11") {
                Some((3, 11))
            } else {
                None
            }
        });
        assert_eq!(chosen, Some(PathBuf::from("/opt/python3.11")));
    }

    #[test]
    fn choose_python_skips_failing_version_probe_then_picks_valid() {
        let candidates = vec![
            PathBuf::from("/broken/python3"),
            PathBuf::from("/opt/python3.12"),
        ];
        let chosen = choose_python(&candidates, |p| {
            if p.ends_with("broken/python3") {
                None
            } else if p.ends_with("python3.12") {
                Some((3, 12))
            } else {
                None
            }
        });
        assert_eq!(chosen, Some(PathBuf::from("/opt/python3.12")));
    }
}
