import Foundation

/// The Supabase session the host app bridges into the App Group (written by
/// WidgetBridge.swift's `store_session_c`). The widget reads it here to make
/// authenticated, RLS-scoped queries.
struct NexusSession: Codable {
    let access_token: String
    let refresh_token: String
    let expires_at: Double // unix seconds
    let user_id: String
}

/// Which channel the session actually came through. Surfaced in the widget UI so
/// the free-tier entitlement question is answered by observation, not assumption
/// — the App Group looked fine until an on-device probe reported `ctr:NIL`.
enum AuthSource: String {
    case keychain = "kc"
    case appGroup = "ag"
    case none = "—"
}

enum SessionStore {
    // Resolved at runtime via AppGroup.identifier so it matches the App Group
    // SideStore actually assigns during re-signing (see AppGroup.swift).
    static let key = "nexusSession"

    private static func decode(_ json: String?) -> NexusSession? {
        guard
            let json = json,
            let data = json.data(using: .utf8),
            let s = try? JSONDecoder().decode(NexusSession.self, from: data)
        else { return nil }
        return s
    }

    /// Keychain first (the channel that may work on free provisioning), then the
    /// App Group (works on Simulator / paid accounts).
    static func loadWithSource() -> (session: NexusSession, source: AuthSource)? {
        if let s = decode(KeychainSession.load()) { return (s, .keychain) }
        if let s = decode(AppGroup.defaults?.string(forKey: key)) { return (s, .appGroup) }
        return nil
    }

    static func load() -> NexusSession? { loadWithSource()?.session }

    static func save(_ s: NexusSession) {
        guard
            let data = try? JSONEncoder().encode(s),
            let json = String(data: data, encoding: .utf8)
        else { return }
        // Refreshed tokens go back to both channels so the app and widget stay
        // in sync regardless of which one is actually functioning.
        KeychainSession.save(json)
        AppGroup.defaults?.set(json, forKey: key)
    }

    /// A currently-valid access token + the user id, refreshing if the stored
    /// token is within 60s of expiry. Returns nil if there's no session (signed
    /// out). The host app bridges fresh sessions on every auth change while it's
    /// running, so the widget usually only refreshes itself when the app hasn't
    /// run for over an hour.
    static func validAuth() async -> (token: String, userID: String, source: AuthSource)? {
        guard let (s, source) = loadWithSource() else { return nil }
        let now = Date().timeIntervalSince1970
        if s.expires_at - 60 > now {
            return (s.access_token, s.user_id, source)
        }
        if let refreshed = await refresh(s.refresh_token) {
            save(refreshed)
            return (refreshed.access_token, refreshed.user_id, source)
        }
        // Refresh failed — fall back to the stored token (may still work within
        // the rotation reuse window).
        return (s.access_token, s.user_id, source)
    }

    private struct TokenResponse: Codable {
        let access_token: String
        let refresh_token: String
        let expires_at: Double?
        let expires_in: Double?
        let user: TokenUser?
        struct TokenUser: Codable { let id: String }
    }

    /// Exchange a refresh token for a fresh session via Supabase Auth.
    /// NOTE: Supabase rotates refresh tokens; the new one is saved back to the
    /// App Group. If the host app refreshes concurrently a rotation race is
    /// possible (mitigated by Supabase's reuse interval) — acceptable for a
    /// single user; revisit if it causes spurious sign-outs.
    static func refresh(_ refreshToken: String) async -> NexusSession? {
        guard var comps = URLComponents(string: "\(Secrets.supabaseURL)/auth/v1/token") else { return nil }
        comps.queryItems = [URLQueryItem(name: "grant_type", value: "refresh_token")]
        guard let url = comps.url else { return nil }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue(Secrets.supabaseAnon, forHTTPHeaderField: "apikey")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["refresh_token": refreshToken])

        guard
            let (data, resp) = try? await URLSession.shared.data(for: req),
            let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode),
            let tr = try? JSONDecoder().decode(TokenResponse.self, from: data)
        else { return nil }

        let expiresAt = tr.expires_at ?? (Date().timeIntervalSince1970 + (tr.expires_in ?? 3600))
        return NexusSession(
            access_token: tr.access_token,
            refresh_token: tr.refresh_token,
            expires_at: expiresAt,
            user_id: tr.user?.id ?? load()?.user_id ?? ""
        )
    }
}
