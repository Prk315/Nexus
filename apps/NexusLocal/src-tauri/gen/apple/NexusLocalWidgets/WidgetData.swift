import SwiftUI

// MARK: - Supabase row models for the Phase-C widgets

struct HabitRow: Codable {
    let id: String
    let name: String
    let archived: Bool
    /// Monday = 0 … Sunday = 6. `nil` means every day (Protocol's convention:
    /// selecting all seven days normalises back to null).
    let repeat_days: [Int]?
    let scheduled_time: String?   // "HH:MM:SS"
    let sort_order: Int?

    // Optional so callers that select a narrower column list still decode
    // (synthesised Codable uses decodeIfPresent for Optionals).
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
    /// pf_tasks.id is a bigint. Declaring this as String made the *whole* array
    /// decode throw, which `try?` turned into [] — the widget silently showed
    /// "0 open" while 10 tasks were outstanding.
    let id: Int
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
    /// Only selected by the "what should a start tap be called" query. Optional
    /// like the rest, so the narrower today-totals select still decodes
    /// (synthesised Codable uses decodeIfPresent for Optionals) — declaring it
    /// non-optional would make that whole array throw and silently become [].
    let task_name: String?
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
