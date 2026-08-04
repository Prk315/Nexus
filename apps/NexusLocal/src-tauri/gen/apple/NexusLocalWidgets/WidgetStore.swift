import Foundation

/// Widget-local persistent state: which page of a paged list is showing, and
/// short-lived optimistic overrides so a tapped row repaints instantly instead
/// of waiting for Supabase to agree.
///
/// Uses the App Group when the process is entitled to one, falling back to the
/// extension's own `UserDefaults.standard`. Both the timeline provider and the
/// AppIntent that mutates this run inside the widget extension process, so the
/// fallback is consistent with itself — the App Group is a bonus (it lets the
/// host app clear overrides), never a requirement.
enum WidgetStore {
    private static var store: UserDefaults { AppGroup.defaults ?? .standard }

    // MARK: - Paging

    static func page(_ kind: String) -> Int { store.integer(forKey: "page.\(kind)") }

    static func setPage(_ kind: String, _ value: Int) {
        store.set(max(0, value), forKey: "page.\(kind)")
    }

    // MARK: - Optimistic habit overrides

    /// An override is trusted for this long. Beyond it we always believe the
    /// server — so a failed write can never leave the widget permanently lying.
    private static let overrideTTL: TimeInterval = 120
    private static let overridesKey = "habitOverrides"

    struct Override: Codable {
        let done: Bool
        let at: Double  // unix seconds
    }

    static func overrideKey(_ habitID: String, _ date: String) -> String { "\(habitID)|\(date)" }

    /// Overrides that are still within the TTL.
    static func loadOverrides() -> [String: Override] {
        guard
            let data = store.data(forKey: overridesKey),
            let map = try? JSONDecoder().decode([String: Override].self, from: data)
        else { return [:] }
        let cutoff = Date().timeIntervalSince1970 - overrideTTL
        return map.filter { $0.value.at >= cutoff }
    }

    static func setOverride(habitID: String, date: String, done: Bool) {
        var map = loadOverrides()
        map[overrideKey(habitID, date)] = Override(done: done, at: Date().timeIntervalSince1970)
        persist(map)
    }

    /// Drop an override once the server has caught up with it.
    static func clearOverride(habitID: String, date: String) {
        var map = loadOverrides()
        guard map.removeValue(forKey: overrideKey(habitID, date)) != nil else { return }
        persist(map)
    }

    private static func persist(_ map: [String: Override]) {
        guard let data = try? JSONEncoder().encode(map) else { return }
        store.set(data, forKey: overridesKey)
    }
}
