import WidgetKit
import SwiftUI

struct TaskItem: Identifiable {
    let id: String
    let title: String
    let priority: String?
    let dueDate: String?
    let overdue: Bool
}

struct TasksEntry: TimelineEntry {
    let date: Date
    let items: [TaskItem]
    let openCount: Int
    var signedOut: Bool = false

    static let placeholder = TasksEntry(date: Date(), items: [
        TaskItem(id: "1", title: "Ship Nexus Local widgets", priority: "high", dueDate: "2026-08-02", overdue: false),
        TaskItem(id: "2", title: "Review PR", priority: "medium", dueDate: "2026-08-01", overdue: true),
        TaskItem(id: "3", title: "Plan Phase D", priority: "low", dueDate: nil, overdue: false),
    ], openCount: 12)
    static let signedOut = TasksEntry(date: Date(), items: [], openCount: 0, signedOut: true)
}

struct TasksProvider: TimelineProvider {
    func placeholder(in context: Context) -> TasksEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (TasksEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        Task { completion(await fetchEntry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TasksEntry>) -> Void) {
        Task {
            let entry = await fetchEntry()
            let next = Calendar.current.date(byAdding: .minute, value: entry.signedOut ? 10 : 20, to: Date()) ?? Date()
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func fetchEntry() async -> TasksEntry {
        let client = SupabaseClient()          // anon key; App Group unavailable on free-tier
        let today = todayString()

        // Project tasks only (`category=is.null`): quick tasks — reminders,
        // chores, shopping — have their own widget, and a long shopping list
        // would drown the 6 rows this one gets.
        let rows: [TaskDetailRow] = (try? await client.fetch(
            table: "pf_tasks",
            select: "id,title,priority,due_date",
            filters: ["user_id": "eq.\(Secrets.userID)", "done": "eq.false", "category": "is.null", "order": "due_date.asc.nullslast"]
        )) ?? []

        var items: [TaskItem] = []
        for r in rows.prefix(6) {
            let isOverdue: Bool = (r.due_date.map { $0 < today }) ?? false
            items.append(TaskItem(id: String(r.id), title: r.title, priority: r.priority,
                                  dueDate: r.due_date, overdue: isOverdue))
        }
        return TasksEntry(date: Date(), items: items, openCount: rows.count)
    }
}

private func dueLabel(_ due: String?, overdue: Bool) -> String {
    guard let d = due else { return "" }
    if overdue { return "overdue" }
    if d == todayString() { return "today" }
    return String(d.suffix(5)) // MM-DD
}

struct TasksSmallView: View {
    let entry: TasksEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CleanHeader(label: "TASKS").padding(.bottom, 8)
            CleanDivider().padding(.bottom, 10)
            Text("\(entry.openCount)")
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .foregroundColor(wPrimary)
            Text("open").font(.system(size: 11)).foregroundColor(wTertiary)
            Spacer(minLength: 0)
            if let top = entry.items.first {
                CleanDivider().padding(.bottom, 6)
                Text(top.title)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(wSecondary)
                    .lineLimit(2)
            }
        }
        .padding(14)
    }
}

struct TasksMediumView: View {
    let entry: TasksEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                CleanHeader(label: "TASKS")
                Spacer()
                Text("\(entry.openCount) open").font(.system(size: 10)).foregroundColor(wTertiary)
            }
            .padding(.bottom, 8)
            CleanDivider().padding(.bottom, 8)

            if entry.items.isEmpty {
                Spacer()
                Text("Nothing open 🎉").font(.system(size: 12)).foregroundColor(wTertiary)
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(entry.items.prefix(4)) { item in
                        HStack(spacing: 7) {
                            Circle().fill(priorityColor(item.priority)).frame(width: 6, height: 6)
                            Text(item.title)
                                .font(.system(size: 12))
                                .foregroundColor(wPrimary)
                                .lineLimit(1)
                            Spacer(minLength: 4)
                            let label = dueLabel(item.dueDate, overdue: item.overdue)
                            if !label.isEmpty {
                                Text(label)
                                    .font(.system(size: 9, weight: .semibold))
                                    .foregroundColor(item.overdue ? wRed : wTertiary)
                            }
                        }
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(14)
    }
}

struct TasksWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: TasksEntry
    var body: some View {
        if entry.signedOut {
            SignedOutView()
        } else if family == .systemMedium {
            TasksMediumView(entry: entry)
        } else {
            TasksSmallView(entry: entry)
        }
    }
}

struct TasksWidget: Widget {
    let kind = "NexusLocalTasksWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TasksProvider()) { entry in
            TasksWidgetEntryView(entry: entry).widgetBackground(wBg)
        }
        .configurationDisplayName("Tasks")
        .description("Your open tasks, soonest first.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
