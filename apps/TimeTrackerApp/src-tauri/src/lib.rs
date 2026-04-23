mod blocker;
mod commands;
mod config;
mod db;
mod models;
mod sync;
#[cfg(not(mobile))]
mod tray;

use config::ConfigState;
use db::{migrations, AppState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Load config (reads ~/.timetrackerrc)
            let config_state = ConfigState::load();
            let db_path = config_state.db_path();

            // Ensure the database's parent directory exists (the stored path
            // may point to a directory from the old Python app that no longer exists).
            if let Some(parent) = db_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }

            // Open / create SQLite database
            let app_state = AppState::new(db_path.to_str().unwrap_or("timetracker.db"))
                .expect("Failed to open database");

            // Run idempotent migrations
            {
                let db = app_state.db.lock().unwrap();
                migrations::run(&db).expect("Database migration failed");
            }

            app.manage(app_state);
            app.manage(config_state);

            // Desktop-only setup: system tray, app-blocker daemon, floating widgets.
            // None of these concepts exist on mobile.
            #[cfg(not(mobile))]
            {
                // Set up system tray
                tray::setup(app.handle())?;

                // Start app-blocker background daemon
                blocker::start(app.handle().clone());

                // Create one floating widget window per connected monitor
                let monitors = app
                    .get_webview_window("main")
                    .and_then(|w| w.available_monitors().ok())
                    .unwrap_or_default();

                let widget_logical = 140.0_f64;
                let margin = 20.0_f64;

                // The primary monitor (closest to the origin) determines the scale
                // used to convert physical *positions* to logical coordinates.
                // Each monitor's own scale is used only for its physical *size*.
                // Without this distinction, an external 1× monitor next to a 2×
                // MacBook gets placed at 2× its intended logical position.
                let primary_scale = monitors
                    .iter()
                    .min_by_key(|m| {
                        let p = m.position();
                        p.x.unsigned_abs() + p.y.unsigned_abs()
                    })
                    .map(|m| m.scale_factor())
                    .unwrap_or(1.0);

                for (i, monitor) in monitors.iter().enumerate() {
                    let label = format!("widget_{}", i);
                    let own_scale = monitor.scale_factor();
                    let pos = monitor.position();
                    let size = monitor.size();

                    // Convert monitor origin using primary scale (global logical space),
                    // then add the monitor's own logical width/height.
                    let x = pos.x as f64 / primary_scale
                        + size.width as f64 / own_scale
                        - widget_logical
                        - margin;
                    let y = pos.y as f64 / primary_scale
                        + size.height as f64 / own_scale
                        - widget_logical
                        - margin;

                    let build_result = tauri::WebviewWindowBuilder::new(
                        app,
                        &label,
                        tauri::WebviewUrl::App("/".into()),
                    )
                    .title("")
                    .inner_size(widget_logical, widget_logical)
                    .position(x, y)
                    .decorations(false)
                    .transparent(true)
                    .shadow(false)
                    .always_on_top(true)
                    .visible_on_all_workspaces(true)
                    .visible(false)
                    .resizable(false)
                    .skip_taskbar(true)
                    .build();

                    // Apply the full three-flag collection behavior so the widget
                    // appears on all Spaces AND over fullscreen apps like VS Code.
                    if let Ok(ref widget) = build_result {
                        commands::configure_widget(widget);
                    }
                    let _ = build_result;
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Timer
            commands::get_status,
            commands::start_timer,
            commands::stop_timer,
            commands::pause_timer,
            commands::resume_timer,
            commands::cancel_paused,
            commands::resume_from_entry,
            // Entries
            commands::get_entries,
            commands::edit_entry,
            commands::delete_entry,
            commands::get_statistics,
            commands::get_all_projects,
            // Sync
            commands::sync_push,
            commands::sync_pull,
            commands::sync_bidirectional,
            commands::test_supabase_connection,
            // Export / Import
            commands::export_csv,
            commands::export_json_entries,
            commands::import_json_entries,
            // Config
            commands::get_config,
            commands::set_config,
            // Categories
            commands::get_categories,
            commands::save_categories,
            // Users
            commands::get_local_users,
            commands::create_local_user,
            // Widget
            commands::toggle_widgets,
            // App Blocker
            commands::get_blocked_apps,
            commands::add_blocked_app,
            commands::remove_blocked_app,
            commands::set_blocked_app_enabled,
            commands::get_blocker_enabled,
            commands::set_blocker_enabled,
            commands::get_installed_apps,
            // Site Blocker
            commands::get_blocked_sites,
            commands::add_blocked_site,
            commands::remove_blocked_site,
            commands::set_blocked_site_enabled,
            commands::sync_blocked_sites,
            // Schedule
            commands::get_schedule_blocks,
            commands::add_schedule_block,
            commands::update_schedule_block,
            commands::remove_schedule_block,
            // Time Unlock
            commands::get_time_unlock_rules,
            commands::add_time_unlock_rule,
            commands::remove_time_unlock_rule,
            commands::get_today_minutes,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running TimeTracker");
}
