use crate::config::ConfigState;
use crate::db::AppState;
use crate::models::SyncResult;
use crate::sync::supabase;
use tauri::State;

#[tauri::command]
pub async fn sync_push(
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
) -> Result<SyncResult, String> {
    supabase::push_unsynced(&state, &config.get()).await
}

#[tauri::command]
pub async fn sync_pull(
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
    include_own_device: bool,
) -> Result<SyncResult, String> {
    supabase::pull_from_cloud(&state, &config.get(), include_own_device).await
}

#[tauri::command]
pub async fn sync_bidirectional(
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
) -> Result<SyncResult, String> {
    let cfg = config.get();
    let push = supabase::push_unsynced(&state, &cfg).await?;
    let pull = supabase::pull_from_cloud(&state, &cfg, false).await?;
    Ok(SyncResult {
        pushed: push.pushed,
        pulled: pull.pulled,
        errors: [push.errors, pull.errors].concat(),
    })
}

#[tauri::command]
pub async fn test_supabase_connection(
    config: State<'_, ConfigState>,
) -> Result<bool, String> {
    supabase::test_connection(&config.get()).await
}
