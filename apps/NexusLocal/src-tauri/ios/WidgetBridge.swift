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

/// Diagnostics: write the APP process's App Group state + a write/read-back probe
/// to tmp/appgroup_debug.txt for the Rust `appgroup_debug` command to surface in
/// the UI. Lets us compare the app's view against the widget's without a cable.
@_silgen_name("appgroup_debug_c")
public func appgroupDebugC() {
    let d = AppGroup.defaults
    d?.set("probe", forKey: "debugProbe")
    let readback = (d?.string(forKey: "debugProbe") == "probe")
    let text = AppGroup.debugInfo() + "\nprobe:\(readback ? "OK" : "FAIL")"
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("appgroup_debug.txt")
    try? text.write(to: url, atomically: true, encoding: .utf8)
}
#endif
