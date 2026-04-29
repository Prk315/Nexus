import WidgetKit
import SwiftUI

// MARK: - Entry

struct TodayFocusEntry: TimelineEntry {
    let date: Date
    let primaryGoal: String?
    let secondaryCount: Int
    let dueToday: Int
    let overdue: Int
    let isPlaceholder: Bool

    static let placeholder = TodayFocusEntry(
        date: Date(), primaryGoal: "Finish the report",
        secondaryCount: 3, dueToday: 5, overdue: 1, isPlaceholder: true
    )
    static let empty = TodayFocusEntry(
        date: Date(), primaryGoal: nil,
        secondaryCount: 0, dueToday: 0, overdue: 0, isPlaceholder: false
    )
}

// MARK: - Provider

struct TodayFocusProvider: TimelineProvider {
    let client = SupabaseClient()

    func placeholder(in context: Context) -> TodayFocusEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (TodayFocusEntry) -> Void) {
        if context.isPreview {
            completion(.placeholder)
            return
        }
        Task { completion(await fetchEntry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayFocusEntry>) -> Void) {
        Task {
            let entry = await fetchEntry()
            // 4 entries, refresh every 15 minutes
            let entries = (0..<4).map { offset -> TodayFocusEntry in
                let entryDate = Calendar.current.date(byAdding: .minute, value: offset * 15, to: Date()) ?? Date()
                return TodayFocusEntry(
                    date: entryDate,
                    primaryGoal: entry.primaryGoal,
                    secondaryCount: entry.secondaryCount,
                    dueToday: entry.dueToday,
                    overdue: entry.overdue,
                    isPlaceholder: false
                )
            }
            completion(Timeline(entries: entries, policy: .atEnd))
        }
    }

    private func fetchEntry() async -> TodayFocusEntry {
        let today = todayString()
        let uid   = Secrets.userID

        async let primaryRows: [PrimaryGoalRow] = (try? client.fetch(
            table: "pf_daily_primary_goal",
            select: "text,time_estimate_min",
            filters: ["user_id": "eq.\(uid)", "date": "eq.\(today)"]
        )) ?? []

        async let secondaryRows: [SecondaryGoalRow] = (try? client.fetch(
            table: "pf_daily_secondary_goals",
            select: "id,text,sort_order",
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

        return TodayFocusEntry(
            date: Date(),
            primaryGoal: primary.first?.text,
            secondaryCount: secondary.count,
            dueToday: dueToday,
            overdue: overdue,
            isPlaceholder: false
        )
    }
}

// MARK: - Views

struct TodayFocusSmallView: View {
    let entry: TodayFocusEntry

    var body: some View {
        ZStack {
            Color(red: 0.07, green: 0.07, blue: 0.09)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Circle().fill(Color.indigo).frame(width: 6, height: 6)
                    Text("TODAY")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(.indigo)
                        .tracking(1.5)
                }

                if let goal = entry.primaryGoal {
                    Text(goal)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("No goal set")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(Color.white.opacity(0.35))
                }

                Spacer(minLength: 0)

                HStack(spacing: 6) {
                    if entry.overdue > 0 {
                        Label("\(entry.overdue)", systemImage: "exclamationmark.circle.fill")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(.red)
                    }
                    Label("\(entry.dueToday)", systemImage: "checkmark.circle")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(Color.white.opacity(0.55))
                    if entry.secondaryCount > 0 {
                        Text("+\(entry.secondaryCount)")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(Color.white.opacity(0.35))
                    }
                }
            }
            .padding(14)
        }
    }
}

struct TodayFocusMediumView: View {
    let entry: TodayFocusEntry

    var body: some View {
        ZStack {
            Color(red: 0.07, green: 0.07, blue: 0.09)
            HStack(alignment: .top, spacing: 0) {
                // Left: primary goal
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 4) {
                        Circle().fill(Color.indigo).frame(width: 6, height: 6)
                        Text("FOCUS")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundColor(.indigo)
                            .tracking(1.5)
                    }
                    if let goal = entry.primaryGoal {
                        Text(goal)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.white)
                            .lineLimit(4)
                    } else {
                        Text("No goal set today")
                            .font(.system(size: 13))
                            .foregroundColor(Color.white.opacity(0.35))
                    }
                    Spacer(minLength: 0)
                }
                .padding(14)
                .frame(maxWidth: .infinity)

                // Divider
                Rectangle()
                    .fill(Color.white.opacity(0.08))
                    .frame(width: 1)
                    .padding(.vertical, 12)

                // Right: stats
                VStack(alignment: .leading, spacing: 10) {
                    statRow(icon: "checklist", label: "Due today", value: entry.dueToday, color: .indigo)
                    if entry.overdue > 0 {
                        statRow(icon: "exclamationmark.circle.fill", label: "Overdue", value: entry.overdue, color: .red)
                    }
                    statRow(icon: "target", label: "Goals", value: entry.secondaryCount + (entry.primaryGoal != nil ? 1 : 0), color: .teal)
                }
                .padding(14)
                .frame(width: 120)
            }
        }
    }

    @ViewBuilder
    func statRow(icon: String, label: String, value: Int, color: Color) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 11))
                .foregroundColor(color)
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                    .font(.system(size: 9))
                    .foregroundColor(Color.white.opacity(0.4))
                Text("\(value)")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(.white)
            }
        }
    }
}

// MARK: - Widget definition

struct TodayFocusWidget: Widget {
    let kind = "TodayFocusWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TodayFocusProvider()) { entry in
            TodayFocusWidgetEntryView(entry: entry)
                .widgetBackground(Color(red: 0.07, green: 0.07, blue: 0.09))
        }
        .configurationDisplayName("Today Focus")
        .description("Your primary goal and task overview for the day.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct TodayFocusWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: TodayFocusEntry

    var body: some View {
        switch family {
        case .systemMedium: TodayFocusMediumView(entry: entry)
        default:            TodayFocusSmallView(entry: entry)
        }
    }
}
