pub mod hosts;
// Include ios_content_blocker during normal iOS builds AND during `cargo test`
// on any platform, so the pure helper functions (url pattern generation) can be
// tested without a connected device.
#[cfg(any(target_os = "ios", test))]
pub mod ios_content_blocker;

use crate::db::{app_blocker, schedule, site_blocker, timer, AppState};
use chrono::Datelike;
use std::collections::{BTreeSet, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Guards against concurrent hosts-file writes (e.g. schedule change fires
/// while a password dialog from the previous tick is still open).
static HOSTS_WRITE: OnceLock<Mutex<()>> = OnceLock::new();
fn hosts_write_lock() -> &'static Mutex<()> {
    HOSTS_WRITE.get_or_init(|| Mutex::new(()))
}

/// Scan /Applications (and ~/Applications) for .app bundles.
/// Returns (display_name, process_name) pairs sorted alphabetically.
pub fn scan_installed_apps() -> Vec<(String, String)> {
    let home = dirs::home_dir().unwrap_or_default();
    let dirs_to_scan = [
        std::path::PathBuf::from("/Applications"),
        std::path::PathBuf::from("/Applications/Utilities"),
        std::path::PathBuf::from("/System/Applications"),
        home.join("Applications"),
    ];

    let mut apps: Vec<(String, String)> = Vec::new();

    for dir in &dirs_to_scan {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "app") {
                let display = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default();
                if display.is_empty() {
                    continue;
                }
                let exe = get_executable_name(&path).unwrap_or_else(|| display.clone());
                apps.push((display, exe));
            }
        }
    }

    apps.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    apps.dedup_by(|a, b| a.1 == b.1);
    apps
}

fn get_executable_name(app_bundle: &std::path::Path) -> Option<String> {
    let plist_path = app_bundle.join("Contents/Info.plist");
    let data = std::fs::read(&plist_path).ok()?;
    let text = String::from_utf8_lossy(&data);
    let key = "<key>CFBundleExecutable</key>";
    let pos = text.find(key)?;
    let after = &text[pos + key.len()..];
    let start = after.find("<string>")? + "<string>".len();
    let end = after[start..].find("</string>")?;
    Some(after[start..start + end].trim().to_owned())
}

/// Gracefully quit an app by its process name using osascript, then pkill.
fn kill_app(process_name: &str) {
    let _ = std::process::Command::new("osascript")
        .args([
            "-e",
            &format!("tell application \"{}\" to quit", process_name),
        ])
        .output();
    std::thread::sleep(Duration::from_secs(2));
    let _ = std::process::Command::new("pkill")
        .args(["-x", process_name])
        .output();
}

/// Returns true if a process with the given name is currently running.
fn is_running(process_name: &str) -> bool {
    std::process::Command::new("pgrep")
        .args(["-x", process_name])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Spawn the background blocker loop. Checks every 5 seconds.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            tick(&app);
        }
    });
}

fn tick(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Ok(db) = state.db.lock() else { return };

    // ── Load all data while holding the DB lock ───────────────────────────
    let blocker_on = app_blocker::is_blocker_on(&db);

    let timer_active = timer::get_status(&db)
        .map(|s| s.active.is_some())
        .unwrap_or(false);

    let Ok(permanent_apps) = app_blocker::get_all(&db) else { return };
    let Ok(permanent_sites) = site_blocker::get_all(&db) else { return };
    let Ok(schedule_blocks) = schedule::get_all_blocks(&db) else { return };
    let Ok(unlock_rules) = schedule::get_all_unlock_rules(&db) else { return };
    let today_minutes = schedule::tracked_minutes_today(&db).unwrap_or(0);

    drop(db); // release lock before any syscalls

    // ── Current wall-clock context ────────────────────────────────────────
    let now = chrono::Local::now();
    let current_dow = now.weekday().number_from_monday() as i64; // 1=Mon … 7=Sun
    let current_time = now.time();

    // ── Build schedule-active sets ────────────────────────────────────────
    let mut sched_apps: HashSet<String> = HashSet::new();
    let mut sched_sites: HashSet<String> = HashSet::new();

    for block in &schedule_blocks {
        if !block.enabled {
            continue;
        }
        let active_today = block
            .days_of_week
            .split(',')
            .filter_map(|d| d.trim().parse::<i64>().ok())
            .any(|d| d == current_dow);
        if !active_today {
            continue;
        }

        let Ok(start) = chrono::NaiveTime::parse_from_str(&block.start_time, "%H:%M") else {
            continue;
        };
        let Ok(end) = chrono::NaiveTime::parse_from_str(&block.end_time, "%H:%M") else {
            continue;
        };

        let in_window = if start <= end {
            current_time >= start && current_time < end
        } else {
            // Overnight block e.g. 22:00–06:00
            current_time >= start || current_time < end
        };
        if !in_window {
            continue;
        }

        for p in &block.blocked_apps {
            sched_apps.insert(p.clone());
        }
        for d in &block.blocked_sites {
            sched_sites.insert(d.clone());
        }
    }

    // ── Time-unlock overrides ─────────────────────────────────────────────
    let mut unlocked_apps: HashSet<String> = HashSet::new();
    let mut unlocked_sites: HashSet<String> = HashSet::new();

    for rule in &unlock_rules {
        if !rule.enabled || today_minutes < rule.required_minutes {
            continue;
        }
        if let Some(p) = &rule.process_name {
            unlocked_apps.insert(p.clone());
        }
        if let Some(d) = &rule.domain {
            unlocked_sites.insert(d.clone());
        }
    }

    // ── Kill blocked apps ─────────────────────────────────────────────────
    // Permanent list (only when global blocker is on)
    if blocker_on {
        for entry in &permanent_apps {
            if !entry.enabled || unlocked_apps.contains(&entry.process_name) {
                continue;
            }
            if entry.block_mode == "focus_only" && !timer_active {
                continue;
            }
            if is_running(&entry.process_name) {
                let name = entry.process_name.clone();
                std::thread::spawn(move || kill_app(&name));
            }
        }
    }

    // Schedule-based blocking (active regardless of global toggle)
    for proc_name in &sched_apps {
        if unlocked_apps.contains(proc_name) {
            continue;
        }
        if is_running(proc_name) {
            let name = proc_name.clone();
            std::thread::spawn(move || kill_app(&name));
        }
    }

    // ── Compute domain set and sync hosts ─────────────────────────────────
    // Use BTreeSet so the order is stable → hosts::apply can diff correctly.
    let mut domains: BTreeSet<String> = BTreeSet::new();

    if blocker_on {
        for site in &permanent_sites {
            if site.enabled && !unlocked_sites.contains(&site.domain) {
                domains.insert(site.domain.clone());
            }
        }
    }
    for domain in &sched_sites {
        if !unlocked_sites.contains(domain) {
            domains.insert(domain.clone());
        }
    }

    let domain_vec: Vec<String> = domains.into_iter().collect();

    // Spawn a thread so the macOS password dialog (if needed) doesn't block
    // the tokio runtime thread that drives the tick loop.
    // The mutex serialises concurrent attempts so only one dialog appears.
    std::thread::spawn(move || {
        let _guard = hosts_write_lock().lock().unwrap_or_else(|e| e.into_inner());
        let _ = hosts::apply(&domain_vec);
    });
}
