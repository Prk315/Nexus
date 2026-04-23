use crate::db::{schedule, AppState};
use crate::models::{FocusBlock, TimeUnlockRule};
use tauri::State;

// ── Schedule blocks ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_schedule_blocks(state: State<AppState>) -> Result<Vec<FocusBlock>, String> {
    let db = state.db.lock().unwrap();
    schedule::get_all_blocks(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_schedule_block(
    state: State<AppState>,
    name: String,
    start_time: String,
    end_time: String,
    days_of_week: String,
    color: String,
) -> Result<FocusBlock, String> {
    let db = state.db.lock().unwrap();
    schedule::add_block(&db, &name, &start_time, &end_time, &days_of_week, &color)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_schedule_block(
    state: State<AppState>,
    id: i64,
    name: String,
    start_time: String,
    end_time: String,
    days_of_week: String,
    color: String,
    enabled: bool,
    blocked_apps: Vec<String>,
    blocked_sites: Vec<String>,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    schedule::update_block(
        &db,
        id,
        &name,
        &start_time,
        &end_time,
        &days_of_week,
        &color,
        enabled,
        &blocked_apps,
        &blocked_sites,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_schedule_block(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    schedule::remove_block(&db, id).map_err(|e| e.to_string())
}

// ── Time-unlock rules ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_time_unlock_rules(state: State<AppState>) -> Result<Vec<TimeUnlockRule>, String> {
    let db = state.db.lock().unwrap();
    schedule::get_all_unlock_rules(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_time_unlock_rule(
    state: State<AppState>,
    process_name: Option<String>,
    domain: Option<String>,
    required_minutes: i64,
) -> Result<TimeUnlockRule, String> {
    let db = state.db.lock().unwrap();
    schedule::add_unlock_rule(&db, process_name.as_deref(), domain.as_deref(), required_minutes)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_time_unlock_rule(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    schedule::remove_unlock_rule(&db, id).map_err(|e| e.to_string())
}

/// Expose today's tracked minutes so the frontend can show reward progress.
#[tauri::command]
pub fn get_today_minutes(state: State<AppState>) -> Result<i64, String> {
    let db = state.db.lock().unwrap();
    schedule::tracked_minutes_today(&db).map_err(|e| e.to_string())
}
