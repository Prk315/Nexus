import WidgetKit
import SwiftUI

// MARK: - Entry

struct TodayEntry: TimelineEntry {
    let date: Date
    let primaryGoal: String?
    let secondaryCount: Int
    let dueToday: Int
    let overdue: Int

    static let placeholder = TodayEntry(
        date: Date(), primaryGoal: "Ship Nexus Local",
        secondaryCount: 3, dueToday: 5, overdue: 1
    )
    static let empty = TodayEntry(
        date: Date(), primaryGoal: nil, secondaryCount: 0, dueToday: 0, overdue: 0
    )
}

// MARK: - Provider (direct Supabase REST, refreshes every 15 min)

struct TodayProvider: TimelineProvider {
    let client = SupabaseClient()

    func placeholder(in context: Context) -> TodayEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        Task { completion(await fetchEntry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        Task {
            let entry = await fetchEntry()
            let entries = (0..<4).map { offset -> TodayEntry in
                let d = Calendar.current.date(byAdding: .minute, value: offset * 15, to: Date()) ?? Date()
                return TodayEntry(date: d, primaryGoal: entry.primaryGoal,
                                  secondaryCount: entry.secondaryCount,
                                  dueToday: entry.dueToday, overdue: entry.overdue)
            }
            completion(Timeline(entries: entries, policy: .atEnd))
        }
    }

    private func fetchEntry() async -> TodayEntry {
        let today = todayString()
        let uid   = Secrets.userID

        async let primaryRows: [PrimaryGoalRow] = (try? client.fetch(
            table: "pf_daily_primary_goal",
            select: "text",
            filters: ["user_id": "eq.\(uid)", "date": "eq.\(today)"]
        )) ?? []

        async let secondaryRows: [SecondaryGoalRow] = (try? client.fetch(
            table: "pf_daily_secondary_goals",
            select: "id",
            filters: ["user_id": "eq.\(uid)", "date": "eq.\(today)"]
        )) ?? []

        async let taskRows: [TaskRow] = (try? client.fetch(
            table: "pf_tasks",
            select: "id,done,due_date",
            filters: ["user_id": "eq.\(uid)", "done": "eq.false"]
        )) ?? []

        let (primary, secondary, tasks) = await (primaryRows, secondaryRows, taskRows)
        let dueToday = tasks.filter { $0.due_date == today }.count
        let overdue  = tasks.filter { t in
            guard let d = t.due_date else { return false }
            return d < today
        }.count

        return TodayEntry(date: Date(), primaryGoal: primary.first?.text,
                          secondaryCount: secondary.count,
                          dueToday: dueToday, overdue: overdue)
    }
}

// MARK: - Views

struct TodaySmallView: View {
    let entry: TodayEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CleanHeader(label: "TODAY").padding(.bottom, 8)
            CleanDivider().padding(.bottom, 10)

            if let goal = entry.primaryGoal {
                Text(goal)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(wPrimary)
                    .lineLimit(4)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("No goal set")
                    .font(.system(size: 12))
                    .foregroundColor(wTertiary)
            }

            Spacer(minLength: 0)
            CleanDivider().padding(.vertical, 6)

            HStack(spacing: 8) {
                if entry.overdue > 0 {
                    Label("\(entry.overdue)", systemImage: "exclamationmark.circle.fill")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(wRed)
                }
                Label("\(entry.dueToday)", systemImage: "checkmark.circle")
                    .font(.system(size: 10))
                    .foregroundColor(wSecondary)
                if entry.secondaryCount > 0 {
                    Text("+\(entry.secondaryCount)")
                        .font(.system(size: 10))
                        .foregroundColor(wTertiary)
                }
            }
        }
        .padding(14)
    }
}

struct TodayMediumView: View {
    let entry: TodayEntry
    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                CleanHeader(label: "TODAY").padding(.bottom, 8)
                CleanDivider().padding(.bottom, 10)
                if let goal = entry.primaryGoal {
                    Text(goal)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(wPrimary)
                        .lineLimit(5)
                } else {
                    Text("No goal set today")
                        .font(.system(size: 12))
                        .foregroundColor(wTertiary)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity)

            Rectangle().fill(wSep).frame(width: 0.5).padding(.vertical, 12)

            VStack(alignment: .leading, spacing: 12) {
                statRow(label: "DUE TODAY", value: entry.dueToday,
                        color: entry.dueToday > 0 ? wBlue : wSecondary)
                statRow(label: "GOALS",
                        value: entry.secondaryCount + (entry.primaryGoal != nil ? 1 : 0),
                        color: wSecondary)
                if entry.overdue > 0 {
                    statRow(label: "OVERDUE", value: entry.overdue, color: wRed)
                }
            }
            .padding(14)
            .frame(width: 110)
        }
    }

    @ViewBuilder
    func statRow(label: String, value: Int, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 8, weight: .medium))
                .foregroundColor(wTertiary)
                .tracking(0.5)
            Text("\(value)")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundColor(color)
        }
    }
}

struct TodayWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: TodayEntry
    var body: some View {
        switch family {
        case .systemMedium: TodayMediumView(entry: entry)
        default:            TodaySmallView(entry: entry)
        }
    }
}

struct TodayWidget: Widget {
    let kind = "NexusLocalTodayWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TodayProvider()) { entry in
            TodayWidgetEntryView(entry: entry).widgetBackground(wBg)
        }
        .configurationDisplayName("Today")
        .description("Your primary goal and task overview for the day.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
