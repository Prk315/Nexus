use crate::config::ConfigState;
use crate::db::{timer, AppState};
use crate::models::SyncResult;
use crate::sync::{active_session, blocking, supabase};
use serde::{Deserialize, Serialize};
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

// ── Active session poll ───────────────────────────────────────────────────────

/// Called by the frontend every ~10 s to reconcile the active timer across
/// devices. Returns a PollResult that tells the frontend what (if anything)
/// changed.
#[tauri::command]
pub async fn poll_active_session(
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
) -> Result<active_session::PollResult, String> {
    let cfg = config.get();

    // Read local timer state
    let local_status = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        crate::db::timer::get_status(&db).map_err(|e| e.to_string())?
    };

    let (status_str, local_start): (&str, Option<String>) = match (&local_status.active, &local_status.paused) {
        (Some(a), _) => ("running", Some(a.start_time.clone())),
        (_, Some(p)) => ("paused",  Some(p.start_time.clone())),
        _            => ("idle",    None),
    };

    let result = active_session::poll(&cfg, status_str, local_start.as_deref()).await?;

    // If poll says Adopted, insert the remote session into local DB now
    if let active_session::PollResult::Adopted(ref remote) = result {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        timer::adopt_remote_session(
            &db,
            &remote.task_name,
            remote.project.as_deref(),
            remote.tags.as_deref(),
            remote.notes.as_deref(),
            remote.billable,
            remote.hourly_rate,
            &remote.start_time,
            Some(&remote.user_id),
        )?;
    }

    Ok(result)
}

// ── Blocking sync ─────────────────────────────────────────────────────────────

/// Serialisable summary returned to the frontend after a blocking sync operation.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct BlockingSyncSummary {
    pub sites_pushed: usize,
    pub sites_pulled: usize,
    pub apps_pushed: usize,
    pub apps_pulled: usize,
    pub blocks_pushed: usize,
    pub blocks_pulled: usize,
    pub rules_pushed: usize,
    pub rules_pulled: usize,
    pub errors: Vec<String>,
}

impl From<blocking::BlockingSyncResult> for BlockingSyncSummary {
    fn from(r: blocking::BlockingSyncResult) -> Self {
        Self {
            sites_pushed:  r.sites_pushed,
            sites_pulled:  r.sites_pulled,
            apps_pushed:   r.apps_pushed,
            apps_pulled:   r.apps_pulled,
            blocks_pushed: r.blocks_pushed,
            blocks_pulled: r.blocks_pulled,
            rules_pushed:  r.rules_pushed,
            rules_pulled:  r.rules_pulled,
            errors:        r.errors,
        }
    }
}

/// Push all locally-unsynced blocking rows to Supabase.
#[tauri::command]
pub async fn sync_blocking_push(
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
) -> Result<BlockingSyncSummary, String> {
    let cfg = config.get();
    let mut total = blocking::BlockingSyncResult::default();

    macro_rules! merge {
        ($fut:expr) => {
            match $fut.await {
                Ok(r) => {
                    total.sites_pushed  += r.sites_pushed;
                    total.apps_pushed   += r.apps_pushed;
                    total.blocks_pushed += r.blocks_pushed;
                    total.rules_pushed  += r.rules_pushed;
                    total.errors.extend(r.errors);
                }
                Err(e) => total.errors.push(e),
            }
        };
    }

    merge!(blocking::push_blocked_sites(&state, &cfg));
    merge!(blocking::push_blocked_apps(&state, &cfg));
    merge!(blocking::push_focus_blocks(&state, &cfg));
    merge!(blocking::push_unlock_rules(&state, &cfg));

    Ok(total.into())
}

/// Pull all remote blocking rows from Supabase into the local SQLite database.
#[tauri::command]
pub async fn sync_blocking_pull(
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
) -> Result<BlockingSyncSummary, String> {
    let cfg = config.get();
    let mut total = blocking::BlockingSyncResult::default();

    macro_rules! merge {
        ($fut:expr) => {
            match $fut.await {
                Ok(r) => {
                    total.sites_pulled  += r.sites_pulled;
                    total.apps_pulled   += r.apps_pulled;
                    total.blocks_pulled += r.blocks_pulled;
                    total.rules_pulled  += r.rules_pulled;
                    total.errors.extend(r.errors);
                }
                Err(e) => total.errors.push(e),
            }
        };
    }

    merge!(blocking::pull_blocked_sites(&state, &cfg));
    merge!(blocking::pull_blocked_apps(&state, &cfg));
    merge!(blocking::pull_focus_blocks(&state, &cfg));
    merge!(blocking::pull_unlock_rules(&state, &cfg));

    Ok(total.into())
}

/// Full bidirectional blocking sync: push unsynced rows, then pull remote changes.
#[tauri::command]
pub async fn sync_blocking_bidirectional(
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
) -> Result<BlockingSyncSummary, String> {
    let result = blocking::sync_all_blocking(&state, &config.get()).await?;
    Ok(result.into())
}
