import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Rows / entry

/// pf_tasks rows with the quick-task category set. Separate from
/// `TaskDetailRow` because this select carries `category` — and pf_tasks.id
/// is a bigint, so `id` must be Int (a String here makes the whole array
/// decode throw, which `try?` silently turns into "no tasks").
struct QuickTaskRow: Codable {
    let id: Int
    let title: String
    let category: String?
    let due_date: String?
}

struct QuickTaskItem: Identifiable {
    let id: Int
    let title: String
    let category: String
    let overdue: Bool
    let done: Bool
}

struct QuickTasksEntry: TimelineEntry {
    let date: Date
    let today: String
    let items: [QuickTaskItem]   // the current page only
    let openCount: Int
    let page: Int
    let pageCount: Int

    static let placeholder = QuickTasksEntry(
        date: Date(), today: "2026-08-13",
        items: [
            QuickTaskItem(id: 1, title: "Pick up parcel", category: "reminder", overdue: false, done: false),
            QuickTaskItem(id: 2, title: "Vacuum bedroom", category: "chore", overdue: false, done: false),
            QuickTaskItem(id: 3, title: "Oat milk", category: "shopping", overdue: false, done: false),
            QuickTaskItem(id: 4, title: "Eggs", category: "shopping", overdue: false, done: true),
        ],
        openCount: 3, page: 0, pageCount: 1
    )
}

func categoryIcon(_ c: String) -> String {
    switch c {
    case "chore":    return "🧹"
    case "shopping": return "🛒"
    default:         return "🔔"
    }
}

// MARK: - Provider

struct QuickTasksProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuickTasksEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (QuickTasksEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        Task { completion(await fetchEntry(family: context.family)) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QuickTasksEntry>) -> Void) {
        Task {
            let entry = await fetchEntry(family: context.family)
            // Taps reload explicitly; this is the passive catch-up for edits
            // made in the apps.
            let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    static func rowCapacity(_ family: WidgetFamily) -> Int {
        switch family {
        case .systemLarge: return 9
        default:           return 4
        }
    }

    private func fetchEntry(family: WidgetFamily) async -> QuickTasksEntry {
        let client = SupabaseClient()          // anon key; widget_anon_read covers pf_tasks
        let today = todayString()

        let rows: [QuickTaskRow] = (try? await client.fetch(
            table: "pf_tasks",
            select: "id,title,category,due_date",
            filters: [
                "user_id": "eq.\(Secrets.userID)",
                "done": "eq.false",
                "category": "not.is.null",
                "order": "category.asc,created_at.desc",
            ]
        )) ?? []

        let overrides = WidgetStore.loadOverrides()

        var items: [QuickTaskItem] = []
        for r in rows {
            var done = false
            if let o = overrides[WidgetStore.overrideKey("pf-task-\(r.id)", today)] {
                done = o.done
            }
            items.append(QuickTaskItem(
                id: r.id,
                title: r.title,
                category: r.category ?? "reminder",
                overdue: (r.due_date.map { $0 < today }) ?? false,
                done: done
            ))
        }

        // A completed row stays visible (struck through) until the next fetch
        // no longer returns it — mirroring the habits list, and giving the tap
        // an undo window instead of the row vanishing under the finger.
        let openCount = items.filter { !$0.done }.count

        let capacity = Self.rowCapacity(family)
        let pageCount = max(1, Int(ceil(Double(items.count) / Double(capacity))))
        let page = min(WidgetStore.page(WidgetKind.quickTasks), pageCount - 1)
        let start = page * capacity
        let pageItems = start < items.count
            ? Array(items[start..<min(start + capacity, items.count)])
            : []

        return QuickTasksEntry(
            date: Date(), today: today, items: pageItems,
            openCount: openCount, page: page, pageCount: pageCount
        )
    }
}

// MARK: - Row view

@available(iOS 17.0, *)
struct QuickTaskRowView: View {
    let item: QuickTaskItem
    var compact: Bool = false

    var body: some View {
        Button(intent: ToggleQuickTaskIntent(taskID: item.id, done: item.done)) {
            HStack(spacing: 9) {
                ZStack {
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(item.done ? wGreen : Color.clear)
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .strokeBorder(item.done ? wGreen : wTertiary, lineWidth: 1.5)
                    if item.done {
                        Image(systemName: "checkmark")
                            .font(.system(size: compact ? 8 : 9, weight: .bold))
                            .foregroundColor(wBg)
                    }
                }
                .frame(width: compact ? 16 : 18, height: compact ? 16 : 18)

                Text(categoryIcon(item.category))
                    .font(.system(size: compact ? 9 : 10))

                Text(item.title)
                    .font(.system(size: compact ? 12 : 13, weight: .medium))
                    .foregroundColor(item.done ? wTertiary : wPrimary)
                    .strikethrough(item.done, color: wTertiary)
                    .lineLimit(1)

                Spacer(minLength: 4)

                if item.overdue && !item.done {
                    Text("overdue")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(wRed)
                }
            }
            .padding(.vertical, 3)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Widget view

@available(iOS 17.0, *)
struct QuickTasksView: View {
    @Environment(\.widgetFamily) var family
    let entry: QuickTasksEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header.padding(.bottom, 7)
            CleanDivider().padding(.bottom, 7)

            if entry.items.isEmpty {
                Spacer()
                Text("No reminders, chores or shopping 🎉")
                    .font(.system(size: 12))
                    .foregroundColor(wTertiary)
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: family == .systemLarge ? 3 : 2) {
                    ForEach(entry.items) { item in
                        QuickTaskRowView(item: item, compact: family != .systemLarge)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(14)
    }

    private var header: some View {
        HStack(spacing: 6) {
            CleanHeader(label: "QUICK TASKS")

            Spacer(minLength: 4)

            Text("\(entry.openCount) open")
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundColor(entry.openCount == 0 ? wGreen : wSecondary)

            if entry.pageCount > 1 {
                pageButton(systemName: "chevron.left", delta: -1)
                Text("\(entry.page + 1)/\(entry.pageCount)")
                    .font(.system(size: 9, weight: .medium, design: .rounded))
                    .foregroundColor(wTertiary)
                    .frame(minWidth: 22)
                pageButton(systemName: "chevron.right", delta: 1)
            }
        }
    }

    private func pageButton(systemName: String, delta: Int) -> some View {
        Button(intent: QuickTaskPageIntent(delta: delta, pageCount: entry.pageCount)) {
            Image(systemName: systemName)
                .font(.system(size: 9, weight: .bold))
                .foregroundColor(wSecondary)
                .frame(width: 18, height: 18)
                .background(
                    RoundedRectangle(cornerRadius: 5, style: .continuous).fill(wSep)
                )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Widget definition

struct QuickTasksWidget: Widget {
    let kind = WidgetKind.quickTasks

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: QuickTasksProvider()) { entry in
            Group {
                if #available(iOS 17.0, *) {
                    QuickTasksView(entry: entry)
                } else {
                    // Interactive widgets are iOS 17+.
                    SignedOutView()
                }
            }
            .widgetBackground(wBg)
        }
        .configurationDisplayName("Quick Tasks")
        .description("Reminders, chores and shopping — tap to complete. Add via the app or the “Add Quick Task” Siri shortcut.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
