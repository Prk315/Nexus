//! Bridge for sharing the authenticated Supabase session with the widget
//! extension via the App Group. The webview logs in (nexus-core auth) and calls
//! `store_session` whenever the session changes; on iOS this hands the token
//! blob to Swift (`WidgetBridge.swift`), which writes it into the shared App
//! Group container the widget reads from. No-ops on desktop so the same
//! frontend code runs everywhere.

#[cfg(target_os = "ios")]
extern "C" {
    fn store_session_c(json: *const std::os::raw::c_char);
    fn clear_session_c();
    fn appgroup_debug_c();
    fn keychain_debug_c();
}

/// Persist the Supabase session JSON ({access_token, refresh_token, expires_at,
/// user_id}) into the App Group for the widget.
#[tauri::command]
pub fn store_session(session_json: String) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let c = std::ffi::CString::new(session_json).map_err(|e| e.to_string())?;
        // SAFETY: Swift copies the string before returning; the pointer only
        // needs to be valid for the duration of the call.
        unsafe { store_session_c(c.as_ptr()) };
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = session_json;
    }
    Ok(())
}

/// Clear the shared session on sign-out.
#[tauri::command]
pub fn clear_session() -> Result<(), String> {
    #[cfg(target_os = "ios")]
    unsafe {
        clear_session_c()
    };
    Ok(())
}

/// Diagnostics: the APP process's App Group resolution + write/read-back probe.
/// Surfaced in the status UI to debug the widget session bridge (paired with the
/// widget's own on-screen diagnostics).
#[tauri::command]
pub fn appgroup_debug() -> String {
    #[cfg(target_os = "ios")]
    {
        // SAFETY: no args; Swift writes the diagnostic file synchronously.
        unsafe { appgroup_debug_c() };
        let path = std::env::temp_dir().join("appgroup_debug.txt");
        std::fs::read_to_string(path).unwrap_or_else(|_| "no debug file written".to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        "App Group debug is iOS-only".to_string()
    }
}

/// Diagnostics: the APP process's shared-keychain resolution + whether the
/// session is readable from it. Compare against the widget's own badge/readout:
/// if the app reports `sess:yes` but the widget still falls back to anon, the
/// keychain access group did not survive re-signing. If the app itself reports
/// `sess:no`, nothing was ever written (not signed in, or the write was denied)
/// and the sharing question is still unanswered.
#[tauri::command]
pub fn keychain_debug() -> String {
    #[cfg(target_os = "ios")]
    {
        // SAFETY: no args; Swift writes the diagnostic file synchronously.
        unsafe { keychain_debug_c() };
        let path = std::env::temp_dir().join("keychain_debug.txt");
        std::fs::read_to_string(path).unwrap_or_else(|_| "no debug file written".to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        "Keychain debug is iOS-only".to_string()
    }
}
