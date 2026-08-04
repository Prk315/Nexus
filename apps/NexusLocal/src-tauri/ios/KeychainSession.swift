import Foundation
import Security

/// Shared-keychain channel for the Supabase session — the replacement for the
/// App Group, which free-tier provisioning cannot grant (on-device SideStore
/// debug showed `ctr:NIL`; see commit bbf60f1).
///
/// Why this might succeed where App Groups failed: an App Group identifier must
/// be registered in Apple's developer portal, which a free account cannot do. A
/// keychain access group needs no registration — it is simply
/// `<AppIdentifierPrefix>.<bundle-id>`, derived from the signing team. The app
/// and its widget extension are re-signed with the SAME team, so they land in a
/// shared group even after SideStore rewrites the prefix.
///
/// ⚠️ The iOS **Simulator ignores keychain access groups entirely** — every
/// process shares one keychain. A passing simulator test therefore proves only
/// that the code path works, NEVER that the entitlement survives re-signing.
/// This must be confirmed on a real device via SideStore before any anon RLS
/// policy is dropped.
enum KeychainSession {
    private static let service = "com.bastianthomsen.nexuslocal.session"
    private static let account = "nexusSession"
    private static let bundlePrefix = "com.bastianthomsen.nexuslocal"

    // MARK: - Access group resolution

    /// The team prefix, discovered by round-tripping a throwaway item and reading
    /// back the access group iOS assigned it (`<prefix>.<bundle-id>`). This uses
    /// only public API, so it can't break the way entitlement introspection can,
    /// and it survives SideStore rewriting the team ID.
    private static func teamPrefix() -> String? {
        let probe: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "nexuslocal.probe",
            kSecAttrAccount as String: "nexuslocal.probe",
        ]
        var read = probe
        read[kSecReturnAttributes as String] = true
        read[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        var status = SecItemCopyMatching(read as CFDictionary, &item)

        if status == errSecItemNotFound {
            var add = probe
            add[kSecValueData as String] = Data("probe".utf8)
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            SecItemAdd(add as CFDictionary, nil)
            status = SecItemCopyMatching(read as CFDictionary, &item)
        }

        guard
            status == errSecSuccess,
            let attrs = item as? [String: Any],
            let group = attrs[kSecAttrAccessGroup as String] as? String,
            let dot = group.firstIndex(of: ".")
        else { return nil }

        return String(group[group.startIndex..<dot])
    }

    /// The shared group both targets declare in `keychain-access-groups`.
    static var accessGroup: String? {
        guard let prefix = teamPrefix() else { return nil }
        return "\(prefix).\(bundlePrefix)"
    }

    // MARK: - Session storage

    @discardableResult
    static func save(_ json: String) -> Bool {
        guard let data = json.data(using: .utf8) else { return false }

        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let group = accessGroup { query[kSecAttrAccessGroup as String] = group }

        SecItemDelete(query as CFDictionary)

        var attrs = query
        attrs[kSecValueData as String] = data
        // Widgets refresh while the device is locked, so the item must survive a
        // locked screen — AfterFirstUnlock is the least-permissive class that does.
        attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

        return SecItemAdd(attrs as CFDictionary, nil) == errSecSuccess
    }

    static func load() -> String? {
        // Deliberately OMIT kSecAttrAccessGroup: the search then spans every group
        // this process is entitled to, so a prefix we failed to predict still resolves.
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var item: CFTypeRef?
        guard
            SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
            let data = item as? Data
        else { return nil }

        return String(data: data, encoding: .utf8)
    }

    static func clear() {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let group = accessGroup { query[kSecAttrAccessGroup as String] = group }
        SecItemDelete(query as CFDictionary)
    }

    /// Per-process diagnostics — call from BOTH the app and the widget and compare.
    /// `grp` differing between the two, or `sess:no` in the widget while the app
    /// says `sess:yes`, means the shared group did not survive re-signing.
    static func debugInfo() -> String {
        "kc grp:…\((accessGroup ?? "nil").suffix(28))  sess:\(load() != nil ? "yes" : "no")"
    }
}
