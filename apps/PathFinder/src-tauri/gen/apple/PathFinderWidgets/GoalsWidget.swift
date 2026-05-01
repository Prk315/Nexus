import WidgetKit
import SwiftUI

// MARK: - Entry

struct GoalsWidgetEntry: TimelineEntry {
    let date: Date
    let goals: [GoalRow]
    let activeCount: Int

    static let placeholder = GoalsWidgetEntry(
        date: Date(),
        goals: [
            GoalRow(id: 1, title: "Ship PathFinder v1.0",    priority: "high",   deadline: "2026-05-15"),
            GoalRow(id: 2, title: "Read 12 books this year", priority: "medium", deadline: nil),
            GoalRow(id: 3, title: "Get to 80 kg",            priority: "medium", deadline: "2026-06-01"),
            GoalRow(id: 4, title: "Daily meditation habit",  priority: "low",    deadline: nil),
            GoalRow(id: 5, title: "Launch side project",     priority: "high",   deadline: "2026-07-01"),
        ],
        activeCount: 5
    )
    static let empty = GoalsWidgetEntry(date: Date(), goals: [], activeCount: 0)
}

// MARK: - Provider

struct GoalsProvider: TimelineProvider {
    let client = SupabaseClient()

    func placeholder(in context: Context) -> GoalsWidgetEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (GoalsWidgetEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        Task { completion(await fetchEntry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<GoalsWidgetEntry>) -> Void) {
        Task {
            let entry = await fetchEntry()
            let entries = (0..<4).map { offset -> GoalsWidgetEntry in
                let d = Calendar.current.date(byAdding: .minute, value: offset * 15, to: Date()) ?? Date()
                return GoalsWidgetEntry(date: d, goals: entry.goals, activeCount: entry.activeCount)
            }
            completion(Timeline(entries: entries, policy: .atEnd))
        }
    }

    private func fetchEntry() async -> GoalsWidgetEntry {
        let all: [GoalRow] = (try? await client.fetch(
            table: "pf_goals",
            select: "id,title,priority,deadline",
            filters: ["user_id": "eq.\(Secrets.userID)", "status": "eq.active"]
        )) ?? []
        let sorted = all.sorted { priorityOrder($0.priority) < priorityOrder($1.priority) }
        return GoalsWidgetEntry(date: Date(), goals: Array(sorted.prefix(5)), activeCount: all.count)
    }
}

// MARK: - Shared sub-views

private struct GoalItemRow: View {
    let goal: GoalRow

    private var dotColor: Color {
        let c = priorityColor(goal.priority)
        return Color(red: c.red, green: c.green, blue: c.blue)
    }

    private var deadlineBadge: String? {
        guard let dl = goal.deadline, let days = daysUntil(dl) else { return nil }
        if days < 0  { return "overdue" }
        if days == 0 { return "today" }
        if days <= 7 { return "\(days)d" }
        return nil
    }

    private var badgeColor: Color {
        guard let dl = goal.deadline, let days = daysUntil(dl) else { return wTertiary }
        return days < 0 ? wRed : wAmber
    }

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(dotColor).frame(width: 6, height: 6)
            Text(goal.title)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(wPrimary.opacity(0.85))
                .lineLimit(1)
            Spacer(minLength: 0)
            if let badge = deadlineBadge {
                Text(badge)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(badgeColor)
            }
        }
    }
}

// MARK: - Small view

struct GoalsSmallView: View {
    let entry: GoalsWidgetEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                CleanHeader(label: "GOALS")
                Spacer()
                if entry.activeCount > 0 {
                    Text("\(entry.activeCount)")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(wSecondary)
                }
            }
            .padding(.bottom, 8)

            CleanDivider().padding(.bottom, 10)

            if let top = entry.goals.first {
                Text(top.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(wPrimary)
                    .lineLimit(4)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Spacer()
                Text("No active goals")
                    .font(.system(size: 12))
                    .foregroundColor(wTertiary)
            }

            Spacer(minLength: 0)

            if entry.activeCount > 1 {
                CleanDivider().padding(.vertical, 6)
                Text("+\(entry.activeCount - 1) more")
                    .font(.system(size: 9))
                    .foregroundColor(wTertiary)
            }
        }
        .padding(14)
    }
}

// MARK: - Medium view

struct GoalsMediumView: View {
    let entry: GoalsWidgetEntry

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                CleanHeader(label: "GOALS")
                    .padding(.bottom, 8)
                CleanDivider().padding(.bottom, 10)

                if let top = entry.goals.first {
                    Text(top.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(wPrimary)
                        .lineLimit(4)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("No active goals")
                        .font(.system(size: 12))
                        .foregroundColor(wTertiary)
                }

                Spacer(minLength: 0)

                CleanDivider().padding(.vertical, 6)
                Text("\(entry.activeCount) active")
                    .font(.system(size: 9))
                    .foregroundColor(wTertiary)
            }
            .padding(14)
            .frame(maxWidth: .infinity)

            Rectangle().fill(wSep).frame(width: 0.5).padding(.vertical, 12)

            VStack(alignment: .leading, spacing: 8) {
                if entry.goals.count <= 1 {
                    Spacer()
                    Text("No other goals")
                        .font(.system(size: 10))
                        .foregroundColor(wTertiary)
                    Spacer()
                } else {
                    ForEach(entry.goals.dropFirst(), id: \.id) { goal in
                        GoalItemRow(goal: goal)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Widget definition

struct GoalsWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: GoalsWidgetEntry

    var body: some View {
        switch family {
        case .systemMedium: GoalsMediumView(entry: entry)
        default:            GoalsSmallView(entry: entry)
        }
    }
}

struct GoalsWidget: Widget {
    let kind = "GoalsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: GoalsProvider()) { entry in
            GoalsWidgetEntryView(entry: entry)
                .widgetBackground(wBg)
        }
        .configurationDisplayName("Goals")
        .description("Your active goals at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
