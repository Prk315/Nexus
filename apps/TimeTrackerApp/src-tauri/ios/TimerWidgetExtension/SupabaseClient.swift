import Foundation

enum SupabaseError: Error {
    case badURL
    case networkError(Error)
    case decodingError(Error)
    case httpError(Int)
}

struct SupabaseClient {
    private let baseURL: String
    private let anonKey: String

    init(url: String = Secrets.supabaseURL, key: String = Secrets.supabaseAnon) {
        self.baseURL = url
        self.anonKey = key
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

        var request = URLRequest(url: url, timeoutInterval: 8)
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
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
}
