//! Session recording — start/stop/pause/resume against Supabase.
//!
//! # Model, ported from `apps/TimeTrackerApp/src-tauri/src/db/timer.rs`
//!
//! Elapsed time is *derived*, never stored while the clock runs: `pause`
//! snapshots `now - start_time` into `elapsed_seconds`, and `resume` back-dates
//! `start_time = now - elapsed_seconds` so the derivation keeps working
//! unchanged. `stop` writes a `time_entries` row and clears the active session.
//!
//! Unlike TimeTracker there is no local SQLite here. `active_sessions` has a
//! UNIQUE(user_id), so there is exactly one active session per user across every
//! device — Supabase is the ground truth and the phone is a thin client.
//!
//! # Two bugs from the original that are deliberately not reproduced
//!
//! 1. `resume_timer` there dropped `user_id` (the INSERT omitted the column and
//!    the returned struct hardcoded `None`). Here `user_id` is carried through
//!    every path — it is also the row key, so losing it loses the session.
//! 2. Timestamps there were local-time strings, which turned every
//!    last-write-wins comparison into a lexical compare that remote won by
//!    accident. Everything written from here is RFC3339 UTC — the format
//!    [`super::now_rfc3339`] defines — so the compare is an instant compare.
//!
//! # The one invariant worth protecting
//!
//! Each command samples `now` exactly once and reuses it. That is what makes
//! `paused_at - start_time == elapsed_seconds` true *by construction* at pause
//! time, which in turn lets `stop` use a single duration formula
//! (`end - start`, with `end = paused_at ?? now`) that stays correct for a
//! session that was paused overnight. Two clock reads in one command quietly
//! break that, which is why `updated_at` is stamped from the same `now` rather
//! than from `now_rfc3339()`.

use super::{eq, Rest, T_ACTIVE_SESSIONS, T_TIME_ENTRIES};
use chrono::{DateTime, Duration, Local, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStatus {
    /// "idle" | "running" | "paused"
    pub state: String,
    pub task_name: Option<String>,
    pub project: Option<String>,
    pub start_time: Option<String>,
    pub elapsed_seconds: i64,
}

impl Default for SessionStatus {
    fn default() -> Self {
        Self {
            state: "idle".to_string(),
            task_name: None,
            project: None,
            start_time: None,
            elapsed_seconds: 0,
        }
    }
}

/// A row of `active_sessions`. Extra columns (`tags`, `notes`, `billable`,
/// `hourly_rate`) exist because the TimeTracker desktop app writes them; `stop`
/// copies them into the `time_entries` row rather than dropping them.
#[derive(Debug, Clone, Default, Deserialize)]
struct ActiveRow {
    /// Row identity, used as the compare-and-swap key on every write. A
    /// stop-and-start on another device mints a new uuid under the same
    /// `user_id`, which is exactly the replacement we need to detect.
    #[serde(default)]
    id: String,
    #[serde(default)]
    user_id: String,
    #[serde(default)]
    device_id: String,
    #[serde(default)]
    task_name: String,
    #[serde(default)]
    project: Option<String>,
    #[serde(default)]
    tags: Option<String>,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    billable: bool,
    #[serde(default)]
    hourly_rate: f64,
    #[serde(default)]
    start_time: String,
    #[serde(default)]
    paused_at: Option<String>,
    #[serde(default)]
    elapsed_seconds: i64,
}

const NOT_CONFIGURED: &str =
    "Supabase is not configured — set `supabase.url` and `supabase.key` in ~/.nexuslocalrc";
const NO_SESSION: &str = "No active session";
const ALREADY_RUNNING: &str = "A session is already running";
const SESSION_MOVED: &str = "The session changed on another device — reload and try again";

// ── commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn tt_session_status() -> Result<SessionStatus, String> {
    let rest = configured()?;
    let now = Utc::now();
    Ok(match fetch_active(&rest).await? {
        Some(row) => derive_status(&row, now),
        None => SessionStatus::default(),
    })
}

#[tauri::command]
pub async fn tt_session_start(
    task_name: String,
    project: Option<String>,
) -> Result<SessionStatus, String> {
    let rest = configured()?;
    let now = Utc::now();

    let task_name = task_name.trim().to_string();
    if task_name.is_empty() {
        return Err("Task name cannot be empty".to_string());
    }
    let project = project.and_then(|p| {
        let p = p.trim().to_string();
        if p.is_empty() {
            None
        } else {
            Some(p)
        }
    });

    // UNIQUE(user_id) means this is one session per user across every device, so
    // the pre-check reads whatever another device may have started.
    if let Some(existing) = fetch_active(&rest).await? {
        return Err(busy_message(&existing));
    }

    let start_time = now.to_rfc3339();
    let body = json!({
        "user_id": rest.user_id(),
        "device_id": crate::device::get_or_create(),
        "task_name": task_name,
        "project": project,
        "start_time": start_time,
        "paused_at": Value::Null,
        "elapsed_seconds": 0,
        "updated_at": now.to_rfc3339(),
    });

    // Plain insert, never an upsert on user_id: an upsert would silently clobber
    // a session another device is running. Lose the race, report it as such.
    rest.insert(T_ACTIVE_SESSIONS, &body)
        .await
        .map_err(|e| if is_conflict(&e) { ALREADY_RUNNING.to_string() } else { e })?;

    Ok(SessionStatus {
        state: "running".to_string(),
        task_name: Some(task_name),
        project,
        start_time: Some(start_time),
        elapsed_seconds: 0,
    })
}

#[tauri::command]
pub async fn tt_session_pause() -> Result<SessionStatus, String> {
    let rest = configured()?;
    let now = Utc::now();

    let row = fetch_active(&rest).await?.ok_or(NO_SESSION)?;
    if row.paused_at.is_some() {
        return Err("Session is already paused".to_string());
    }

    // Snapshot the derived elapsed and stamp `paused_at` from the *same* `now`,
    // so `paused_at - start_time == elapsed_seconds` holds exactly.
    let elapsed = elapsed_at(&row.start_time, now);
    let paused_at = now.to_rfc3339();
    update_active(
        &rest,
        &row.id,
        &json!({
            "elapsed_seconds": elapsed,
            "paused_at": paused_at,
            "updated_at": now.to_rfc3339(),
        }),
    )
    .await?;

    Ok(SessionStatus {
        state: "paused".to_string(),
        task_name: Some(row.task_name),
        project: row.project,
        start_time: Some(row.start_time),
        elapsed_seconds: elapsed,
    })
}

#[tauri::command]
pub async fn tt_session_resume() -> Result<SessionStatus, String> {
    let rest = configured()?;
    let now = Utc::now();

    let row = fetch_active(&rest).await?.ok_or(NO_SESSION)?;
    if row.paused_at.is_none() {
        return Err("Session is not paused".to_string());
    }

    // Back-date the start so the plain `now - start_time` derivation keeps
    // working with no notion of "paused for N seconds" anywhere downstream.
    let new_start = back_dated_start(now, row.elapsed_seconds).to_rfc3339();
    update_active(
        &rest,
        &row.id,
        &json!({
            "start_time": new_start,
            "paused_at": Value::Null,
            "updated_at": now.to_rfc3339(),
        }),
    )
    .await?;

    Ok(SessionStatus {
        state: "running".to_string(),
        task_name: Some(row.task_name),
        project: row.project,
        start_time: Some(new_start),
        elapsed_seconds: row.elapsed_seconds.max(0),
    })
}

#[tauri::command]
pub async fn tt_session_stop() -> Result<SessionStatus, String> {
    let rest = configured()?;
    let now = Utc::now();

    let row = fetch_active(&rest).await?.ok_or(NO_SESSION)?;

    let end = session_end(row.paused_at.as_deref(), now);
    let duration = elapsed_at(&row.start_time, end);

    // Attribute the entry to the device that did the work, not the one tapping
    // stop — it also makes the UNIQUE(device_id, start_time, task_name) key
    // stable if two devices race to stop the same session.
    let device_id = if row.device_id.is_empty() {
        crate::device::get_or_create()
    } else {
        row.device_id.clone()
    };
    let user_id = if row.user_id.is_empty() {
        rest.user_id().to_string()
    } else {
        row.user_id.clone()
    };

    let entry = json!({
        "device_id": device_id,
        "user_id": user_id,
        "task_name": row.task_name,
        "project": row.project,
        // Normalized, not passed through: a row the SQLite-era desktop app wrote
        // carries a local-time string, and copying it verbatim would seed a
        // fresh `time_entries` row with the very format bug (2) is about.
        "start_time": normalized_start(&row.start_time),
        "end_time": end.to_rfc3339(),
        "duration_seconds": duration,
        "tags": row.tags,
        "notes": row.notes,
        "billable": row.billable,
        "hourly_rate": row.hourly_rate,
    });

    // `on_conflict` has to be spelled out: PostgREST otherwise resolves against
    // the primary key, and the real unique violation surfaces as an opaque 409.
    rest.upsert(T_TIME_ENTRIES, "device_id,start_time,task_name", &entry)
        .await?;

    // Same compare-and-swap as `update_active`: without the `id` clause this
    // would delete whatever session happens to sit under our `user_id` now,
    // which after a fast stop-and-start on another device is not the one we read.
    // `Rest::delete` sends `Prefer: return=minimal`, so a zero-row delete is
    // indistinguishable from success here — the CAS prevents the wrong deletion,
    // it does not report one.
    let user = eq(rest.user_id());
    let id = eq(&row.id);
    rest.delete(
        T_ACTIVE_SESSIONS,
        &[("user_id", user.as_str()), ("id", id.as_str())],
    )
    .await?;

    Ok(SessionStatus::default())
}

// ── remote plumbing ──────────────────────────────────────────────────────────

fn configured() -> Result<Rest, String> {
    let rest = Rest::load();
    if rest.is_configured() {
        Ok(rest)
    } else {
        Err(NOT_CONFIGURED.to_string())
    }
}

async fn fetch_active(rest: &Rest) -> Result<Option<ActiveRow>, String> {
    let filter = eq(rest.user_id());
    let value = rest
        .select(
            T_ACTIVE_SESSIONS,
            &[
                ("select", "*"),
                ("user_id", filter.as_str()),
                ("limit", "1"),
            ],
        )
        .await?;
    match value.as_array().and_then(|rows| rows.first()) {
        Some(row) => serde_json::from_value(row.clone())
            .map(Some)
            .map_err(|e| format!("malformed active_sessions row: {e}")),
        None => Ok(None),
    }
}

/// Compare-and-swap on the row we just read. `expected_id` is the second half of
/// the filter and is what makes this safe across devices: `active_sessions` is
/// keyed by `user_id` alone, so between our read and our write another device
/// can have stopped that session and started a different one under the *same*
/// key. Filtering on `id` too means the PATCH simply matches nothing in that
/// case instead of stamping our stale numbers onto someone else's session.
///
/// `id` rather than `start_time`: it is a uuid, so it survives urlencoding
/// unambiguously (a legacy `start_time` contains a space), and it is stable
/// across `resume`, which rewrites `start_time`.
async fn update_active(rest: &Rest, expected_id: &str, body: &Value) -> Result<(), String> {
    let user = eq(rest.user_id());
    let id = eq(expected_id);
    let updated = rest
        .update(
            T_ACTIVE_SESSIONS,
            &[("user_id", user.as_str()), ("id", id.as_str())],
            body,
        )
        .await?;
    // PostgREST answers a no-match PATCH with 200 and an empty array, so this is
    // the CAS failing — the row is gone or has been replaced.
    if updated.as_array().is_some_and(|rows| rows.is_empty()) {
        return Err(SESSION_MOVED.to_string());
    }
    Ok(())
}

/// A unique violation from PostgREST, either shape. Matched against the status
/// prefix `status_error` builds rather than a bare "409", which would also fire
/// on an error body that merely contains those digits.
fn is_conflict(err: &str) -> bool {
    err.starts_with("supabase 409") || err.contains("23505")
}

fn busy_message(row: &ActiveRow) -> String {
    if row.paused_at.is_some() {
        format!(
            "A session is paused (\"{}\") — resume or stop it first",
            row.task_name
        )
    } else {
        ALREADY_RUNNING.to_string()
    }
}

// ── pure logic (unit-tested below; no network, no ambient clock) ──────────────

/// Elapsed seconds between a stored `start_time` and `now`, clamped at zero.
/// An unparseable start time is treated as "just started" rather than as a
/// wild number — the old local-time rows are the reason this can happen.
fn elapsed_at(start_time: &str, now: DateTime<Utc>) -> i64 {
    match parse_ts(start_time) {
        Some(start) => (now - start).num_seconds().max(0),
        None => 0,
    }
}

/// When the session actually ended: the moment it was paused if it was paused,
/// otherwise now. A paused session stopped the next morning must not bill the
/// night — and because `pause` writes `paused_at` and `elapsed_seconds` from one
/// clock read, `end - start_time` equals that snapshot exactly.
fn session_end(paused_at: Option<&str>, now: DateTime<Utc>) -> DateTime<Utc> {
    paused_at.and_then(parse_ts).unwrap_or(now)
}

/// A `start_time` normalized to RFC3339 for writing into `time_entries`.
/// Unparseable input is passed through unchanged: an odd timestamp on the entry
/// beats losing the entry, and it is still the key the row already had.
fn normalized_start(start_time: &str) -> String {
    parse_ts(start_time)
        .map(|d| d.to_rfc3339())
        .unwrap_or_else(|| start_time.to_string())
}

/// The back-dated start that makes `now - start == elapsed_seconds`.
fn back_dated_start(now: DateTime<Utc>, elapsed_seconds: i64) -> DateTime<Utc> {
    now - Duration::seconds(elapsed_seconds.max(0))
}

/// Parse a timestamp from these tables. RFC3339 is what we write; the naive
/// fallbacks read rows the SQLite-era desktop app left behind, which were local
/// time in both `T` and space-separated spellings.
///
/// Those legacy strings carry no offset, so they are resolved in the *reading*
/// device's zone. That is what the writer meant — but it means a legacy row
/// written in Copenhagen and read on a phone in another zone derives an elapsed
/// off by the offset delta. Interpreting them as UTC instead would be
/// deterministic and wrong for everyone; this is right whenever the phone is
/// where the desktop is, which is the case this app has. It self-heals: the
/// first `stop` normalizes the value (see `normalized_start`), and nothing
/// written from here is ever offset-free.
fn parse_ts(s: &str) -> Option<DateTime<Utc>> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Utc));
    }
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
    ] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(s, fmt) {
            // `.single()` rather than `.unwrap()`: a DST-ambiguous or skipped
            // local time would panic otherwise, which is how TimeTracker did it.
            if let Some(local) = naive.and_local_timezone(Local).single() {
                return Some(local.with_timezone(&Utc));
            }
        }
    }
    None
}

fn derive_status(row: &ActiveRow, now: DateTime<Utc>) -> SessionStatus {
    let paused = row.paused_at.is_some();
    SessionStatus {
        state: if paused { "paused" } else { "running" }.to_string(),
        task_name: Some(row.task_name.clone()),
        project: row.project.clone(),
        start_time: Some(row.start_time.clone()),
        elapsed_seconds: if paused {
            row.elapsed_seconds.max(0)
        } else {
            elapsed_at(&row.start_time, now)
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timetracker::now_rfc3339;

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn elapsed_is_derived_from_the_start_timestamp() {
        let start = "2026-08-05T12:00:00+00:00";
        assert_eq!(elapsed_at(start, at("2026-08-05T12:00:00+00:00")), 0);
        assert_eq!(elapsed_at(start, at("2026-08-05T12:00:42+00:00")), 42);
        assert_eq!(elapsed_at(start, at("2026-08-05T13:30:00+00:00")), 5400);
    }

    #[test]
    fn elapsed_is_offset_aware_not_a_string_compare() {
        // The same instant spelled in two zones must derive the same elapsed.
        let utc = elapsed_at("2026-08-05T12:00:00+00:00", at("2026-08-05T12:10:00+00:00"));
        let cph = elapsed_at("2026-08-05T14:00:00+02:00", at("2026-08-05T12:10:00+00:00"));
        assert_eq!(utc, cph);
        assert_eq!(utc, 600);
    }

    #[test]
    fn elapsed_clamps_at_zero_for_a_future_start() {
        let elapsed = elapsed_at("2026-08-05T12:00:00+00:00", at("2026-08-05T11:00:00+00:00"));
        assert_eq!(elapsed, 0);
    }

    #[test]
    fn elapsed_of_an_unparseable_start_is_zero_not_garbage() {
        assert_eq!(elapsed_at("not a timestamp", at("2026-08-05T12:00:00+00:00")), 0);
        assert_eq!(elapsed_at("", at("2026-08-05T12:00:00+00:00")), 0);
    }

    #[test]
    fn pause_then_resume_preserves_elapsed() {
        let start = "2026-08-05T12:00:00+00:00";
        let pause_at = at("2026-08-05T12:25:00+00:00");

        // pause: snapshot the derived elapsed.
        let snapshot = elapsed_at(start, pause_at);
        assert_eq!(snapshot, 1500);

        // resume 3 hours later: back-date so the derivation resumes at 1500.
        let resume_at = at("2026-08-05T15:25:00+00:00");
        let new_start = back_dated_start(resume_at, snapshot).to_rfc3339();
        assert_eq!(elapsed_at(&new_start, resume_at), snapshot);

        // and the clock keeps running from there — paused time is not counted.
        let later = at("2026-08-05T15:35:00+00:00");
        assert_eq!(elapsed_at(&new_start, later), snapshot + 600);
    }

    #[test]
    fn repeated_pause_resume_cycles_do_not_drift() {
        // Each cycle: work from `start` until :10 past, pause, idle ~2h, resume.
        let mut start = "2026-08-05T09:00:00+00:00".to_string();
        let mut elapsed = 0;
        for cycle in 0..5 {
            let pause_at = at(&format!("2026-08-05T{:02}:10:00+00:00", 9 + cycle * 2));
            elapsed = elapsed_at(&start, pause_at);
            let resume_at = at(&format!("2026-08-05T{:02}:00:00+00:00", 11 + cycle * 2));
            start = back_dated_start(resume_at, elapsed).to_rfc3339();
        }
        // Ten worked minutes per cycle, five cycles, however long the gaps were.
        assert_eq!(elapsed, 5 * 600);
    }

    #[test]
    fn stop_of_a_paused_session_bills_to_the_pause_not_to_now() {
        // Exactly what `tt_session_stop` computes, through the same helper.
        let start = "2026-08-05T12:00:00+00:00";
        let pause_at = at("2026-08-05T12:25:00+00:00");
        let snapshot = elapsed_at(start, pause_at);
        assert_eq!(snapshot, 1500);

        // Stopped the next morning: the night must not be billed.
        let stopped_at = at("2026-08-06T09:00:00+00:00");
        let end = session_end(Some(&pause_at.to_rfc3339()), stopped_at);
        assert_eq!(end, pause_at);
        assert_eq!(elapsed_at(start, end), snapshot);

        // A running session ends now, so the same formula still holds.
        let end = session_end(None, stopped_at);
        assert_eq!(end, stopped_at);
        assert_eq!(elapsed_at(start, end), 75_600);
    }

    #[test]
    fn written_entries_carry_a_normalized_start_time() {
        // RFC3339 in, the same instant out.
        assert_eq!(
            normalized_start("2026-08-05T14:00:00+02:00"),
            at("2026-08-05T12:00:00+00:00").to_rfc3339()
        );
        // A legacy local-time row is rewritten with an offset rather than
        // seeding a fresh `time_entries` row with the old format.
        let legacy = normalized_start("2026-08-05 12:00:00");
        assert!(!legacy.contains(' '), "still space-separated: {legacy}");
        assert!(parse_ts(&legacy).is_some());
        // Junk is passed through rather than dropping the entry.
        assert_eq!(normalized_start("garbage"), "garbage");
    }

    #[test]
    fn back_dating_ignores_a_negative_snapshot() {
        let now = at("2026-08-05T12:00:00+00:00");
        assert_eq!(back_dated_start(now, -90), now);
        assert_eq!(back_dated_start(now, 0), now);
    }

    #[test]
    fn parses_rfc3339_in_any_offset() {
        let expected = at("2026-08-05T12:00:00+00:00");
        assert_eq!(parse_ts("2026-08-05T12:00:00+00:00"), Some(expected));
        assert_eq!(parse_ts("2026-08-05T12:00:00Z"), Some(expected));
        assert_eq!(parse_ts("2026-08-05T14:00:00+02:00"), Some(expected));
        // Sub-second precision is preserved, not truncated to the second.
        assert_eq!(
            parse_ts("2026-08-05T12:00:00.250Z"),
            Some(at("2026-08-05T12:00:00.250+00:00"))
        );
    }

    #[test]
    fn parses_the_legacy_local_time_spellings() {
        use chrono::Timelike;

        // Every shape the SQLite era wrote — `T` and space separated, with and
        // without a fractional part. Asserting the wall clock in the local zone
        // (rather than an absolute instant) keeps this true under any `TZ`,
        // while still proving the value is the 12:00 the writer meant and not,
        // say, the epoch.
        for legacy in [
            "2026-08-05T12:00:00.000",
            "2026-08-05 12:00:00.000",
            "2026-08-05T12:00:00",
            "2026-08-05 12:00:00",
        ] {
            let parsed = parse_ts(legacy).expect("legacy timestamp should parse");
            let wall = parsed.with_timezone(&Local);
            assert_eq!(wall.hour(), 12, "wrong hour for {legacy}");
            assert_eq!(wall.minute(), 0, "wrong minute for {legacy}");
            assert_eq!(wall.second(), 0, "wrong second for {legacy}");
        }

        // All four spellings name the same instant.
        let instants: Vec<_> = [
            "2026-08-05T12:00:00.000",
            "2026-08-05 12:00:00.000",
            "2026-08-05T12:00:00",
            "2026-08-05 12:00:00",
        ]
        .iter()
        .map(|s| parse_ts(s).unwrap())
        .collect();
        assert!(instants.windows(2).all(|w| w[0] == w[1]));
    }

    #[test]
    fn rejects_junk_rather_than_defaulting_to_now() {
        assert_eq!(parse_ts(""), None);
        assert_eq!(parse_ts("   "), None);
        assert_eq!(parse_ts("yesterday"), None);
        assert_eq!(parse_ts("2026-13-45T99:00:00Z"), None);
    }

    #[test]
    fn everything_written_round_trips_through_rfc3339() {
        // now_rfc3339 is what every write uses; it must survive a re-read.
        let written = now_rfc3339();
        assert!(parse_ts(&written).is_some(), "unparseable write: {written}");
        assert!(written.contains('T'), "must not be space-separated: {written}");
    }

    #[test]
    fn status_of_a_running_row_derives_elapsed() {
        let row = ActiveRow {
            task_name: "deep work".to_string(),
            project: Some("nexus".to_string()),
            start_time: "2026-08-05T12:00:00+00:00".to_string(),
            elapsed_seconds: 999, // stale while running — must be ignored
            ..Default::default()
        };
        let status = derive_status(&row, at("2026-08-05T12:05:00+00:00"));
        assert_eq!(status.state, "running");
        assert_eq!(status.elapsed_seconds, 300);
        assert_eq!(status.task_name.as_deref(), Some("deep work"));
        assert_eq!(status.project.as_deref(), Some("nexus"));
    }

    #[test]
    fn status_of_a_paused_row_freezes_at_the_snapshot() {
        let row = ActiveRow {
            task_name: "deep work".to_string(),
            start_time: "2026-08-05T12:00:00+00:00".to_string(),
            paused_at: Some("2026-08-05T12:25:00+00:00".to_string()),
            elapsed_seconds: 1500,
            ..Default::default()
        };
        // Hours later the paused elapsed has not moved.
        let status = derive_status(&row, at("2026-08-05T18:00:00+00:00"));
        assert_eq!(status.state, "paused");
        assert_eq!(status.elapsed_seconds, 1500);
    }

    #[test]
    fn idle_status_is_the_default() {
        let status = SessionStatus::default();
        assert_eq!(status.state, "idle");
        assert_eq!(status.elapsed_seconds, 0);
        assert!(status.task_name.is_none());
    }

    #[test]
    fn active_row_deserializes_from_a_postgrest_row() {
        let row: ActiveRow = serde_json::from_value(json!({
            "id": "0f0e4d9c-2b1a-4c3d-8e9f-000000000001",
            "user_id": "default",
            "device_id": "dev-1",
            "task_name": "deep work",
            "project": null,
            "tags": null,
            "notes": null,
            "billable": false,
            "hourly_rate": 0.0,
            "start_time": "2026-08-05T12:00:00+00:00",
            "paused_at": null,
            "elapsed_seconds": 0,
            "updated_at": "2026-08-05T12:00:00+00:00"
        }))
        .expect("row should deserialize");
        assert_eq!(row.user_id, "default");
        assert_eq!(row.device_id, "dev-1");
        assert!(row.paused_at.is_none());
        // The CAS key every write filters on — losing it would silently turn
        // each mutation back into a blind write over `user_id`.
        assert_eq!(row.id, "0f0e4d9c-2b1a-4c3d-8e9f-000000000001");
    }

    #[test]
    fn conflict_detection_matches_both_error_shapes() {
        assert!(is_conflict("supabase 409 Conflict: {}"));
        assert!(is_conflict(r#"supabase 400: {"code":"23505"}"#));
        assert!(!is_conflict("supabase 500: internal"));
        assert!(!is_conflict("error sending request"));
        // A task name that merely contains the digits is not a conflict.
        assert!(!is_conflict(
            r#"supabase 400: {"message":"invalid task 409 review"}"#
        ));
    }

    #[test]
    fn busy_message_distinguishes_paused_from_running() {
        let running = ActiveRow {
            task_name: "deep work".to_string(),
            ..Default::default()
        };
        assert_eq!(busy_message(&running), ALREADY_RUNNING);

        let paused = ActiveRow {
            paused_at: Some("2026-08-05T12:25:00+00:00".to_string()),
            ..running.clone()
        };
        assert!(busy_message(&paused).contains("paused"));
        assert!(busy_message(&paused).contains("deep work"));
    }
}
