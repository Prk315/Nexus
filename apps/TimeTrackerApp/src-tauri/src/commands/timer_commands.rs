use crate::db::{entries, timer, AppState};
use crate::models::{ActiveSession, PausedSession, TimeEntry, TimerStatus};
use tauri::State;

#[tauri::command]
pub fn get_status(state: State<'_, AppState>) -> Result<TimerStatus, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    timer::get_status(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_timer(
    state: State<'_, AppState>,
    task_name: String,
    project: Option<String>,
    tags: Option<String>,
    notes: Option<String>,
    billable: bool,
    hourly_rate: f64,
    user_id: Option<String>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    timer::start_timer(
        &db,
        &task_name,
        project.as_deref(),
        tags.as_deref(),
        notes.as_deref(),
        billable,
        hourly_rate,
        user_id.as_deref(),
    )
}

#[tauri::command]
pub fn stop_timer(state: State<'_, AppState>) -> Result<TimeEntry, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    timer::stop_timer(&db)
}

#[tauri::command]
pub fn pause_timer(state: State<'_, AppState>) -> Result<PausedSession, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    timer::pause_timer(&db)
}

#[tauri::command]
pub fn resume_timer(state: State<'_, AppState>) -> Result<ActiveSession, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    timer::resume_timer(&db)
}

#[tauri::command]
pub fn cancel_paused(state: State<'_, AppState>) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    timer::cancel_paused(&db)
}

#[tauri::command]
pub fn resume_from_entry(
    state: State<'_, AppState>,
    entry_id: i64,
    user_id: Option<String>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let entry = entries::get_entries(&db, None, None, None, None, None, None)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|e| e.id == entry_id)
        .ok_or_else(|| format!("Entry {entry_id} not found"))?;
    timer::start_timer(
        &db,
        &entry.task_name,
        entry.project.as_deref(),
        entry.tags.as_deref(),
        entry.notes.as_deref(),
        entry.billable,
        entry.hourly_rate,
        user_id.as_deref(),
    )
}
