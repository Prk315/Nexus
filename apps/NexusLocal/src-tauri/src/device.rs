use crate::config::state_dir;
use std::fs;
use uuid::Uuid;

/// A stable per-machine identity for this grid node, persisted so the node keeps
/// the same id across restarts. Mirrors TimeTracker's device-id approach.
pub fn get_or_create() -> String {
    let path = state_dir().join("device_id");
    if let Ok(existing) = fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let id = Uuid::new_v4().to_string();
    let _ = fs::write(&path, &id);
    id
}

/// Best-effort human-readable machine name for the dashboard.
///
/// iOS sandboxes forbid spawning subprocesses, so the `hostname` command route
/// used on desktop hard-fails there and leaves the dashboard showing "unknown".
/// On iOS read the name straight from libc's `gethostname(2)` instead.
#[cfg(target_os = "ios")]
pub fn hostname() -> String {
    let mut buf = [0u8; 256];
    let rc = unsafe { libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len()) };
    if rc == 0 {
        let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        if let Ok(s) = std::str::from_utf8(&buf[..end]) {
            let t = s.trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }
    "iPhone".to_string()
}

/// Best-effort human-readable machine name for the dashboard.
#[cfg(not(target_os = "ios"))]
pub fn hostname() -> String {
    std::env::var("HOSTNAME")
        .ok()
        .or_else(|| {
            std::process::Command::new("hostname")
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string())
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

pub fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "ios") {
        "ios"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}
