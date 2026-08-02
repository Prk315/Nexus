//! Live Activity (Dynamic Island) bridge. The timer itself lives in TimeTracker
//! and syncs to Supabase `active_sessions`; the frontend polls that and calls
//! these commands to start/end the Live Activity. Swift impl lives in
//! `ios/LiveActivitiesBridge.swift`; no-ops off iOS.

#[cfg(target_os = "ios")]
extern "C" {
    fn start_live_activity_c(
        task_name: *const std::os::raw::c_char,
        project_name: *const std::os::raw::c_char,
        start_timestamp: f64,
    );
    fn end_live_activity_c();
}

/// Start (or restart) the timer Live Activity. `start_timestamp` is Unix seconds.
#[tauri::command]
pub fn start_live_activity(task_name: String, project_name: String, start_timestamp: f64) {
    #[cfg(target_os = "ios")]
    {
        use std::ffi::CString;
        let task_c = CString::new(task_name).unwrap_or_default();
        let project_c = CString::new(project_name).unwrap_or_default();
        // SAFETY: pointers valid for the call; Swift copies before returning.
        unsafe { start_live_activity_c(task_c.as_ptr(), project_c.as_ptr(), start_timestamp) };
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (task_name, project_name, start_timestamp);
    }
}

/// End any running timer Live Activity.
#[tauri::command]
pub fn end_live_activity() {
    #[cfg(target_os = "ios")]
    unsafe {
        end_live_activity_c()
    };
}
