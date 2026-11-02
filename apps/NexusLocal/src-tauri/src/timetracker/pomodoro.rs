//! Pomodoro: durable config, and the live run that drives the session.
//!
//! # Why the phase machine moved here from TypeScript
//!
//! It used to be a `useEffect` in the WebView, which had three consequences:
//! a reload or a closed window restarted the cycle; a second device had its own
//! unrelated cycle; and breaks were billed as work, because nothing paused the
//! session at a phase boundary. Now the run lives in `pomodoro_config`'s
//! `run_*` columns, and every phase change is a single function — [`plan`] — of
//! (run, session state, config, now).
//!
//! # Who advances it
//!
//! Anyone who calls [`reconcile`]: the desktop driver ([`spawn_driver`]) wakes
//! at each deadline, and every `tt_pomodoro_*` command reconciles before it
//! answers, which is all the phone needs — it only has to be right when looked
//! at. Two devices racing over the same deadline is safe: every run write is a
//! compare-and-swap on `run_rev`, and only the writer that wins it gets to
//! notify. The session side effect is idempotent by construction (pausing a
//! paused session is skipped).
//!
//! # Late transitions
//!
//! A driver that wakes after a boundary — the Mac slept, the app was quit —
//! applies the transition *as of the boundary*: a focus block that ended at
//! 12:25 pauses the session at 12:25, not at wake time, so a nap is never
//! billed as focus. A break that ended more than [`GRACE_SECS`] ago does not
//! auto-resume the session — it parks the next focus block, held at full
//! length, until the user presses resume. Resuming tracked time on behalf of
//! someone who is not there is the one thing this must never do.
//!
//! No `#[cfg(target_os = "ios")]` split for the data path: this is plain HTTP
//! against PostgREST, identical on both targets.

use super::session::{self, ActiveRow, SessionStatus};
use super::{eq, now_rfc3339, Rest, T_POMODORO_CONFIG};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

/// Wire shape shared with `pomodoro.ts`. Field names are **snake_case on the
/// wire** — Tauri camelCases *parameter* names (`{ config }`), not the contents
/// of a serde-deserialized struct, and these names double as the Postgres column
/// names so the upsert body can be built from the same vocabulary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PomodoroConfig {
    pub enabled: bool,
    pub work_minutes: u32,
    pub break_minutes: u32,
    pub long_break_minutes: u32,
    pub sessions_per_cycle: u32,
}

impl Default for PomodoroConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            work_minutes: 25,
            break_minutes: 5,
            long_break_minutes: 15,
            sessions_per_cycle: 4,
        }
    }
}

/// Every duration must be at least a minute and a cycle at least one session.
///
/// This only ever sees zero: the fields are `u32`, so serde rejects a negative
/// while deserializing the command argument, before this runs — a negative
/// surfaces as serde's own message, not one of these. What this catches is the
/// config that would make the phase machine spin: a 0-minute phase completes
/// instantly, and `sessions_per_cycle = 0` is a modulo by zero on the TS side.
fn validate(config: &PomodoroConfig) -> Result<(), String> {
    let bad = |field: &str| Err(format!("pomodoro: {field} must be at least 1"));
    if config.work_minutes < 1 {
        return bad("work_minutes");
    }
    if config.break_minutes < 1 {
        return bad("break_minutes");
    }
    if config.long_break_minutes < 1 {
        return bad("long_break_minutes");
    }
    if config.sessions_per_cycle < 1 {
        return bad("sessions_per_cycle");
    }
    Ok(())
}

/// Read one field, falling back to the default for anything the phase machine
/// can't use.
///
/// The columns are nullable and Postgres `integer` is signed, while these fields
/// are `u32` — so a null, a missing column or a negative number are all
/// reachable from a hand-edited or pre-validation row. `serde_json::from_value`
/// would turn each of those into a hard error on the *read* path, which is the
/// worst place for it: a panel that can't read is a panel whose next write
/// overwrites whatever is actually stored. Reading is therefore total, and
/// `validate` guards the write path instead. Same shape as `sanitizeConfig` in
/// `pomodoro.ts`, which clamps to the same `1..=u32::MAX` window so a value the
/// panel accepts is a value this can store.
fn minutes_field(row: &Value, key: &str, fallback: u32) -> u32 {
    row.get(key)
        // PostgREST emits a `numeric`/`real` column as a JSON float, and the
        // column type is unit 1's to choose. `as_i64` alone would reject `25.0`
        // and silently fall back to the default on a perfectly valid setting.
        .and_then(|v| {
            v.as_i64()
                .or_else(|| v.as_f64().filter(|f| f.is_finite()).map(|f| f.floor() as i64))
        })
        .filter(|v| *v >= 1 && *v <= u32::MAX as i64)
        .map(|v| v as u32)
        .unwrap_or(fallback)
}

fn config_from_row(row: &Value) -> PomodoroConfig {
    let d = PomodoroConfig::default();
    PomodoroConfig {
        enabled: row.get("enabled").and_then(Value::as_bool).unwrap_or(d.enabled),
        work_minutes: minutes_field(row, "work_minutes", d.work_minutes),
        break_minutes: minutes_field(row, "break_minutes", d.break_minutes),
        long_break_minutes: minutes_field(row, "long_break_minutes", d.long_break_minutes),
        sessions_per_cycle: minutes_field(row, "sessions_per_cycle", d.sessions_per_cycle),
    }
}

/// Read the caller's config row.
///
/// A missing row is a valid "never configured" state, not an error — it is what
/// a fresh install looks like — so it resolves to `PomodoroConfig::default()`.
/// The same is true of an unconfigured `~/.nexuslocalrc`: the panel should still
/// render its defaults rather than show a wall of red. A real transport or
/// PostgREST failure *is* surfaced, including the `relation does not exist` you
/// get until work unit 1's migration is applied.
#[tauri::command]
pub async fn tt_pomodoro_get() -> Result<PomodoroConfig, String> {
    let rest = Rest::load();
    if !rest.is_configured() {
        return Ok(PomodoroConfig::default());
    }

    let user = eq(rest.user_id());
    let rows = rest
        .select(
            T_POMODORO_CONFIG,
            &[("user_id", user.as_str()), ("select", "*"), ("limit", "1")],
        )
        .await?;

    Ok(rows
        .as_array()
        .and_then(|rows| rows.first())
        .map(config_from_row)
        .unwrap_or_default())
}

/// Upsert the caller's config row, merging on `user_id`.
///
/// Unlike `get`, an unconfigured backend is an error here: silently dropping a
/// write is how a setting looks saved and comes back as the default.
#[tauri::command]
pub async fn tt_pomodoro_set(config: PomodoroConfig) -> Result<PomodoroConfig, String> {
    validate(&config)?;

    let rest = Rest::load();
    if !rest.is_configured() {
        return Err("pomodoro: supabase is not configured (~/.nexuslocalrc)".to_string());
    }

    // `PomodoroConfig` carries neither the key nor the timestamp, so the row is
    // assembled here rather than serialized wholesale.
    let body = json!([{
        "user_id": rest.user_id(),
        "enabled": config.enabled,
        "work_minutes": config.work_minutes,
        "break_minutes": config.break_minutes,
        "long_break_minutes": config.long_break_minutes,
        "sessions_per_cycle": config.sessions_per_cycle,
        "updated_at": now_rfc3339(),
    }]);

    rest.upsert(T_POMODORO_CONFIG, "user_id", &body).await?;
    Ok(config)
}

// ── the live run: pure model ─────────────────────────────────────────────────

/// How late a driver may observe a break ending and still resume the session
/// on the user's behalf. Past this, the next focus block waits for a click.
pub const GRACE_SECS: i64 = 120;

/// Notices older than this are dropped rather than fired on wake — "your
/// break started" three hours after the fact is noise.
const STALE_NOTICE_SECS: i64 = 3600;

/// Upper bound on transitions applied in one reconcile. A day-long gap settles
/// in two (focus → break → parked focus); this only stops a bug from spinning.
const MAX_STEPS: usize = 8;

/// Emitted to every window after each reconcile, with a [`PomodoroStatus`].
pub const STATUS_EVENT: &str = "pomodoro:status";

const NO_RUN: &str = "No pomodoro is running";
const RUN_MOVED: &str = "The pomodoro changed on another device — try again";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Work,
    Break,
    LongBreak,
}

impl Phase {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "work" => Some(Phase::Work),
            "break" => Some(Phase::Break),
            "long_break" => Some(Phase::LongBreak),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Phase::Work => "work",
            Phase::Break => "break",
            Phase::LongBreak => "long_break",
        }
    }

    fn is_break(self) -> bool {
        self != Phase::Work
    }
}

fn phase_seconds(phase: Phase, config: &PomodoroConfig) -> i64 {
    let minutes = match phase {
        Phase::Work => config.work_minutes,
        Phase::Break => config.break_minutes,
        Phase::LongBreak => config.long_break_minutes,
    };
    i64::from(minutes.max(1)) * 60
}

/// The phase after `phase`. `completed` is the **post-increment** count of
/// focus blocks — the one that just ended is already counted — which is what
/// makes the 4th block of a 4-per-cycle config the one that earns the long
/// break. Same convention TimeTracker used.
fn next_phase(phase: Phase, completed: u32, config: &PomodoroConfig) -> Phase {
    if phase.is_break() {
        return Phase::Work;
    }
    if completed.is_multiple_of(config.sessions_per_cycle.max(1)) {
        Phase::LongBreak
    } else {
        Phase::Break
    }
}

/// Armed: counting down to a deadline. Held: frozen with this many seconds left.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Clock {
    Armed(DateTime<Utc>),
    Held(i64),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Run {
    phase: Phase,
    completed: u32,
    clock: Clock,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Sess {
    Idle,
    Running,
    Paused,
}

fn sess_of(row: Option<&ActiveRow>) -> Sess {
    match row {
        None => Sess::Idle,
        Some(r) if r.is_paused() => Sess::Paused,
        Some(_) => Sess::Running,
    }
}

/// What a transition does to the session, at which instant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Effect {
    Nothing,
    PauseAt(DateTime<Utc>),
    ResumeAt(DateTime<Utc>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Notice {
    BreakStarted,
    LongBreakStarted,
    FocusStarted,
    /// A break ended while nobody was watching; the next block is parked.
    BreakOverWaiting,
}

impl Notice {
    pub fn message(self) -> &'static str {
        match self {
            Notice::BreakStarted => "Short break — tracking paused.",
            Notice::LongBreakStarted => "Long break — well earned. Tracking paused.",
            Notice::FocusStarted => "Break over — back to focus.",
            Notice::BreakOverWaiting => "Break's over. Resume when you're back.",
        }
    }

    fn entering(phase: Phase) -> Self {
        match phase {
            Phase::Work => Notice::FocusStarted,
            Phase::Break => Notice::BreakStarted,
            Phase::LongBreak => Notice::LongBreakStarted,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Step {
    /// `None` ends the run.
    next: Option<Run>,
    effect: Effect,
    notice: Option<Notice>,
}

/// Seconds left until `ends`, rounded up and never below 1 — a held clock at 0
/// would read as "already over" and transition the moment it is resumed.
fn seconds_left(ends: DateTime<Utc>, now: DateTime<Utc>) -> i64 {
    let ms = (ends - now).num_milliseconds();
    ((ms + 999) / 1000).max(1)
}

/// The single next transition, or `None` when the run is settled.
///
/// Order matters: a passed deadline is handled before reconciling against the
/// session, because a session the driver paused at the last boundary looks
/// exactly like one the user paused by hand.
fn plan(run: &Run, sess: Sess, config: &PomodoroConfig, now: DateTime<Utc>) -> Option<Step> {
    // Stopping the timer — from the panel, the widget, another device — ends
    // the pomodoro with it.
    if sess == Sess::Idle {
        return Some(Step { next: None, effect: Effect::Nothing, notice: None });
    }

    let fresh = |boundary: DateTime<Utc>| (now - boundary).num_seconds() <= STALE_NOTICE_SECS;

    match run.clock {
        Clock::Armed(ends) if ends <= now => {
            let late = (now - ends).num_seconds() > GRACE_SECS;
            if !run.phase.is_break() {
                let done = run.completed.saturating_add(1);
                let next = next_phase(Phase::Work, done, config);
                Some(Step {
                    next: Some(Run {
                        phase: next,
                        completed: done,
                        clock: Clock::Armed(ends + Duration::seconds(phase_seconds(next, config))),
                    }),
                    // As of the boundary, not now: see "Late transitions".
                    effect: if sess == Sess::Running { Effect::PauseAt(ends) } else { Effect::Nothing },
                    notice: fresh(ends).then(|| Notice::entering(next)),
                })
            } else if !late {
                Some(Step {
                    next: Some(Run {
                        phase: Phase::Work,
                        completed: run.completed,
                        clock: Clock::Armed(
                            ends + Duration::seconds(phase_seconds(Phase::Work, config)),
                        ),
                    }),
                    effect: if sess == Sess::Paused { Effect::ResumeAt(ends) } else { Effect::Nothing },
                    notice: Some(Notice::FocusStarted),
                })
            } else {
                Some(Step {
                    next: Some(Run {
                        phase: Phase::Work,
                        completed: run.completed,
                        clock: Clock::Held(phase_seconds(Phase::Work, config)),
                    }),
                    effect: Effect::Nothing,
                    notice: fresh(ends).then_some(Notice::BreakOverWaiting),
                })
            }
        }
        Clock::Armed(ends) => match (run.phase.is_break(), sess) {
            // Timer paused by hand mid-focus: hold the countdown with it.
            (false, Sess::Paused) => Some(Step {
                next: Some(Run { clock: Clock::Held(seconds_left(ends, now)), ..*run }),
                effect: Effect::Nothing,
                notice: None,
            }),
            // Timer resumed by hand mid-break: the user chose to work.
            (true, Sess::Running) => Some(focus_now(run, config, now)),
            _ => None,
        },
        Clock::Held(left) => match (run.phase.is_break(), sess) {
            (false, Sess::Running) => Some(Step {
                next: Some(Run { clock: Clock::Armed(now + Duration::seconds(left.max(1))), ..*run }),
                effect: Effect::Nothing,
                notice: None,
            }),
            (true, Sess::Running) => Some(focus_now(run, config, now)),
            _ => None,
        },
    }
}

fn focus_now(run: &Run, config: &PomodoroConfig, now: DateTime<Utc>) -> Step {
    Step {
        next: Some(Run {
            phase: Phase::Work,
            completed: run.completed,
            clock: Clock::Armed(now + Duration::seconds(phase_seconds(Phase::Work, config))),
        }),
        effect: Effect::Nothing,
        notice: None,
    }
}

/// Skip the rest of the current phase. A skipped focus block still counts —
/// the user decided it was done — so the cycle position stays honest.
fn skip(run: &Run, sess: Sess, config: &PomodoroConfig, now: DateTime<Utc>) -> Step {
    if run.phase.is_break() {
        Step {
            next: Some(Run {
                phase: Phase::Work,
                completed: run.completed,
                clock: Clock::Armed(now + Duration::seconds(phase_seconds(Phase::Work, config))),
            }),
            effect: if sess == Sess::Paused { Effect::ResumeAt(now) } else { Effect::Nothing },
            notice: None,
        }
    } else {
        let done = run.completed.saturating_add(1);
        let next = next_phase(Phase::Work, done, config);
        Step {
            next: Some(Run {
                phase: next,
                completed: done,
                clock: Clock::Armed(now + Duration::seconds(phase_seconds(next, config))),
            }),
            effect: if sess == Sess::Running { Effect::PauseAt(now) } else { Effect::Nothing },
            notice: None,
        }
    }
}

/// Read the run columns. Total, like `config_from_row`: a row that breaks the
/// armed-xor-held invariant reads as "no run" rather than as an error.
fn run_from_row(row: &Value) -> Option<Run> {
    let phase = row.get("run_phase").and_then(Value::as_str).and_then(Phase::parse)?;
    let completed = row
        .get("run_completed")
        .and_then(Value::as_i64)
        .and_then(|n| u32::try_from(n).ok())
        .unwrap_or(0);
    let ends = row
        .get("run_ends_at")
        .and_then(Value::as_str)
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc));
    let held = row.get("run_held_seconds").and_then(Value::as_i64).filter(|n| *n > 0);
    let clock = match (ends, held) {
        (Some(e), None) => Clock::Armed(e),
        (None, Some(h)) => Clock::Held(h),
        _ => return None,
    };
    Some(Run { phase, completed, clock })
}

fn run_body(run: Option<&Run>) -> Value {
    match run {
        None => json!({
            "run_phase": Value::Null,
            "run_completed": 0,
            "run_ends_at": Value::Null,
            "run_held_seconds": Value::Null,
        }),
        Some(r) => {
            let (ends, held) = match r.clock {
                Clock::Armed(e) => (json!(e.to_rfc3339()), Value::Null),
                Clock::Held(h) => (Value::Null, json!(h)),
            };
            json!({
                "run_phase": r.phase.as_str(),
                "run_completed": r.completed,
                "run_ends_at": ends,
                "run_held_seconds": held,
            })
        }
    }
}

// ── the live run: what the UI sees ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct RunView {
    pub phase: Phase,
    pub completed: u32,
    /// Focus blocks finished in the current cycle, for the dots. A long break
    /// shows a full cycle rather than an empty one.
    pub done_in_cycle: u32,
    /// RFC3339; set while the clock runs. The UI derives the countdown from it
    /// so every window and device shows the same second.
    pub ends_at: Option<String>,
    /// Set while the clock is held.
    pub held_seconds: Option<i64>,
    /// Length of the current phase under the current config, for the ring.
    pub total_seconds: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PomodoroStatus {
    pub config: PomodoroConfig,
    pub run: Option<RunView>,
    pub session: SessionStatus,
}

fn view_of(run: &Run, config: &PomodoroConfig) -> RunView {
    let per = config.sessions_per_cycle.max(1);
    let (ends_at, held_seconds) = match run.clock {
        Clock::Armed(e) => (Some(e.to_rfc3339()), None),
        Clock::Held(h) => (None, Some(h)),
    };
    RunView {
        phase: run.phase,
        completed: run.completed,
        done_in_cycle: if run.phase == Phase::LongBreak { per } else { run.completed % per },
        ends_at,
        held_seconds,
        total_seconds: phase_seconds(run.phase, config),
    }
}

// ── the live run: remote plumbing ────────────────────────────────────────────

struct Snapshot {
    config: PomodoroConfig,
    run: Option<Run>,
    rev: i64,
    has_row: bool,
    session: Option<ActiveRow>,
}

impl Snapshot {
    fn status(&self, now: DateTime<Utc>) -> PomodoroStatus {
        PomodoroStatus {
            config: self.config.clone(),
            run: self.run.as_ref().map(|r| view_of(r, &self.config)),
            session: session::status_of(self.session.as_ref(), now),
        }
    }
}

async fn read_snapshot(rest: &Rest) -> Result<Snapshot, String> {
    let user = eq(rest.user_id());
    let query = [("user_id", user.as_str()), ("select", "*"), ("limit", "1")];
    let (rows, active) = tokio::join!(
        rest.select(T_POMODORO_CONFIG, &query),
        session::fetch_active(rest)
    );
    let rows = rows?;
    let row = rows.as_array().and_then(|r| r.first());
    Ok(Snapshot {
        config: row.map(config_from_row).unwrap_or_default(),
        run: row.and_then(run_from_row),
        rev: row.and_then(|r| r.get("run_rev")).and_then(Value::as_i64).unwrap_or(0),
        has_row: row.is_some(),
        session: active?,
    })
}

/// Compare-and-swap the run. `false` means another writer moved `run_rev`
/// first (or the row is gone) — re-read, don't retry blind.
async fn write_run(rest: &Rest, rev: i64, run: Option<&Run>) -> Result<bool, String> {
    let user = eq(rest.user_id());
    let expected = eq(&rev.to_string());
    let mut body = run_body(run);
    body["run_rev"] = json!(rev + 1);
    body["updated_at"] = json!(now_rfc3339());
    let updated = rest
        .update(
            T_POMODORO_CONFIG,
            &[("user_id", user.as_str()), ("run_rev", expected.as_str())],
            &body,
        )
        .await
        .map_err(migration_hint)?;
    Ok(updated.as_array().is_some_and(|rows| !rows.is_empty()))
}

/// The CAS needs a row to match. A fresh install has none until the first
/// config save, so create it with the defaults.
async fn ensure_row(rest: &Rest) -> Result<(), String> {
    rest.upsert(T_POMODORO_CONFIG, "user_id", &json!([{ "user_id": rest.user_id() }]))
        .await
        .map(|_| ())
}

/// Until `20261028120000_pomodoro_run_state.sql` is applied, every run write
/// fails on an unknown column. Say which file fixes it.
fn migration_hint(err: String) -> String {
    if err.contains("run_") {
        format!("{err} — apply supabase/migrations/20261028120000_pomodoro_run_state.sql")
    } else {
        err
    }
}

async fn apply_effect(
    rest: &Rest,
    row: Option<&ActiveRow>,
    effect: Effect,
    now: DateTime<Utc>,
) -> Result<(), String> {
    match (effect, row) {
        (Effect::PauseAt(at), Some(r)) if !r.is_paused() => {
            session::pause_row(rest, r, at, now).await.map(|_| ())
        }
        (Effect::ResumeAt(at), Some(r)) if r.is_paused() => {
            session::resume_row(rest, r, at, now).await.map(|_| ())
        }
        _ => Ok(()),
    }
}

/// Serialises every run mutation in this process. The CAS already makes
/// cross-device races safe; this just keeps the driver and a button press in
/// the same app from burning a round trip losing to each other.
static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Apply every due transition, then report the settled state and whatever
/// notices this process won the right to fire.
async fn reconcile(rest: &Rest) -> Result<(PomodoroStatus, Vec<Notice>), String> {
    let mut notices = Vec::new();
    for _ in 0..MAX_STEPS {
        let snap = read_snapshot(rest).await?;
        let now = Utc::now();
        let step = snap
            .run
            .as_ref()
            .and_then(|run| plan(run, sess_of(snap.session.as_ref()), &snap.config, now));
        let Some(step) = step else {
            return Ok((snap.status(now), notices));
        };
        apply_effect(rest, snap.session.as_ref(), step.effect, now).await?;
        if write_run(rest, snap.rev, step.next.as_ref()).await? {
            notices.extend(step.notice);
        }
    }
    Err("pomodoro: the run did not settle".to_string())
}

fn configured_rest() -> Result<Rest, String> {
    let rest = Rest::load();
    if rest.is_configured() {
        Ok(rest)
    } else {
        Err("pomodoro: supabase is not configured (~/.nexuslocalrc)".to_string())
    }
}

/// Reconcile, tell every window, and fire the notices.
async fn settle(app: &AppHandle, rest: &Rest) -> Result<PomodoroStatus, String> {
    let (status, notices) = reconcile(rest).await?;
    publish(app, &status, &notices);
    Ok(status)
}

fn publish(app: &AppHandle, status: &PomodoroStatus, notices: &[Notice]) {
    let _ = app.emit(STATUS_EVENT, status);
    #[cfg(desktop)]
    for notice in notices {
        alert::announce(app, *notice, status.session.task_name.as_deref());
    }
    #[cfg(not(desktop))]
    let _ = notices;
}

// ── the live run: commands ───────────────────────────────────────────────────

/// Current run and session, after applying any transition that is due.
#[tauri::command]
pub async fn tt_pomodoro_status(app: AppHandle) -> Result<PomodoroStatus, String> {
    let rest = configured_rest()?;
    let _guard = LOCK.lock().await;
    settle(&app, &rest).await
}

/// One click: start a focus block, starting (or resuming) the timer if it is
/// not already running. `task_name` is only needed when the timer is idle.
#[tauri::command]
pub async fn tt_pomodoro_start(
    app: AppHandle,
    task_name: Option<String>,
    project: Option<String>,
) -> Result<PomodoroStatus, String> {
    let rest = configured_rest()?;
    let _guard = LOCK.lock().await;
    let snap = read_snapshot(&rest).await?;
    let now = Utc::now();

    let task_name = task_name.unwrap_or_default();
    if snap.session.is_none() && task_name.trim().is_empty() {
        return Err("What are you working on? A focus block needs a task name.".to_string());
    }

    // Run first, session second. If the session call then fails, the next
    // reconcile sees a run over an idle (or still-paused) timer and unwinds
    // it — the reverse order would leave a timer running with no pomodoro.
    if !snap.has_row {
        ensure_row(&rest).await?;
    }
    let run = Run {
        phase: Phase::Work,
        completed: 0,
        clock: Clock::Armed(now + Duration::seconds(phase_seconds(Phase::Work, &snap.config))),
    };
    if !write_run(&rest, snap.rev, Some(&run)).await? {
        return Err(RUN_MOVED.to_string());
    }
    match &snap.session {
        None => {
            session::start(&rest, &task_name, project, now).await?;
        }
        Some(row) if row.is_paused() => {
            session::resume_row(&rest, row, now, now).await?;
        }
        Some(_) => {}
    }

    #[cfg(desktop)]
    let _ = crate::float::show(&app);
    settle(&app, &rest).await
}

/// Hold the countdown. In a focus block this pauses the timer too.
#[tauri::command]
pub async fn tt_pomodoro_pause(app: AppHandle) -> Result<PomodoroStatus, String> {
    mutate(app, |run, sess, _config, now| match run.clock {
        Clock::Armed(ends) => Ok(Step {
            next: Some(Run { clock: Clock::Held(seconds_left(ends, now)), ..*run }),
            effect: if !run.phase.is_break() && sess == Sess::Running {
                Effect::PauseAt(now)
            } else {
                Effect::Nothing
            },
            notice: None,
        }),
        Clock::Held(_) => Err("The pomodoro is already paused".to_string()),
    })
    .await
}

/// Restart a held countdown. In a focus block this resumes the timer too.
#[tauri::command]
pub async fn tt_pomodoro_resume(app: AppHandle) -> Result<PomodoroStatus, String> {
    mutate(app, |run, sess, _config, now| match run.clock {
        Clock::Held(left) => Ok(Step {
            next: Some(Run { clock: Clock::Armed(now + Duration::seconds(left)), ..*run }),
            effect: if !run.phase.is_break() && sess == Sess::Paused {
                Effect::ResumeAt(now)
            } else {
                Effect::Nothing
            },
            notice: None,
        }),
        Clock::Armed(_) => Err("The pomodoro is not paused".to_string()),
    })
    .await
}

/// End the current phase now and move to the next.
#[tauri::command]
pub async fn tt_pomodoro_skip(app: AppHandle) -> Result<PomodoroStatus, String> {
    mutate(app, |run, sess, config, now| Ok(skip(run, sess, config, now))).await
}

/// End the pomodoro and stop the timer, logging the entry.
#[tauri::command]
pub async fn tt_pomodoro_end(app: AppHandle) -> Result<PomodoroStatus, String> {
    let rest = configured_rest()?;
    let _guard = LOCK.lock().await;
    let snap = read_snapshot(&rest).await?;
    if snap.run.is_some() && !write_run(&rest, snap.rev, None).await? {
        return Err(RUN_MOVED.to_string());
    }
    if let Some(row) = &snap.session {
        session::stop_row(&rest, row, Utc::now()).await?;
    }
    settle(&app, &rest).await
}

/// Shared shape of pause / resume / skip: read, compute a step from the
/// current run, write the run (CAS), then apply the session effect — the same
/// run-first order as `tt_pomodoro_start`, for the same reason.
async fn mutate(
    app: AppHandle,
    decide: impl FnOnce(&Run, Sess, &PomodoroConfig, DateTime<Utc>) -> Result<Step, String>,
) -> Result<PomodoroStatus, String> {
    let rest = configured_rest()?;
    let _guard = LOCK.lock().await;
    let snap = read_snapshot(&rest).await?;
    let now = Utc::now();
    let run = snap.run.as_ref().ok_or(NO_RUN)?;
    let step = decide(run, sess_of(snap.session.as_ref()), &snap.config, now)?;
    if !write_run(&rest, snap.rev, step.next.as_ref()).await? {
        return Err(RUN_MOVED.to_string());
    }
    apply_effect(&rest, snap.session.as_ref(), step.effect, now).await?;
    settle(&app, &rest).await
}

// ── the desktop driver ───────────────────────────────────────────────────────

/// Keep the run moving while no window is looking: wake at each deadline
/// (capped, so a session paused from the phone is noticed within seconds),
/// reconcile, and broadcast when anything changed.
///
/// Lives in the app, not the `--daemon` process: notifications and the
/// floating window both need Tauri, which the daemon never initialises. Quit
/// the app and the cycle stops advancing — and catches up correctly, as of each
/// boundary, the next time anything reconciles.
#[cfg(desktop)]
pub fn spawn_driver(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut memory = DriverMemory::default();
        loop {
            let wait = drive_once(&app, &mut memory).await;
            tokio::time::sleep(wait).await;
        }
    });
}

/// What the driver saw last time round.
#[cfg(desktop)]
#[derive(Default)]
struct DriverMemory {
    /// Serialized status, so an unchanged one is not re-broadcast.
    json: String,
    had_run: bool,
}

#[cfg(desktop)]
async fn drive_once(app: &AppHandle, memory: &mut DriverMemory) -> std::time::Duration {
    use std::time::Duration as Wait;

    let rest = Rest::load();
    if !rest.is_configured() {
        return Wait::from_secs(60);
    }
    let result = {
        let _guard = LOCK.lock().await;
        reconcile(&rest).await
    };
    match result {
        Ok((status, notices)) => {
            let json = serde_json::to_string(&status).unwrap_or_default();
            if json != memory.json || !notices.is_empty() {
                publish(app, &status, &notices);
                memory.json = json;
            }
            // A run this process did not start — from the phone, or one still
            // going when the app launched — gets the floating window too. Only
            // on the edge, so hiding it mid-run sticks.
            let has_run = status.run.is_some();
            if has_run && !memory.had_run {
                let _ = crate::float::show(app);
            }
            memory.had_run = has_run;
            next_wake(&status, Utc::now())
        }
        Err(e) => {
            eprintln!("[pomodoro] {e}");
            Wait::from_secs(30)
        }
    }
}

/// Just past the deadline when one is near; otherwise a poll slow enough to be
/// free and fast enough that a pause from the phone lands within one.
#[cfg(desktop)]
fn next_wake(status: &PomodoroStatus, now: DateTime<Utc>) -> std::time::Duration {
    use std::time::Duration as Wait;

    let poll = if status.run.is_some() { Wait::from_secs(15) } else { Wait::from_secs(30) };
    let deadline = status
        .run
        .as_ref()
        .and_then(|r| r.ends_at.as_deref())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc));
    match deadline {
        Some(ends) => {
            let ms = (ends - now).num_milliseconds().max(0) as u64 + 250;
            Wait::from_millis(ms).min(poll)
        }
        None => poll,
    }
}

/// Notification + chime for a phase change. Desktop-only: the phone's WebView
/// is suspended in the background, so a notification fired from here would
/// arrive exactly when it is no longer news.
#[cfg(desktop)]
mod alert {
    use super::Notice;
    use tauri::AppHandle;
    use tauri_plugin_notification::NotificationExt;

    pub fn announce(app: &AppHandle, notice: Notice, task: Option<&str>) {
        let body = match task {
            Some(t) if !t.is_empty() && notice != Notice::BreakOverWaiting => {
                format!("{} ({t})", notice.message())
            }
            _ => notice.message().to_string(),
        };
        if let Err(e) = app.notification().builder().title("Pomodoro").body(body).show() {
            eprintln!("[pomodoro] notification failed: {e}");
        }
        chime(notice);
    }

    /// Played directly rather than as the notification's sound, so it still
    /// sounds when notifications are denied or banners are off.
    #[cfg(target_os = "macos")]
    fn chime(notice: Notice) {
        let sound = match notice {
            Notice::FocusStarted | Notice::BreakOverWaiting => "Hero",
            Notice::BreakStarted | Notice::LongBreakStarted => "Glass",
        };
        // Waited on from a throwaway thread: a dropped `Child` is never reaped,
        // and a day of pomodoros would leave a zombie per chime.
        let path = format!("/System/Library/Sounds/{sound}.aiff");
        std::thread::spawn(move || {
            let _ = std::process::Command::new("/usr/bin/afplay").arg(path).status();
        });
    }

    #[cfg(not(target_os = "macos"))]
    fn chime(_notice: Notice) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> PomodoroConfig {
        PomodoroConfig::default()
    }

    #[test]
    fn defaults_are_the_classic_pomodoro() {
        let c = cfg();
        assert!(!c.enabled);
        assert_eq!(c.work_minutes, 25);
        assert_eq!(c.break_minutes, 5);
        assert_eq!(c.long_break_minutes, 15);
        assert_eq!(c.sessions_per_cycle, 4);
        assert!(validate(&c).is_ok());
    }

    #[test]
    fn zero_durations_are_rejected_by_name() {
        for (mutate, field) in [
            ((|c: &mut PomodoroConfig| c.work_minutes = 0) as fn(&mut PomodoroConfig), "work_minutes"),
            (|c| c.break_minutes = 0, "break_minutes"),
            (|c| c.long_break_minutes = 0, "long_break_minutes"),
            (|c| c.sessions_per_cycle = 0, "sessions_per_cycle"),
        ] {
            let mut c = cfg();
            mutate(&mut c);
            let err = validate(&c).expect_err("zero should be rejected");
            assert!(err.contains(field), "{err} should name {field}");
        }
    }

    #[test]
    fn a_one_minute_cycle_is_allowed() {
        // Deliberately no upper bound and no opinion beyond ">= 1": a 1/1/1
        // config is a legitimate way to test the ring.
        let c = PomodoroConfig {
            enabled: true,
            work_minutes: 1,
            break_minutes: 1,
            long_break_minutes: 1,
            sessions_per_cycle: 1,
        };
        assert!(validate(&c).is_ok());
    }

    /// The TS side sends and receives these exact keys. Camel-casing them there
    /// yields `missing field 'work_minutes'`, which is why this is pinned.
    #[test]
    fn wire_shape_is_snake_case() {
        let json = serde_json::to_value(cfg()).unwrap();
        for key in [
            "enabled",
            "work_minutes",
            "break_minutes",
            "long_break_minutes",
            "sessions_per_cycle",
        ] {
            assert!(json.get(key).is_some(), "missing {key} on the wire");
        }
    }

    /// Rows come back with `user_id` and `updated_at` attached; reading must
    /// ignore them rather than fail.
    #[test]
    fn row_with_extra_columns_reads() {
        let row = json!({
            "user_id": "default",
            "enabled": true,
            "work_minutes": 50,
            "break_minutes": 10,
            "long_break_minutes": 30,
            "sessions_per_cycle": 3,
            "updated_at": "2026-01-01T00:00:00Z",
        });
        let parsed = config_from_row(&row);
        assert_eq!(parsed.work_minutes, 50);
        assert_eq!(parsed.break_minutes, 10);
        assert_eq!(parsed.long_break_minutes, 30);
        assert_eq!(parsed.sessions_per_cycle, 3);
        assert!(parsed.enabled);
    }

    /// The columns are nullable and `integer` is signed. Reading must stay total
    /// — an error here would leave the panel holding defaults it never read,
    /// and its next write would overwrite the row it failed to parse.
    #[test]
    fn junk_row_falls_back_field_by_field() {
        let row = json!({
            "user_id": "default",
            "enabled": null,
            "work_minutes": null,
            "break_minutes": -5,
            "long_break_minutes": 0,
            "sessions_per_cycle": 7,
        });
        let parsed = config_from_row(&row);
        let d = PomodoroConfig::default();
        assert!(!parsed.enabled);
        assert_eq!(parsed.work_minutes, d.work_minutes);
        assert_eq!(parsed.break_minutes, d.break_minutes);
        assert_eq!(parsed.long_break_minutes, d.long_break_minutes);
        // The one good field survives — fallback is per-field, not all-or-nothing.
        assert_eq!(parsed.sessions_per_cycle, 7);
    }

    /// The column type is unit 1's to choose, and PostgREST renders `numeric`
    /// and `real` as JSON floats. A valid setting must not fall back merely
    /// because it arrived as `25.0`.
    #[test]
    fn float_columns_are_read_not_discarded() {
        let row = json!({ "work_minutes": 25.0, "break_minutes": 7.9 });
        let parsed = config_from_row(&row);
        assert_eq!(parsed.work_minutes, 25);
        assert_eq!(parsed.break_minutes, 7); // floored, as `sanitizeConfig` does
    }

    /// Anything the panel can't send must still not blow up the read.
    #[test]
    fn out_of_range_values_fall_back() {
        let row = json!({
            "work_minutes": 5_000_000_000i64, // > u32::MAX
            "break_minutes": "twenty",
            "long_break_minutes": true,
        });
        let parsed = config_from_row(&row);
        let d = PomodoroConfig::default();
        assert_eq!(parsed.work_minutes, d.work_minutes);
        assert_eq!(parsed.break_minutes, d.break_minutes);
        assert_eq!(parsed.long_break_minutes, d.long_break_minutes);
    }

    #[test]
    fn empty_row_is_the_default_config() {
        assert_eq!(config_from_row(&json!({})), PomodoroConfig::default());
    }

    // ── the live run ─────────────────────────────────────────────────────────

    fn t(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn armed(phase: Phase, completed: u32, ends: &str) -> Run {
        Run { phase, completed, clock: Clock::Armed(t(ends)) }
    }

    #[test]
    fn a_settled_run_plans_nothing() {
        let run = armed(Phase::Work, 0, "2026-10-28T12:25:00Z");
        assert_eq!(plan(&run, Sess::Running, &cfg(), t("2026-10-28T12:10:00Z")), None);
        let brk = armed(Phase::Break, 1, "2026-10-28T12:30:00Z");
        assert_eq!(plan(&brk, Sess::Paused, &cfg(), t("2026-10-28T12:27:00Z")), None);
    }

    #[test]
    fn stopping_the_timer_ends_the_run() {
        let run = armed(Phase::Work, 2, "2026-10-28T12:25:00Z");
        let step = plan(&run, Sess::Idle, &cfg(), t("2026-10-28T12:10:00Z")).unwrap();
        assert_eq!(step.next, None);
        assert_eq!(step.effect, Effect::Nothing);
    }

    /// The core promise: a break pauses tracking, and the pause lands at the
    /// boundary even when the driver is late — a nap is not focus.
    #[test]
    fn focus_ending_pauses_the_session_at_the_boundary() {
        let run = armed(Phase::Work, 0, "2026-10-28T12:25:00Z");
        let now = t("2026-10-28T12:40:00Z"); // woke 15 minutes late
        let step = plan(&run, Sess::Running, &cfg(), now).unwrap();
        assert_eq!(step.effect, Effect::PauseAt(t("2026-10-28T12:25:00Z")));
        assert_eq!(
            step.next,
            Some(armed(Phase::Break, 1, "2026-10-28T12:30:00Z")),
            "the break is timed from the boundary too"
        );
        assert_eq!(step.notice, Some(Notice::BreakStarted));
    }

    #[test]
    fn the_last_block_of_a_cycle_earns_the_long_break() {
        let run = armed(Phase::Work, 3, "2026-10-28T12:25:00Z");
        let step = plan(&run, Sess::Running, &cfg(), t("2026-10-28T12:25:01Z")).unwrap();
        let next = step.next.unwrap();
        assert_eq!(next.phase, Phase::LongBreak);
        assert_eq!(next.completed, 4);
        assert_eq!(next.clock, Clock::Armed(t("2026-10-28T12:40:00Z")));
        assert_eq!(step.notice, Some(Notice::LongBreakStarted));
    }

    #[test]
    fn a_break_ending_on_time_resumes_the_session_at_the_boundary() {
        let run = armed(Phase::Break, 1, "2026-10-28T12:30:00Z");
        let step = plan(&run, Sess::Paused, &cfg(), t("2026-10-28T12:30:40Z")).unwrap();
        assert_eq!(step.effect, Effect::ResumeAt(t("2026-10-28T12:30:00Z")));
        assert_eq!(step.next, Some(armed(Phase::Work, 1, "2026-10-28T12:55:00Z")));
        assert_eq!(step.notice, Some(Notice::FocusStarted));
    }

    /// Never resume tracked time for someone who is not there.
    #[test]
    fn a_break_observed_late_parks_the_next_block_instead() {
        let run = armed(Phase::Break, 1, "2026-10-28T12:30:00Z");
        let now = t("2026-10-28T12:30:00Z") + Duration::seconds(GRACE_SECS + 1);
        let step = plan(&run, Sess::Paused, &cfg(), now).unwrap();
        assert_eq!(step.effect, Effect::Nothing);
        assert_eq!(
            step.next,
            Some(Run { phase: Phase::Work, completed: 1, clock: Clock::Held(25 * 60) })
        );
        assert_eq!(step.notice, Some(Notice::BreakOverWaiting));
    }

    /// A Mac asleep through focus *and* break settles in two steps: pause at
    /// the focus boundary, then park. Nothing after 12:25 is billed.
    #[test]
    fn a_long_sleep_settles_without_billing_the_gap() {
        let c = cfg();
        let now = t("2026-10-28T18:00:00Z");
        let run = armed(Phase::Work, 0, "2026-10-28T12:25:00Z");

        let first = plan(&run, Sess::Running, &c, now).unwrap();
        assert_eq!(first.effect, Effect::PauseAt(t("2026-10-28T12:25:00Z")));
        assert_eq!(first.notice, None, "a notice from hours ago is noise");

        let second = plan(&first.next.unwrap(), Sess::Paused, &c, now).unwrap();
        assert_eq!(second.effect, Effect::Nothing);
        assert_eq!(second.notice, None);
        let parked = second.next.unwrap();
        assert_eq!(parked.clock, Clock::Held(25 * 60));

        assert_eq!(plan(&parked, Sess::Paused, &c, now), None, "and then it stays put");
    }

    #[test]
    fn pausing_the_timer_by_hand_holds_the_countdown() {
        let run = armed(Phase::Work, 0, "2026-10-28T12:25:00Z");
        let step = plan(&run, Sess::Paused, &cfg(), t("2026-10-28T12:15:30.500Z")).unwrap();
        assert_eq!(step.next.unwrap().clock, Clock::Held(570), "rounded up");
        assert_eq!(step.effect, Effect::Nothing);
    }

    #[test]
    fn resuming_the_timer_by_hand_rearms_a_held_block() {
        let run = Run { phase: Phase::Work, completed: 0, clock: Clock::Held(570) };
        let now = t("2026-10-28T13:00:00Z");
        let step = plan(&run, Sess::Running, &cfg(), now).unwrap();
        assert_eq!(step.next.unwrap().clock, Clock::Armed(t("2026-10-28T13:09:30Z")));
    }

    #[test]
    fn resuming_the_timer_during_a_break_starts_focus() {
        let run = armed(Phase::Break, 1, "2026-10-28T12:30:00Z");
        let now = t("2026-10-28T12:27:00Z");
        let step = plan(&run, Sess::Running, &cfg(), now).unwrap();
        assert_eq!(step.next, Some(armed(Phase::Work, 1, "2026-10-28T12:52:00Z")));
    }

    #[test]
    fn skipping_focus_counts_it_and_pauses_now() {
        let run = armed(Phase::Work, 0, "2026-10-28T12:25:00Z");
        let now = t("2026-10-28T12:20:00Z");
        let step = skip(&run, Sess::Running, &cfg(), now);
        assert_eq!(step.effect, Effect::PauseAt(now));
        assert_eq!(step.next, Some(armed(Phase::Break, 1, "2026-10-28T12:25:00Z")));
    }

    #[test]
    fn skipping_a_break_resumes_now() {
        let run = armed(Phase::Break, 1, "2026-10-28T12:30:00Z");
        let now = t("2026-10-28T12:27:00Z");
        let step = skip(&run, Sess::Paused, &cfg(), now);
        assert_eq!(step.effect, Effect::ResumeAt(now));
        assert_eq!(step.next, Some(armed(Phase::Work, 1, "2026-10-28T12:52:00Z")));
    }

    #[test]
    fn run_columns_round_trip() {
        for run in [
            armed(Phase::LongBreak, 4, "2026-10-28T12:40:00Z"),
            Run { phase: Phase::Work, completed: 2, clock: Clock::Held(300) },
        ] {
            let mut row = run_body(Some(&run));
            row["run_rev"] = json!(7);
            assert_eq!(run_from_row(&row), Some(run));
        }
        assert_eq!(run_from_row(&run_body(None)), None);
    }

    /// PostgREST renders `timestamptz` with microseconds and `+00:00`.
    #[test]
    fn run_reads_postgrest_timestamps() {
        let row = json!({
            "run_phase": "work",
            "run_completed": 1,
            "run_ends_at": "2026-10-28T12:25:00.123456+00:00",
            "run_held_seconds": null,
        });
        let run = run_from_row(&row).unwrap();
        assert_eq!(run.clock, Clock::Armed(t("2026-10-28T12:25:00.123456Z")));
    }

    /// Armed xor held. Anything else is a broken row and reads as no run.
    #[test]
    fn a_row_breaking_the_invariant_reads_as_no_run() {
        let both = json!({
            "run_phase": "work",
            "run_ends_at": "2026-10-28T12:25:00Z",
            "run_held_seconds": 30,
        });
        let neither = json!({ "run_phase": "break" });
        let junk_phase = json!({ "run_phase": "nap", "run_held_seconds": 30 });
        // Pre-migration rows have no run columns at all.
        let legacy = json!({ "user_id": "default", "work_minutes": 25 });
        for row in [both, neither, junk_phase, legacy] {
            assert_eq!(run_from_row(&row), None, "{row}");
        }
    }

    #[test]
    fn the_long_break_shows_a_full_cycle() {
        let c = cfg();
        let long = view_of(&armed(Phase::LongBreak, 4, "2026-10-28T12:40:00Z"), &c);
        assert_eq!(long.done_in_cycle, 4);
        let work = view_of(&armed(Phase::Work, 5, "2026-10-28T13:05:00Z"), &c);
        assert_eq!(work.done_in_cycle, 1);
        assert_eq!(work.total_seconds, 25 * 60);
    }

    /// The UI reads these exact strings off the event payload.
    #[test]
    fn phase_wire_names_match_the_columns() {
        for phase in [Phase::Work, Phase::Break, Phase::LongBreak] {
            assert_eq!(serde_json::to_value(phase).unwrap(), json!(phase.as_str()));
            assert_eq!(Phase::parse(phase.as_str()), Some(phase));
        }
    }
}
