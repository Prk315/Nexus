import WidgetKit
import Foundation

// MARK: - Timeline entry

struct TimerEntry: TimelineEntry {
    let date: Date
    let state: SharedTimerState
}

// MARK: - Supabase response models

private struct ActiveSessionRow: Decodable {
    let task_name: String
    let project: String?
    let start_time: String
}

private struct TimeEntryRow: Decodable {
    let duration_seconds: Int
}

private struct RecentTaskRow: Decodable {
    let task_name: String
    let project: String?
}

// MARK: - Provider (fetches from Supabase directly)

struct TimerProvider: TimelineProvider {
    private let client = SupabaseClient()

    func placeholder(in context: Context) -> TimerEntry {
        TimerEntry(date: .now, state: .empty)
    }

    func getSnapshot(in context: Context, completion: @escaping (TimerEntry) -> Void) {
        if context.isPreview {
            completion(TimerEntry(date: .now, state: .empty))
            return
        }
        Task { completion(TimerEntry(date: .now, state: await fetchState())) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TimerEntry>) -> Void) {
        Task {
            let state = await fetchState()
            let entry = TimerEntry(date: .now, state: state)

            let next = Calendar.current.date(
                byAdding: .minute,
                value: state.isRunning ? 15 : 30,
                to: .now
            ) ?? .now.addingTimeInterval(900)

            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    // MARK: - Supabase fetch

    private func fetchState() async -> SharedTimerState {
        let uid = Secrets.userID

        // Fetch active session
        let activeSessions: [ActiveSessionRow] = (try? await client.fetch(
            table: "active_sessions",
            select: "task_name,project,start_time",
            filters: ["user_id": "eq.\(uid)"]
        )) ?? []

        // Fetch today's completed entries for total (filter by start_time >= today midnight)
        let todayStart = todayMidnightISO()
        let todayEntries: [TimeEntryRow] = (try? await client.fetch(
            table: "time_entries",
            select: "duration_seconds",
            filters: ["user_id": "eq.\(uid)", "start_time": "gte.\(todayStart)"]
        )) ?? []

        let todayTotal = todayEntries.reduce(0) { $0 + $1.duration_seconds }

        // Fetch recent entries for Quick Start (order by created_at desc, limit 20)
        let recentRows: [RecentTaskRow] = (try? await client.fetch(
            table: "time_entries",
            select: "task_name,project",
            filters: ["user_id": "eq.\(uid)", "order": "created_at.desc", "limit": "20"]
        )) ?? []

        // Deduplicate recent tasks
        var seen = Set<String>()
        var recentTasks: [RecentTask] = []
        for row in recentRows {
            let key = "\(row.task_name)|\(row.project ?? "")"
            if !seen.contains(key) {
                seen.insert(key)
                recentTasks.append(RecentTask(taskName: row.task_name, projectName: row.project ?? ""))
            }
            if recentTasks.count >= 5 { break }
        }

        if let session = activeSessions.first {
            let startTimestamp = parseISO8601(session.start_time)?.timeIntervalSince1970 ?? 0
            return SharedTimerState(
                isRunning: true,
                taskName: session.task_name,
                projectName: session.project ?? "",
                startTimestamp: startTimestamp,
                todayTotalSeconds: todayTotal,
                recentTasks: recentTasks
            )
        } else {
            return SharedTimerState(
                isRunning: false,
                taskName: "",
                projectName: "",
                startTimestamp: 0,
                todayTotalSeconds: todayTotal,
                recentTasks: recentTasks
            )
        }
    }

    // MARK: - Helpers

    private func todayMidnightISO() -> String {
        let cal = Calendar.current
        let midnight = cal.startOfDay(for: Date())
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: midnight)
    }

    private func parseISO8601(_ str: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: str) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: str)
    }
}
