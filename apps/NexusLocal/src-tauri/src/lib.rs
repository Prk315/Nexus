mod config;
mod device;
mod grid;
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

            // macOS: run as a menubar accessory (no dock icon).
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            #[cfg(not(mobile))]
            tray::setup(app.handle())?;

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
        .on_window_event(|window, event| {
            // Menubar app: closing the window hides it instead of quitting.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![grid_status])
        .run(tauri::generate_context!())
        .expect("error while running Nexus Local");
}
