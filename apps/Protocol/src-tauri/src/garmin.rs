use std::path::PathBuf;
use tauri::command;

fn bridge_script_path() -> Result<PathBuf, String> {
    // Allow override via env var for flexibility (CI, custom installs, etc.)
    if let Ok(env_path) = std::env::var("GARMIN_BRIDGE_PATH") {
        let p = PathBuf::from(env_path);
        if p.exists() {
            return Ok(p);
        }
    }

    // In dev the binary lives at apps/Protocol/src-tauri/target/debug/protocol.
    // Walk upward until we find garmin_bridge/garmin_bridge.py (up to 8 levels).
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut dir = exe.parent().unwrap_or(&exe).to_path_buf();
    for _ in 0..8 {
        let candidate = dir.join("garmin_bridge").join("garmin_bridge.py");
        if candidate.exists() {
            return Ok(candidate);
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
    }

    Err("garmin_bridge.py not found — set GARMIN_BRIDGE_PATH env var to override".to_string())
}

/// Run an arbitrary command against the Garmin bridge script.
/// `command` is the sub-command name (e.g. "sync", "fetch_activities").
/// `args` are additional positional arguments passed after the command.
#[command]
pub async fn garmin_run(command: String, args: Vec<String>) -> Result<String, String> {
    let bridge = bridge_script_path()?;
    let bridge_str = bridge.to_string_lossy().to_string();

    let mut cmd_args = vec![bridge_str, command];
    cmd_args.extend(args);

    let output = std::process::Command::new("python")
        .args(&cmd_args)
        .output()
        .or_else(|_| std::process::Command::new("python3").args(&cmd_args).output())
        .map_err(|e| format!("Failed to launch Python: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// Authenticate with Garmin Connect, storing OAuth tokens locally.
/// Pass `otp` for the MFA second step; leave it empty/None for the first attempt.
/// Returns raw JSON from the bridge: `{"ok":true}`, `{"mfa_required":true}`, or an error.
#[command]
pub async fn garmin_auth(email: String, password: String, otp: Option<String>) -> Result<String, String> {
    let bridge = bridge_script_path()?;
    let bridge_str = bridge.to_string_lossy().to_string();

    let mut cmd_args = vec![
        bridge_str,
        "auth".to_string(),
        "--email".to_string(),
        email,
        "--password".to_string(),
        password,
    ];
    if let Some(code) = otp {
        if !code.is_empty() {
            cmd_args.push("--otp".to_string());
            cmd_args.push(code);
        }
    }

    let output = std::process::Command::new("python")
        .args(&cmd_args)
        .output()
        .or_else(|_| std::process::Command::new("python3").args(&cmd_args).output())
        .map_err(|e| format!("Failed to launch Python: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// Return the resolved path to garmin_bridge.py (useful for debugging / first-run setup UI).
#[command]
pub async fn garmin_bridge_path() -> Result<String, String> {
    bridge_script_path().map(|p| p.to_string_lossy().to_string())
}
