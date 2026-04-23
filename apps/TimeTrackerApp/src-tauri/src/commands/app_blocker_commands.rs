use crate::blocker;
use crate::db::{app_blocker, AppState};
use crate::models::{BlockedApp, InstalledApp};
use tauri::State;

#[tauri::command]
pub fn get_blocked_apps(state: State<AppState>) -> Result<Vec<BlockedApp>, String> {
    let db = state.db.lock().unwrap();
    app_blocker::get_all(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_blocked_app(
    state: State<AppState>,
    display_name: String,
    process_name: String,
    block_mode: String,
) -> Result<BlockedApp, String> {
    let db = state.db.lock().unwrap();
    app_blocker::add(&db, &display_name, &process_name, &block_mode)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_blocked_app(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    app_blocker::remove(&db, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_blocked_app_enabled(
    state: State<AppState>,
    id: i64,
    enabled: bool,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    app_blocker::set_enabled(&db, id, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_blocker_enabled(state: State<AppState>) -> bool {
    let db = state.db.lock().unwrap();
    app_blocker::is_blocker_on(&db)
}

#[tauri::command]
pub fn set_blocker_enabled(state: State<AppState>, enabled: bool) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    app_blocker::set_blocker_on(&db, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_installed_apps() -> Vec<InstalledApp> {
    blocker::scan_installed_apps()
        .into_iter()
        .map(|(display_name, process_name)| InstalledApp {
            display_name,
            process_name,
        })
        .collect()
}
