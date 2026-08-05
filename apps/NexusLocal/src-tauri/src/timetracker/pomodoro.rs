//! Pomodoro configuration, persisted to Supabase.
//!
//! STUB (work unit 4). The phase machine itself lives in TypeScript — a 1s
//! interval is a WebView concern, not a Rust one. What Rust owns is durable
//! config, because TimeTracker's version kept pomodoro settings in a Redux slice
//! with no persistence call, so every duration reset to the default on launch.

use super::{Rest, T_POMODORO_CONFIG};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
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

const UNIMPLEMENTED: &str = "timetracker::pomodoro is not implemented yet (work unit 4)";

#[tauri::command]
pub async fn tt_pomodoro_get() -> Result<PomodoroConfig, String> {
    let _ = (Rest::load(), T_POMODORO_CONFIG);
    Err(UNIMPLEMENTED.to_string())
}

#[tauri::command]
pub async fn tt_pomodoro_set(config: PomodoroConfig) -> Result<PomodoroConfig, String> {
    let _ = config;
    Err(UNIMPLEMENTED.to_string())
}
