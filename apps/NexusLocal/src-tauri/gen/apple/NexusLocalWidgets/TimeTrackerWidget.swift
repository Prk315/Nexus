import WidgetKit
import SwiftUI

struct TimeTrackerEntry: TimelineEntry {
    let date: Date
    let activeTask: String?
    let running: Bool
    let startDate: Date?        // for a live-counting running timer
    let elapsedSeconds: Int     // for paused / fallback
    let todaySeconds: Int
    var signedOut: Bool = false

    static let placeholder = TimeTrackerEntry(
        date: Date(), activeTask: "Deep work", running: true,
        startDate: Date().addingTimeInterval(-3720), elapsedSeconds: 3720,
        todaySeconds: 14400
    )
    static let signedOut = TimeTrackerEntry(
        date: Date(), activeTask: nil, running: false, startDate: nil,
        elapsedSeconds: 0, todaySeconds: 0, signedOut: true
    )
}

struct TimeTrackerProvider: TimelineProvider {
    func placeholder(in context: Context) -> TimeTrackerEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (TimeTrackerEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        Task { completion(await fetchEntry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TimeTrackerEntry>) -> Void) {
        Task {
            let entry = await fetchEntry()
            // Poll more often when a timer is running so today's total keeps pace.
            let mins = entry.signedOut ? 10 : (entry.running ? 5 : 20)
            let next = Calendar.current.date(byAdding: .minute, value: mins, to: Date()) ?? Date()
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func fetchEntry() async -> TimeTrackerEntry {
        guard await SessionStore.validAuth() != nil else { return .signedOut }
        // TimeTracker rows live under user_id="default" and its RLS grants the
        // anon role only — read with the anon key (no user JWT), or authed reads
        // return nothing.
        let client = SupabaseClient()
        let today = todayString()

        async let sessionRows: [ActiveSessionRow] = (try? client.fetch(
            table: "active_sessions",
            select: "task_name,project,elapsed_seconds,start_time,paused_at",
            filters: ["user_id": "eq.\(kTimeTrackerUserID)", "limit": "1"]
        )) ?? []

        async let entryRows: [TimeEntryRow] = (try? client.fetch(
            table: "time_entries",
            select: "duration_seconds,start_time",
            filters: ["user_id": "eq.\(kTimeTrackerUserID)", "start_time": "gte.\(today)"]
        )) ?? []

        let (sessions, entries) = await (sessionRows, entryRows)
        let todaySecs = entries.reduce(0) { $0 + ($1.duration_seconds ?? 0) }

        if let s = sessions.first {
            let paused = s.paused_at != nil
            let start = s.start_time.flatMap { ISO8601DateFormatter().date(from: $0) }
            return TimeTrackerEntry(
                date: Date(), activeTask: s.task_name ?? "Timer", running: !paused,
                startDate: paused ? nil : start, elapsedSeconds: s.elapsed_seconds ?? 0,
                todaySeconds: todaySecs
            )
        }
        return TimeTrackerEntry(date: Date(), activeTask: nil, running: false,
                                startDate: nil, elapsedSeconds: 0, todaySeconds: todaySecs)
    }
}

struct TimeTrackerView: View {
    @Environment(\.widgetFamily) var family
    let entry: TimeTrackerEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                CleanHeader(label: "TIME")
                Spacer()
                if entry.running {
                    HStack(spacing: 4) {
                        Circle().fill(wGreen).frame(width: 6, height: 6)
                        Text("live").font(.system(size: 9, weight: .semibold)).foregroundColor(wGreen)
                    }
                }
            }
            .padding(.bottom, 8)
            CleanDivider().padding(.bottom, 10)

            if let task = entry.activeTask {
                Text(task)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(wPrimary)
                    .lineLimit(1)
                if entry.running, let start = entry.startDate {
                    Text(start, style: .timer)
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                        .foregroundColor(wAccent)
                } else {
                    Text(formatSeconds(entry.elapsedSeconds) + " · paused")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(wSecondary)
                }
            } else {
                Text("No active timer")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(wTertiary)
            }

            Spacer(minLength: 0)
            CleanDivider().padding(.bottom, 6)
            HStack {
                Text("TODAY").font(.system(size: 9, weight: .medium)).foregroundColor(wTertiary).tracking(0.5)
                Spacer()
                Text(formatSeconds(entry.todaySeconds))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(wSecondary)
            }
        }
        .padding(14)
    }
}

struct TimeTrackerWidgetEntryView: View {
    let entry: TimeTrackerEntry
    var body: some View {
        if entry.signedOut { SignedOutView() } else { TimeTrackerView(entry: entry) }
    }
}

struct TimeTrackerWidget: Widget {
    let kind = "NexusLocalTimeTrackerWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TimeTrackerProvider()) { entry in
            TimeTrackerWidgetEntryView(entry: entry).widgetBackground(wBg)
        }
        .configurationDisplayName("Time Tracker")
        .description("Your active timer and today's tracked time.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
