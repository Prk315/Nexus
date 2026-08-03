import SwiftUI

// MARK: - Supabase row models for the Phase-C widgets

struct HabitRow: Codable {
    let id: String
    let name: String
    let archived: Bool
}

struct HabitCompletionRow: Codable {
    let habit_id: String
    let date: String
}

struct SleepRow: Codable {
    let date: String
    let quality_score: Double?
    let duration_min: Int?
    let deep_sleep_min: Int?
    let rem_sleep_min: Int?
    let light_sleep_min: Int?
}

struct TaskDetailRow: Codable {
    let id: String
    let title: String
    let priority: String?
    let due_date: String?
}

struct ActiveSessionRow: Codable {
    let task_name: String?
    let project: String?
    let elapsed_seconds: Int?
    let start_time: String?
    let paused_at: String?
}

struct TimeEntryRow: Codable {
    let duration_seconds: Int?
    let start_time: String?
}

// MARK: - TimeTracker uses a fixed user_id (not the auth uid)

let kTimeTrackerUserID = "default"

// MARK: - Formatting helpers

/// Minutes → "7h 4m" (or "45m").
func formatMinutes(_ minutes: Int) -> String {
    let h = minutes / 60
    let m = minutes % 60
    return h > 0 ? "\(h)h \(m)m" : "\(m)m"
}

/// Seconds → "7h 4m".
func formatSeconds(_ seconds: Int) -> String {
    formatMinutes(seconds / 60)
}

func priorityColor(_ p: String?) -> Color {
    switch p {
    case "high":   return wRed
    case "medium": return wAmber
    default:       return wSecondary
    }
}

func priorityRank(_ p: String?) -> Int {
    switch p {
    case "high":   return 0
    case "medium": return 1
    default:       return 2
    }
}
