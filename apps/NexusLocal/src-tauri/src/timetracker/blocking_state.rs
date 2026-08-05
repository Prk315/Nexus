//! The materialized blocking verdict — one row, computed server-side.
//!
//! STUB (work unit 8 owns the producer; this is the Rust consumer).
//!
//! `focus-evaluate` runs on pg_cron every 5 minutes and collapses
//! `focus_blocks` + `unlock_rules` + `blocked_sites` + `blocked_apps` + today's
//! `time_entries` into a single row per user:
//!
//! ```text
//! blocking_state(user_id, effective_domains jsonb, effective_processes jsonb,
//!                reasons jsonb, computed_at timestamptz)
//! ```
//!
//! Every client — the iPhone widget, the Mac grid node, the app UI — reads this
//! and acts. None of them re-derive it. That is the whole point: a schedule
//! window can open and a reward can unlock while every device is asleep, and the
//! next client to wake sees the answer already computed.

use super::{Rest, T_BLOCKING_STATE};
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

const UNIMPLEMENTED: &str = "timetracker::blocking_state is not implemented yet (work unit 8)";

#[tauri::command]
pub async fn tt_blocking_state() -> Result<BlockingState, String> {
    let _ = (Rest::load(), T_BLOCKING_STATE);
    Err(UNIMPLEMENTED.to_string())
}
