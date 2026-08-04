import WidgetKit
import SwiftUI

// MARK: - Entry

struct ExerciseHeatmapEntry: TimelineEntry {
    let date: Date
    let fractionByDate: [String: Double]
    let daysTrained: Int
    let weeks: Int

    var perWeek: Double { weeks > 0 ? Double(daysTrained) / Double(weeks) : 0 }

    static let placeholder: ExerciseHeatmapEntry = {
        var map: [String: Double] = [:]
        let cal = Calendar.current
        for offset in 0..<84 where offset % 3 != 1 {
            guard let day = cal.date(byAdding: .day, value: -offset, to: Date()) else { continue }
            map[dateString(day)] = offset % 5 == 0 ? 0.25 : 1.0
        }
        return ExerciseHeatmapEntry(date: Date(), fractionByDate: map, daysTrained: 38, weeks: 12)
    }()
}

// MARK: - Provider

struct ExerciseHeatmapProvider: TimelineProvider {
    func placeholder(in context: Context) -> ExerciseHeatmapEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (ExerciseHeatmapEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        Task { completion(await fetchEntry(family: context.family)) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ExerciseHeatmapEntry>) -> Void) {
        Task {
            let entry = await fetchEntry(family: context.family)
            let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func fetchEntry(family: WidgetFamily) async -> ExerciseHeatmapEntry {
        let client = SupabaseClient()
        let uid = Secrets.userID
        let metrics = HeatmapMetrics.forFamily(family)

        let columns = heatmapColumns(weeks: metrics.weeks)
        guard let firstDay = columns.first?.first else {
            return ExerciseHeatmapEntry(date: Date(), fractionByDate: [:],
                                        daysTrained: 0, weeks: metrics.weeks)
        }
        let since = dateString(firstDay)

        // "Trained that day" isn't centralised in Protocol, so union the three
        // sources the app itself treats as activity: logged strength sessions,
        // runs, and Garmin-imported exercise sets.
        async let workoutRows: [WorkoutSessionRow] = (try? client.fetch(
            table: "protocol_workout_sessions",
            select: "scheduled_date,completed",
            filters: ["user_id": "eq.\(uid)", "scheduled_date": "gte.\(since)"]
        )) ?? []

        async let runRows: [RunningSessionRow] = (try? client.fetch(
            table: "protocol_running_sessions",
            select: "date,completed",
            filters: ["user_id": "eq.\(uid)", "date": "gte.\(since)"]
        )) ?? []

        async let setRows: [ExerciseSetDateRow] = (try? client.fetch(
            table: "protocol_exercise_sets",
            select: "date",
            filters: ["user_id": "eq.\(uid)", "date": "gte.\(since)"]
        )) ?? []

        let (workouts, runs, sets) = await (workoutRows, runRows, setRows)

        // 1.0 = trained, 0.25 = planned but not done (mirrors Protocol's
        // computeWorkoutFractionByDate), absent = nothing on the calendar.
        var fractionByDate: [String: Double] = [:]
        func mark(_ key: String?, done: Bool) {
            guard let key = key, !key.isEmpty else { return }
            let value = done ? 1.0 : 0.25
            fractionByDate[key] = max(fractionByDate[key] ?? 0, value)
        }

        for row in workouts { mark(row.scheduled_date, done: row.completed == true) }
        for row in runs     { mark(row.date, done: row.completed == true) }
        for row in sets     { mark(row.date, done: true) }

        return ExerciseHeatmapEntry(
            date: Date(),
            fractionByDate: fractionByDate,
            daysTrained: fractionByDate.values.filter { $0 >= 1.0 }.count,
            weeks: metrics.weeks
        )
    }
}

// MARK: - View

struct ExerciseHeatmapView: View {
    @Environment(\.widgetFamily) var family
    let entry: ExerciseHeatmapEntry

    var body: some View {
        let metrics = HeatmapMetrics.forFamily(family)

        VStack(alignment: .leading, spacing: 0) {
            HStack {
                CleanHeader(label: "TRAINING")
                Spacer()
                Text("\(metrics.weeks)w")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundColor(wTertiary)
            }
            .padding(.bottom, 7)
            CleanDivider().padding(.bottom, 8)

            HeatmapGrid(metrics: metrics, fractionByDate: entry.fractionByDate, tint: wWorkout)

            Spacer(minLength: 6)

            HStack(spacing: 6) {
                Text("\(entry.daysTrained)")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundColor(wPrimary)
                Text("days")
                    .font(.system(size: 9))
                    .foregroundColor(wTertiary)
                Spacer()
                Text(String(format: "%.1f/wk", entry.perWeek))
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundColor(wWorkout)
            }
        }
        .padding(14)
    }
}

struct ExerciseHeatmapWidget: Widget {
    let kind = "NexusLocalExerciseHeatmapWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ExerciseHeatmapProvider()) { entry in
            ExerciseHeatmapView(entry: entry).widgetBackground(wBg)
        }
        .configurationDisplayName("Training Heatmap")
        .description("Days you trained — strength sessions, runs and logged sets.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
