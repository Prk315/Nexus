import WidgetKit
import SwiftUI

struct HabitsEntry: TimelineEntry {
    let date: Date
    let done: Int
    let total: Int
    var signedOut: Bool = false

    var fraction: Double { total > 0 ? Double(done) / Double(total) : 0 }

    static let placeholder = HabitsEntry(date: Date(), done: 4, total: 6)
    static let signedOut = HabitsEntry(date: Date(), done: 0, total: 0, signedOut: true)
}

struct HabitsProvider: TimelineProvider {
    func placeholder(in context: Context) -> HabitsEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (HabitsEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        Task { completion(await fetchEntry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HabitsEntry>) -> Void) {
        Task {
            let entry = await fetchEntry()
            let next = Calendar.current.date(byAdding: .minute, value: entry.signedOut ? 10 : 20, to: Date()) ?? Date()
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func fetchEntry() async -> HabitsEntry {
        let client = SupabaseClient()          // anon key; App Group unavailable on free-tier
        let uid = Secrets.userID
        let today = todayString()

        async let habitRows: [HabitRow] = (try? client.fetch(
            table: "protocol_habits",
            select: "id,name,archived",
            filters: ["user_id": "eq.\(uid)", "archived": "eq.false"]
        )) ?? []

        async let completionRows: [HabitCompletionRow] = (try? client.fetch(
            table: "protocol_habit_completions",
            select: "habit_id,date",
            filters: ["user_id": "eq.\(uid)", "date": "eq.\(today)"]
        )) ?? []

        let (habits, completions) = await (habitRows, completionRows)
        let activeIDs = Set(habits.map { $0.id })
        let doneToday = Set(completions.map { $0.habit_id }).intersection(activeIDs)
        return HabitsEntry(date: Date(), done: doneToday.count, total: habits.count)
    }
}

private struct HabitRing: View {
    let fraction: Double
    let size: CGFloat
    var body: some View {
        ZStack {
            Circle().stroke(wSep, lineWidth: size * 0.09)
            Circle()
                .trim(from: 0, to: max(0.001, fraction))
                .stroke(fraction >= 1 ? wGreen : wAccent,
                        style: StrokeStyle(lineWidth: size * 0.09, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(Int((fraction * 100).rounded()))%")
                .font(.system(size: size * 0.22, weight: .bold, design: .rounded))
                .foregroundColor(wPrimary)
        }
        .frame(width: size, height: size)
    }
}

struct HabitsSmallView: View {
    let entry: HabitsEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CleanHeader(label: "HABITS").padding(.bottom, 10)
            CleanDivider().padding(.bottom, 10)
            Spacer(minLength: 0)
            HStack {
                Spacer()
                HabitRing(fraction: entry.fraction, size: 74)
                Spacer()
            }
            Spacer(minLength: 0)
            Text("\(entry.done) of \(entry.total) done today")
                .font(.system(size: 11))
                .foregroundColor(wSecondary)
        }
        .padding(14)
    }
}

struct HabitsMediumView: View {
    let entry: HabitsEntry
    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                CleanHeader(label: "HABITS").padding(.bottom, 8)
                CleanDivider().padding(.bottom, 10)
                Text(entry.total > 0 && entry.done == entry.total ? "All done 🎉" : "Keep going")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(wPrimary)
                Spacer(minLength: 0)
                Text("\(entry.done) of \(entry.total) complete today")
                    .font(.system(size: 11))
                    .foregroundColor(wSecondary)
            }
            .padding(14)
            .frame(maxWidth: .infinity)

            Rectangle().fill(wSep).frame(width: 0.5).padding(.vertical, 12)

            HStack {
                Spacer()
                HabitRing(fraction: entry.fraction, size: 84)
                Spacer()
            }
            .frame(width: 130)
        }
    }
}

struct HabitsWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: HabitsEntry
    var body: some View {
        if entry.signedOut {
            SignedOutView()
        } else if family == .systemMedium {
            HabitsMediumView(entry: entry)
        } else {
            HabitsSmallView(entry: entry)
        }
    }
}

struct HabitsWidget: Widget {
    let kind = "NexusLocalHabitsWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: HabitsProvider()) { entry in
            HabitsWidgetEntryView(entry: entry).widgetBackground(wBg)
        }
        .configurationDisplayName("Habits")
        .description("Today's habit completion.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
