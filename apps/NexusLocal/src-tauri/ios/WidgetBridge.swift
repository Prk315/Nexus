#if os(iOS)
import Foundation
import WidgetKit

private let kSessionKey = "nexusSession"

/// Called from Rust with a JSON Supabase session blob
/// ({access_token, refresh_token, expires_at, user_id}). The widget runs in a
/// separate process and can't see the webview's localStorage, so we stash the
/// session in the shared App Group container for it to read. The group is
/// resolved via `AppGroup.identifier` so it survives SideStore's re-signing
/// rewrite (see AppGroup.swift).
@_silgen_name("store_session_c")
public func storeSessionC(_ jsonPtr: UnsafePointer<CChar>) {
    let json = String(cString: jsonPtr) // copy immediately; pointer isn't retained
    DispatchQueue.main.async {
        AppGroup.defaults?.set(json, forKey: kSessionKey)
        WidgetCenter.shared.reloadAllTimelines()
    }
}

/// Clear the stored session on sign-out.
@_silgen_name("clear_session_c")
public func clearSessionC() {
    DispatchQueue.main.async {
        AppGroup.defaults?.removeObject(forKey: kSessionKey)
        WidgetCenter.shared.reloadAllTimelines()
    }
}
#endif
