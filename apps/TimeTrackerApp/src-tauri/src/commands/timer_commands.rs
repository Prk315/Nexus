use crate::config::ConfigState;
use crate::db::{entries, timer, AppState};
use crate::models::{ActiveSession, PausedSession, TimeEntry, TimerStatus};
use crate::sync::active_session as remote;
use tauri::State;

const DEFAULT_USER: &str = "default";

// ── helpers ───────────────────────────────────────────────────────────────────

/// Fire-and-forget push of the current active session. Errors are only logged.
async fn push_active_best_effort(
    config: &crate::models::AppConfig,
    session: &ActiveSession,
) {
    if let Err(e) = remote::push_active(config, session, DEFAULT_USER).await {
        eprintln!("[active_session] push_active failed (non-fatal): {e}");
    }
}

async fn push_paused_best_effort(
    config: &crate::models::AppConfig,
    session: &PausedSession,
) {
    if let Err(e) = remote::push_paused(config, session, DEFAULT_USER).await {
        eprintln!("[active_session] push_paused failed (non-fatal): {e}");
    }
}

async fn clear_remote_best_effort(config: &crate::models::AppConfig) {
    if let Err(e) = remote::clear_remote(config, DEFAULT_USER).await {
        eprintln!("[active_session] clear_remote failed (non-fatal): {e}");
    }
}

// ── commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_status(state: State<'_, AppState>) -> Result<TimerStatus, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    timer::get_status(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_timer(
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
    task_name: String,
    project: Option<String>,
    tags: Option<String>,
    notes: Option<String>,
    billable: bool,
    hourly_rate: f64,
    user_id: Option<String>,
) -> Result<(), String> {
    {
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
        )?;
    }

    // Push to Supabase (best-effort)
    let status = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        timer::get_status(&db).map_err(|e| e.to_string())?
    };
    if let Some(session) = status.active {
        push_active_best_effort(&config.get(), &session).await;
    }

    Ok(())
}

#[tauri::command]
pub async fn stop_timer(
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
) -> Result<TimeEntry, String> {
    let entry = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        timer::stop_timer(&db)?
    };
    clear_remote_best_effort(&config.get()).await;
    Ok(entry)
}

#[tauri::command]
pub async fn pause_timer(
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
) -> Result<PausedSession, String> {
    let status = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        timer::pause_timer(&db)?;
        timer::get_status(&db).map_err(|e| e.to_string())?
    };

    if let Some(session) = &status.paused {
        push_paused_best_effort(&config.get(), session).await;
    }

    status.paused.ok_or_else(|| "No paused session after pause".into())
}

#[tauri::command]
pub async fn resume_timer(
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
) -> Result<ActiveSession, String> {
    let status = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        timer::resume_timer(&db)?;
        timer::get_status(&db).map_err(|e| e.to_string())?
    };

    if let Some(session) = &status.active {
        push_active_best_effort(&config.get(), session).await;
    }

    status.active.ok_or_else(|| "No active session after resume".into())
}

#[tauri::command]
pub async fn cancel_paused(
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
) -> Result<bool, String> {
    let result = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        timer::cancel_paused(&db)?
    };
    clear_remote_best_effort(&config.get()).await;
    Ok(result)
}

#[tauri::command]
pub async fn resume_from_entry(
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
    entry_id: i64,
    user_id: Option<String>,
) -> Result<(), String> {
    {
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
        )?;
    }

    let status = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        timer::get_status(&db).map_err(|e| e.to_string())?
    };
    if let Some(session) = status.active {
        push_active_best_effort(&config.get(), &session).await;
    }

    Ok(())
}
