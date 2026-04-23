use crate::db::{users, AppState};
use crate::models::LocalUser;
use tauri::State;

#[tauri::command]
pub fn get_local_users(state: State<'_, AppState>) -> Result<Vec<LocalUser>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    users::get_all(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_local_user(
    state: State<'_, AppState>,
    name: String,
) -> Result<Option<i64>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    users::create(&db, &name).map_err(|e| e.to_string())
}
