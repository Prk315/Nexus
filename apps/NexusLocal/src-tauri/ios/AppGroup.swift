import Foundation

/// Resolves the App Group container identifier at runtime.
///
/// AltStore/SideStore rewrite App Group IDs during on-device re-signing — they
/// append the developer team ID so the group is unique on a free Apple account —
/// and record the real identifiers in the app's (and each extension's) Info.plist
/// under the `ALTAppGroups` array. Hardcoding the original ID therefore silently
/// breaks the app↔widget shared container after a SideStore install:
/// `UserDefaults(suiteName:)` for a group the process isn't entitled to returns a
/// non-shared store, so the session the app writes is invisible to the widget.
///
/// Read `ALTAppGroups` first and pick the entry derived from our base group; fall
/// back to the compile-time ID for App Store / Xcode / simulator builds where the
/// entitlement is untouched. This mirrors AltStore's own `Bundle+AltStore.swift`.
enum AppGroup {
    /// The compile-time group as declared in the entitlements / project.yml.
    static let base = "group.com.bastianthomsen.nexuslocal"
    /// Substring that identifies our group among any AltStore rewrites.
    private static let marker = "com.bastianthomsen.nexuslocal"

    static var identifier: String {
        if let groups = Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String],
           !groups.isEmpty {
            return groups.first(where: { $0.contains(marker) }) ?? groups.first ?? base
        }
        return base
    }

    /// Shared defaults for the resolved group (nil only if the process truly
    /// isn't entitled to any matching group).
    static var defaults: UserDefaults? { UserDefaults(suiteName: identifier) }

    /// Compact human-readable diagnostics for the App Group plumbing, so the
    /// app↔widget session bridge can be debugged from the UI (no cable needed).
    /// Runs per-process: call it in the app AND the widget to compare both sides.
    ///   alt  — how many groups SideStore injected into ALTAppGroups (0 = none →
    ///          we fell back to `base`, which likely isn't entitled)
    ///   grp  — the group actually resolved + used for UserDefaults(suiteName:)
    ///   ctr  — whether this process is entitled to that group's container
    ///          (NIL = the App Group entitlement didn't survive re-signing)
    ///   sess — whether the shared session key is currently present
    static func debugInfo() -> String {
        let alt = (Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String]) ?? []
        let id = identifier
        let ctr = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id) != nil
        let hasSession = UserDefaults(suiteName: id)?.string(forKey: "nexusSession") != nil
        let altTails = alt.map { "…" + $0.suffix(14) }.joined(separator: " ")
        return """
        alt:\(alt.count) [\(altTails)]
        grp:…\(id.suffix(20))
        ctr:\(ctr ? "OK" : "NIL")  sess:\(hasSession ? "yes" : "no")
        """
    }
}
