use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

use rag_core::{bin_path, ensure_data_dirs};

pub fn rag_sidecar_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let parent = exe.parent().ok_or("exe parent")?;
    #[cfg(windows)]
    let name = "codebase-wiki-mcp.exe";
    #[cfg(not(windows))]
    let name = "codebase-wiki-mcp";
    let bundled = parent.join(name);
    if bundled.is_file() {
        return Ok(bundled);
    }
    Err(format!("Sidecar non trovato: {}", bundled.display()))
}

pub fn install_mcp_binary() -> Result<(), String> {
    ensure_data_dirs()?;
    let dest = bin_path();
    let sidecar = rag_sidecar_path()?;
    let current_ver = sidecar_version(&sidecar).unwrap_or_default();
    let dest_ver = if dest.is_file() {
        sidecar_version(&dest).unwrap_or_default()
    } else {
        String::new()
    };
    if dest.is_file() && dest_ver == current_ver && !current_ver.is_empty() {
        return Ok(());
    }
    let tmp = dest.with_extension("part");
    fs::copy(&sidecar, &tmp).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&dest).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&dest, perms).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn sidecar_version(path: &Path) -> Option<String> {
    let out = Command::new(path).arg("--version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}
