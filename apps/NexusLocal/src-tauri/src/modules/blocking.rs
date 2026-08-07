//! Blocking module — Mac enforcement of the server's blocking verdict.
//!
//! # Where the thinking happens
//!
//! Nowhere in here. The `focus-evaluate` edge function runs on pg_cron and
//! collapses `focus_blocks`, `unlock_rules`, `blocked_sites`, `blocked_apps` and
//! today's `time_entries` into a single materialized row:
//!
//! ```text
//! blocking_state(user_id, effective_domains, effective_processes,
//!                reasons, today_minutes, computed_at)
//! ```
//!
//! This module reads that row and acts: domains go into `/etc/hosts`, processes
//! get quit-then-killed. It does **not** re-derive policy — `focus_only` modes
//! and reward unlocks are already resolved server-side. If the Mac computed its
//! own view while the iPhone's content blocker read the server's, the two would
//! drift apart, which is exactly what the materialized row exists to prevent.
//!
//! # Failure posture
//!
//! If the read fails or the row is missing, the current enforcement is left
//! **untouched** — we never apply an empty set on a transient error, because an
//! empty `effective_domains` from a dropped connection is indistinguishable from
//! "nothing is blocked" and would silently switch blocking off. A row that does
//! exist with empty arrays *is* authoritative, and does clear the hosts block.
//!
//! A stale `computed_at` (evaluator stopped running) likewise never clears
//! anything: we keep enforcing the last known verdict and surface the age in the
//! `status` action.
//!
//! Autonomous enforcement (the tick) is gated behind `blocking_enabled` in the
//! node config, off by default, because writing `/etc/hosts` requires an admin
//! prompt. Explicit `apply`/`clear` commands work regardless (user-initiated).
//!
//! The gate is an [`AtomicBool`] shared with the `enforcement` commands rather
//! than a value baked in at construction, so the toggle takes effect on the next
//! tick instead of at the next launch. The tick loop therefore always runs and
//! checks the flag first — the loop itself costs nothing when off (the early
//! return precedes every network call and every filesystem read).

use crate::grid::{ModuleContext, ModuleManifest, NexusModule};
use crate::timetracker::T_BLOCKING_STATE;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

const MARKER_BEGIN: &str = "# BEGIN NexusLocal-Block";
const MARKER_END: &str = "# END NexusLocal-Block";

/// How old `computed_at` may get before the verdict is reported as stale. The
/// evaluator runs every 5 minutes, so half an hour of silence means it stopped.
const STALE_AFTER_SECS: i64 = 30 * 60;

pub struct BlockingModule {
    /// Whether the tick autonomously enforces the server's verdict. Shared with
    /// the `enforcement` Tauri commands, which flip it at runtime.
    enabled: Arc<AtomicBool>,
}

impl BlockingModule {
    pub fn new(enabled: Arc<AtomicBool>) -> Self {
        Self { enabled }
    }

    fn is_enforcing(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }
}

#[async_trait]
impl NexusModule for BlockingModule {
    fn manifest(&self) -> ModuleManifest {
        ModuleManifest {
            id: "blocking".to_string(),
            name: "TimeTracker · Site & App Blocking".to_string(),
            version: "0.2.0".to_string(),
            actions: vec!["status".to_string(), "apply".to_string(), "clear".to_string()],
            // Re-enforce every 30s so a schedule window opening (or a reward
            // unlocking) takes effect without a manual command.
            //
            // Always `Some`, even when enforcement is currently off: the runtime
            // reads this once at startup to decide whether to spawn a loop at
            // all, so returning `None` here would mean the toggle could never
            // start enforcing without a restart. `tick` re-checks the flag.
            tick_interval_secs: Some(30),
        }
    }

    async fn tick(&self, ctx: &ModuleContext) -> Result<(), String> {
        if !self.is_enforcing() {
            return Ok(());
        }

        // Read failure or a missing row → skip the tick entirely. Never apply an
        // empty set we are not sure about.
        let verdict = match fetch_verdict(ctx).await {
            Ok(Some(v)) => v,
            Ok(None) => {
                eprintln!(
                    "[blocking] no blocking_state row for user '{}' — leaving current enforcement in place",
                    ctx.user_id
                );
                return Ok(());
            }
            Err(e) => {
                eprintln!(
                    "[blocking] blocking_state read failed: {e} — leaving current enforcement in place"
                );
                return Ok(());
            }
        };

        if verdict.is_stale(Utc::now()) {
            eprintln!(
                "[blocking] blocking_state is stale (computed_at={:?}) — enforcing last known verdict",
                verdict.computed_at
            );
        }

        enforce(verdict, true).await.map(|_| ())
    }

    async fn handle(
        &self,
        action: &str,
        _payload: &Value,
        ctx: &ModuleContext,
    ) -> Result<Value, String> {
        match action {
            "status" => {
                let now = Utc::now();
                let mut out = json!({ "enforcing": self.is_enforcing() });
                let obj = out.as_object_mut().expect("status is an object");

                match fetch_verdict(ctx).await {
                    Ok(Some(v)) => {
                        obj.insert("state".into(), json!("ok"));
                        obj.insert("domains".into(), json!(v.domains.len()));
                        obj.insert("processes".into(), json!(v.processes.len()));
                        obj.insert("computed_at".into(), json!(v.computed_at));
                        obj.insert("age_seconds".into(), json!(v.age_secs(now)));
                        obj.insert("stale".into(), json!(v.is_stale(now)));
                        // Straight from the evaluator, for the UI to explain a
                        // verdict (and to show progress toward reward unlocks).
                        obj.insert("today_minutes".into(), json!(v.today_minutes));
                        obj.insert("reasons".into(), v.reasons.clone());
                    }
                    Ok(None) => {
                        obj.insert("state".into(), json!("missing"));
                        obj.insert("stale".into(), json!(true));
                    }
                    Err(e) => {
                        obj.insert("state".into(), json!("error"));
                        obj.insert("error".into(), json!(e));
                        obj.insert("stale".into(), json!(true));
                    }
                }

                // What is actually on this machine right now, independent of the
                // verdict — reading /etc/hosts mutates nothing.
                match tokio::task::spawn_blocking(current_blocked)
                    .await
                    .map_err(|e| e.to_string())?
                {
                    Ok(hosts) => {
                        obj.insert("hosts_count".into(), json!(hosts.len()));
                        obj.insert("hosts_blocked".into(), json!(hosts));
                    }
                    Err(e) => {
                        obj.insert("hosts_error".into(), json!(e));
                    }
                }

                Ok(out)
            }
            "apply" => enforce_now(ctx).await,
            "clear" => {
                tokio::task::spawn_blocking(clear)
                    .await
                    .map_err(|e| e.to_string())??;
                Ok(json!({ "cleared": true }))
            }
            other => Err(format!("unsupported blocking action: {other}")),
        }
    }
}

/// Fetch the current verdict and apply it to this machine, right now.
///
/// The explicit, user-initiated path — behind the queued `apply` command *and*
/// the `tt_enforcement_apply_now` Tauri command, so switching enforcement on in
/// the UI takes effect immediately instead of at the next 30s tick.
///
/// Unlike the tick, this surfaces failures instead of silently leaving things
/// alone: someone is watching a button, and "nothing happened" is a worse answer
/// than "no verdict has been computed yet".
pub async fn enforce_now(ctx: &ModuleContext) -> Result<Value, String> {
    let verdict = fetch_verdict(ctx)
        .await?
        .ok_or_else(|| format!("no blocking_state row for user '{}'", ctx.user_id))?;
    let stale = verdict.is_stale(Utc::now());
    let domains = verdict.domains.len();
    let processes = verdict.processes.len();
    let kills_started = enforce(verdict, false).await?;
    Ok(json!({
        "domains": domains,
        "processes": processes,
        // Processes found running and sent a quit — the force-kill lands 2s
        // later on its own thread, so this is a count of kills started, not of
        // confirmed exits.
        "kills_started": kills_started,
        "stale": stale,
    }))
}

// ── the server's verdict ────────────────────────────────────────────────────

/// One `blocking_state` row: what this machine must enforce, and when the
/// evaluator last said so.
///
/// Mirrors what `supabase/functions/focus-evaluate/index.ts` actually writes —
/// `effective_domains`, `effective_processes`, `reasons`, `today_minutes`,
/// `computed_at`. Only the first two drive behaviour here; `reasons` and
/// `today_minutes` are carried so `status` can explain a verdict without a
/// second round-trip. `reasons` is a flat map of domain/process → explanation
/// and is deliberately never branched on.
// No `Eq`: `serde_json::Value` is only `PartialEq` (floats).
#[derive(Debug, Clone, Default, PartialEq)]
struct Verdict {
    domains: Vec<String>,
    processes: Vec<String>,
    computed_at: Option<String>,
    today_minutes: Option<i64>,
    reasons: Value,
}

impl Verdict {
    /// Seconds since the evaluator computed this row. `None` if `computed_at` is
    /// absent or unparseable.
    fn age_secs(&self, now: DateTime<Utc>) -> Option<i64> {
        let ts = self.computed_at.as_deref()?;
        let parsed = DateTime::parse_from_rfc3339(ts).ok()?;
        Some((now - parsed.with_timezone(&Utc)).num_seconds())
    }

    /// A verdict we cannot date is treated as stale — but staleness only changes
    /// what `status` reports, never what gets enforced.
    fn is_stale(&self, now: DateTime<Utc>) -> bool {
        self.age_secs(now).map(|a| a > STALE_AFTER_SECS).unwrap_or(true)
    }
}

/// Read this user's materialized verdict. `Ok(None)` means the row does not
/// exist — which is *not* the same as a row whose arrays are empty.
async fn fetch_verdict(ctx: &ModuleContext) -> Result<Option<Verdict>, String> {
    let user = format!("eq.{}", ctx.user_id);
    let rows = ctx
        .supabase
        .select(
            T_BLOCKING_STATE,
            // `select=*` on purpose: the edge function owns this table's shape,
            // and an explicit column list would 400 the moment it gains one.
            &[("select", "*"), ("user_id", user.as_str()), ("limit", "1")],
        )
        .await?;
    Ok(parse_verdict(&rows))
}

/// Parse a PostgREST response into a verdict.
///
/// Returns `None` only when there is no row. A present row with `[]` (or `null`)
/// arrays is the server authoritatively saying "nothing is blocked" and must be
/// honoured, otherwise blocking could never be switched off.
fn parse_verdict(rows: &Value) -> Option<Verdict> {
    let row = rows.as_array()?.first()?;
    Some(Verdict {
        domains: string_list(row.get("effective_domains")),
        processes: string_list(row.get("effective_processes")),
        computed_at: row
            .get("computed_at")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        today_minutes: row.get("today_minutes").and_then(|v| v.as_i64()),
        reasons: row.get("reasons").cloned().unwrap_or(Value::Null),
    })
}

/// Normalise a jsonb string array: trimmed, de-blanked, deduplicated and
/// **sorted**. The sort is load-bearing — jsonb array order is not guaranteed
/// stable between evaluator runs, and an order flip would render a different
/// hosts file and fire an admin password dialog on every tick.
fn string_list(value: Option<&Value>) -> Vec<String> {
    let Some(arr) = value.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut out: Vec<String> = arr
        .iter()
        .filter_map(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Apply a verdict to this machine. Returns how many running processes were
/// sent a quit (the force-kill follows on a detached thread).
///
/// Processes go first, deliberately: the hosts write can stall on — or fail at —
/// the admin password dialog (a cancelled dialog makes `osascript` exit
/// nonzero), and app blocking must not be hostage to that. The hosts error is
/// still returned so the caller logs it. Same ordering as TimeTracker's tick.
///
/// `honor_backoff` distinguishes the autonomous tick (true) from a user pressing
/// a button (false) — see [`apply`]. Note process killing is never backed off:
/// it needs no privileges and no dialog, so a refused hosts write must not also
/// stop blocked apps from being quit.
async fn enforce(verdict: Verdict, honor_backoff: bool) -> Result<usize, String> {
    let processes = verdict.processes;
    let killed = tokio::task::spawn_blocking(move || enforce_processes(&processes))
        .await
        .map_err(|e| e.to_string())?;

    let domains = verdict.domains;
    tokio::task::spawn_blocking(move || apply(&domains, honor_backoff))
        .await
        .map_err(|e| e.to_string())??;

    Ok(killed)
}

// ── process killing (macOS) ─────────────────────────────────────────────────

/// Quit every listed process that is currently running. Each kill runs on its
/// own thread — the graceful-quit step sleeps 2s and the tick loop must not
/// stall behind it.
///
/// No policy is applied here: `effective_processes` has already had `focus_only`
/// modes and unlock rules resolved server-side.
#[cfg(target_os = "macos")]
fn enforce_processes(processes: &[String]) -> usize {
    let mut killed = 0;
    for name in processes {
        let name = name.trim();
        if name.is_empty() || !is_running(name) {
            continue;
        }
        killed += 1;
        let owned = name.to_string();
        std::thread::spawn(move || kill_app(&owned));
    }
    killed
}

#[cfg(not(target_os = "macos"))]
fn enforce_processes(_processes: &[String]) -> usize {
    0
}

/// True if a process with exactly this name is running.
#[cfg(target_os = "macos")]
fn is_running(process_name: &str) -> bool {
    std::process::Command::new("pgrep")
        .args(["-x", process_name])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Ask the app to quit (so it can save state), give it 2s, then force it.
#[cfg(target_os = "macos")]
fn kill_app(process_name: &str) {
    let _ = std::process::Command::new("osascript")
        .args([
            "-e",
            &format!(
                "tell application \"{}\" to quit",
                applescript_literal(process_name)
            ),
        ])
        .output();
    std::thread::sleep(std::time::Duration::from_secs(2));
    let _ = std::process::Command::new("pkill")
        .args(["-x", process_name])
        .output();
}

// ── hosts-file plumbing (macOS) ─────────────────────────────────────────────

/// Serialises hosts writes so a queued `apply` command racing a tick can never
/// put two admin password dialogs on screen at once.
#[cfg(target_os = "macos")]
fn hosts_write_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

/// How long the tick waits before re-prompting after a failed privileged write.
///
/// Cancelling the admin dialog makes `osascript` exit nonzero. Without a backoff
/// the 30s tick simply tries again — so one cancelled dialog becomes a dialog
/// every thirty seconds, forever, and the only way out is switching enforcement
/// off entirely. Ten minutes is long enough to be ignorable and short enough
/// that a schedule window opening still gets enforced the same hour.
#[cfg(target_os = "macos")]
const HOSTS_RETRY_BACKOFF_SECS: u64 = 10 * 60;

/// When the tick may next attempt a privileged write. `None` = no backoff.
#[cfg(target_os = "macos")]
fn hosts_backoff() -> &'static std::sync::Mutex<Option<std::time::Instant>> {
    static UNTIL: std::sync::OnceLock<std::sync::Mutex<Option<std::time::Instant>>> =
        std::sync::OnceLock::new();
    UNTIL.get_or_init(|| std::sync::Mutex::new(None))
}

#[cfg(target_os = "macos")]
fn backoff_active() -> bool {
    hosts_backoff()
        .lock()
        .map(|g| g.map(|until| std::time::Instant::now() < until).unwrap_or(false))
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn set_backoff(active: bool) {
    if let Ok(mut g) = hosts_backoff().lock() {
        *g = active.then(|| {
            std::time::Instant::now() + std::time::Duration::from_secs(HOSTS_RETRY_BACKOFF_SECS)
        });
    }
}

/// Both address families, deliberately.
///
/// An IPv4-only entry does **not** block on a dual-stack machine: `/etc/hosts`
/// overrides the A lookup, the AAAA lookup still goes to real DNS, and Chrome's
/// Happy Eyeballs prefers the IPv6 answer — so it connects straight past the
/// block. This is invisible to `ping youtube.com`, which reports 127.0.0.1
/// because it asked for IPv4. `dscacheutil -q host -a name <domain>` shows both
/// answers and is the diagnostic to reach for.
///
/// Safari happened to honour the IPv4 entry, which is exactly what made this
/// look like "blocking works" for weeks. TimeTracker's blocker has the same bug.
#[cfg(any(target_os = "macos", test))]
const BLOCK_ADDRS: [&str; 2] = ["127.0.0.1", "::1"];

#[cfg(any(target_os = "macos", test))]
fn build_block(domains: &[String]) -> String {
    if domains.is_empty() {
        return String::new();
    }
    let mut lines = vec![MARKER_BEGIN.to_owned()];
    for domain in domains {
        let domain = domain.trim();
        if domain.is_empty() {
            continue;
        }
        for addr in BLOCK_ADDRS {
            lines.push(format!("{addr} {domain}"));
        }
        if !domain.starts_with("www.") {
            for addr in BLOCK_ADDRS {
                lines.push(format!("{addr} www.{domain}"));
            }
        }
    }
    lines.push(MARKER_END.to_owned());
    lines.join("\n")
}

/// The full hosts file this verdict implies, given the current one.
///
/// Pure, and a **fixed point**: `render_hosts(render_hosts(c, d), d)` equals
/// `render_hosts(c, d)`, and an already-correct file renders to itself
/// byte-for-byte. That is the property `apply`'s early return depends on — every
/// deviation is an admin password dialog on the next tick.
///
/// Our block is rewritten **in place** when the markers already exist rather
/// than stripped-and-appended. Appending would shuffle the file's tail on every
/// pass, and TimeTracker's blocker (which appends its own differently-marked
/// block the same way) would shuffle it back — two enforcers ping-ponging the
/// file, with a password prompt each round.
#[cfg(any(target_os = "macos", test))]
fn render_hosts(current: &str, domains: &[String]) -> String {
    let block = build_block(domains);
    let block_lines: Vec<&str> = block.lines().collect();

    let mut out: Vec<&str> = Vec::new();
    let mut inside = false;
    let mut placed = false;
    for line in current.lines() {
        match line.trim() {
            MARKER_BEGIN => inside = true,
            MARKER_END => {
                inside = false;
                if !placed && !block_lines.is_empty() {
                    out.extend(block_lines.iter().copied());
                    placed = true;
                }
            }
            // Everything between the markers is ours to replace or drop.
            _ if inside => {}
            _ => out.push(line),
        }
    }

    // Drop blank lines the removed block left behind at the end of the file.
    while out.last().map(|l: &&str| l.trim().is_empty()).unwrap_or(false) {
        out.pop();
    }

    // First time (or after a dangling BEGIN with no END): append at the end.
    if !placed && !block_lines.is_empty() {
        out.push("");
        out.extend(block_lines.iter().copied());
    }

    let mut rendered = out.join("\n");
    // A real /etc/hosts ends with a newline; without this the "nothing is
    // blocked" case would rewrite the file just to delete it.
    if !rendered.is_empty() {
        rendered.push('\n');
    }
    rendered
}

/// Escape a string for embedding in an AppleScript double-quoted literal.
/// Backslashes first, then quotes — a hand-written `# it's a "note"` comment in
/// /etc/hosts would otherwise terminate the script early and wedge `apply`
/// permanently.
#[cfg(any(target_os = "macos", test))]
fn applescript_literal(raw: &str) -> String {
    raw.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Domains currently blocked in our marker region of /etc/hosts (bare, no www).
pub fn current_blocked() -> Result<Vec<String>, String> {
    let content = std::fs::read_to_string("/etc/hosts")
        .map_err(|e| format!("Cannot read /etc/hosts: {e}"))?;
    let mut domains = Vec::new();
    let mut inside = false;
    for line in content.lines() {
        match line.trim() {
            MARKER_BEGIN => inside = true,
            MARKER_END => inside = false,
            l if inside => {
                if let Some(host) = l.strip_prefix("127.0.0.1 ") {
                    let host = host.trim();
                    if !host.starts_with("www.") {
                        domains.push(host.to_string());
                    }
                }
            }
            _ => {}
        }
    }
    Ok(domains)
}

/// Write the verdict into /etc/hosts.
///
/// `honor_backoff` is true for the autonomous tick and false for user-initiated
/// applies: someone who just pressed a button is asking for the dialog, and
/// should not be told to wait out a cooldown they can't see.
#[cfg(target_os = "macos")]
fn apply(domains: &[String], honor_backoff: bool) -> Result<(), String> {
    let _guard = hosts_write_lock().lock().unwrap_or_else(|e| e.into_inner());

    let current = std::fs::read_to_string("/etc/hosts")
        .map_err(|e| format!("Cannot read /etc/hosts: {e}"))?;
    let new_content = render_hosts(&current, domains);

    // Skip the privileged write (and its password dialog) if nothing changed.
    // Load-bearing: without it a 30s tick loop spams admin prompts forever.
    // Also the steady state, so it clears any backoff from an earlier refusal.
    if new_content == current {
        set_backoff(false);
        return Ok(());
    }

    // A recently-refused dialog: stay quiet rather than re-prompting on every
    // tick. Checked after the no-op case so a verdict that resolves itself still
    // clears the cooldown.
    if honor_backoff && backoff_active() {
        return Ok(());
    }

    // Two layers of quoting: the shell sees a single-quoted string, and
    // AppleScript sees a double-quoted one wrapping the whole command.
    let shell_quoted = new_content.replace('\'', r"'\''");
    let command = format!(
        "printf '%s' '{shell_quoted}' | tee /etc/hosts > /dev/null && \
         dscacheutil -flushcache && killall -HUP mDNSResponder"
    );
    let script = format!(
        "do shell script \"{}\" with administrator privileges",
        applescript_literal(&command)
    );
    let output = std::process::Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| format!("osascript failed to launch: {e}"))?;
    if output.status.success() {
        set_backoff(false);
        Ok(())
    } else {
        // Cancelled dialog, wrong password, or a genuinely broken write — all
        // indistinguishable here, and all equally bad to retry in 30 seconds.
        set_backoff(true);
        Err(format!(
            "hosts update failed (backing off {}m): {}",
            HOSTS_RETRY_BACKOFF_SECS / 60,
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[cfg(not(target_os = "macos"))]
fn apply(_domains: &[String], _honor_backoff: bool) -> Result<(), String> {
    Err("site blocking is only implemented on macOS".to_string())
}

fn clear() -> Result<(), String> {
    // User-initiated: prompt even if the tick is mid-backoff.
    apply(&[], false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    // ── manifest ────────────────────────────────────────────────────────────

    fn module(enabled: bool) -> BlockingModule {
        BlockingModule::new(Arc::new(AtomicBool::new(enabled)))
    }

    #[test]
    fn manifest_advertises_the_routed_actions() {
        let m = module(false).manifest();
        // The id routes queued commands (gridClient's runViaGrid) — changing it
        // orphans every command already in the queue.
        assert_eq!(m.id, "blocking");
        assert_eq!(m.actions, s(&["status", "apply", "clear"]));
    }

    #[test]
    fn tick_loop_is_started_regardless_of_the_switch() {
        // The runtime reads `tick_interval_secs` once, at startup, to decide
        // whether to spawn a loop at all. If this went `None` while enforcement
        // was off, switching it on would do nothing until the next launch —
        // which is the whole bug this shape exists to prevent. `tick` is what
        // enforces the switch, not the manifest.
        assert_eq!(module(false).manifest().tick_interval_secs, Some(30));
        assert_eq!(module(true).manifest().tick_interval_secs, Some(30));
    }

    #[test]
    fn the_switch_is_read_live_not_captured_at_construction() {
        // The `enforcement` commands hold the other end of this Arc; a toggle
        // has to be visible to a tick that is already looping.
        let flag = Arc::new(AtomicBool::new(false));
        let m = BlockingModule::new(Arc::clone(&flag));
        assert!(!m.is_enforcing(), "starts off");
        flag.store(true, Ordering::Relaxed);
        assert!(m.is_enforcing(), "toggle must be visible without a restart");
        flag.store(false, Ordering::Relaxed);
        assert!(!m.is_enforcing());
    }

    // ── privileged-write backoff ────────────────────────────────────────────

    /// The only test that touches the process-global backoff cell. Kept as one
    /// test on purpose — split in two they could interleave under the default
    /// parallel test runner and flake.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_refused_dialog_silences_the_tick_until_the_cooldown_expires() {
        set_backoff(false);
        assert!(!backoff_active(), "no backoff by default");

        // A cancelled admin dialog. Without this the 30s tick re-prompts
        // immediately and keeps doing so until enforcement is switched off.
        set_backoff(true);
        assert!(backoff_active(), "a refused write must suppress the next tick");

        // A later success (or a verdict that needs no write) reopens it — the
        // cooldown must not outlive the condition that caused it.
        set_backoff(false);
        assert!(!backoff_active());
    }

    // ── build_block ─────────────────────────────────────────────────────────

    #[test]
    fn empty_domains_produces_empty_block() {
        assert_eq!(build_block(&[]), "");
    }

    #[test]
    fn single_domain_adds_www_variant() {
        let block = build_block(&s(&["youtube.com"]));
        assert!(block.contains("127.0.0.1 youtube.com"), "bare domain missing");
        assert!(block.contains("127.0.0.1 www.youtube.com"), "www variant missing");
    }

    #[test]
    fn every_domain_is_blocked_on_both_address_families() {
        // The bug this pins: an IPv4-only entry overrides the A lookup while the
        // AAAA lookup still reaches real DNS, so Chrome (which prefers IPv6)
        // loads the site normally. `ping` asks for IPv4 and reports 127.0.0.1,
        // which is why it looked like it was working.
        let block = build_block(&s(&["youtube.com"]));
        for line in [
            "127.0.0.1 youtube.com",
            "::1 youtube.com",
            "127.0.0.1 www.youtube.com",
            "::1 www.youtube.com",
        ] {
            assert!(block.contains(line), "missing `{line}` in:\n{block}");
        }
    }

    #[test]
    fn current_blocked_does_not_double_count_the_two_families() {
        // `current_blocked` reads back only the IPv4 lines. If it ever learns to
        // parse `::1` too it must dedupe, or the status UI reports twice the
        // domains that are actually blocked.
        let block = build_block(&s(&["a.com", "b.com"]));
        let v4 = block.lines().filter(|l| l.starts_with("127.0.0.1 ")).count();
        let v6 = block.lines().filter(|l| l.starts_with("::1 ")).count();
        assert_eq!(v4, v6, "the two families must stay in lockstep");
        assert_eq!(v4, 4, "2 domains × (bare + www)");
    }

    #[test]
    fn www_domain_not_doubled() {
        let block = build_block(&s(&["www.youtube.com"]));
        assert!(block.contains("127.0.0.1 www.youtube.com"));
        assert!(!block.contains("127.0.0.1 www.www.youtube.com"));
    }

    #[test]
    fn block_wrapped_in_markers() {
        let block = build_block(&s(&["example.com"]));
        assert!(block.starts_with(MARKER_BEGIN));
        assert!(block.ends_with(MARKER_END));
    }

    // ── render_hosts ────────────────────────────────────────────────────────
    //
    // Every fixture ends with a newline, like a real /etc/hosts. The invariant
    // that protects the password prompt is not self-idempotence but "an
    // already-correct file renders to itself" — a fixture without the trailing
    // newline passes the weaker property while still prompting on every tick.

    /// A plausible untouched /etc/hosts, quotes and backslash included.
    const REAL_HOSTS: &str = "##\n# Host Database\n##\n127.0.0.1\tlocalhost\n\
                              255.255.255.255\tbroadcasthost\n::1\tlocalhost\n\
                              # it's a \"note\" with a \\ in it\n";

    #[test]
    fn untouched_hosts_file_is_left_alone_by_an_empty_verdict() {
        // The steady state on a machine with nothing blocked: must be a no-op,
        // otherwise every tick takes the privileged path.
        assert_eq!(render_hosts(REAL_HOSTS, &[]), REAL_HOSTS);
    }

    #[test]
    fn applied_hosts_file_renders_to_itself() {
        let domains = s(&["a.com", "b.com"]);
        let applied = render_hosts(REAL_HOSTS, &domains);
        assert_eq!(render_hosts(&applied, &domains), applied, "not a fixed point");
        // …and a changed verdict does render something different.
        assert_ne!(render_hosts(&applied, &s(&["other.com"])), applied);
    }

    #[test]
    fn user_content_survives_apply_and_clear() {
        let applied = render_hosts(REAL_HOSTS, &s(&["reddit.com", "twitter.com"]));
        assert!(applied.contains("127.0.0.1 reddit.com"));
        assert!(applied.contains("127.0.0.1 www.twitter.com"));
        assert!(applied.starts_with(REAL_HOSTS.trim_end_matches('\n')));
        // Clearing puts the file back exactly as it was.
        assert_eq!(render_hosts(&applied, &[]), REAL_HOSTS);
    }

    #[test]
    fn our_block_is_rewritten_in_place() {
        // A foreign block (TimeTracker's) sits after ours. Rewriting our region
        // must not move it — otherwise the two enforcers ping-pong the file,
        // prompting for the admin password on every pass.
        let applied = render_hosts(REAL_HOSTS, &s(&["a.com"]));
        let with_foreign = format!(
            "{applied}\n# BEGIN TimeTracker-Block\n127.0.0.1 b.com\n# END TimeTracker-Block\n"
        );
        let rerendered = render_hosts(&with_foreign, &s(&["a.com"]));
        assert_eq!(rerendered, with_foreign, "foreign block moved or file churned");

        let changed = render_hosts(&with_foreign, &s(&["c.com"]));
        assert!(changed.contains("127.0.0.1 c.com"));
        assert!(!changed.contains("127.0.0.1 a.com"));
        assert!(
            changed.ends_with("# BEGIN TimeTracker-Block\n127.0.0.1 b.com\n# END TimeTracker-Block\n"),
            "the foreign block must stay where it was: {changed}"
        );
    }

    #[test]
    fn empty_verdict_removes_only_our_block() {
        let applied = render_hosts(REAL_HOSTS, &s(&["x.com"]));
        let with_foreign = format!(
            "{applied}\n# BEGIN TimeTracker-Block\n127.0.0.1 b.com\n# END TimeTracker-Block\n"
        );
        let cleared = render_hosts(&with_foreign, &[]);
        assert!(!cleared.contains("x.com"));
        assert!(!cleared.contains(MARKER_BEGIN));
        assert!(cleared.contains("127.0.0.1 b.com"), "foreign block was eaten");
        assert_eq!(render_hosts(&cleared, &[]), cleared);
    }

    // ── AppleScript escaping ────────────────────────────────────────────────

    #[test]
    fn applescript_literal_escapes_backslash_before_quote() {
        assert_eq!(applescript_literal(r#"a "b" \ c"#), r#"a \"b\" \\ c"#);
        // A quote in the hosts file must not terminate the script literal.
        assert!(!applescript_literal(REAL_HOSTS).contains("\"note\""));
    }

    // ── parse_verdict: missing row vs. empty row ─────────────────────────────

    #[test]
    fn missing_row_parses_to_none() {
        assert_eq!(parse_verdict(&json!([])), None);
    }

    #[test]
    fn unexpected_response_shape_parses_to_none() {
        // Real PostgREST errors never reach here — `Supabase::select` turns any
        // non-2xx into an `Err`, which the tick treats as "leave things alone".
        // A body that is somehow not an array is treated the same way.
        assert_eq!(parse_verdict(&json!({"unexpected": true})), None);
    }

    #[test]
    fn present_row_with_empty_arrays_is_authoritative() {
        let v = parse_verdict(&json!([{
            "effective_domains": [],
            "effective_processes": [],
            "computed_at": "2026-08-05T12:00:00+00:00",
        }]))
        .expect("row exists");
        assert!(v.domains.is_empty());
        assert!(v.processes.is_empty());
    }

    /// The exact row `supabase/functions/focus-evaluate/index.ts` upserts —
    /// including `Date.toISOString()`'s millisecond `Z` form, which must parse.
    #[test]
    fn real_focus_evaluate_row_parses() {
        let v = parse_verdict(&json!([{
            "user_id": "default",
            "effective_domains": ["reddit.com", "youtube.com"],
            "effective_processes": ["Discord"],
            "reasons": {
                "reddit.com": { "blocked": true, "source": "permanent" },
                "Discord": { "blocked": true, "source": "schedule", "today_minutes": 42 },
            },
            "today_minutes": 42,
            "computed_at": "2026-08-05T12:00:00.000Z",
        }]))
        .expect("row exists");
        assert_eq!(v.domains, s(&["reddit.com", "youtube.com"]));
        assert_eq!(v.processes, s(&["Discord"]));
        assert_eq!(v.today_minutes, Some(42));
        assert_eq!(v.reasons["reddit.com"]["source"], json!("permanent"));
        // Datable → staleness is meaningful rather than defaulting to "stale".
        let now = DateTime::parse_from_rfc3339("2026-08-05T12:04:00.000Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(v.age_secs(now), Some(240));
        assert!(!v.is_stale(now));
    }

    #[test]
    fn null_arrays_default_to_empty() {
        let v = parse_verdict(&json!([{ "effective_domains": null }])).expect("row exists");
        assert!(v.domains.is_empty());
        assert!(v.processes.is_empty());
        assert_eq!(v.computed_at, None);
    }

    #[test]
    fn domains_are_trimmed_deduped_and_sorted() {
        let v = parse_verdict(&json!([{
            "effective_domains": ["b.com", " a.com ", "b.com", "", "   "],
            "effective_processes": ["Slack", "Discord", "Slack"],
        }]))
        .expect("row exists");
        assert_eq!(v.domains, s(&["a.com", "b.com"]));
        assert_eq!(v.processes, s(&["Discord", "Slack"]));
    }

    // ── staleness ───────────────────────────────────────────────────────────

    fn verdict_at(computed_at: Option<&str>) -> Verdict {
        Verdict {
            computed_at: computed_at.map(str::to_string),
            ..Default::default()
        }
    }

    #[test]
    fn fresh_verdict_is_not_stale() {
        let now = Utc::now();
        let v = verdict_at(Some(&(now - chrono::Duration::minutes(4)).to_rfc3339()));
        assert_eq!(v.age_secs(now), Some(4 * 60));
        assert!(!v.is_stale(now));
    }

    #[test]
    fn old_verdict_is_stale() {
        let now = Utc::now();
        let v = verdict_at(Some(&(now - chrono::Duration::minutes(31)).to_rfc3339()));
        assert!(v.is_stale(now));
    }

    #[test]
    fn boundary_is_not_stale() {
        let now = Utc::now();
        let v = verdict_at(Some(&(now - chrono::Duration::seconds(STALE_AFTER_SECS)).to_rfc3339()));
        assert!(!v.is_stale(now), "exactly at the threshold is still fresh");
    }

    #[test]
    fn undatable_verdict_is_stale() {
        let now = Utc::now();
        assert!(verdict_at(None).is_stale(now));
        // TimeTracker's old SQLite format: no offset, so not RFC 3339.
        assert!(verdict_at(Some("2026-08-05 12:00:00")).is_stale(now));
        assert_eq!(verdict_at(Some("not a date")).age_secs(now), None);
    }
}
