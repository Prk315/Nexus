//! Rewards — unlock a blocked app or site by tracking N minutes today.
//!
//! STUB (work unit 7).
//!
//! There is no balance and nothing is spent: the "currency" is minutes of
//! *completed* time entries today, and a rule is satisfied while
//! `today_minutes >= required_minutes`. Unlocks reset at local midnight because
//! the evaluation is date-scoped.
//!
//! Whether a rule is currently satisfied is decided by the `focus-evaluate` edge
//! function and published in `blocking_state`. This module is CRUD over the rules
//! plus a read of that verdict — it must not recompute thresholds client-side, or
//! the phone and the Mac will disagree about what is blocked.

use super::{Rest, T_UNLOCK_RULES};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnlockRule {
    pub id: Option<String>,
    /// Exactly one of `process_name` / `domain` is set.
    pub process_name: Option<String>,
    pub domain: Option<String>,
    pub required_minutes: i64,
    pub enabled: bool,
}

const UNIMPLEMENTED: &str = "timetracker::rewards is not implemented yet (work unit 7)";

#[tauri::command]
pub async fn tt_unlock_rules() -> Result<Vec<UnlockRule>, String> {
    let _ = (Rest::load(), T_UNLOCK_RULES);
    Err(UNIMPLEMENTED.to_string())
}

#[tauri::command]
pub async fn tt_unlock_rule_save(rule: UnlockRule) -> Result<UnlockRule, String> {
    let _ = rule;
    Err(UNIMPLEMENTED.to_string())
}

#[tauri::command]
pub async fn tt_unlock_rule_delete(id: String) -> Result<(), String> {
    let _ = id;
    Err(UNIMPLEMENTED.to_string())
}
