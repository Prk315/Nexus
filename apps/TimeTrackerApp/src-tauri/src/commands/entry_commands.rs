use crate::db::{entries, statistics, AppState};
use crate::models::{Statistics, TimeEntry};
use tauri::State;

#[tauri::command]
pub fn get_entries(
    state: State<'_, AppState>,
    limit: Option<i64>,
    project: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    tags: Option<String>,
    user_id: Option<String>,
) -> Result<Vec<TimeEntry>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    entries::get_entries(
        &db,
        limit,
        project.as_deref(),
        start_date.as_deref(),
        end_date.as_deref(),
        tags.as_deref(),
        user_id.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn edit_entry(
    state: State<'_, AppState>,
    entry_id: i64,
    task_name: Option<String>,
    project: Option<String>,
    tags: Option<String>,
    notes: Option<String>,
    billable: Option<bool>,
    hourly_rate: Option<f64>,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    entries::edit_entry(
        &db,
        entry_id,
        task_name.as_deref(),
        project.as_deref(),
        tags.as_deref(),
        notes.as_deref(),
        billable,
        hourly_rate,
    )
}

#[tauri::command]
pub fn delete_entry(state: State<'_, AppState>, entry_id: i64) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    entries::delete_entry(&db, entry_id)
}

#[tauri::command]
pub fn get_statistics(
    state: State<'_, AppState>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Statistics, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    statistics::get(&db, start_date.as_deref(), end_date.as_deref())
}

#[tauri::command]
pub fn get_all_projects(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    entries::get_all_projects(&db).map_err(|e| e.to_string())
}
