//! The root enforcer: site blocking that needs a password once, not per change.
//!
//! # The hole it closes
//!
//! `/etc/hosts` is root's, so the daemon wrote it through `osascript … with
//! administrator privileges` — one dialog per *change* of verdict. That made
//! every re-lock optional. A meal unlock ends after 30 minutes, the verdict puts
//! the sites back, the dialog appears… and Cancel keeps them unblocked, with a
//! ten-minute backoff before the next dialog that can be cancelled the same way.
//! A blocker that asks permission to re-block is not a blocker.
//!
//! # What gets installed (one admin password)
//!
//! ```text
//! /Library/PrivilegedHelperTools/com.bastianthomsen.nexuslocal.hosts   copy of this binary
//! /Library/Application Support/NexusLocal/hosts-enforcer.json         url, anon key, user id
//! /Library/LaunchDaemons/com.bastianthomsen.nexuslocal.hosts.plist    runs it as root, every 30s
//! ```
//!
//! All three are root-owned (plus two small state files beside the config). Each run reads `blocking_state` and renders it into
//! `/etc/hosts` directly (`blocking::write_hosts_direct`) — the same verdict, the
//! same `render_hosts`, no dialog. The user daemon stops writing hosts while
//! this is installed and keeps quitting blocked apps, which never needed root.
//!
//! # Why a root process and not passwordless sudo
//!
//! `enforcement.rs` turned down passwordless sudo, rightly: it would hand *any*
//! process running as this user a root command. Nothing here is invokable by the
//! user. The only input is the server's verdict, and it can only ever produce
//! loopback entries for validated hostnames (`blocking::normalize_domain`).
//!
//! It is also deliberately not fed by a file the daemon writes. That would be
//! simpler on the root side, but a user-writable hand-off is an unblock that
//! needs no password — `echo > ~/.nexuslocal/…` — which is the same hole with a
//! different door.
//!
//! # Leaving is slow on purpose
//!
//! There is no Remove button. The app can only *request* removal, and the
//! enforcer uninstalls itself [`REMOVAL_DELAY_SECS`] after it first sees the
//! request — still blocking the whole time, and the request can be withdrawn.
//! An instant uninstall, even behind the admin password, is the same impulse
//! decision the enforcer exists to take off the table; a day later the impulse
//! has usually passed, and if it hasn't, the decision was a real one.
//!
//! The request lives in `/Users/Shared` because it has to be writable without
//! a password — it only starts a clock. The clock itself is root's: the
//! enforcer stamps when it *first saw* the request in a root-owned file, so no
//! edit to the request can backdate it. Withdrawing the request and asking again
//! restarts the full delay.
//!
//! What this cannot stop is an administrator in a terminal — `sudo launchctl
//! bootout system/com.bastianthomsen.nexuslocal.hosts` works, as it must on a
//! machine you own. The bar is "not one click", not "impossible".
//!
//! # Two things it cannot be made to do
//!
//! - **Block its own source.** The Supabase host is never written, whatever the
//!   verdict says: `blocking_state` is anon-writable, and blocking the API would
//!   freeze the enforcer on its last verdict with no way to receive a new one.
//! - **Unblock on doubt.** A failed read or a missing row leaves `/etc/hosts` as
//!   it is — the posture of the whole module. Only a present, authoritative row
//!   changes anything.
//!
//! # Version skew
//!
//! The helper is a *copy*, so updating the app does not update it. The config
//! records the version that installed it and the panel offers a reinstall when
//! they differ. The code it runs — fetch, validate, render — is the most stable
//! part of the module, so a stale helper keeps working; it is flagged, not fatal.

use serde::{Deserialize, Serialize};

pub const LABEL: &str = "com.bastianthomsen.nexuslocal.hosts";
const PLIST_PATH: &str = "/Library/LaunchDaemons/com.bastianthomsen.nexuslocal.hosts.plist";
const HELPER_PATH: &str = "/Library/PrivilegedHelperTools/com.bastianthomsen.nexuslocal.hosts";
const SUPPORT_DIR: &str = "/Library/Application Support/NexusLocal";
const CONFIG_PATH: &str = "/Library/Application Support/NexusLocal/hosts-enforcer.json";
/// Written by every run, readable by the user: the panel's only honest answer to
/// "is it actually running", since `launchctl` will not describe a system job
/// to a non-root caller.
const STAMP_PATH: &str = "/Library/Application Support/NexusLocal/hosts-enforcer.last";
const LOG_PATH: &str = "/Library/Logs/nexus-local-hosts.log";
/// The app's removal request. Writable without a password — it only starts a
/// clock — hence `/Users/Shared`, which a root process can find without
/// knowing whose home directory to look in.
const REQUEST_DIR: &str = "/Users/Shared/NexusLocal";
const REQUEST_PATH: &str = "/Users/Shared/NexusLocal/hosts-enforcer-removal-request";
/// When root first saw the request. Root-owned, so it cannot be backdated.
const REMOVAL_STATE_PATH: &str = "/Library/Application Support/NexusLocal/hosts-enforcer.removal";
/// How long a removal request waits before the enforcer uninstalls itself.
pub const REMOVAL_DELAY_SECS: i64 = 24 * 60 * 60;

/// The root helper's own revision — **bump only when code the root process
/// runs changes** (`run`, removal handling, `blocking::write_hosts_direct` and
/// what it calls). Comparing against the app version instead flagged the helper
/// as outdated on every app release, asking for an admin password to reinstall
/// identical code; a warning that is usually wrong trains you to ignore it.
const HELPER_REVISION: &str = "0.35.1";
const INTERVAL_SECS: u32 = 30;
/// A run older than this means launchd is not running the job.
const STALE_AFTER_SECS: i64 = 3 * INTERVAL_SECS as i64;

/// What the root process needs and nothing else. 0644: the anon key is the one
/// already committed to this public repo and shipped in the IPA.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct EnforcerConfig {
    supabase_url: String,
    supabase_key: String,
    user_id: String,
    /// The app version that installed the helper copy.
    version: String,
}

/// One run's result, written to [`STAMP_PATH`].
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Stamp {
    at: String,
    ok: bool,
    outcome: String,
}

/// Installed means the plist exists. Whether it is *running* is the stamp's job.
#[cfg(target_os = "macos")]
pub fn installed() -> bool {
    std::path::Path::new(PLIST_PATH).exists()
}

// ── the root side ────────────────────────────────────────────────────────────

/// One enforcement pass, as root, launched by launchd every 30s. Returns the
/// process exit code.
#[cfg(target_os = "macos")]
pub fn run(config_path: &str) -> i32 {
    let config: EnforcerConfig = match std::fs::read_to_string(config_path)
        .map_err(|e| e.to_string())
        .and_then(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string()))
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[hosts-enforcer] cannot read {config_path}: {e}");
            return 1;
        }
    };

    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[hosts-enforcer] cannot start a runtime: {e}");
            return 1;
        }
    };
    let supabase = crate::grid::supabase::Supabase::new(
        config.supabase_url.clone(),
        config.supabase_key.clone(),
    );
    let verdict = runtime.block_on(crate::modules::blocking::fetch_domains(&supabase, &config.user_id));

    let (ok, outcome) = match verdict {
        Ok(Some(domains)) => {
            let domains = without_host(domains, &api_host(&config.supabase_url));
            let n = domains.len();
            match crate::modules::blocking::write_hosts_direct(&domains) {
                Ok(true) => (true, format!("applied — {n} domain(s) blocked")),
                Ok(false) => (true, format!("unchanged — {n} domain(s) blocked")),
                Err(e) => (false, format!("write failed: {e}")),
            }
        }
        // Not an unblock: no verdict is "unknown", and unknown keeps the last state.
        Ok(None) => (false, "no blocking_state row — /etc/hosts left as it is".to_string()),
        Err(e) => (false, format!("verdict read failed ({e}) — /etc/hosts left as it is")),
    };

    // Log transitions, not runs: every 30s would bury the log (a night offline
    // is ~1,000 identical lines), while logging only writes would never record
    // the read failures that are the thing to diagnose.
    let previous: Option<Stamp> = std::fs::read_to_string(STAMP_PATH)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok());
    if previous.map(|p| p.outcome) != Some(outcome.clone()) || outcome.starts_with("applied") {
        eprintln!("[hosts-enforcer] {} {outcome}", chrono::Utc::now().to_rfc3339());
    }

    let stamp = Stamp { at: chrono::Utc::now().to_rfc3339(), ok, outcome };
    if let Ok(json) = serde_json::to_string(&stamp) {
        let _ = std::fs::write(STAMP_PATH, json);
    }

    // After the pass, never instead of it: a pending removal keeps blocking
    // until the moment it takes effect.
    handle_removal(chrono::Utc::now());
    0
}

/// Root's record of a removal request.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct RemovalState {
    seen_at: String,
}

/// What a run does about removal, given whether a request exists and when root
/// first saw it. Pure, so the timing rules are tested rather than trusted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Removal {
    /// No request, nothing recorded.
    Idle,
    /// The request was withdrawn: forget it, so asking again restarts the delay.
    Cancelled,
    /// First sighting: start the clock now.
    Started,
    /// Counting down to this instant.
    Waiting(chrono::DateTime<chrono::Utc>),
    /// The delay has elapsed.
    Due,
}

fn removal_step(
    requested: bool,
    seen_at: Option<chrono::DateTime<chrono::Utc>>,
    now: chrono::DateTime<chrono::Utc>,
) -> Removal {
    let delay = chrono::Duration::seconds(REMOVAL_DELAY_SECS);
    match (requested, seen_at) {
        (false, None) => Removal::Idle,
        (false, Some(_)) => Removal::Cancelled,
        (true, None) => Removal::Started,
        (true, Some(seen)) if now - seen >= delay => Removal::Due,
        (true, Some(seen)) => Removal::Waiting(seen + delay),
    }
}

/// An unreadable state file counts as never seen — which restarts the clock.
/// Every failure here must lengthen the wait, never shorten it.
fn read_seen_at() -> Option<chrono::DateTime<chrono::Utc>> {
    let raw = std::fs::read_to_string(REMOVAL_STATE_PATH).ok()?;
    let state: RemovalState = serde_json::from_str(&raw).ok()?;
    chrono::DateTime::parse_from_rfc3339(&state.seen_at)
        .ok()
        .map(|d| d.with_timezone(&chrono::Utc))
}

#[cfg(target_os = "macos")]
fn handle_removal(now: chrono::DateTime<chrono::Utc>) {
    let requested = std::path::Path::new(REQUEST_PATH).exists();
    match removal_step(requested, read_seen_at(), now) {
        Removal::Idle | Removal::Waiting(_) => {}
        Removal::Cancelled => {
            let _ = std::fs::remove_file(REMOVAL_STATE_PATH);
            eprintln!("[hosts-enforcer] {} removal request withdrawn", now.to_rfc3339());
        }
        Removal::Started => {
            let state = RemovalState { seen_at: now.to_rfc3339() };
            if let Ok(json) = serde_json::to_string(&state) {
                let _ = std::fs::write(REMOVAL_STATE_PATH, json);
            }
            let due = now + chrono::Duration::seconds(REMOVAL_DELAY_SECS);
            eprintln!(
                "[hosts-enforcer] {} removal requested — takes effect at {}",
                now.to_rfc3339(),
                due.to_rfc3339()
            );
        }
        Removal::Due => {
            eprintln!("[hosts-enforcer] {} removal delay elapsed — uninstalling", now.to_rfc3339());
            self_uninstall();
        }
    }
}

/// Delete everything, then unload — which ends this process, so it goes last.
/// `/etc/hosts` is left as it is: the user daemon takes the job back, with its
/// dialogs, and leaving must not double as an unblock.
#[cfg(target_os = "macos")]
fn self_uninstall() {
    for path in [REQUEST_PATH, REMOVAL_STATE_PATH, STAMP_PATH, CONFIG_PATH, PLIST_PATH, HELPER_PATH] {
        let _ = std::fs::remove_file(path);
    }
    let _ = std::process::Command::new("launchctl")
        .args(["bootout", &format!("system/{LABEL}")])
        .status();
}

/// The host part of the Supabase URL, lower-cased.
fn api_host(url: &str) -> String {
    let rest = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
    rest.split(['/', ':', '?', '#']).next().unwrap_or("").to_ascii_lowercase()
}

/// The verdict minus the enforcer's own API host — see the module docs.
fn without_host(domains: Vec<String>, host: &str) -> Vec<String> {
    domains
        .into_iter()
        .filter(|d| {
            let d = d.trim().trim_end_matches('.').to_ascii_lowercase();
            d != host && d.strip_prefix("www.") != Some(host)
        })
        .collect()
}

// ── the user side: status, install, request removal ──────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct HostsEnforcerStatus {
    pub supported: bool,
    pub installed: bool,
    /// A run landed within the last [`STALE_AFTER_SECS`].
    pub running: bool,
    pub installed_version: Option<String>,
    pub app_version: String,
    pub outdated: bool,
    pub last_run_at: Option<String>,
    pub last_ok: Option<bool>,
    pub last_outcome: Option<String>,
    /// The app has asked for removal.
    pub removal_requested: bool,
    /// When the enforcer will remove itself — set once root has seen the
    /// request (within one run of it being made).
    pub removal_due_at: Option<String>,
    pub removal_delay_secs: i64,
}

#[tauri::command]
pub fn tt_hosts_enforcer_status() -> HostsEnforcerStatus {
    let app_version = env!("CARGO_PKG_VERSION").to_string();
    #[cfg(target_os = "macos")]
    {
        let config: Option<EnforcerConfig> = std::fs::read_to_string(CONFIG_PATH)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok());
        let stamp: Option<Stamp> = std::fs::read_to_string(STAMP_PATH)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok());
        let installed = installed();
        let running = installed
            && stamp
                .as_ref()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s.at).ok())
                .map(|at| (chrono::Utc::now() - at.with_timezone(&chrono::Utc)).num_seconds())
                .is_some_and(|age| age <= STALE_AFTER_SECS);
        let installed_version = config.map(|c| c.version);
        HostsEnforcerStatus {
            supported: true,
            installed,
            running,
            outdated: installed && installed_version.as_deref() != Some(HELPER_REVISION),
            installed_version,
            app_version,
            last_run_at: stamp.as_ref().map(|s| s.at.clone()),
            last_ok: stamp.as_ref().map(|s| s.ok),
            last_outcome: stamp.map(|s| s.outcome),
            removal_requested: std::path::Path::new(REQUEST_PATH).exists(),
            removal_due_at: read_seen_at()
                .map(|seen| (seen + chrono::Duration::seconds(REMOVAL_DELAY_SECS)).to_rfc3339()),
            removal_delay_secs: REMOVAL_DELAY_SECS,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        HostsEnforcerStatus {
            supported: false,
            installed: false,
            running: false,
            installed_version: None,
            app_version,
            outdated: false,
            last_run_at: None,
            last_ok: None,
            last_outcome: None,
            removal_requested: false,
            removal_due_at: None,
            removal_delay_secs: REMOVAL_DELAY_SECS,
        }
    }
}

/// Install (or reinstall over) the root enforcer. One admin password.
///
/// Async so the admin dialog doesn't block the thread Tauri dispatches
/// synchronous commands on.
#[tauri::command]
pub async fn tt_hosts_enforcer_install() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let app = crate::config::AppConfig::load();
        if app.supabase.url.is_empty() || app.supabase.key.is_empty() {
            return Err("Supabase is not configured in ~/.nexuslocalrc".to_string());
        }
        let exe = std::env::current_exe().map_err(|e| format!("cannot resolve own path: {e}"))?;
        let config = EnforcerConfig {
            supabase_url: app.supabase.url,
            supabase_key: app.supabase.key,
            user_id: app.user_id,
            version: HELPER_REVISION.to_string(),
        };
        let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
        let script = install_script(&exe.display().to_string(), &json, &daemon_plist());
        tokio::task::spawn_blocking(move || run_as_admin(&script))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("the root enforcer is macOS-only".to_string())
    }
}

/// Ask the enforcer to remove itself [`REMOVAL_DELAY_SECS`] from now. No
/// password: this only starts a clock, and the clock is root's.
#[tauri::command]
pub fn tt_hosts_enforcer_request_removal() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if !installed() {
            return Err("the root enforcer is not installed".to_string());
        }
        std::fs::create_dir_all(REQUEST_DIR)
            .map_err(|e| format!("cannot create {REQUEST_DIR}: {e}"))?;
        std::fs::write(REQUEST_PATH, chrono::Utc::now().to_rfc3339())
            .map_err(|e| format!("cannot write the removal request: {e}"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("the root enforcer is macOS-only".to_string())
    }
}

/// Withdraw a removal request. Asking again later restarts the full delay.
#[tauri::command]
pub fn tt_hosts_enforcer_cancel_removal() -> Result<(), String> {
    match std::fs::remove_file(REQUEST_PATH) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("cannot withdraw the removal request: {e}")),
    }
}

/// POSIX single-quote a string for `/bin/sh`.
fn sh_quote(raw: &str) -> String {
    format!("'{}'", raw.replace('\'', r"'\''"))
}

/// The install, as one `&&` chain: if any step fails nothing later runs, and in
/// particular launchd is never pointed at a half-written plist.
fn install_script(exe: &str, config_json: &str, plist: &str) -> String {
    let helper_dir = std::path::Path::new(HELPER_PATH)
        .parent()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    [
        format!(
            "install -d -m 755 -o root -g wheel {} {}",
            sh_quote(&helper_dir),
            sh_quote(SUPPORT_DIR)
        ),
        // `install` copies into a fresh inode, so a helper that is mid-run keeps
        // its old pages rather than being killed for a codesigning mismatch.
        format!(
            "install -m 755 -o root -g wheel {} {}",
            sh_quote(exe),
            sh_quote(HELPER_PATH)
        ),
        format!("printf '%s' {} > {}", sh_quote(config_json), sh_quote(CONFIG_PATH)),
        format!("chown root:wheel {} && chmod 644 {}", sh_quote(CONFIG_PATH), sh_quote(CONFIG_PATH)),
        format!("printf '%s' {} > {}", sh_quote(plist), sh_quote(PLIST_PATH)),
        format!("chown root:wheel {} && chmod 644 {}", sh_quote(PLIST_PATH), sh_quote(PLIST_PATH)),
        // A reinstall must replace the loaded definition, and bootout of a job
        // that isn't loaded fails — which is fine.
        format!("(launchctl bootout system/{LABEL} 2>/dev/null || true)"),
        format!("launchctl bootstrap system {}", sh_quote(PLIST_PATH)),
    ]
    .join(" && ")
}

#[cfg(target_os = "macos")]
fn run_as_admin(command: &str) -> Result<(), String> {
    let literal = command.replace('\\', "\\\\").replace('"', "\\\"");
    let out = std::process::Command::new("osascript")
        .args(["-e", &format!("do shell script \"{literal}\" with administrator privileges")])
        .output()
        .map_err(|e| format!("osascript failed to launch: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// No `UserName`, so launchd runs it as root. `StartInterval` rather than a
/// long-lived loop: a pass is a few hundred ms, and a process that exits between
/// passes cannot leak, wedge, or drift.
fn daemon_plist() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>{LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>{HELPER_PATH}</string>
		<string>--hosts-enforcer</string>
		<string>{CONFIG_PATH}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StartInterval</key>
	<integer>{INTERVAL_SECS}</integer>
	<key>ProcessType</key>
	<string>Background</string>
	<key>StandardOutPath</key>
	<string>{LOG_PATH}</string>
	<key>StandardErrorPath</key>
	<string>{LOG_PATH}</string>
</dict>
</plist>
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_api_host_is_never_blocked() {
        let host = api_host("https://efxmzsdisaymtpebaxlp.supabase.co/");
        assert_eq!(host, "efxmzsdisaymtpebaxlp.supabase.co");
        let kept = without_host(
            vec![
                "youtube.com".into(),
                "EFXMZSDISAYMTPEBAXLP.supabase.co".into(),
                "www.efxmzsdisaymtpebaxlp.supabase.co".into(),
                "supabase.co".into(),
            ],
            &host,
        );
        // The parent domain doesn't cover the API host in /etc/hosts (exact
        // match only), so it is left to the verdict.
        assert_eq!(kept, vec!["youtube.com".to_string(), "supabase.co".to_string()]);
    }

    #[test]
    fn api_host_survives_ports_and_paths() {
        assert_eq!(api_host("http://localhost:54321/rest/v1"), "localhost");
        assert_eq!(api_host("efx.supabase.co"), "efx.supabase.co");
    }

    #[test]
    fn the_daemon_runs_as_root_every_interval() {
        let p = daemon_plist();
        assert!(!p.contains("UserName"), "a UserName would drop root: {p}");
        assert!(p.contains("<string>--hosts-enforcer</string>"));
        assert!(p.contains(&format!("<integer>{INTERVAL_SECS}</integer>")));
        assert!(p.contains(&format!("<string>{HELPER_PATH}</string>")));
    }

    #[test]
    fn shell_quoting_survives_quotes_and_spaces() {
        assert_eq!(sh_quote("a b"), "'a b'");
        assert_eq!(sh_quote("it's"), r"'it'\''s'");
    }

    #[test]
    fn install_copies_the_binary_and_quotes_every_path() {
        let s = install_script("/Applications/Nexus Local.app/Contents/MacOS/nexus-local", "{}", "<plist/>");
        assert!(s.contains("'/Applications/Nexus Local.app/Contents/MacOS/nexus-local'"), "{s}");
        assert!(s.contains("'/Library/Application Support/NexusLocal'"), "{s}");
        // Bootstrap is the last step, so a failed write never loads a plist.
        assert!(s.ends_with(&format!("launchctl bootstrap system '{PLIST_PATH}'")), "{s}");
        assert!(!s.contains(" ; "), "steps must be &&-chained: {s}");
    }

    fn at(s: &str) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&chrono::Utc)
    }

    #[test]
    fn no_request_means_nothing_happens() {
        assert_eq!(removal_step(false, None, at("2026-11-02T12:00:00Z")), Removal::Idle);
    }

    #[test]
    fn a_request_starts_the_clock_rather_than_removing() {
        assert_eq!(removal_step(true, None, at("2026-11-02T12:00:00Z")), Removal::Started);
    }

    #[test]
    fn a_seen_request_waits_out_the_whole_delay() {
        let seen = at("2026-11-02T12:00:00Z");
        let almost = seen + chrono::Duration::seconds(REMOVAL_DELAY_SECS - 1);
        assert_eq!(
            removal_step(true, Some(seen), almost),
            Removal::Waiting(seen + chrono::Duration::seconds(REMOVAL_DELAY_SECS))
        );
        let due = seen + chrono::Duration::seconds(REMOVAL_DELAY_SECS);
        assert_eq!(removal_step(true, Some(seen), due), Removal::Due);
    }

    /// Withdrawing must forget the clock, or ask-cancel-ask-again would remove
    /// instantly on the strength of the first request.
    #[test]
    fn a_withdrawn_request_is_forgotten() {
        let seen = at("2026-11-01T12:00:00Z");
        assert_eq!(removal_step(false, Some(seen), at("2026-11-02T13:00:00Z")), Removal::Cancelled);
    }

    #[test]
    fn the_delay_is_a_day_not_a_click() {
        const { assert!(REMOVAL_DELAY_SECS >= 24 * 60 * 60) };
    }

    #[test]
    fn the_request_is_not_where_root_keeps_its_clock() {
        // The request is user-writable; the clock must not be, or backdating
        // it would be an instant uninstall.
        assert!(REQUEST_PATH.starts_with("/Users/Shared/"));
        assert!(REMOVAL_STATE_PATH.starts_with(SUPPORT_DIR));
    }

    #[test]
    fn config_round_trips() {
        let c = EnforcerConfig {
            supabase_url: "https://x.supabase.co".into(),
            supabase_key: "k".into(),
            user_id: "default".into(),
            version: "0.34.0".into(),
        };
        let back: EnforcerConfig = serde_json::from_str(&serde_json::to_string(&c).unwrap()).unwrap();
        assert_eq!(back, c);
    }
}
