//! Session recording — start/stop/pause/resume against Supabase.
//!
//! STUB (work unit 2). The command surface below is already registered in
//! `lib.rs`; fill in the bodies here and nothing else needs to change.
//!
//! # Model to port
//!
//! `apps/TimeTrackerApp/src-tauri/src/db/timer.rs` — elapsed time is *derived*,
//! never stored: pause snapshots `now - start_time` into `elapsed_seconds`, and
//! resume back-dates `start_time = now - elapsed_seconds` so the derivation keeps
//! working. Stop writes a `time_entries` row and clears the active session.
//!
//! Unlike TimeTracker there is no local SQLite here. `active_sessions` has a
//! UNIQUE(user_id), so there is exactly one active session per user across every
//! device — Supabase is the ground truth and the phone is a thin client.

use super::{eq, Rest, T_ACTIVE_SESSIONS, T_TIME_ENTRIES};
use serde::{Deserialize, Serialize};

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

const UNIMPLEMENTED: &str = "timetracker::session is not implemented yet (work unit 2)";

#[tauri::command]
pub async fn tt_session_status() -> Result<SessionStatus, String> {
    let _ = (Rest::load(), T_ACTIVE_SESSIONS, eq("default"));
    Err(UNIMPLEMENTED.to_string())
}

#[tauri::command]
pub async fn tt_session_start(
    task_name: String,
    project: Option<String>,
) -> Result<SessionStatus, String> {
    let _ = (task_name, project, T_ACTIVE_SESSIONS);
    Err(UNIMPLEMENTED.to_string())
}

#[tauri::command]
pub async fn tt_session_stop() -> Result<SessionStatus, String> {
    let _ = T_TIME_ENTRIES;
    Err(UNIMPLEMENTED.to_string())
}

#[tauri::command]
pub async fn tt_session_pause() -> Result<SessionStatus, String> {
    Err(UNIMPLEMENTED.to_string())
}

#[tauri::command]
pub async fn tt_session_resume() -> Result<SessionStatus, String> {
    Err(UNIMPLEMENTED.to_string())
}
