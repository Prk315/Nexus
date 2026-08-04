import WidgetKit
import SwiftUI

// MARK: - Entry

struct HabitHeatmapEntry: TimelineEntry {
    let date: Date
    let fractionByDate: [String: Double]
    let streak: Int
    let averagePct: Int

    static let placeholder: HabitHeatmapEntry = {
        var map: [String: Double] = [:]
        let cal = Calendar.current
        for offset in 0..<84 {
            guard let day = cal.date(byAdding: .day, value: -offset, to: Date()) else { continue }
            // Deterministic pseudo-texture so the gallery preview looks alive.
            map[dateString(day)] = [0, 0.25, 0.5, 0.75, 1.0, 1.0, 0.5][offset % 7]
        }
        return HabitHeatmapEntry(date: Date(), fractionByDate: map, streak: 5, averagePct: 68)
    }()
}

// MARK: - Provider

struct HabitHeatmapProvider: TimelineProvider {
    func placeholder(in context: Context) -> HabitHeatmapEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (HabitHeatmapEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        Task { completion(await fetchEntry(family: context.family)) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HabitHeatmapEntry>) -> Void) {
        Task {
            let entry = await fetchEntry(family: context.family)
            let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func fetchEntry(family: WidgetFamily) async -> HabitHeatmapEntry {
        let client = SupabaseClient()
        let uid = Secrets.userID
        let metrics = HeatmapMetrics.forFamily(family)

        let columns = heatmapColumns(weeks: metrics.weeks)
        guard let firstDay = columns.first?.first else {
            return HabitHeatmapEntry(date: Date(), fractionByDate: [:], streak: 0, averagePct: 0)
        }
        let since = dateString(firstDay)

        async let habitRows: [HabitRow] = (try? client.fetch(
            table: "protocol_habits",
            select: "id,name,archived,repeat_days",
            filters: ["user_id": "eq.\(uid)", "archived": "eq.false"]
        )) ?? []

        async let completionRows: [HabitCompletionRow] = (try? client.fetch(
            table: "protocol_habit_completions",
            select: "habit_id,date",
            filters: ["user_id": "eq.\(uid)", "date": "gte.\(since)"]
        )) ?? []

        let (habits, completions) = await (habitRows, completionRows)
        guard !habits.isEmpty else {
            return HabitHeatmapEntry(date: Date(), fractionByDate: [:], streak: 0, averagePct: 0)
        }

        // Completions of since-archived habits would inflate the numerator.
        let activeIDs = Set(habits.map { $0.id })

        // How many habits were due on each weekday. Protocol's own heatmap divides
        // by the *total* habit count, which under-reports partial-schedule days —
        // dividing by what was actually scheduled is the honest fraction.
        var scheduledPerWeekday: [Int: Int] = [:]
        for weekday in 0..<7 {
            scheduledPerWeekday[weekday] = habits.filter { habit in
                guard let days = habit.repeat_days else { return true }
                return days.contains(weekday)
            }.count
        }

        var doneByDate: [String: Set<String>] = [:]
        for completion in completions where activeIDs.contains(completion.habit_id) {
            doneByDate[completion.date, default: []].insert(completion.habit_id)
        }

        let todayKey = todayString()
        var fractionByDate: [String: Double] = [:]
        var sum = 0.0
        var counted = 0

        for column in columns {
            for day in column {
                let key = dateString(day)
                if key > todayKey { continue }
                let denominator = scheduledPerWeekday[mondayFirstWeekday(day)] ?? 0
                guard denominator > 0 else { continue }
                let fraction = min(1.0, Double(doneByDate[key]?.count ?? 0) / Double(denominator))
                fractionByDate[key] = fraction
                sum += fraction
                counted += 1
            }
        }

        return HabitHeatmapEntry(
            date: Date(),
            fractionByDate: fractionByDate,
            streak: currentStreak(fractionByDate: fractionByDate),
            averagePct: counted > 0 ? Int((sum / Double(counted) * 100).rounded()) : 0
        )
    }
}

// MARK: - View

struct HabitHeatmapView: View {
    @Environment(\.widgetFamily) var family
    let entry: HabitHeatmapEntry

    var body: some View {
        let metrics = HeatmapMetrics.forFamily(family)

        VStack(alignment: .leading, spacing: 0) {
            HStack {
                CleanHeader(label: "HABITS")
                Spacer()
                Text("\(metrics.weeks)w")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundColor(wTertiary)
            }
            .padding(.bottom, 7)
            CleanDivider().padding(.bottom, 8)

            HeatmapGrid(metrics: metrics, fractionByDate: entry.fractionByDate, tint: wGreen)

            Spacer(minLength: 6)

            HStack(spacing: 6) {
                Text("\(entry.averagePct)%")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundColor(wPrimary)
                Text("avg")
                    .font(.system(size: 9))
                    .foregroundColor(wTertiary)
                Spacer()
                if entry.streak > 0 {
                    Image(systemName: "flame.fill")
                        .font(.system(size: 9))
                        .foregroundColor(wAmber)
                    Text("\(entry.streak)d")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundColor(wAmber)
                }
            }
        }
        .padding(14)
    }
}

struct HabitHeatmapWidget: Widget {
    let kind = WidgetKind.habitHeatmap

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: HabitHeatmapProvider()) { entry in
            HabitHeatmapView(entry: entry).widgetBackground(wBg)
        }
        .configurationDisplayName("Habit Heatmap")
        .description("Your habit consistency as a contribution grid.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
