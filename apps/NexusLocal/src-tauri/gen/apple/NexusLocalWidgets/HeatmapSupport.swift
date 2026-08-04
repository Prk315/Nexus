import WidgetKit
import SwiftUI

// MARK: - Calendar helpers

/// Weekday index with Monday = 0 … Sunday = 6, matching Protocol's
/// `dayOfWeek()` (`(Date.getDay() + 6) % 7`) and `Habit.repeat_days`.
func mondayFirstWeekday(_ date: Date) -> Int {
    // Calendar's .weekday is 1 = Sunday … 7 = Saturday.
    (Calendar.current.component(.weekday, from: date) + 5) % 7
}

func dateString(_ date: Date) -> String {
    let fmt = DateFormatter()
    fmt.dateFormat = "yyyy-MM-dd"
    fmt.timeZone = TimeZone.current
    return fmt.string(from: date)
}

/// Contribution-graph columns: `weeks` Monday-started weeks, the last of which
/// contains `today`. Mirrors Protocol's `buildHeatmapGrid`.
func heatmapColumns(weeks: Int, today: Date = Date()) -> [[Date]] {
    let cal = Calendar.current
    let startOfToday = cal.startOfDay(for: today)
    guard
        let thisMonday = cal.date(byAdding: .day, value: -mondayFirstWeekday(startOfToday), to: startOfToday),
        let firstMonday = cal.date(byAdding: .day, value: -7 * (weeks - 1), to: thisMonday)
    else { return [] }

    return (0..<weeks).map { week in
        (0..<7).compactMap { day in
            cal.date(byAdding: .day, value: week * 7 + day, to: firstMonday)
        }
    }
}

// MARK: - Sizing

struct HeatmapMetrics {
    let weeks: Int
    let cell: CGFloat
    let gap: CGFloat

    var radius: CGFloat { max(2, (cell * 0.18).rounded()) }

    static func forFamily(_ family: WidgetFamily) -> HeatmapMetrics {
        // Sized to fit the padded content box. After 14pt padding a small widget
        // gives ~130x130pt and a medium ~310x130; header + divider + footer eat
        // ~50pt of height, leaving ~80 for the grid.
        //   width  = weeks * cell + (weeks - 1) * gap
        //   height = 7 * cell + 6 * gap
        // Both families keep a 68pt-tall grid so the two heatmap widgets line up
        // when placed side by side.
        switch family {
        case .systemMedium: return HeatmapMetrics(weeks: 26, cell: 9, gap: 2)  // 284 x 68 — half a year
        case .systemLarge:  return HeatmapMetrics(weeks: 26, cell: 9, gap: 2)
        default:            return HeatmapMetrics(weeks: 12, cell: 8, gap: 2)  // 118 x 68 — a quarter
        }
    }
}

// MARK: - Grid view

/// A GitHub-style contribution grid. `fractionByDate` maps "yyyy-MM-dd" → 0…1;
/// missing dates render as an empty cell. Colour ramp matches Protocol's
/// `ConsistencyHeatmap`: a single hue at `0.15 + fraction * 0.85` opacity.
struct HeatmapGrid: View {
    let metrics: HeatmapMetrics
    let fractionByDate: [String: Double]
    var tint: Color = wGreen
    var today: Date = Date()

    var body: some View {
        let columns = heatmapColumns(weeks: metrics.weeks, today: today)
        let todayKey = dateString(today)

        HStack(alignment: .top, spacing: metrics.gap) {
            ForEach(Array(columns.enumerated()), id: \.offset) { _, week in
                VStack(spacing: metrics.gap) {
                    ForEach(Array(week.enumerated()), id: \.offset) { _, day in
                        cell(for: day, todayKey: todayKey)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func cell(for day: Date, todayKey: String) -> some View {
        let key = dateString(day)
        let isFuture = key > todayKey
        let fraction = fractionByDate[key] ?? 0

        RoundedRectangle(cornerRadius: metrics.radius, style: .continuous)
            .fill(fraction > 0 ? tint.opacity(0.15 + fraction * 0.85) : wSep)
            .frame(width: metrics.cell, height: metrics.cell)
            // Future days keep their slot so the grid stays rectangular.
            .opacity(isFuture ? 0 : 1)
            .overlay(
                RoundedRectangle(cornerRadius: metrics.radius, style: .continuous)
                    .strokeBorder(wPrimary.opacity(0.55), lineWidth: 1)
                    .opacity(key == todayKey ? 1 : 0)
            )
    }
}

// MARK: - Streak maths over a date→fraction map

/// Any completion at all counts toward the streak. With 18 habits scheduled
/// daily a "100% of them" streak would read 0 essentially forever, so the flame
/// tracks *showing up* — consecutive days with at least one habit done.
let showedUpThreshold = 0.001

/// Consecutive days ending today (or yesterday, so an unfinished today doesn't
/// read as a broken streak) where `fraction` cleared `threshold`.
func currentStreak(fractionByDate: [String: Double], threshold: Double = showedUpThreshold, today: Date = Date()) -> Int {
    let cal = Calendar.current
    var streak = 0
    var cursor = cal.startOfDay(for: today)

    // An incomplete today doesn't break the streak — it just doesn't extend it.
    if (fractionByDate[dateString(cursor)] ?? 0) < threshold {
        guard let yesterday = cal.date(byAdding: .day, value: -1, to: cursor) else { return 0 }
        cursor = yesterday
    }

    while (fractionByDate[dateString(cursor)] ?? 0) >= threshold {
        streak += 1
        guard let previous = cal.date(byAdding: .day, value: -1, to: cursor) else { break }
        cursor = previous
    }
    return streak
}

// MARK: - Row models for the heatmap widgets

struct WorkoutSessionRow: Codable {
    let scheduled_date: String?
    let completed: Bool?
}

struct RunningSessionRow: Codable {
    let date: String?
    let completed: Bool?
}

struct ExerciseSetDateRow: Codable {
    let date: String?
}
