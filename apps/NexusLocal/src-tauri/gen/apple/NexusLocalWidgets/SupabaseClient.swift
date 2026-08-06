import Foundation

enum SupabaseError: Error {
    case badURL
    case networkError(Error)
    case decodingError(Error)
    case httpError(Int)
}

/// Minimal Supabase PostgREST client — the widget fetches directly from the
/// cloud (no App Group, no host app required), using the publishable anon key.
struct SupabaseClient {
    private let baseURL: String
    private let anonKey: String
    private let bearer: String

    /// Pass `accessToken` (a user JWT) to make RLS-scoped requests; without it
    /// the anon key is used as the bearer (only works on anon-open tables).
    init(url: String = Secrets.supabaseURL, key: String = Secrets.supabaseAnon, accessToken: String? = nil) {
        self.baseURL = url
        self.anonKey = key
        self.bearer = accessToken ?? key
    }

    func fetch<T: Decodable>(
        table: String,
        select: String = "*",
        filters: [String: String] = [:]
    ) async throws -> [T] {
        var components = URLComponents(string: "\(baseURL)/rest/v1/\(table)")!
        var queryItems = [URLQueryItem(name: "select", value: select)]
        for (key, value) in filters {
            queryItems.append(URLQueryItem(name: key, value: value))
        }
        components.queryItems = queryItems

        guard let url = components.url else { throw SupabaseError.badURL }

        var request = URLRequest(url: url)
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw SupabaseError.networkError(error)
        }

        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw SupabaseError.httpError(http.statusCode)
        }

        do {
            return try JSONDecoder().decode([T].self, from: data)
        } catch {
            throw SupabaseError.decodingError(error)
        }
    }

    /// Invoke an Edge Function with a dedicated single-purpose credential —
    /// deliberately NOT the anon key.
    ///
    /// `key` defaults to `Secrets.widgetKey` (habit-toggle). Pass a different
    /// one to reach a different scoped function — `Secrets.widgetSessionKey` for
    /// `session-toggle`. Each function accepts exactly one key, so the pairing is
    /// the scope: leaking one credential cannot be used against the other's
    /// function, and either can be rotated alone.
    ///
    /// All widget writes go through here. There is intentionally no generic
    /// insert/delete on this client: the anon key has no write policies on any
    /// pf_/protocol_ table, so a direct write would fail anyway, and offering
    /// one would just invite re-opening that hole. Adding a *scoped* function to
    /// this surface is the sanctioned way to add a write; adding a table verb is
    /// not.
    @discardableResult
    func callFunction(
        _ name: String,
        body: [String: Any],
        key: String = Secrets.widgetKey
    ) async -> Bool {
        guard let url = URL(string: "\(baseURL)/functions/v1/\(name)") else { return false }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(key, forHTTPHeaderField: "x-widget-key")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        return await send(request)
    }

    private func applyAuth(_ request: inout URLRequest) {
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
    }

    private func send(_ request: URLRequest) async -> Bool {
        guard
            let (_, response) = try? await URLSession.shared.data(for: request),
            let http = response as? HTTPURLResponse
        else { return false }
        return (200..<300).contains(http.statusCode)
    }
}
