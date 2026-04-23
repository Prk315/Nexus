use crate::db::{templates, AppState};
use crate::models::Template;
use tauri::State;

#[tauri::command]
pub fn get_all_templates(state: State<'_, AppState>) -> Result<Vec<Template>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    templates::get_all(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_template(
    state: State<'_, AppState>,
    name: String,
    task_name: String,
    project: Option<String>,
    tags: Option<String>,
    notes: Option<String>,
    billable: bool,
    hourly_rate: f64,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    templates::save(
        &db,
        &name,
        &task_name,
        project.as_deref(),
        tags.as_deref(),
        notes.as_deref(),
        billable,
        hourly_rate,
    )
}

#[tauri::command]
pub fn delete_template(state: State<'_, AppState>, name: String) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    templates::delete(&db, &name)
}
