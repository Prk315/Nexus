//! Pomodoro configuration, persisted to Supabase.
//!
//! The phase machine itself lives in TypeScript (`src/lib/timetracker/pomodoro.ts`)
//! — a 1s interval is a WebView concern, not a Rust one. What Rust owns is durable
//! config, because TimeTracker's version kept pomodoro settings in a Redux slice
//! with no persistence call, so every duration reset to the default on launch.
//!
//! No `#[cfg(target_os = "ios")]` split here: this is plain HTTP against
//! PostgREST, identical on both targets. Gating it would disable pomodoro on the
//! one platform this app actually ships to.

use super::{eq, now_rfc3339, Rest, T_POMODORO_CONFIG};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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
}
