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

use crate::grid::{ModuleContext, ModuleManifest, NexusModule};
use crate::timetracker::T_BLOCKING_STATE;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde_json::{json, Value};

const MARKER_BEGIN: &str = "# BEGIN NexusLocal-Block";
const MARKER_END: &str = "# END NexusLocal-Block";

/// How old `computed_at` may get before the verdict is reported as stale. The
/// evaluator runs every 5 minutes, so half an hour of silence means it stopped.
const STALE_AFTER_SECS: i64 = 30 * 60;

pub struct BlockingModule {
    /// Whether the tick autonomously enforces the server's verdict.
    enabled: bool,
}

impl BlockingModule {
    pub fn new(enabled: bool) -> Self {
        Self { enabled }
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
            // unlocking) takes effect without a manual command — but only when
            // enforcement is switched on.
            tick_interval_secs: if self.enabled { Some(30) } else { None },
        }
    }

    async fn tick(&self, ctx: &ModuleContext) -> Result<(), String> {
        if !self.enabled {
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

        enforce(verdict).await.map(|_| ())
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
                let mut out = json!({ "enforcing": self.enabled });
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
            "apply" => {
                // Explicit, user-initiated: surface the failure rather than
                // silently skipping the way the tick does.
                let verdict = fetch_verdict(ctx).await?.ok_or_else(|| {
                    format!("no blocking_state row for user '{}'", ctx.user_id)
                })?;
                let stale = verdict.is_stale(Utc::now());
                let domains = verdict.domains.len();
                let processes = verdict.processes.len();
                let kills_started = enforce(verdict).await?;
                Ok(json!({
                    "domains": domains,
                    "processes": processes,
                    // Processes found running and sent a quit — the force-kill
                    // lands 2s later on its own thread, so this is a count of
                    // kills started, not of confirmed exits.
                    "kills_started": kills_started,
                    "stale": stale,
                }))
            }
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
async fn enforce(verdict: Verdict) -> Result<usize, String> {
    let processes = verdict.processes;
    let killed = tokio::task::spawn_blocking(move || enforce_processes(&processes))
        .await
        .map_err(|e| e.to_string())?;

    let domains = verdict.domains;
    tokio::task::spawn_blocking(move || apply(&domains))
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
        lines.push(format!("127.0.0.1 {domain}"));
        if !domain.starts_with("www.") {
            lines.push(format!("127.0.0.1 www.{domain}"));
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
fn current_blocked() -> Result<Vec<String>, String> {
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

#[cfg(target_os = "macos")]
fn apply(domains: &[String]) -> Result<(), String> {
    let _guard = hosts_write_lock().lock().unwrap_or_else(|e| e.into_inner());

    let current = std::fs::read_to_string("/etc/hosts")
        .map_err(|e| format!("Cannot read /etc/hosts: {e}"))?;
    let new_content = render_hosts(&current, domains);

    // Skip the privileged write (and its password dialog) if nothing changed.
    // Load-bearing: without it a 30s tick loop spams admin prompts forever.
    if new_content == current {
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
        Ok(())
    } else {
        Err(format!(
            "hosts update failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

#[cfg(not(target_os = "macos"))]
fn apply(_domains: &[String]) -> Result<(), String> {
    Err("site blocking is only implemented on macOS".to_string())
}

fn clear() -> Result<(), String> {
    apply(&[])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
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
