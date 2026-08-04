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
        // Write to BOTH channels. The App Group works on the Simulator and on a
        // paid account; the shared keychain is the candidate that may also work
        // under free provisioning. The widget prefers whichever it can read.
        AppGroup.defaults?.set(json, forKey: kSessionKey)
        KeychainSession.save(json)
        WidgetCenter.shared.reloadAllTimelines()
    }
}

/// Clear the stored session on sign-out — from both channels, or a stale token
/// in the one we didn't clear would keep the widget "signed in" after sign-out.
@_silgen_name("clear_session_c")
public func clearSessionC() {
    DispatchQueue.main.async {
        AppGroup.defaults?.removeObject(forKey: kSessionKey)
        KeychainSession.clear()
        WidgetCenter.shared.reloadAllTimelines()
    }
}

/// Diagnostics: the APP process's view of the shared keychain, written next to
/// the App Group probe so both sides can be compared without a cable.
@_silgen_name("keychain_debug_c")
public func keychainDebugC() {
    let text = KeychainSession.debugInfo()
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("keychain_debug.txt")
    try? text.write(to: url, atomically: true, encoding: .utf8)
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
