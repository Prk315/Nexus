use crate::blocker::hosts;
use crate::db::{app_blocker, site_blocker, AppState};
use crate::models::BlockedSite;
use tauri::State;

/// Re-read the enabled sites from the DB and push them to /etc/hosts.
/// Only active sites are written; if the global blocker is off, the
/// hosts file is cleared instead.
fn sync_hosts(state: &AppState) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let blocker_on = app_blocker::is_blocker_on(&db);
    let sites = site_blocker::get_all(&db).map_err(|e| e.to_string())?;
    drop(db);

    if blocker_on {
        let domains: Vec<String> = sites
            .into_iter()
            .filter(|s| s.enabled)
            .map(|s| s.domain)
            .collect();
        hosts::apply(&domains)
    } else {
        hosts::clear()
    }
}

#[tauri::command]
pub fn get_blocked_sites(state: State<AppState>) -> Result<Vec<BlockedSite>, String> {
    let db = state.db.lock().unwrap();
    site_blocker::get_all(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_blocked_site(state: State<AppState>, domain: String) -> Result<BlockedSite, String> {
    let site = {
        let db = state.db.lock().unwrap();
        site_blocker::add(&db, &domain).map_err(|e| e.to_string())?
    };
    // Apply hosts change — shows password dialog if needed
    sync_hosts(&state)?;
    Ok(site)
}

#[tauri::command]
pub fn remove_blocked_site(state: State<AppState>, id: i64) -> Result<(), String> {
    {
        let db = state.db.lock().unwrap();
        site_blocker::remove(&db, id).map_err(|e| e.to_string())?;
    }
    sync_hosts(&state)
}

#[tauri::command]
pub fn set_blocked_site_enabled(
    state: State<AppState>,
    id: i64,
    enabled: bool,
) -> Result<(), String> {
    {
        let db = state.db.lock().unwrap();
        site_blocker::set_enabled(&db, id, enabled).map_err(|e| e.to_string())?;
    }
    sync_hosts(&state)
}

/// Called when the global blocker toggle changes, so sites are
/// applied or removed in sync with apps.
#[tauri::command]
pub fn sync_blocked_sites(state: State<AppState>) -> Result<(), String> {
    sync_hosts(&state)
}
