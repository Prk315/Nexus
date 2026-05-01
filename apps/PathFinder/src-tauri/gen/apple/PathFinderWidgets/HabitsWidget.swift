import WidgetKit
import SwiftUI

// MARK: - Entry

struct HabitsWidgetEntry: TimelineEntry {
    let date: Date
    let habits: [HabitEntry]
    let isPlaceholder: Bool

    static let placeholder = HabitsWidgetEntry(
        date: Date(),
        habits: [
            HabitEntry(title: "Morning run",  color: "green",  done: true,  streak: 7),
            HabitEntry(title: "Meditate",     color: "violet", done: true,  streak: 14),
            HabitEntry(title: "Read 30 min",  color: "amber",  done: false, streak: 3),
            HabitEntry(title: "Cold shower",  color: "cyan",   done: false, streak: 5),
            HabitEntry(title: "Journal",      color: "rose",   done: true,  streak: 21),
            HabitEntry(title: "Workout",      color: "orange", done: false, streak: 2),
        ],
        isPlaceholder: true
    )
}

// MARK: - Provider

struct HabitsProvider: TimelineProvider {
    let client = SupabaseClient()

    func placeholder(in context: Context) -> HabitsWidgetEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (HabitsWidgetEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        Task { completion(await fetchEntry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HabitsWidgetEntry>) -> Void) {
        Task {
            let entry = await fetchEntry()
            var entries: [HabitsWidgetEntry] = []
            for offset: Int in 0..<4 {
                let d = Calendar.current.date(byAdding: .minute, value: offset * 15, to: Date()) ?? Date()
                entries.append(HabitsWidgetEntry(date: d, habits: entry.habits, isPlaceholder: false))
            }
            completion(Timeline(entries: entries, policy: .atEnd))
        }
    }

    private func fetchEntry() async -> HabitsWidgetEntry {
        let today = todayString()
        let uid   = Secrets.userID

        async let habitRows: [HabitRow] = (try? client.fetch(
            table: "pf_daily_habits",
            select: "id,title,color,sort_order",
            filters: ["user_id": "eq.\(uid)", "order": "sort_order.asc"]
        )) ?? []

        let habits = await habitRows
        guard !habits.isEmpty else {
            return HabitsWidgetEntry(date: Date(), habits: [], isPlaceholder: false)
        }

        let ids = habits.map { "\($0.id)" }.joined(separator: ",")
        let completions: [HabitCompletion] = (try? await client.fetch(
            table: "pf_habit_completions",
            select: "habit_id,date",
            filters: ["habit_id": "in.(\(ids))", "date": "gte.\(sevenDaysAgo())"]
        )) ?? []

        let todayDoneIds = Set(completions.filter { $0.date == today }.map { $0.habit_id })

        let entries: [HabitEntry] = habits.map { h in
            let dates = completions.filter { $0.habit_id == h.id }.map { $0.date }.sorted()
            let streak = computeStreak(dates: dates, today: today)
            return HabitEntry(title: h.title, color: h.color, done: todayDoneIds.contains(h.id), streak: streak)
        }

        return HabitsWidgetEntry(date: Date(), habits: entries, isPlaceholder: false)
    }

    private func sevenDaysAgo() -> String {
        let d = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
        let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd"
        return fmt.string(from: d)
    }

    private func computeStreak(dates: [String], today: String) -> Int {
        var streak = 0; var check = today
        let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd"
        while dates.contains(check) {
            streak += 1
            guard let d = fmt.date(from: check),
                  let prev = Calendar.current.date(byAdding: .day, value: -1, to: d) else { break }
            check = fmt.string(from: prev)
        }
        return streak
    }
}

// MARK: - Color mapping

extension Color {
    init(habitColor: String) {
        switch habitColor {
        case "green":   self = .green
        case "teal":    self = Color(red: 0.2,  green: 0.8,  blue: 0.7)
        case "cyan":    self = .cyan
        case "blue":    self = .blue
        case "indigo":  self = .indigo
        case "violet":  self = Color(red: 0.55, green: 0.27, blue: 0.9)
        case "purple":  self = .purple
        case "pink":    self = .pink
        case "rose":    self = Color(red: 0.95, green: 0.3,  blue: 0.4)
        case "red":     self = .red
        case "orange":  self = .orange
        case "amber":   self = Color(red: 0.96, green: 0.72, blue: 0.0)
        case "emerald": self = Color(red: 0.06, green: 0.73, blue: 0.46)
        default:        self = Color(red: 0.48, green: 0.49, blue: 0.52)
        }
    }
}

// MARK: - Views

struct HabitsWidgetView: View {
    let entry: HabitsWidgetEntry

    var doneCount: Int { entry.habits.filter { $0.done }.count }
    var allDone: Bool  { !entry.habits.isEmpty && doneCount == entry.habits.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                CleanHeader(label: "HABITS")
                Spacer()
                Text("\(doneCount)/\(entry.habits.count)")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(allDone ? wGreen : wSecondary)
            }
            .padding(.bottom, 8)

            CleanDivider().padding(.bottom, 8)

            if entry.habits.isEmpty {
                Spacer()
                Text("No habits yet")
                    .font(.system(size: 12))
                    .foregroundColor(wTertiary)
                Spacer()
            } else if allDone {
                Spacer()
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 24))
                        .foregroundColor(wGreen)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("All habits done")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(wPrimary)
                        Text("Great work today.")
                            .font(.system(size: 10))
                            .foregroundColor(wSecondary)
                    }
                }
                Spacer()
            } else {
                VStack(spacing: 6) {
                    ForEach(Array(entry.habits.prefix(6).enumerated()), id: \.offset) { _, habit in
                        HabitRowView(habit: habit)
                    }
                }
                if entry.habits.count > 6 {
                    Text("+\(entry.habits.count - 6) more")
                        .font(.system(size: 9))
                        .foregroundColor(wTertiary)
                        .padding(.top, 4)
                }
            }

            Spacer(minLength: 0)

            CleanDivider().padding(.vertical, 6)

            HStack {
                Text("\(doneCount) done")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundColor(allDone ? wGreen : wSecondary)
                Spacer()
                if !allDone && !entry.habits.isEmpty {
                    Text("\(entry.habits.count - doneCount) remaining")
                        .font(.system(size: 9))
                        .foregroundColor(wTertiary)
                }
            }
        }
        .padding(12)
    }
}

struct HabitRowView: View {
    let habit: HabitEntry

    var body: some View {
        HStack(spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(habit.done ? Color(habitColor: habit.color).opacity(0.12) : Color.clear)
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .strokeBorder(habit.done ? Color(habitColor: habit.color) : wSep, lineWidth: 1.5)
                if habit.done {
                    Image(systemName: "checkmark")
                        .font(.system(size: 7, weight: .bold))
                        .foregroundColor(Color(habitColor: habit.color))
                }
            }
            .frame(width: 14, height: 14)

            Text(habit.title)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(habit.done ? wSecondary : wPrimary)
                .strikethrough(habit.done, color: wSep)
                .lineLimit(1)

            Spacer()

            if habit.streak >= 3 {
                Text("×\(habit.streak)")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundColor(habit.streak >= 7 ? wAmber : wTertiary)
            }
        }
    }
}

// MARK: - Widget definition

struct HabitsWidget: Widget {
    let kind = "HabitsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: HabitsProvider()) { entry in
            HabitsWidgetView(entry: entry)
                .widgetBackground(wBg)
        }
        .configurationDisplayName("Habits")
        .description("Today's habits with streaks and completion status.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
