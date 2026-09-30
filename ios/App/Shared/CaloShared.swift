// Общее для приложения и виджета: данные, которые приложение кладёт в App Group,
// и запросы к API с токеном (Authorization: Bearer). ARCHITECTURE.md §11.
import Foundation

enum CaloShared {
    static let appGroup = "group.am.egor.calo"
    static let defaults = UserDefaults(suiteName: appGroup)

    struct Summary: Codable {
        var date: String
        var kcal: Int
        var norm: Int?
        var protein: Int
        var proteinNorm: Int?
        var fat: Int
        var carbs: Int
        var updatedAt: String
    }

    /// Блюдо для кнопки «+» в виджете.
    struct Dish: Codable, Identifiable, Hashable {
        var id: String
        var name: String
        var grams: Double
        var kcal: Int
    }

    struct Config: Codable {
        var baseURL: String
        var token: String
    }

    // MARK: — хранилище App Group

    static func save<T: Encodable>(_ value: T, key: String) {
        defaults?.set(try? JSONEncoder().encode(value), forKey: key)
    }

    static func load<T: Decodable>(_ type: T.Type, key: String) -> T? {
        guard let data = defaults?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    static var config: Config? { load(Config.self, key: "config") }
    static var summary: Summary? { load(Summary.self, key: "summary") }
    static var dishes: [Dish] { load([Dish].self, key: "dishes") ?? [] }

    // MARK: — API

    static func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) -> URLRequest? {
        guard let cfg = config, let url = URL(string: cfg.baseURL + path) else { return nil }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.httpMethod = method
        req.setValue("Bearer \(cfg.token)", forHTTPHeaderField: "Authorization")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        return req
    }

    /// Свежая сводка дня с сервера; при ошибке — последняя сохранённая.
    static func fetchSummary() async -> Summary? {
        guard let req = request("/api/summary/day") else { return summary }
        do {
            let (data, res) = try await URLSession.shared.data(for: req)
            let status = (res as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200 else {
                note("summary HTTP \(status)")
                return summary
            }
            let fresh = try JSONDecoder().decode(Summary.self, from: data)
            save(fresh, key: "summary")
            return fresh
        } catch {
            note("summary: \(error.localizedDescription)")
            return summary
        }
    }

    /// Записать блюдо в дневник (кнопка виджета). true — записано.
    static func addDish(_ dish: Dish) async -> Bool {
        let body: [String: Any] = [
            "recipeId": dish.id,
            "grams": dish.grams,
            "eatenAt": ISO8601DateFormatter().string(from: Date()),
        ]
        guard let req = request("/api/entries", method: "POST", body: body) else {
            note("нет config")
            return false
        }
        do {
            let (_, res) = try await URLSession.shared.data(for: req)
            let status = (res as? HTTPURLResponse)?.statusCode ?? 0
            note("HTTP \(status)")
            return status == 201
        } catch {
            note("сеть: \(error.localizedDescription)")
            return false
        }
    }

    /// Итог последнего нажатия «+» — для отладки (читается с Mac через devicectl).
    /// Пишется файлом, а не в UserDefaults: процесс виджета живёт секунды и не успевает их сбросить.
    static func note(_ text: String) {
        guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return }
        let url = dir.appendingPathComponent("widget-log.txt")
        let line = "\(ISO8601DateFormatter().string(from: Date())) \(text)\n"
        let old = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        try? (String(old.suffix(4000)) + line).write(to: url, atomically: true, encoding: .utf8)
    }
}
