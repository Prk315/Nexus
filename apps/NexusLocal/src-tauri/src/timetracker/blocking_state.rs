//! The materialized blocking verdict — one row, computed server-side.
//!
//! `focus-evaluate` (`supabase/functions/focus-evaluate/`) runs on pg_cron every
//! 5 minutes and collapses `focus_blocks` + `unlock_rules` + `blocked_sites` +
//! `blocked_apps` + today's `time_entries` into a single row per user:
//!
//! ```text
//! blocking_state(user_id, effective_domains jsonb, effective_processes jsonb,
//!                reasons jsonb, today_minutes integer, computed_at timestamptz)
//! ```
//!
//! Every client — the iPhone widget, the Mac grid node, the app UI — reads this
//! and acts. None of them re-derive it. That is the whole point: a schedule
//! window can open and a reward can unlock while every device is asleep, and the
//! next client to wake sees the answer already computed.
//!
//! # This module is read-only
//!
//! Nothing here writes `blocking_state`. The edge function is its sole writer;
//! a client that recomputed the verdict locally would be a second source of
//! truth that disagrees the moment the device sleeps.
//!
//! # Why a missing row is an error
//!
//! [`tt_blocking_state`] returns `Err` when no row exists rather than an empty
//! [`BlockingState`]. An empty verdict and a never-computed verdict are
//! indistinguishable to a caller that only looks at `effective_domains`, and the
//! failure mode is that enforcement silently switches off. Callers that want to
//! render "not computed yet" should match on the error; callers that enforce
//! should keep their previous state. Stale blocking beats absent blocking.
//!
//! Pure HTTP — no iOS FFI, so no `#[cfg(not(target_os = "ios"))]` arm is needed;
//! this compiles unchanged for desktop and `aarch64-apple-ios`.

use super::{eq, Rest, T_BLOCKING_STATE};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BlockingState {
    #[serde(default)]
    pub effective_domains: Vec<String>,
    #[serde(default)]
    pub effective_processes: Vec<String>,
    /// Why each target is blocked or unlocked — for the UI, not for logic.
    #[serde(default)]
    pub reasons: serde_json::Value,
    pub computed_at: Option<String>,
}

/// Columns to fetch. Named explicitly rather than `*` so an added column can
/// never change what this deserializes.
const COLUMNS: &str = "effective_domains,effective_processes,reasons,computed_at";

#[tauri::command]
pub async fn tt_blocking_state() -> Result<BlockingState, String> {
    fetch(&Rest::load()).await
}

async fn fetch(rest: &Rest) -> Result<BlockingState, String> {
    if !rest.is_configured() {
        return Err(
            "supabase is not configured — set supabase.url and supabase.key in ~/.nexuslocalrc"
                .to_string(),
        );
    }

    let user_filter = eq(rest.user_id());
    let rows = rest
        .select(
            T_BLOCKING_STATE,
            &[
                ("user_id", user_filter.as_str()),
                ("select", COLUMNS),
                ("limit", "1"),
            ],
        )
        .await?;

    parse_row(&rows, rest.user_id())
}

/// Split out from [`fetch`] so the parsing rules are testable without a network.
fn parse_row(rows: &serde_json::Value, user_id: &str) -> Result<BlockingState, String> {
    let row = rows
        .as_array()
        .and_then(|rows| rows.first())
        .ok_or_else(|| {
            format!(
                "no blocking_state row for user '{user_id}' — the focus-evaluate \
                 edge function has not run yet (it is scheduled on pg_cron as \
                 'nexus-focus-evaluate'). Treat this as 'unknown', not 'nothing blocked'."
            )
        })?;

    serde_json::from_value::<BlockingState>(row.clone())
        .map_err(|e| format!("blocking_state row for user '{user_id}' did not deserialize: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_a_full_row() {
        let rows = json!([{
            "effective_domains": ["reddit.com", "youtube.com"],
            "effective_processes": ["Slack"],
            "reasons": {
                "youtube.com": { "blocked": true, "source": "focus_block", "block_name": "Deep work" }
            },
            "computed_at": "2026-08-05T12:00:00+00:00",
        }]);

        let state = parse_row(&rows, "default").expect("row should parse");
        assert_eq!(state.effective_domains, vec!["reddit.com", "youtube.com"]);
        assert_eq!(state.effective_processes, vec!["Slack"]);
        assert_eq!(
            state.computed_at.as_deref(),
            Some("2026-08-05T12:00:00+00:00")
        );
        assert_eq!(state.reasons["youtube.com"]["source"], "focus_block");
    }

    #[test]
    fn an_empty_verdict_is_still_a_verdict() {
        // Nothing blocked right now — distinct from "never computed".
        let rows = json!([{
            "effective_domains": [],
            "effective_processes": [],
            "reasons": {},
            "computed_at": "2026-08-05T12:00:00+00:00",
        }]);

        let state = parse_row(&rows, "default").expect("row should parse");
        assert!(state.effective_domains.is_empty());
        assert!(state.computed_at.is_some());
    }

    #[test]
    fn a_missing_row_is_an_error_not_an_empty_state() {
        // The whole point: enforcement must not read "no row" as "unblock all".
        let err = parse_row(&json!([]), "default").expect_err("empty result must error");
        assert!(err.contains("focus-evaluate"), "message should say why: {err}");
    }

    #[test]
    fn extra_columns_are_ignored() {
        // today_minutes exists in the table but not in this struct; adding a
        // column upstream must not break the read.
        let rows = json!([{
            "effective_domains": ["x.com"],
            "effective_processes": [],
            "reasons": {},
            "today_minutes": 72,
            "computed_at": "2026-08-05T12:00:00+00:00",
        }]);
        let state = parse_row(&rows, "default").expect("row should parse");
        assert_eq!(state.effective_domains, vec!["x.com"]);
    }

    #[test]
    fn null_jsonb_columns_fall_back_to_defaults() {
        let rows = json!([{ "computed_at": null }]);
        let state = parse_row(&rows, "default").expect("row should parse");
        assert!(state.effective_domains.is_empty());
        assert!(state.computed_at.is_none());
    }
}
