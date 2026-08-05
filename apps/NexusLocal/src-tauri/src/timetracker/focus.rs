//! Focus schedule blocks — wall-clock windows during which apps/sites are blocked.
//!
//! STUB (work unit 6). Note this is unrelated to pomodoro despite both using the
//! word "focus": a focus block is a recurring calendar window (e.g. Mon–Fri
//! 09:00–17:00), not a countdown.
//!
//! The gap being closed: in TimeTracker, `focus_blocks` syncs to Supabase but the
//! *payload* of a block — which apps and sites it blocks — lives only in local
//! SQLite (`schedule_block_apps` / `schedule_block_sites` have no cloud
//! counterpart). Work unit 1 adds those tables; this module reads and writes them
//! so a schedule created on the phone actually means something to the evaluator.

use super::{Rest, T_FOCUS_BLOCKS};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusBlock {
    pub id: Option<String>,
    pub name: String,
    /// "HH:MM" local time.
    pub start_time: String,
    pub end_time: String,
    /// ISO weekday CSV, 1 = Monday .. 7 = Sunday.
    pub days_of_week: String,
    pub color: String,
    pub enabled: bool,
    #[serde(default)]
    pub process_names: Vec<String>,
    #[serde(default)]
    pub domains: Vec<String>,
}

const UNIMPLEMENTED: &str = "timetracker::focus is not implemented yet (work unit 6)";

#[tauri::command]
pub async fn tt_focus_blocks() -> Result<Vec<FocusBlock>, String> {
    let _ = (Rest::load(), T_FOCUS_BLOCKS);
    Err(UNIMPLEMENTED.to_string())
}

#[tauri::command]
pub async fn tt_focus_block_save(block: FocusBlock) -> Result<FocusBlock, String> {
    let _ = block;
    Err(UNIMPLEMENTED.to_string())
}

#[tauri::command]
pub async fn tt_focus_block_delete(id: String) -> Result<(), String> {
    let _ = id;
    Err(UNIMPLEMENTED.to_string())
}
