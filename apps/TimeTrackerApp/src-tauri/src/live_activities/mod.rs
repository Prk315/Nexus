/// Live Activities / Dynamic Island bridge for iOS.
///
/// On iOS builds the Swift functions are compiled into the binary from
/// `src-tauri/ios/{LiveActivitiesBridge,WidgetBridge}.swift`.
/// On every other platform all Tauri commands are no-ops.

// ── FFI declarations (iOS only) ─────────────────────────────────────────────

#[cfg(target_os = "ios")]
extern "C" {
    fn start_live_activity_c(
        task_name: *const std::os::raw::c_char,
        project_name: *const std::os::raw::c_char,
        start_timestamp: f64,
    );
    fn end_live_activity_c();
    fn sync_widget_state_c(json: *const std::os::raw::c_char);
}

// ── Tauri commands ───────────────────────────────────────────────────────────

/// Called from JS immediately after `start_timer` succeeds.
/// `start_timestamp`: Unix seconds (f64) matching the timer's start time.
#[tauri::command]
pub fn start_live_activity(task_name: String, project_name: String, start_timestamp: f64) {
    #[cfg(target_os = "ios")]
    {
        use std::ffi::CString;
        let task_c = CString::new(task_name).unwrap_or_default();
        let project_c = CString::new(project_name).unwrap_or_default();
        // SAFETY: pointers are valid for the duration of the call; Swift copies
        // the strings before returning.
        unsafe {
            start_live_activity_c(task_c.as_ptr(), project_c.as_ptr(), start_timestamp);
        }
    }
    // Suppress unused-variable warnings on non-iOS targets.
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (task_name, project_name, start_timestamp);
    }
}

/// Called from JS immediately after `stop_timer` or `pause_timer` succeeds.
#[tauri::command]
pub fn end_live_activity() {
    #[cfg(target_os = "ios")]
    unsafe {
        end_live_activity_c();
    }
}

/// Snapshot the current timer state and push it to the widget extension via
/// the App Group. Widgets read this JSON and reload their timelines.
/// Called from JS after every timer start / stop / pause / resume.
#[tauri::command]
pub fn sync_widget_state(state: tauri::State<crate::db::AppState>) {
    #[cfg(target_os = "ios")]
    {
        use crate::db::{entries, timer};
        use std::ffi::CString;

        let db = match state.db.lock() {
            Ok(d) => d,
            Err(_) => return,
        };

        let status = timer::get_status(&db)
            .unwrap_or_else(|_| crate::models::TimerStatus { active: None, paused: None });
        let today_secs = entries::today_total_seconds(&db).unwrap_or(0);
        let recent_pairs = entries::get_recent_tasks(&db, 5).unwrap_or_default();

        let is_running = status.active.is_some();
        let (task_name, project_name, start_ts) = if let Some(ref s) = status.active {
            let ts = chrono::DateTime::parse_from_rfc3339(&s.start_time)
                .map(|dt| dt.timestamp() as f64)
                .or_else(|_| {
                    chrono::NaiveDateTime::parse_from_str(&s.start_time, "%Y-%m-%dT%H:%M:%S%.3f")
                        .map(|ndt| {
                            ndt.and_local_timezone(chrono::Local)
                                .unwrap()
                                .timestamp() as f64
                        })
                })
                .unwrap_or(0.0);
            (s.task_name.clone(), s.project.clone().unwrap_or_default(), ts)
        } else {
            (String::new(), String::new(), 0.0)
        };

        // Build a minimal JSON payload matching SharedTimerState on the Swift side.
        let recent_json: String = recent_pairs
            .iter()
            .map(|(t, p)| {
                format!(
                    r#"{{"taskName":{},"projectName":{}}}"#,
                    serde_json::to_string(t).unwrap_or_default(),
                    serde_json::to_string(p).unwrap_or_default(),
                )
            })
            .collect::<Vec<_>>()
            .join(",");

        let json = format!(
            r#"{{"isRunning":{},"taskName":{},"projectName":{},"startTimestamp":{},"todayTotalSeconds":{},"recentTasks":[{}]}}"#,
            is_running,
            serde_json::to_string(&task_name).unwrap_or_default(),
            serde_json::to_string(&project_name).unwrap_or_default(),
            start_ts,
            today_secs,
            recent_json,
        );

        if let Ok(c) = CString::new(json) {
            unsafe { sync_widget_state_c(c.as_ptr()); }
        }
    }
    #[cfg(not(target_os = "ios"))]
    let _ = state;
}
