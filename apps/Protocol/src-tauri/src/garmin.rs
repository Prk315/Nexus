use std::path::PathBuf;
use tauri::command;

fn bridge_script_path() -> Result<PathBuf, String> {
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

/// On Windows the Microsoft Store python.exe stub does not work when invoked
/// from a child process. Try `py -3` (Windows Launcher, always in C:\Windows)
/// first, then fall back to `python` and `python3` for other platforms.
fn invoke_python(args: &[String]) -> Result<std::process::Output, String> {
    std::process::Command::new("py")
        .arg("-3")
        .args(args)
        .output()
        .or_else(|_| std::process::Command::new("python").args(args).output())
        .or_else(|_| std::process::Command::new("python3").args(args).output())
        .map_err(|e| format!("Failed to launch Python: {e}"))
}

fn run_bridge(cmd_args: Vec<String>) -> Result<String, String> {
    let output = invoke_python(&cmd_args)?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// Run an arbitrary sub-command against the Garmin bridge script.
#[command]
pub async fn garmin_run(command: String, args: Vec<String>) -> Result<String, String> {
    let bridge = bridge_script_path()?;
    let bridge_str = bridge.to_string_lossy().to_string();

    let mut cmd_args = vec![bridge_str, command];
    cmd_args.extend(args);
    run_bridge(cmd_args)
}

/// Authenticate with Garmin Connect, storing OAuth tokens locally.
/// Pass `otp` for the MFA second step; leave it None for the first attempt.
/// Returns raw JSON: `{"ok":true}`, `{"mfa_required":true}`, or Err(message).
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
    run_bridge(cmd_args)
}

/// Return the resolved path to garmin_bridge.py (useful for the setup UI).
#[command]
pub async fn garmin_bridge_path() -> Result<String, String> {
    bridge_script_path().map(|p| p.to_string_lossy().to_string())
}
