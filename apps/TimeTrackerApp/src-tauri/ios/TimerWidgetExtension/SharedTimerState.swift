import Foundation

private let kAppGroup = "group.com.bastianthomsen.timetracker"
private let kStateKey  = "timerWidgetState"

// MARK: - Model

struct RecentTask: Codable, Identifiable, Hashable {
    var taskName: String
    var projectName: String
    var id: String { taskName + "|" + projectName }
}

struct SharedTimerState: Codable {
    var isRunning: Bool
    var taskName: String
    var projectName: String
    /// Unix timestamp (seconds) of the adjusted timer start.
    /// When `isRunning` is false this field is ignored.
    var startTimestamp: Double
    var todayTotalSeconds: Int
    var recentTasks: [RecentTask]

    static var empty: SharedTimerState {
        SharedTimerState(
            isRunning: false,
            taskName: "",
            projectName: "",
            startTimestamp: 0,
            todayTotalSeconds: 0,
            recentTasks: []
        )
    }
}

// MARK: - Reader

func loadSharedTimerState() -> SharedTimerState {
    guard
        let json = UserDefaults(suiteName: kAppGroup)?.string(forKey: kStateKey),
        let data = json.data(using: .utf8),
        let state = try? JSONDecoder().decode(SharedTimerState.self, from: data)
    else {
        return .empty
    }
    return state
}
