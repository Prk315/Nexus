mod ble_scan;
mod config;
mod content_blocker;
mod device;
mod grid;
mod ios_bridge;
mod live_activities;
mod modules;
#[cfg(not(mobile))]
mod tray;

use config::AppConfig;
use grid::runtime::Grid;
use grid::supabase::Supabase;
use grid::{ModuleContext, ModuleManifest};
use serde::Serialize;
use std::sync::Arc;
use tauri::Manager;

/// Snapshot of this node, surfaced to the status UI via `grid_status`.
#[derive(Debug, Clone, Serialize)]
pub struct GridStatus {
    pub device_id: String,
    pub platform: String,
    pub hostname: String,
    pub version: String,
    pub supabase_configured: bool,
    pub modules: Vec<ModuleManifest>,
}

#[tauri::command]
fn grid_status(state: tauri::State<Arc<GridStatus>>) -> GridStatus {
    (**state).clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config = AppConfig::load();
            let device_id = device::get_or_create();
            let supabase = Supabase::new(config.supabase.url.clone(), config.supabase.key.clone());

            let grid = Grid::new(modules::registry(&config));
            let manifests = grid.manifests();

            let status = Arc::new(GridStatus {
                device_id: device_id.clone(),
                platform: device::platform().to_string(),
                hostname: device::hostname(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                supabase_configured: supabase.is_configured(),
                modules: manifests,
            });
            app.manage(Arc::clone(&status));

            // macOS: show in the Dock while we're trying it out (a plain menubar
            // accessory is easy to miss, especially behind a MacBook notch).
            // Flip back to ActivationPolicy::Accessory for the background-only look.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            #[cfg(not(mobile))]
            tray::setup(app.handle())?;

            // Show the status window on launch so there's an obvious entry point.
            #[cfg(desktop)]
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }

            // Launch the grid: startup hooks, per-module tick loops, and the
            // Supabase command-queue poller. tokio::spawn inside needs a runtime
            // context, so kick it off from the Tauri (tokio) async runtime.
            let ctx = ModuleContext {
                supabase,
                user_id: config.user_id.clone(),
                device_id,
            };
            let poll_secs = config.poll_secs;
            tauri::async_runtime::spawn(async move {
                grid.spawn(ctx, poll_secs);
            });

            Ok(())
        })
        .on_window_event(|_window, _event| {
            // Menubar app: closing the window hides it instead of quitting.
            // Desktop-only — iOS has no window to hide.
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                let _ = _window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            grid_status,
            ios_bridge::store_session,
            ios_bridge::clear_session,
            ios_bridge::appgroup_debug,
            content_blocker::apply_content_blocker,
            live_activities::start_live_activity,
            live_activities::end_live_activity,
            ble_scan::ble_scan_start,
            ble_scan::ble_write,
            ble_scan::ble_scan_stop,
            ble_scan::ble_scan_results
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nexus Local");
}
