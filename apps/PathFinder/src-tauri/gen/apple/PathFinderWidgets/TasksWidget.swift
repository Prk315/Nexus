import WidgetKit
import SwiftUI

private let kTaskAccent = Color(red: 0.3, green: 0.6, blue: 1.0) // blue

// MARK: - Entry

struct TasksWidgetEntry: TimelineEntry {
    let date: Date
    let dueToday: [TaskItem]
    let overdue: [TaskItem]

    var totalDue: Int { dueToday.count + overdue.count }

    static let placeholder = TasksWidgetEntry(
        date: Date(),
        dueToday: [
            TaskItem(id: 1, title: "Review PR from Jake",       priority: "high",   isOverdue: false),
            TaskItem(id: 2, title: "Write weekly summary",      priority: "medium", isOverdue: false),
            TaskItem(id: 3, title: "Update project roadmap",    priority: "medium", isOverdue: false),
            TaskItem(id: 4, title: "Reply to design feedback",  priority: "low",    isOverdue: false),
        ],
        overdue: [
            TaskItem(id: 5, title: "Send invoice to client",    priority: "high",   isOverdue: true),
            TaskItem(id: 6, title: "Fix onboarding bug",        priority: "medium", isOverdue: true),
        ]
    )
    static let empty = TasksWidgetEntry(date: Date(), dueToday: [], overdue: [])
}

// MARK: - Provider

struct TasksProvider: TimelineProvider {
    let client = SupabaseClient()

    func placeholder(in context: Context) -> TasksWidgetEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (TasksWidgetEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        Task { completion(await fetchEntry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TasksWidgetEntry>) -> Void) {
        Task {
            let entry = await fetchEntry()
            let entries = (0..<4).map { offset -> TasksWidgetEntry in
                let d = Calendar.current.date(byAdding: .minute, value: offset * 15, to: Date()) ?? Date()
                return TasksWidgetEntry(date: d, dueToday: entry.dueToday, overdue: entry.overdue)
            }
            completion(Timeline(entries: entries, policy: .atEnd))
        }
    }

    private func fetchEntry() async -> TasksWidgetEntry {
        let today = todayString()

        // Fetch all undone tasks with a due_date <= today.
        // PostgREST lte naturally excludes NULL values, so no extra null filter needed.
        let rows: [TaskDetailRow] = (try? await client.fetch(
            table: "pf_tasks",
            select: "id,title,done,due_date,priority",
            filters: [
                "user_id": "eq.\(Secrets.userID)",
                "done":    "eq.false",
                "due_date": "lte.\(today)",
            ]
        )) ?? []

        let dueToday = rows
            .filter { $0.due_date == today }
            .sorted { priorityOrder($0.priority) < priorityOrder($1.priority) }
            .prefix(8)
            .map { TaskItem(id: $0.id, title: $0.title, priority: $0.priority, isOverdue: false) }

        let overdue = rows
            .filter { r in r.due_date != nil && r.due_date! < today }
            .sorted { priorityOrder($0.priority) < priorityOrder($1.priority) }
            .prefix(6)
            .map { TaskItem(id: $0.id, title: $0.title, priority: $0.priority, isOverdue: true) }

        return TasksWidgetEntry(date: Date(), dueToday: Array(dueToday), overdue: Array(overdue))
    }
}

// MARK: - Shared sub-views

private struct TaskRowView: View {
    let task: TaskItem

    private var dotColor: Color {
        let c = priorityColor(task.priority)
        return Color(red: c.red, green: c.green, blue: c.blue)
    }

    var body: some View {
        HStack(spacing: 7) {
            Circle()
                .strokeBorder(task.isOverdue ? Color.red.opacity(0.7) : dotColor.opacity(0.7), lineWidth: 1.5)
                .frame(width: 9, height: 9)
            Text(task.title)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(task.isOverdue ? Color.red.opacity(0.75) : Color.white.opacity(0.85))
                .lineLimit(1)
            Spacer(minLength: 0)
        }
    }
}

private struct SectionHeader: View {
    let label: String
    let count: Int
    let color: Color

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 5, height: 5)
            Text(label)
                .font(.system(size: 8, weight: .semibold))
                .foregroundColor(color)
                .tracking(1.2)
            Spacer()
            Text("\(count)")
                .font(.system(size: 9, weight: .semibold))
                .foregroundColor(color.opacity(0.7))
        }
    }
}

// MARK: - Medium View  (due today list)

struct TasksMediumView: View {
    let entry: TasksWidgetEntry

    var body: some View {
        HStack(alignment: .top, spacing: 0) {

            // Left: count summary
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Circle().fill(kTaskAccent).frame(width: 6, height: 6)
                    Text("TASKS")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(kTaskAccent)
                        .tracking(1.5)
                }

                if entry.totalDue == 0 {
                    Spacer()
                    VStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 24))
                            .foregroundColor(.green.opacity(0.8))
                        Text("All clear")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(Color.white.opacity(0.6))
                    }
                    .frame(maxWidth: .infinity)
                    Spacer()
                } else {
                    HStack(alignment: .lastTextBaseline, spacing: 3) {
                        Text("\(entry.dueToday.count)")
                            .font(.system(size: 38, weight: .bold, design: .rounded))
                            .foregroundColor(.white)
                        Text("today")
                            .font(.system(size: 12))
                            .foregroundColor(Color.white.opacity(0.4))
                            .padding(.bottom, 5)
                    }
                    Spacer(minLength: 0)
                    if entry.overdue.count > 0 {
                        HStack(spacing: 3) {
                            Image(systemName: "exclamationmark.circle.fill")
                                .font(.system(size: 10))
                                .foregroundColor(.red)
                            Text("\(entry.overdue.count) overdue")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundColor(.red.opacity(0.8))
                        }
                    }
                }
            }
            .padding(14)
            .frame(width: 110)

            // Divider
            Rectangle()
                .fill(Color.white.opacity(0.08))
                .frame(width: 1)
                .padding(.vertical, 12)

            // Right: task list
            VStack(alignment: .leading, spacing: 5) {
                if entry.dueToday.isEmpty && entry.overdue.isEmpty {
                    Spacer()
                    Text("Nothing due today")
                        .font(.system(size: 11))
                        .foregroundColor(Color.white.opacity(0.3))
                    Spacer()
                } else {
                    // Show overdue first (capped at 2) then due today
                    let overdueShown = Array(entry.overdue.prefix(2))
                    let todayShown   = Array(entry.dueToday.prefix(6 - overdueShown.count))

                    ForEach(overdueShown) { task in TaskRowView(task: task) }
                    ForEach(todayShown)   { task in TaskRowView(task: task) }

                    let remaining = entry.totalDue - overdueShown.count - todayShown.count
                    if remaining > 0 {
                        Text("+\(remaining) more")
                            .font(.system(size: 9))
                            .foregroundColor(Color.white.opacity(0.25))
                            .padding(.top, 1)
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Large View  (due today + full overdue section)

struct TasksLargeView: View {
    let entry: TasksWidgetEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack(spacing: 4) {
                Circle().fill(kTaskAccent).frame(width: 6, height: 6)
                Text("TASKS")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(kTaskAccent)
                    .tracking(1.5)
                Spacer()
                Text("\(entry.totalDue) pending")
                    .font(.system(size: 10))
                    .foregroundColor(Color.white.opacity(0.35))
            }

            if entry.totalDue == 0 {
                Spacer()
                VStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 32))
                        .foregroundColor(.green.opacity(0.8))
                    Text("Nothing due today")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(Color.white.opacity(0.6))
                }
                .frame(maxWidth: .infinity)
                Spacer()
            } else {
                // Due today section
                if !entry.dueToday.isEmpty {
                    SectionHeader(label: "DUE TODAY", count: entry.dueToday.count, color: kTaskAccent)
                    VStack(spacing: 6) {
                        ForEach(entry.dueToday) { task in TaskRowView(task: task) }
                    }
                }

                // Overdue section
                if !entry.overdue.isEmpty {
                    SectionHeader(label: "OVERDUE", count: entry.overdue.count, color: .red)
                    VStack(spacing: 6) {
                        ForEach(entry.overdue) { task in TaskRowView(task: task) }
                    }
                }

                Spacer(minLength: 0)
            }
        }
        .padding(14)
    }
}

// MARK: - Widget definition

struct TasksWidget: Widget {
    let kind = "TasksWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TasksProvider()) { entry in
            TasksWidgetEntryView(entry: entry)
                .widgetBackground(Color(red: 0.07, green: 0.07, blue: 0.09))
        }
        .configurationDisplayName("Tasks")
        .description("Tasks due today and overdue.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct TasksWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: TasksWidgetEntry

    var body: some View {
        switch family {
        case .systemLarge: TasksLargeView(entry: entry)
        default:           TasksMediumView(entry: entry)
        }
    }
}
