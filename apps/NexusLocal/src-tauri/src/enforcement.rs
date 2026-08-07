//! Making Mac enforcement actually continual.
//!
//! `modules/blocking.rs` knows *how* to enforce the server's verdict. This
//! module is about whether it ever gets the chance, which turned out to be three
//! separate problems:
//!
//! 1. **The switch was unreachable.** `blocking_enabled` lived only in
//!    `~/.nexuslocalrc`, defaulted to `false`, and was read once at startup — so
//!    turning enforcement on meant hand-editing JSON and relaunching. It shipped
//!    off and stayed off.
//! 2. **The switch was frozen.** Even edited, the flag was baked into the module
//!    at construction and `tick_interval_secs` returned `None` when off, so the
//!    runtime span no loop at all. Now the flag is an [`AtomicBool`] shared with
//!    the module and the loop always runs (see `modules/blocking.rs`).
//! 3. **Nothing kept the app alive.** A menubar app that isn't running enforces
//!    nothing, and there was no launch-at-login. After a reboot the Mac was
//!    unprotected until someone happened to open the app.
//!
//! Point 3 is handled with a **LaunchAgent** rather than a plain login item,
//! because the two differ exactly where it matters: a login item starts the app
//! once, and if it dies you are unprotected until you notice. The agent below
//! also carries `KeepAlive: {SuccessfulExit: false}` — relaunch on a crash, but
//! *not* after a clean quit. Quitting from the tray is a deliberate act and must
//! stay possible; a bare `KeepAlive: true` would resurrect the app instantly and
//! leave no way to stop it short of deleting the plist.
//!
//! # What this deliberately does not do
//!
//! Writing `/etc/hosts` needs root, so each *change* of verdict raises an admin
//! password dialog (unchanged verdicts don't — `render_hosts` is a fixed point,
//! which is what keeps the 30s tick silent). Removing that prompt means granting
//! passwordless sudo to a helper, which is a real weakening of the machine's
//! security posture and not something to install behind a toggle. `hosts_error`
//! in the status surfaces a refused dialog so it never fails silently.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::config::AppConfig;
use crate::grid::ModuleContext;

/// The launchd job label, and the plist basename. Matches the bundle identifier
/// so `launchctl list | grep nexuslocal` finds it where you'd expect.
#[cfg(target_os = "macos")]
const AGENT_LABEL: &str = "com.bastianthomsen.nexuslocal";

/// Shared handle to the blocking module's enforcement switch. The module holds
/// the other end; flipping this is visible on its next tick.
pub struct EnforcementFlag(pub Arc<AtomicBool>);

/// Everything the UI needs to explain the state of Mac enforcement in one read.
#[derive(Debug, Clone, Serialize)]
pub struct EnforcementStatus {
    /// False on iOS (and anywhere that isn't macOS), where the whole panel hides.
    pub supported: bool,
    /// Whether the tick is currently applying the server's verdict.
    pub enforcing: bool,
    /// Whether the LaunchAgent is installed *and* loaded.
    pub autostart: bool,
    /// Whether the background service is running **right now**. On macOS this is
    /// the process that actually enforces — the desktop app spawns no grid — so
    /// "agent installed" without this is enforcement that isn't happening.
    pub daemon_running: bool,
    /// The binary the LaunchAgent would launch. Shown because in `tauri dev`
    /// this is `target/debug/nexus-local`, and registering a dev build for
    /// launch-at-login is almost never what someone means.
    pub exe_path: String,
    /// Where the agent plist lives, so it can be inspected or removed by hand.
    pub agent_path: String,
    /// Domains currently in our `/etc/hosts` marker block — what this machine is
    /// enforcing *right now*, independent of what the server last said.
    pub hosts_domains: Vec<String>,
    /// Set if `/etc/hosts` could not be read.
    pub hosts_error: Option<String>,
}

#[tauri::command]
pub fn tt_enforcement_get(flag: tauri::State<'_, EnforcementFlag>) -> EnforcementStatus {
    let (hosts_domains, hosts_error) = match crate::modules::blocking_hosts_domains() {
        Ok(d) => (d, None),
        Err(e) => (Vec::new(), Some(e)),
    };
    EnforcementStatus {
        supported: cfg!(target_os = "macos"),
        enforcing: flag.0.load(Ordering::Relaxed),
        autostart: autostart_installed(),
        daemon_running: daemon_running(),
        exe_path: exe_path().unwrap_or_else(|e| e),
        agent_path: agent_plist_path_display(),
        hosts_domains,
        hosts_error,
    }
}

/// Flip enforcement and persist it, so it survives the next launch.
///
/// The persist happens **first**: if writing `~/.nexuslocalrc` fails we return
/// the error without touching the flag, rather than enforcing in a way that
/// silently reverts on restart.
#[tauri::command]
pub fn tt_enforcement_set(
    enforcing: bool,
    flag: tauri::State<'_, EnforcementFlag>,
) -> Result<(), String> {
    AppConfig::set_blocking_enabled(enforcing)?;
    flag.0.store(enforcing, Ordering::Relaxed);
    Ok(())
}

/// Apply the current verdict immediately, without waiting for the next tick.
///
/// Switching enforcement on and then watching nothing happen for 30 seconds
/// reads as broken, so the toggle calls this straight after.
#[tauri::command]
pub async fn tt_enforcement_apply_now(
    ctx: tauri::State<'_, ModuleContext>,
) -> Result<serde_json::Value, String> {
    crate::modules::blocking_enforce_now(&ctx.inner().clone()).await
}

/// Install or remove the LaunchAgent.
#[tauri::command]
pub fn tt_enforcement_autostart_set(enabled: bool) -> Result<(), String> {
    if enabled {
        install_autostart()
    } else {
        remove_autostart()
    }
}

// ── launch at login (macOS) ─────────────────────────────────────────────────

fn exe_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.display().to_string())
        .map_err(|e| format!("cannot resolve own path: {e}"))
}

#[cfg(target_os = "macos")]
fn agent_plist_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| {
        h.join("Library")
            .join("LaunchAgents")
            .join(format!("{AGENT_LABEL}.plist"))
    })
}

#[cfg(target_os = "macos")]
fn agent_plist_path_display() -> String {
    agent_plist_path()
        .map(|p| p.display().to_string())
        .unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
fn agent_plist_path_display() -> String {
    String::new()
}

/// Installed *and* loaded. The plist existing on disk is not enough — an agent
/// that was booted out is a file that does nothing, and reporting it as "on"
/// would be the same class of lie as a missing verdict reading as "unblocked".
#[cfg(target_os = "macos")]
fn autostart_installed() -> bool {
    let Some(path) = agent_plist_path() else {
        return false;
    };
    if !path.exists() {
        return false;
    }
    std::process::Command::new("launchctl")
        .args(["list", AGENT_LABEL])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
fn autostart_installed() -> bool {
    false
}

/// Is a `--daemon` process alive?
///
/// Asked of the OS rather than of launchd, deliberately: `launchctl list` reports
/// the *job*, which stays listed through a crash loop and while throttled. What
/// the panel needs to say is whether anything is enforcing this second.
#[cfg(target_os = "macos")]
fn daemon_running() -> bool {
    std::process::Command::new("pgrep")
        .args(["-f", "nexus-local --daemon"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
fn daemon_running() -> bool {
    false
}

/// Escape text for an XML text node. An `.app` living under a path with an `&`
/// in it would otherwise produce a malformed plist that launchd rejects with a
/// singularly unhelpful error.
#[cfg(any(target_os = "macos", test))]
fn xml_escape(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Where the daemon's stdout/stderr go.
///
/// A headless process with nowhere to log is undiagnosable: launchd discards
/// both streams by default, so "the service is installed but nothing is
/// blocked" would leave literally no evidence anywhere on the machine. The
/// module's `eprintln!`s — skipped ticks, stale verdicts, refused hosts
/// writes — all land here.
#[cfg(any(target_os = "macos", test))]
fn log_path() -> String {
    dirs::home_dir()
        .map(|h| h.join("Library/Logs/nexus-local.log").display().to_string())
        .unwrap_or_else(|| "/tmp/nexus-local.log".to_string())
}

#[cfg(any(target_os = "macos", test))]
fn agent_plist(exe: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>{label}</string>
	<!-- `--daemon` is what makes this a background service rather than a second
	     copy of the GUI app: no window, no tray, no Dock icon, and it keeps
	     enforcing after the app is quit. See main.rs. -->
	<key>ProgramArguments</key>
	<array>
		<string>{exe}</string>
		<string>--daemon</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<!-- Relaunch if it crashes, but respect a clean quit from the tray menu.
	     `KeepAlive: true` would make the app impossible to stop. -->
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<!-- Don't hammer the machine if the binary is missing or crashes on boot. -->
	<key>ThrottleInterval</key>
	<integer>30</integer>
	<!-- launchd discards both streams by default, which would leave a silent
	     failure with no evidence anywhere. -->
	<key>StandardOutPath</key>
	<string>{log}</string>
	<key>StandardErrorPath</key>
	<string>{log}</string>
</dict>
</plist>
"#,
        label = AGENT_LABEL_FOR_PLIST,
        exe = xml_escape(exe),
        log = xml_escape(&log_path()),
    )
}

#[cfg(target_os = "macos")]
const AGENT_LABEL_FOR_PLIST: &str = AGENT_LABEL;
#[cfg(all(not(target_os = "macos"), test))]
const AGENT_LABEL_FOR_PLIST: &str = "com.bastianthomsen.nexuslocal";

#[cfg(target_os = "macos")]
fn install_autostart() -> Result<(), String> {
    let exe = exe_path()?;
    let path = agent_plist_path().ok_or("no home directory")?;
    let dir = path.parent().ok_or("no LaunchAgents directory")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    std::fs::write(&path, agent_plist(&exe))
        .map_err(|e| format!("cannot write {}: {e}", path.display()))?;

    let domain = gui_domain()?;
    // Bootstrapping an already-loaded label fails, and a stale definition would
    // otherwise survive an exe path change (dev build → installed .app). Boot it
    // out first and ignore the failure that means "it wasn't loaded".
    let _ = std::process::Command::new("launchctl")
        .args(["bootout", &format!("{domain}/{AGENT_LABEL}")])
        .output();

    let out = std::process::Command::new("launchctl")
        .args(["bootstrap", &domain, &path.display().to_string()])
        .output()
        .map_err(|e| format!("launchctl failed to launch: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "launchctl bootstrap failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

#[cfg(target_os = "macos")]
fn remove_autostart() -> Result<(), String> {
    let domain = gui_domain()?;
    // Unload before deleting: removing the plist alone leaves the job loaded
    // until the next logout, so the toggle would look off while still running.
    let _ = std::process::Command::new("launchctl")
        .args(["bootout", &format!("{domain}/{AGENT_LABEL}")])
        .output();
    if let Some(path) = agent_plist_path() {
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("cannot remove {}: {e}", path.display()))?;
        }
    }
    Ok(())
}

/// launchd's per-user GUI domain, e.g. `gui/501`. `libc` is only a dependency on
/// iOS here, so read the uid from `id -u` rather than pulling it in for desktop.
#[cfg(target_os = "macos")]
fn gui_domain() -> Result<String, String> {
    let out = std::process::Command::new("id")
        .arg("-u")
        .output()
        .map_err(|e| format!("cannot read uid: {e}"))?;
    let uid = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if uid.is_empty() {
        return Err("cannot read uid".to_string());
    }
    Ok(format!("gui/{uid}"))
}

#[cfg(not(target_os = "macos"))]
fn install_autostart() -> Result<(), String> {
    Err("launch at login is only implemented on macOS".to_string())
}

#[cfg(not(target_os = "macos"))]
fn remove_autostart() -> Result<(), String> {
    Err("launch at login is only implemented on macOS".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plist_escapes_paths_that_would_break_the_xml() {
        let p = agent_plist("/Users/x/Apps & Things/Nexus Local.app/Contents/MacOS/nexus-local");
        assert!(p.contains("Apps &amp; Things"), "unescaped ampersand: {p}");
        assert!(!p.contains("Apps & Things"));
    }

    #[test]
    fn the_agent_launches_the_daemon_not_a_second_gui_app() {
        // Without `--daemon` launchd would start a whole second desktop app:
        // another window, another Dock icon, and — because it would also spawn
        // a grid — a second writer racing the first for /etc/hosts.
        let p = agent_plist("/Applications/Nexus Local.app/Contents/MacOS/nexus-local");
        assert!(p.contains("<string>--daemon</string>"), "{p}");
    }

    #[test]
    fn plist_relaunches_on_crash_but_not_on_a_clean_quit() {
        let p = agent_plist("/tmp/nexus-local");
        // A bare `<key>KeepAlive</key><true/>` would make Quit useless: launchd
        // would restart the app the instant the tray menu stopped it.
        assert!(p.contains("<key>KeepAlive</key>"));
        assert!(p.contains("<key>SuccessfulExit</key>\n\t\t<false/>"), "{p}");
        assert!(p.contains("<key>RunAtLoad</key>\n\t<true/>"), "{p}");
    }

    #[test]
    fn plist_label_matches_the_path_it_is_written_to() {
        // `launchctl bootout gui/<uid>/<label>` has to name the same job the
        // plist declares, or disabling silently leaves it loaded.
        let p = agent_plist("/tmp/nexus-local");
        assert!(p.contains(&format!("<string>{AGENT_LABEL_FOR_PLIST}</string>")));
        #[cfg(target_os = "macos")]
        assert!(agent_plist_path_display().ends_with(&format!("{AGENT_LABEL_FOR_PLIST}.plist")));
    }
}
