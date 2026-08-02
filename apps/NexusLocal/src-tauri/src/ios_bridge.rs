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
