use crate::db::{goals, AppState};
use crate::models::GoalProgress;
use tauri::State;

#[tauri::command]
pub fn get_active_goals(
    state: State<'_, AppState>,
    project: Option<String>,
) -> Result<Vec<GoalProgress>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    goals::get_active(&db, project.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_goal(
    state: State<'_, AppState>,
    target_hours: f64,
    period: String,
    start_date: String,
    end_date: String,
    project: Option<String>,
) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    goals::add(&db, target_hours, &period, &start_date, &end_date, project.as_deref())
}

#[tauri::command]
pub fn deactivate_goal(state: State<'_, AppState>, goal_id: i64) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    goals::deactivate(&db, goal_id)
}
