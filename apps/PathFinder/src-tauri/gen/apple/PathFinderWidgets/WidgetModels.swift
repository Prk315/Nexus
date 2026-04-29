import Foundation
import SwiftUI

// MARK: - Supabase row types

struct PrimaryGoalRow: Codable {
    let text: String
    let time_estimate_min: Int?
}

struct SecondaryGoalRow: Codable {
    let id: Int
    let text: String
    let sort_order: Int
}

struct HabitRow: Codable {
    let id: Int
    let title: String
    let color: String
    let sort_order: Int
}

struct HabitCompletion: Codable {
    let habit_id: Int
    let date: String
}

struct SystemRow: Codable {
    let id: Int
    let title: String
    let frequency: String
    let days_of_week: String?
    let last_done: String?
    let streak_count: Int
}

/// Lightweight task row used by TodayFocusWidget (count-only queries).
struct TaskRow: Codable {
    let id: Int
    let done: Bool
    let due_date: String?
}

/// Full task row used by TasksWidget (needs title + priority).
struct TaskDetailRow: Codable {
    let id: Int
    let title: String
    let done: Bool
    let due_date: String?
    let priority: String
}

/// Active goal row used by GoalsWidget.
struct GoalRow: Codable {
    let id: Int
    let title: String
    let priority: String
    let deadline: String?
}

/// Minimal row for counting goals by status (avoids decoding unused fields).
struct GoalCountRow: Codable {
    let id: Int
}

// MARK: - Widget entry models

struct HabitEntry {
    let title: String
    let color: String
    let done: Bool
    let streak: Int
}

/// Processed task item for TasksWidget views.
struct TaskItem: Identifiable {
    let id: Int
    let title: String
    let priority: String
    let isOverdue: Bool
}

// MARK: - WidgetKit background compatibility

extension View {
    /// Applies .containerBackground on iOS 17+ and .background on iOS 16.x.
    /// WidgetKit requires .containerBackground on iOS 17+; using it on a 16.0
    /// deployment target without this guard causes a compile-time availability warning.
    @ViewBuilder
    func widgetBackground(_ color: Color) -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(color, for: .widget)
        } else {
            self.background(color)
        }
    }
}

// MARK: - Shared priority helpers

func priorityOrder(_ p: String) -> Int {
    switch p {
    case "high":   return 0
    case "medium": return 1
    default:       return 2
    }
}

func priorityColor(_ p: String) -> (red: Double, green: Double, blue: Double) {
    switch p {
    case "high":   return (0.95, 0.35, 0.35)  // red
    case "medium": return (0.96, 0.72, 0.00)  // amber
    default:       return (1.0,  1.0,  1.0)   // white (low)
    }
}

// MARK: - Date helpers

func todayString() -> String {
    let fmt = DateFormatter()
    fmt.dateFormat = "yyyy-MM-dd"
    fmt.timeZone = TimeZone.current
    return fmt.string(from: Date())
}

/// Days until a YYYY-MM-DD date string (negative = overdue).
func daysUntil(_ dateStr: String) -> Int? {
    let fmt = DateFormatter()
    fmt.dateFormat = "yyyy-MM-dd"
    fmt.timeZone = TimeZone.current
    guard let target = fmt.date(from: dateStr) else { return nil }
    let startOfToday = Calendar.current.startOfDay(for: Date())
    let startOfTarget = Calendar.current.startOfDay(for: target)
    return Calendar.current.dateComponents([.day], from: startOfToday, to: startOfTarget).day
}

/// Mirror of isDue() from Systems.tsx
func systemIsDue(_ sys: SystemRow) -> Bool {
    let today = todayString()

    if let dowStr = sys.days_of_week, !dowStr.isEmpty {
        let cal = Calendar.current
        let todayDow = cal.component(.weekday, from: Date()) - 1 // 0=Sun
        let days = dowStr.split(separator: ",").compactMap { Int($0) }
        guard days.contains(todayDow) else { return false }
        guard let lastDone = sys.last_done else { return true }
        return String(lastDone.prefix(10)) != today
    }

    guard let lastDoneStr = sys.last_done,
          let lastDone = ISO8601DateFormatter().date(from: lastDoneStr + "T00:00:00Z") else {
        return true
    }

    let diffDays = Date().timeIntervalSince(lastDone) / 86_400
    switch sys.frequency {
    case "daily":   return diffDays >= 1
    case "weekly":  return diffDays >= 7
    default:        return diffDays >= 30
    }
}
