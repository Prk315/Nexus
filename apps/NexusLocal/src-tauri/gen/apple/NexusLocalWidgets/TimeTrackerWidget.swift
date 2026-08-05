import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Timestamp parsing

/// TimeTracker's `start_time` / `paused_at` are TEXT columns that have collected
/// three shapes over the app's life, and a plain `ISO8601DateFormatter()` reads
/// only the first:
///
///   1. `2026-08-05T09:15:30Z`      — what `session-toggle` writes.
///   2. `2026-08-05T09:15:30.123Z`  — what `chrono`'s `to_rfc3339()` writes
///      (`timetracker/mod.rs::now_rfc3339`). The default formatter's
///      `.withInternetDateTime` *rejects* fractional seconds.
///   3. `2026-07-02T14:47`          — offset-less rows from the SQLite era.
///
/// Returning nil for 2 or 3 is not a visible error: `fetchEntry` falls through to
/// the paused branch and a running timer renders as a frozen "0m · paused".
func parseTimeTrackerDate(_ value: String) -> Date? {
    let plain = ISO8601DateFormatter()
    if let d = plain.date(from: value) { return d }

    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = fractional.date(from: value) { return d }

    let legacy = DateFormatter()
    legacy.locale = Locale(identifier: "en_US_POSIX")
    legacy.timeZone = TimeZone.current  // offset-less rows were written in local time
    for format in ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm"] {
        legacy.dateFormat = format
        if let d = legacy.date(from: value) { return d }
    }
    return nil
}

// MARK: - Entry

struct TimeTrackerEntry: TimelineEntry {
    let date: Date
    let activeTask: String?
    let running: Bool
    let startDate: Date?        // for a live-counting running timer
    let elapsedSeconds: Int     // for paused / fallback
    let todaySeconds: Int
    /// What a tap on "start" should be called. Widgets have no text field, so
    /// this is the most recent completed entry's name — the overwhelmingly likely
    /// intent — falling back to `kDefaultSessionTaskName`.
    var lastTask: String = kDefaultSessionTaskName
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

// MARK: - Provider

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
        // Anon key throughout: TimeTracker rows (user_id="default") already grant
        // the anon role, and free-tier SideStore has no App Group session anyway.
        // Writes do NOT go this way — they go through the session-toggle Edge
        // Function, which holds the only credential allowed to mutate these rows.
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

        // The name a "start" tap will use. Separate from the today query because
        // the last thing worked on is usually more recent than midnight — on a
        // fresh morning the today query is empty and would yield no name at all.
        async let recentRows: [TimeEntryRow] = (try? client.fetch(
            table: "time_entries",
            select: "task_name",
            filters: [
                "user_id": "eq.\(kTimeTrackerUserID)",
                "order": "start_time.desc",
                "limit": "1",
            ]
        )) ?? []

        let (sessions, entries, recent) = await (sessionRows, entryRows, recentRows)
        var todaySecs = entries.reduce(0) { $0 + ($1.duration_seconds ?? 0) }

        var lastTask = recent.first?.task_name.flatMap { $0.isEmpty ? nil : $0 }
            ?? kDefaultSessionTaskName

        // Server truth first.
        var activeTask: String? = nil
        var running = false
        var startDate: Date? = nil
        var elapsed = 0

        if let s = sessions.first {
            let paused = s.paused_at != nil
            activeTask = s.task_name ?? "Timer"
            running = !paused
            startDate = paused ? nil : s.start_time.flatMap(parseTimeTrackerDate)
            elapsed = s.elapsed_seconds ?? 0
        }

        // Then the optimistic override from a tap that Supabase may not have
        // caught up with yet. It expires on its own (WidgetStore's TTL), and the
        // intent clears it outright when the write failed — so the worst case is
        // a stale-by-seconds view, never a permanent lie.
        if let o = WidgetStore.loadSessionOverride() {
            let serverHasSession = sessions.first != nil
            if o.running == serverHasSession {
                // Server agreed — the optimistic state has served its purpose.
                WidgetStore.clearSessionOverride()
            } else if o.running {
                activeTask = o.taskName ?? lastTask
                running = true
                startDate = o.startedAt.map { Date(timeIntervalSince1970: $0) }
                elapsed = 0
            } else {
                // Stopped locally, server still shows the session. Credit the
                // time to today's total now, otherwise the total appears to drop
                // the moment the timer stops and climbs back a few minutes later.
                if let s = sessions.first {
                    todaySecs += s.paused_at != nil
                        ? (s.elapsed_seconds ?? 0)
                        : Int(max(0, Date().timeIntervalSince(
                            s.start_time.flatMap(parseTimeTrackerDate) ?? Date())))
                }
                // The session just stopped is by far the likeliest thing to
                // restart, and it is not in `time_entries` yet — so the "start"
                // button would otherwise offer the task worked on *before* it.
                if let name = sessions.first?.task_name, !name.isEmpty {
                    lastTask = name
                }
                activeTask = nil
                running = false
                startDate = nil
                elapsed = 0
            }
        }

        return TimeTrackerEntry(
            date: Date(), activeTask: activeTask, running: running,
            startDate: startDate, elapsedSeconds: elapsed, todaySeconds: todaySecs,
            lastTask: lastTask
        )
    }
}

// MARK: - Start / stop button

/// WidgetKit gives one interaction per widget: a `Button` backed by an
/// `AppIntent`. This is it — the only way to start or stop a session with the
/// app closed.
@available(iOS 17.0, *)
struct SessionButton: View {
    let entry: TimeTrackerEntry

    var body: some View {
        Group {
            if entry.running || entry.activeTask != nil {
                Button(intent: StopSessionIntent()) { label("stop", "stop.fill", wRed) }
            } else {
                Button(intent: StartSessionIntent(taskName: entry.lastTask)) {
                    label("start", "play.fill", wGreen)
                }
            }
        }
        .buttonStyle(.plain)
    }

    private func label(_ text: String, _ icon: String, _ tint: Color) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 8, weight: .bold))
            Text(text).font(.system(size: 10, weight: .semibold))
        }
        .foregroundColor(tint)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(tint.opacity(0.16))
        )
        .contentShape(Rectangle())
    }
}

// MARK: - View

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
                // What a tap will start, so the button is never a surprise.
                Text(entry.lastTask)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(wTertiary)
                    .lineLimit(1)
                    .padding(.top, 1)
            }

            Spacer(minLength: 0)
            CleanDivider().padding(.bottom, 6)
            HStack(spacing: 6) {
                Text("TODAY").font(.system(size: 9, weight: .medium)).foregroundColor(wTertiary).tracking(0.5)
                Text(formatSeconds(entry.todaySeconds))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(wSecondary)
                Spacer(minLength: 4)
                // Interactive widgets are iOS 17+. Below that the widget stays
                // read-only rather than showing a button that cannot fire.
                if #available(iOS 17.0, *) {
                    SessionButton(entry: entry)
                }
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
    let kind = WidgetKind.timeTracker
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TimeTrackerProvider()) { entry in
            TimeTrackerWidgetEntryView(entry: entry).widgetBackground(wBg)
        }
        .configurationDisplayName("Time Tracker")
        .description("Your active timer and today's tracked time. Tap to start or stop a session.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
