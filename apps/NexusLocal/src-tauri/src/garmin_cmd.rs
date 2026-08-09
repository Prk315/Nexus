//! Manual Garmin pull, straight from the desktop UI.
//!
//! # Why this bypasses the command queue
//!
//! Protocol reaches this machine by enqueuing into `nexus_local_commands`,
//! because it runs in a browser and cannot execute anything locally. The desktop
//! app has no such excuse — it is already on the machine that holds the tokens.
//!
//! More to the point, this exists as a **fallback for when the normal path is
//! broken**, and "the normal path" includes Supabase being unreachable, the
//! queue being backed up, or the daemon being stopped. Routing the fallback
//! through the same infrastructure it is meant to work around would defeat it.
//!
//! # iOS
//!
//! Returns an error, always. The bridge is a Python script driven by
//! `std::process::Command`, and the iOS sandbox forbids spawning subprocesses —
//! which is why `modules::registry()` compiles the Garmin module out there
//! entirely. The phone reaches Garmin by enqueuing a command for the Mac to run,
//! which is the frontend's job, not this command's. The command is still
//! registered on every platform: cfg-ing the `generate_handler!` list is how you
//! get a command that silently 404s on one target.

use serde_json::{json, Value};

/// Run one bridge action: `check`, `status`, `sleep`, `body_stats`,
/// `activities`, `exercise_sets`.
///
/// `date` is `YYYY-MM-DD` and `days` how far back to reach; both are ignored by
/// `check` and `status`. Returns the bridge's raw JSON — deliberately unmapped,
/// because turning it into `protocol_*` rows is Protocol's job and duplicating
/// that mapping here would fork it.
#[tauri::command]
pub async fn tt_garmin_run(
    action: String,
    date: Option<String>,
    days: Option<u64>,
) -> Result<Value, String> {
    #[cfg(target_os = "ios")]
    {
        let _ = (action, date, days);
        Err("The Garmin bridge runs on the Mac — iOS cannot spawn the Python process. \
             Queue it for the Mac node instead."
            .to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let mut payload = json!({});
        if let Some(d) = date.filter(|s| !s.trim().is_empty()) {
            payload["date"] = json!(d);
        }
        if let Some(n) = days {
            payload["days"] = json!(n);
        }
        crate::modules::garmin_run(&action, &payload).await
    }
}

/// The scoped key + export target the UI needs to call `garmin-import`.
///
/// Returned to the frontend rather than having Rust do the POST, so the sync
/// flow (pull four actions, then import once) stays in one readable place. The
/// key never leaves this machine — it goes from the config file to the WebView
/// and then straight to the edge function.
#[tauri::command]
pub fn tt_garmin_import_config() -> (String, String, String) {
    let c = crate::config::AppConfig::load();
    (c.garmin_import_key, c.active_user_id, c.supabase.url)
}
