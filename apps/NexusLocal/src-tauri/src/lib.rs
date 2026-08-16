mod ble_scan;
mod config;
mod content_blocker;
mod device;
mod enforcement;
mod garmin_cmd;
mod grid;
mod ios_bridge;
mod live_activities;
mod modules;
mod timetracker;
#[cfg(not(mobile))]
mod tray;
mod usage;
mod usage_cmd;
// The browser extension's ingest listener. Daemon-only, and there is no daemon
// on the phone.
#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod usage_ingest;
// Uploads intervals to the `usage-ingest` edge function. Daemon-only, same as
// the listener above — the phone records no usage and syncs none.
#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod usage_sync;

use config::AppConfig;
use grid::runtime::Grid;
use grid::supabase::Supabase;
use grid::{ModuleContext, ModuleManifest};
use serde::Serialize;
use std::sync::atomic::AtomicBool;
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

/// Which `user_id` this node's rows are keyed by — `user_id` in
/// `~/.nexuslocalrc`, defaulting to `"default"`.
///
/// The frontend used to hardcode `"default"` in a dozen queries while the Rust
/// side read it from config. That mismatch is worse than not supporting a second
/// account at all: on a machine configured for someone else the daemon would
/// scope correctly while the UI silently read and wrote the *other* person's
/// rows, and it would look like it was working.
///
/// Read fresh rather than cached in `GridStatus`: the file is the boundary
/// between the app and the daemon everywhere else in this codebase, and a value
/// frozen at launch would need a restart to pick up a profile change.
#[tauri::command]
fn tt_node_user_id() -> String {
    AppConfig::load().user_id
}

/// The background service: the grid node with no GUI at all.
///
/// Run as `nexus-local --daemon`, normally by the LaunchAgent that
/// `enforcement.rs` installs. This is what makes blocking survive the app being
/// closed — and closed here means *quit*, not just the window hidden. It creates
/// no window, no tray icon and no Dock entry, and never initialises Tauri.
///
/// # Why the desktop app does not also do this
///
/// On macOS `run()` deliberately does **not** spawn a grid, because two grid
/// nodes sharing one `device_id` is not a redundancy, it's a conflict: both
/// heartbeat as the same node, both claim from the same command queue, and —
/// worst — both write `/etc/hosts`. The per-process `hosts_write_lock` does not
/// serialise across processes, so a changed verdict would raise **two** admin
/// password dialogs. One owner, always: this process.
///
/// # Picking up the toggle
///
/// `blocking_enabled` is polled from `~/.nexuslocalrc` rather than pushed, so
/// the app's switch reaches this process with no IPC. An unreadable file leaves
/// the current setting alone (see `read_blocking_enabled`).
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub fn run_daemon() {
    use std::sync::atomic::Ordering;

    let config = AppConfig::load();
    let device_id = device::get_or_create();
    let supabase = Supabase::new(config.supabase.url.clone(), config.supabase.key.clone());

    let blocking_enabled = Arc::new(AtomicBool::new(config.blocking_enabled));
    let grid = Grid::new(modules::registry(Arc::clone(&blocking_enabled)));

    eprintln!(
        "[daemon] nexus-local {} · node {} · {} module(s) · enforcement {}",
        env!("CARGO_PKG_VERSION"),
        &device_id[..8.min(device_id.len())],
        grid.manifests().len(),
        if config.blocking_enabled { "on" } else { "off" },
    );

    let ctx = ModuleContext {
        supabase,
        user_id: config.user_id.clone(),
        device_id,
    };

    // `ctx` takes ownership of `device_id`, and the sync task needs it to stamp
    // which machine reported an interval — so clone before the move.
    let sync_device_id = ctx.device_id.clone();

    // Generated before the listener exists, so the token file is on disk by the
    // time the extension is set up — and so a failure to create it is one line
    // in the daemon log rather than a silent 401 on every request.
    match usage::ensure_browser_token() {
        Ok(t) => eprintln!("[daemon] browser token ready ({} chars)", t.len()),
        Err(e) => eprintln!("[daemon] cannot create the browser token ({e}) — web usage will 401"),
    }

    let runtime = tokio::runtime::Runtime::new().expect("cannot start the daemon tokio runtime");
    runtime.block_on(async move {
        grid.spawn(ctx, config.poll_secs);

        // The browser extension's way in. Loopback only, token-authenticated,
        // and it never takes the daemon down with it — see `usage_ingest.rs`.
        usage_ingest::spawn();

        // Upload usage so PathFinder/Protocol can read it. Goes through the
        // `usage-ingest` edge function rather than PostgREST, because
        // `usage_intervals` has no anon policy and this process has no session.
        // No-op unless `usage_ingest_key` is set in ~/.nexuslocalrc.
        usage_sync::spawn(
            config.supabase.url.clone(),
            config.supabase.key.clone(),
            config.usage_ingest_key.clone(),
            sync_device_id,
        );

        // Park here forever, re-reading the switch. 5s is well inside the 30s
        // enforcement tick, so a toggle in the app is picked up before the next
        // pass that would act on it.
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(5));
        loop {
            ticker.tick().await;
            if let Some(enabled) = AppConfig::read_blocking_enabled() {
                if enabled != blocking_enabled.load(Ordering::Relaxed) {
                    eprintln!("[daemon] enforcement -> {}", if enabled { "on" } else { "off" });
                    blocking_enabled.store(enabled, Ordering::Relaxed);
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config = AppConfig::load();
            let device_id = device::get_or_create();
            let supabase = Supabase::new(config.supabase.url.clone(), config.supabase.key.clone());

            // The enforcement switch is shared, not copied: the blocking module's
            // tick reads it every 30s and `tt_enforcement_set` writes it, so the
            // toggle takes effect without a relaunch (it used to be baked in at
            // construction, which is why it could only ever be changed by editing
            // ~/.nexuslocalrc and restarting).
            let blocking_enabled = Arc::new(AtomicBool::new(config.blocking_enabled));
            app.manage(enforcement::EnforcementFlag(Arc::clone(&blocking_enabled)));

            let grid = Grid::new(modules::registry(blocking_enabled));
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
            // Also managed as state so `tt_enforcement_apply_now` can enforce
            // on demand instead of making the user wait out a tick.
            app.manage(ctx.clone());
            let poll_secs = config.poll_secs;

            // macOS: the `--daemon` process owns the grid, so the desktop app
            // does not start one. Two nodes sharing a `device_id` would double
            // up on heartbeats and command claims, and both would write
            // /etc/hosts — and since `hosts_write_lock` is per-process, a
            // changed verdict would raise two admin password dialogs. The app
            // is a UI onto the daemon's work; `EnforcementPanel` says so when
            // the daemon isn't running. Everywhere else keeps the old
            // in-process behaviour (iOS has no daemon and still needs to
            // heartbeat its presence).
            #[cfg(not(target_os = "macos"))]
            tauri::async_runtime::spawn(async move {
                grid.spawn(ctx, poll_secs);
            });
            #[cfg(target_os = "macos")]
            {
                let _ = (grid, ctx, poll_secs);
            }

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
            tt_node_user_id,
            ios_bridge::store_session,
            ios_bridge::clear_session,
            ios_bridge::appgroup_debug,
            ios_bridge::keychain_debug,
            content_blocker::apply_content_blocker,
            live_activities::start_live_activity,
            live_activities::end_live_activity,
            ble_scan::ble_scan_start,
            ble_scan::ble_write,
            ble_scan::ble_scan_stop,
            ble_scan::ble_scan_results,
            // Productivity stack (see src/timetracker/mod.rs). Registered here
            // once so each work unit fills in its own file without touching this
            // list — the ordering is not significant.
            timetracker::session::tt_session_status,
            timetracker::session::tt_session_start,
            timetracker::session::tt_session_stop,
            timetracker::session::tt_session_pause,
            timetracker::session::tt_session_resume,
            timetracker::pomodoro::tt_pomodoro_get,
            timetracker::pomodoro::tt_pomodoro_set,
            timetracker::focus::tt_focus_blocks,
            timetracker::focus::tt_focus_block_save,
            timetracker::focus::tt_focus_block_delete,
            timetracker::rewards::tt_unlock_rules,
            timetracker::rewards::tt_unlock_rule_save,
            timetracker::rewards::tt_unlock_rule_delete,
            timetracker::blocking_state::tt_blocking_state,
            // Mac enforcement controls (see enforcement.rs). Registered on every
            // platform on purpose — cfg-ing the handler list is how you get a
            // command that silently doesn't exist on iOS; these report
            // `supported: false` there instead.
            enforcement::tt_enforcement_get,
            enforcement::tt_enforcement_set,
            enforcement::tt_enforcement_apply_now,
            enforcement::tt_enforcement_autostart_set,
            // Foreground-app / web time tracking (see usage.rs). These read the
            // daemon's JSONL day files from disk — on macOS the tracker runs in
            // the daemon, not here.
            usage_cmd::tt_usage_today,
            usage_cmd::tt_usage_range,
            usage_cmd::tt_usage_intervals,
            usage_cmd::tt_usage_spans_range,
            garmin_cmd::tt_garmin_run,
            garmin_cmd::tt_garmin_import_config,
            usage_cmd::tt_active_profile_get,
            usage_cmd::tt_active_profile_set,
            usage_cmd::tt_usage_token
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nexus Local");
}
