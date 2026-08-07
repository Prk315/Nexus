//! Usage tracker — what application is in front, for how long.
//!
//! Samples the frontmost app every 5 seconds and turns the sequence of samples
//! into completed intervals, which are appended to the local JSONL store
//! (`crate::usage`). Nothing here talks to the network, and nothing here is ever
//! written to Supabase — see the privacy note at the top of `usage.rs`.
//!
//! # Why this is a grid module and not a Tauri command
//!
//! It has to run continuously, and on macOS the **daemon** owns the grid — the
//! desktop app spawns none (see `lib.rs`). Anything living in the app stops the
//! moment the app is quit, which for a time tracker means it records exactly the
//! periods you were looking at the time tracker.
//!
//! # How the frontmost app is read, and why not with the obvious API
//!
//! `NSWorkspace.frontmostApplication` needs an `NSApplication` in a process that
//! is a UI agent; the daemon is neither. `osascript`-ing System Events raises a
//! TCC "wants to control your computer" prompt, which a headless LaunchAgent
//! cannot present usefully. `lsappinfo` needs neither: it reads LaunchServices
//! directly and prompts for nothing.
//!
//! ```text
//! $ lsappinfo front
//! ASN:0x0-0x14014:
//! $ lsappinfo info -only name "ASN:0x0-0x14014:"
//! "LSDisplayName"="Google Chrome"
//! ```
//!
//! Idle time comes from `ioreg -c IOHIDSystem`, whose `"HIDIdleTime"` property is
//! nanoseconds since the last HID event. Also prompt-free.
//!
//! # Idle handling is the whole difference between this and a lie
//!
//! Without it, a laptop left open through lunch records 50 minutes of whatever
//! window happened to be in front. So a sample where the machine has been idle
//! for more than [`IDLE_THRESHOLD_SECS`] closes the current interval **at the
//! moment input stopped** — `now - idle`, not `now` — and records nothing at all
//! until input resumes. Ending at `now` would fold the whole idle period into
//! the interval, which is the bug being avoided, one tick later.
//!
//! # Failure posture
//!
//! A failed `lsappinfo` (LaunchServices restarting, the machine mid-login) is a
//! **skipped tick**: the current interval is left open and untouched, and the
//! next successful sample continues it. It is not an error, because a `tick`
//! returning `Err` logs noise on every pass for a condition that resolves
//! itself, and it is certainly not a reason to close an interval — a closed
//! interval cannot be reopened, so guessing wrong there permanently splits a
//! session into fragments.

use crate::grid::{ModuleContext, ModuleManifest, NexusModule};
use crate::usage::{self, UsageEntry};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::sync::Mutex;

/// Idle for longer than this and the user is considered away.
///
/// Two minutes is long enough to survive reading a long page or a phone call at
/// the desk without HID input, and short enough that a coffee break doesn't get
/// billed to whatever was in front.
const IDLE_THRESHOLD_SECS: f64 = 120.0;

/// What one tick managed to observe.
#[derive(Debug, Clone, PartialEq)]
pub enum Sample {
    /// The user is at the machine, with this app in front.
    Active { app: String },
    /// The user has been away since this instant (`now - idle`).
    Idle { since: DateTime<Utc> },
    /// The sample failed. Distinct from `Idle` on purpose: "we don't know" must
    /// never close an interval.
    Unknown,
}

/// The open interval, if any: which app, and when it started.
///
/// Pure — no clock, no filesystem, no subprocesses — so every transition below
/// is testable without a Mac in a particular state.
#[derive(Debug, Default)]
pub struct Tracker {
    current: Option<(String, DateTime<Utc>)>,
}

impl Tracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Currently-open interval, for `status`.
    pub fn current(&self) -> Option<(&str, DateTime<Utc>)> {
        self.current.as_ref().map(|(a, t)| (a.as_str(), *t))
    }

    /// Fold one sample in. Returns an interval to append, if this sample closed
    /// one that was long enough to matter.
    ///
    /// At most one interval can be produced per call: samples are 5s apart and an
    /// interval only closes when the app changes, the user goes idle, or the
    /// local day rolls over.
    pub fn observe(&mut self, now: DateTime<Utc>, sample: Sample) -> Option<UsageEntry> {
        match sample {
            // Leave everything exactly as it is. See "Failure posture" above.
            Sample::Unknown => None,

            Sample::Idle { since } => {
                let (app, started) = self.current.take()?;
                // Closed at the moment input stopped, not at the moment we
                // noticed — otherwise the idle period itself gets recorded as
                // use of whatever was in front. `UsageEntry::app` clamps `since`
                // up to `started` for the case where the interval began inside
                // the idle window.
                let _ = now;
                UsageEntry::app(&app, started, since)
            }

            Sample::Active { app } => {
                match self.current.take() {
                    // Same app, same local day: the interval simply continues.
                    Some((prev, started))
                        if prev == app
                            && usage::local_date_of(started) == usage::local_date_of(now) =>
                    {
                        self.current = Some((prev, started));
                        None
                    }
                    // A different app — or the same app across midnight. The
                    // day file is chosen by an interval's start, so an interval
                    // left open across midnight would file the whole of the
                    // morning under yesterday and make "today" wrong until the
                    // app was next switched. Closing and reopening at the tick
                    // costs at most one tick of resolution.
                    Some((prev, started)) => {
                        let closed = UsageEntry::app(&prev, started, now);
                        self.current = Some((app, now));
                        closed
                    }
                    // Nothing open: start one. Either the first sample after
                    // launch, or the first input after an idle period.
                    None => {
                        self.current = Some((app, now));
                        None
                    }
                }
            }
        }
    }
}

pub struct UsageTrackerModule {
    tracker: Mutex<Tracker>,
}

impl UsageTrackerModule {
    pub fn new() -> Self {
        Self {
            tracker: Mutex::new(Tracker::new()),
        }
    }
}

impl Default for UsageTrackerModule {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl NexusModule for UsageTrackerModule {
    fn manifest(&self) -> ModuleManifest {
        ModuleManifest {
            id: "usage_tracker".to_string(),
            name: "TimeTracker · Foreground app usage".to_string(),
            version: "0.1.0".to_string(),
            actions: vec!["status".to_string(), "today".to_string()],
            // Unconditionally `Some`, for the reason spelled out in
            // `modules/blocking.rs`: `Grid::spawn` reads this **once** at
            // startup to decide whether to spawn a loop at all. Anything
            // runtime-conditional here becomes a setting that cannot take
            // effect without a relaunch. Gate inside `tick`, never here.
            //
            // 5s bounds the error on every interval boundary at 5s, and costs
            // two short-lived subprocesses per tick.
            tick_interval_secs: Some(5),
        }
    }

    async fn tick(&self, _ctx: &ModuleContext) -> Result<(), String> {
        // Both samplers shell out; keep them off the async runtime's threads.
        let (sample, now) = tokio::task::spawn_blocking(|| (sample_now(Utc::now()), Utc::now()))
            .await
            .map_err(|e| e.to_string())?;

        // The lock is held across `observe` only — never across an await, and
        // never across the file write.
        let completed = {
            let mut tracker = self.tracker.lock().unwrap_or_else(|e| e.into_inner());
            tracker.observe(now, sample)
        };

        if let Some(entry) = completed {
            // A failed append is worth one line in the daemon log, but it must
            // not kill the tick loop: a full disk should cost the intervals it
            // happens during, not every interval afterwards.
            if let Err(e) = tokio::task::spawn_blocking(move || usage::append(&entry))
                .await
                .map_err(|e| e.to_string())?
            {
                eprintln!("[usage] cannot record interval: {e}");
            }
        }
        Ok(())
    }

    async fn handle(
        &self,
        action: &str,
        _payload: &Value,
        _ctx: &ModuleContext,
    ) -> Result<Value, String> {
        match action {
            "status" => {
                let (app, since) = {
                    let tracker = self.tracker.lock().unwrap_or_else(|e| e.into_inner());
                    match tracker.current() {
                        Some((a, t)) => (Some(a.to_string()), Some(t.to_rfc3339())),
                        None => (None, None),
                    }
                };
                Ok(json!({
                    "current_app": app,
                    "since": since,
                    "idle_threshold_secs": IDLE_THRESHOLD_SECS,
                    "day": usage::today_local(),
                }))
            }
            "today" => {
                let day = usage::today_local();
                let totals = usage::totals_for_day(&day);
                let total_seconds: i64 = totals.iter().map(|(_, s)| *s).sum();
                Ok(json!({
                    "day": day,
                    "total_seconds": total_seconds,
                    "totals": totals
                        .into_iter()
                        .map(|(label, seconds)| json!({ "label": label, "seconds": seconds }))
                        .collect::<Vec<_>>(),
                }))
            }
            other => Err(format!("unsupported usage_tracker action: {other}")),
        }
    }
}

// ── sampling (macOS) ────────────────────────────────────────────────────────

/// One observation of the machine, at `now`.
///
/// Idle is checked **first**: if the user is away it does not matter what is in
/// front, and asking LaunchServices anyway would be two subprocesses to reach the
/// same conclusion. An unreadable idle counter is treated as "not idle" rather
/// than as `Unknown`, because `ioreg` failing is not evidence the user left —
/// falling back to `Unknown` there would freeze tracking entirely on a machine
/// where that one command is unavailable.
#[cfg(target_os = "macos")]
fn sample_now(now: DateTime<Utc>) -> Sample {
    let idle = read_idle_secs().unwrap_or(0.0);
    if idle > IDLE_THRESHOLD_SECS {
        return Sample::Idle {
            since: now - chrono::Duration::milliseconds((idle * 1000.0) as i64),
        };
    }
    match frontmost_app() {
        Some(app) => Sample::Active { app },
        None => Sample::Unknown,
    }
}

#[cfg(not(target_os = "macos"))]
fn sample_now(_now: DateTime<Utc>) -> Sample {
    Sample::Unknown
}

/// Name of the frontmost application, via LaunchServices.
///
/// Two commands, and both are allowed to fail: `lsappinfo front` gives an ASN
/// (an opaque LaunchServices handle), and `lsappinfo info -only name` resolves it
/// to a display name. At the login window, during fast user switching, or while
/// LaunchServices is restarting, either can come back empty.
#[cfg(target_os = "macos")]
fn frontmost_app() -> Option<String> {
    let front = run(&["front"])?;
    let asn = parse_front_asn(&front)?;
    let info = run(&["info", "-only", "name", &asn])?;
    parse_display_name(&info)
}

#[cfg(target_os = "macos")]
fn run(args: &[&str]) -> Option<String> {
    let out = std::process::Command::new("lsappinfo").args(args).output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).to_string())
}

#[cfg(target_os = "macos")]
fn read_idle_secs() -> Option<f64> {
    let out = std::process::Command::new("ioreg")
        .args(["-c", "IOHIDSystem"])
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| parse_hid_idle_secs(&String::from_utf8_lossy(&out.stdout)))?
}

// ── parsers ─────────────────────────────────────────────────────────────────
//
// Pure and compiled everywhere, so the output formats are pinned by tests on any
// host rather than only where the commands exist.

/// Pull the ASN out of `lsappinfo front`'s output, e.g. `ASN:0x0-0x14014:`.
///
/// The ASN is passed straight back to `lsappinfo` as an argument, so anything
/// that is not recognisably an ASN is dropped rather than forwarded.
fn parse_front_asn(raw: &str) -> Option<String> {
    raw.split_whitespace()
        .find(|tok| tok.starts_with("ASN:"))
        .map(str::to_string)
}

/// Pull the name out of `"LSDisplayName"="Google Chrome"`.
///
/// Takes the value after the **last** `=` and strips the quotes, so a name that
/// itself contains `=` still comes back whole. Returns `None` for the empty
/// name: a blank app label would show up in the panel as an untitled row that
/// nothing explains.
fn parse_display_name(raw: &str) -> Option<String> {
    let line = raw.lines().find(|l| l.contains("LSDisplayName"))?;
    let value = line.rsplit_once('=')?.1.trim();
    let name = value.trim_matches('"').trim();
    (!name.is_empty()).then(|| name.to_string())
}

/// Seconds since the last HID event, from `ioreg -c IOHIDSystem`.
///
/// The property is nanoseconds and the line looks like
/// `      "HIDIdleTime" = 1878065702`. `ioreg` prints one per HID node, so the
/// **smallest** value wins — any single device having seen recent input means
/// the user is here, and taking the first match would report a keyboard that has
/// been untouched while the trackpad was in constant use.
fn parse_hid_idle_secs(raw: &str) -> Option<f64> {
    raw.lines()
        .filter(|l| l.contains("\"HIDIdleTime\""))
        .filter_map(|l| {
            let value = l.rsplit_once('=')?.1.trim();
            let digits: String = value.chars().take_while(char::is_ascii_digit).collect();
            digits.parse::<u64>().ok()
        })
        .min()
        .map(|nanos| nanos as f64 / 1e9)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s)
            .expect("fixture timestamp")
            .with_timezone(&Utc)
    }

    fn active(app: &str) -> Sample {
        Sample::Active { app: app.to_string() }
    }

    // ── manifest ────────────────────────────────────────────────────────────

    #[test]
    fn manifest_advertises_the_routed_actions() {
        let m = UsageTrackerModule::new().manifest();
        assert_eq!(m.id, "usage_tracker");
        assert_eq!(m.actions, vec!["status".to_string(), "today".to_string()]);
    }

    #[test]
    fn the_tick_interval_is_unconditional() {
        // `Grid::spawn` reads this once at startup. The blocking module's bug
        // was returning `None` while a runtime flag was off, which meant the
        // loop was never spawned and the flag could never take effect. Nothing
        // in this manifest may depend on state.
        assert_eq!(UsageTrackerModule::new().manifest().tick_interval_secs, Some(5));
        let m = UsageTrackerModule::new();
        m.tracker
            .lock()
            .unwrap()
            .observe(utc("2026-08-07T09:00:00Z"), active("Ghostty"));
        assert_eq!(m.manifest().tick_interval_secs, Some(5), "still 5 with an interval open");
    }

    // ── interval accumulation ───────────────────────────────────────────────

    #[test]
    fn the_first_sample_opens_an_interval_and_records_nothing() {
        let mut t = Tracker::new();
        assert_eq!(t.observe(utc("2026-08-07T09:00:00Z"), active("Ghostty")), None);
        assert_eq!(t.current().map(|(a, _)| a), Some("Ghostty"));
    }

    #[test]
    fn staying_in_one_app_keeps_a_single_interval_open() {
        // The property that makes this a *time tracker* rather than a sampler:
        // ten ticks in one app is one 50-second interval, not ten 5-second ones.
        let mut t = Tracker::new();
        let start = utc("2026-08-07T09:00:00Z");
        for i in 0..10 {
            assert_eq!(
                t.observe(start + chrono::Duration::seconds(i * 5), active("Ghostty")),
                None,
                "tick {i} closed an interval it should have continued"
            );
        }
        assert_eq!(t.current().map(|(_, s)| s), Some(start), "start must not drift");

        let closed = t
            .observe(start + chrono::Duration::seconds(50), active("Chrome"))
            .expect("switching apps closes the interval");
        assert_eq!(closed.label(), "Ghostty");
        assert_eq!(closed.seconds(), 50);
    }

    #[test]
    fn switching_apps_starts_the_next_interval_where_the_last_one_ended() {
        // No gap and no overlap: the sum of a day's intervals must equal the time
        // actually spent at the machine.
        let mut t = Tracker::new();
        let start = utc("2026-08-07T09:00:00Z");
        t.observe(start, active("Ghostty"));
        let first = t
            .observe(start + chrono::Duration::seconds(60), active("Chrome"))
            .expect("closed");
        let second = t
            .observe(start + chrono::Duration::seconds(100), active("Zed"))
            .expect("closed");

        let UsageEntry::App { end, .. } = &first else {
            panic!("app entry");
        };
        assert_eq!(end, second.start(), "the boundary must be shared exactly");
        assert_eq!(first.seconds() + second.seconds(), 100);
    }

    #[test]
    fn a_sub_two_second_visit_is_dropped_but_still_closes_the_interval() {
        // Alt-tabbing through a window on the way to another one: the passed-over
        // app must not appear in the totals, and must not corrupt the boundary
        // of the app that follows it either.
        let mut t = Tracker::new();
        let start = utc("2026-08-07T09:00:00Z");
        t.observe(start, active("Ghostty"));
        let real = t
            .observe(start + chrono::Duration::seconds(60), active("Finder"))
            .expect("Ghostty closed");
        assert_eq!(real.label(), "Ghostty");

        // 1 second in Finder — below the floor, so nothing is recorded.
        assert_eq!(
            t.observe(start + chrono::Duration::seconds(61), active("Chrome")),
            None,
            "a 1s visit must not be recorded"
        );
        // …and Chrome's interval still begins at the moment it came forward.
        let chrome = t
            .observe(start + chrono::Duration::seconds(121), active("Zed"))
            .expect("Chrome closed");
        assert_eq!(chrome.label(), "Chrome");
        assert_eq!(chrome.seconds(), 60);
    }

    // ── idle ────────────────────────────────────────────────────────────────

    #[test]
    fn going_idle_closes_the_interval_at_the_moment_input_stopped() {
        // The single most important behaviour in this module. A laptop left open
        // through lunch must record the work before lunch, not lunch.
        let mut t = Tracker::new();
        let start = utc("2026-08-07T12:00:00Z");
        t.observe(start, active("Ghostty"));

        // 50 minutes later, HID has been quiet for 45 of them.
        let now = start + chrono::Duration::minutes(50);
        let since = now - chrono::Duration::minutes(45);
        let closed = t.observe(now, Sample::Idle { since }).expect("interval closed");

        assert_eq!(closed.label(), "Ghostty");
        assert_eq!(
            closed.seconds(),
            5 * 60,
            "must bill the 5 minutes of work, not the 50 minutes of wall clock"
        );
        let UsageEntry::App { end, .. } = &closed else {
            panic!("app entry");
        };
        assert_eq!(end, &since.to_rfc3339());
    }

    #[test]
    fn nothing_is_recorded_while_the_user_stays_away() {
        let mut t = Tracker::new();
        let start = utc("2026-08-07T12:00:00Z");
        t.observe(start, active("Ghostty"));
        let now = start + chrono::Duration::minutes(10);
        t.observe(now, Sample::Idle { since: now - chrono::Duration::minutes(5) })
            .expect("closed once");

        // Every subsequent idle tick: nothing at all. Not a zero-length entry,
        // not a repeat of the one already written.
        for i in 1..20 {
            let later = now + chrono::Duration::seconds(i * 5);
            assert_eq!(
                t.observe(later, Sample::Idle { since: later - chrono::Duration::minutes(5) }),
                None,
                "idle tick {i} recorded something"
            );
        }
        assert!(t.current().is_none(), "no interval may be open while away");
    }

    #[test]
    fn input_resuming_starts_a_fresh_interval_not_a_backdated_one() {
        // The gap between going idle and coming back is unaccounted time, by
        // design. Resuming must not silently reclaim it.
        let mut t = Tracker::new();
        let start = utc("2026-08-07T12:00:00Z");
        t.observe(start, active("Ghostty"));
        let away = start + chrono::Duration::minutes(10);
        t.observe(away, Sample::Idle { since: away - chrono::Duration::minutes(5) });

        let back = away + chrono::Duration::minutes(30);
        assert_eq!(t.observe(back, active("Ghostty")), None, "resuming records nothing yet");
        let closed = t
            .observe(back + chrono::Duration::minutes(2), active("Chrome"))
            .expect("closed");
        assert_eq!(closed.seconds(), 120, "only the time since input resumed");
        assert_eq!(closed.start(), &back.to_rfc3339());
    }

    #[test]
    fn an_idle_window_that_swallows_the_whole_interval_records_nothing() {
        // The interval began *inside* the idle window (an app switch that landed
        // between the last HID event and this tick). Closing at `since` would
        // give a negative duration; it must be dropped, not clamped to a bogus
        // positive one.
        let mut t = Tracker::new();
        let start = utc("2026-08-07T12:00:00Z");
        t.observe(start, active("Ghostty"));
        let now = start + chrono::Duration::seconds(5);
        assert_eq!(
            t.observe(now, Sample::Idle { since: start - chrono::Duration::minutes(3) }),
            None
        );
        assert!(t.current().is_none(), "the interval must still be closed");
    }

    #[test]
    fn idle_with_nothing_open_is_a_no_op() {
        let mut t = Tracker::new();
        let now = utc("2026-08-07T12:00:00Z");
        assert_eq!(
            t.observe(now, Sample::Idle { since: now - chrono::Duration::minutes(5) }),
            None
        );
    }

    #[test]
    fn the_idle_threshold_is_two_minutes() {
        // Encoded in `sample_now`; pinned here so shortening it (and starting to
        // fragment every session where someone reads a long page) is deliberate.
        assert_eq!(IDLE_THRESHOLD_SECS, 120.0);
    }

    // ── a failed sample ─────────────────────────────────────────────────────

    #[test]
    fn a_failed_sample_leaves_the_interval_open() {
        // `lsappinfo` failing is not evidence the user left. Closing here would
        // permanently split one session into fragments, and a closed interval
        // cannot be reopened.
        let mut t = Tracker::new();
        let start = utc("2026-08-07T09:00:00Z");
        t.observe(start, active("Ghostty"));
        for i in 1..5 {
            assert_eq!(
                t.observe(start + chrono::Duration::seconds(i * 5), Sample::Unknown),
                None
            );
        }
        assert_eq!(t.current(), Some(("Ghostty", start)), "state must be untouched");

        let closed = t
            .observe(start + chrono::Duration::seconds(60), active("Chrome"))
            .expect("closed");
        assert_eq!(closed.seconds(), 60, "the gap belongs to the interval it spanned");
    }

    #[test]
    fn a_failed_sample_before_anything_is_open_is_a_no_op() {
        let mut t = Tracker::new();
        assert_eq!(t.observe(utc("2026-08-07T09:00:00Z"), Sample::Unknown), None);
        assert!(t.current().is_none());
    }

    // ── the day rollover ────────────────────────────────────────────────────

    #[test]
    fn an_interval_is_closed_and_reopened_at_the_local_day_boundary() {
        // Copenhagen midnight, i.e. 22:00Z in summer. Left open, the whole of the
        // next morning would be filed under yesterday (the day file is chosen by
        // an interval's start) and "today" would read empty until the next app
        // switch.
        let mut t = Tracker::new();
        let before = utc("2026-08-06T21:59:55Z"); // 23:59:55 local
        t.observe(before, active("Ghostty"));

        let after = utc("2026-08-06T22:00:00Z"); // 00:00:00 local, next day
        let closed = t
            .observe(after, active("Ghostty"))
            .expect("the same app across midnight still closes the interval");
        assert_eq!(closed.label(), "Ghostty");
        assert_eq!(
            usage::local_date_of_rfc3339(closed.start()).as_deref(),
            Some("2026-08-06"),
            "the closed interval belongs to yesterday"
        );

        // …and the new one belongs to today, starting at the tick.
        assert_eq!(t.current(), Some(("Ghostty", after)));
        let next = t
            .observe(after + chrono::Duration::minutes(5), active("Chrome"))
            .expect("closed");
        assert_eq!(
            usage::local_date_of_rfc3339(next.start()).as_deref(),
            Some("2026-08-07")
        );
    }

    #[test]
    fn a_utc_midnight_crossing_is_not_a_day_boundary_here() {
        // 00:00Z is 02:00 in Copenhagen: the middle of the same local night. An
        // implementation that split on the UTC date would cut every late session
        // in half for no reason.
        let mut t = Tracker::new();
        let before = utc("2026-08-06T23:59:55Z");
        t.observe(before, active("Ghostty"));
        assert_eq!(
            t.observe(utc("2026-08-07T00:00:05Z"), active("Ghostty")),
            None,
            "same local day — the interval must continue"
        );
    }

    // ── parsers ─────────────────────────────────────────────────────────────

    #[test]
    fn front_asn_is_parsed_from_lsappinfos_output() {
        assert_eq!(
            parse_front_asn("ASN:0x0-0x14014:\n").as_deref(),
            Some("ASN:0x0-0x14014:")
        );
        // Nothing that isn't an ASN gets forwarded back to `lsappinfo`.
        assert_eq!(parse_front_asn(""), None);
        assert_eq!(parse_front_asn("\n"), None);
        assert_eq!(parse_front_asn("lsappinfo: no front application"), None);
    }

    #[test]
    fn display_name_is_parsed_from_the_quoted_value() {
        assert_eq!(
            parse_display_name("\"LSDisplayName\"=\"Google Chrome\"\n").as_deref(),
            Some("Google Chrome")
        );
        assert_eq!(
            parse_display_name("  \"LSDisplayName\"=\"Ghostty\"  ").as_deref(),
            Some("Ghostty")
        );
    }

    #[test]
    fn an_empty_or_missing_display_name_yields_no_app() {
        // A blank label would show up in the panel as an unexplained row, and
        // would accumulate every app the parser ever failed on into one bucket.
        assert_eq!(parse_display_name("\"LSDisplayName\"=\"\""), None);
        assert_eq!(parse_display_name(""), None);
        assert_eq!(parse_display_name("lsappinfo: can't find app"), None);
    }

    #[test]
    fn idle_nanoseconds_are_converted_to_seconds() {
        let out = "    | |   \"HIDIdleTime\" = 1878065702\n";
        let secs = parse_hid_idle_secs(out).expect("parses");
        assert!((secs - 1.878065702).abs() < 1e-6, "got {secs}");
    }

    #[test]
    fn the_smallest_idle_time_across_devices_wins() {
        // `ioreg` prints one HIDIdleTime per HID node. Taking the first would
        // report an untouched keyboard as "away" while the trackpad was in
        // constant use — a whole afternoon lost to a device the user isn't
        // touching.
        let out = concat!(
            "    \"HIDIdleTime\" = 900000000000\n",
            "    \"HIDIdleTime\" = 2000000000\n",
            "    \"HIDIdleTime\" = 750000000000\n",
        );
        let secs = parse_hid_idle_secs(out).expect("parses");
        assert!((secs - 2.0).abs() < 1e-6, "got {secs}");
    }

    #[test]
    fn a_missing_or_unreadable_idle_property_is_none() {
        assert_eq!(parse_hid_idle_secs(""), None);
        assert_eq!(parse_hid_idle_secs("+-o Root  <class IORegistryEntry>\n"), None);
        assert_eq!(parse_hid_idle_secs("    \"HIDIdleTime\" = \n"), None);
        assert_eq!(parse_hid_idle_secs("    \"HIDIdleTime\" = nonsense\n"), None);
    }

    #[test]
    fn an_idle_reading_over_the_threshold_is_what_the_tick_acts_on() {
        // Ties the parser to the decision: 121 seconds of nanoseconds must land
        // on the away side of `IDLE_THRESHOLD_SECS`, 119 on the present side.
        assert!(parse_hid_idle_secs("\"HIDIdleTime\" = 121000000000").unwrap() > IDLE_THRESHOLD_SECS);
        assert!(parse_hid_idle_secs("\"HIDIdleTime\" = 119000000000").unwrap() < IDLE_THRESHOLD_SECS);
    }
}
