import WidgetKit
import SwiftUI

// MARK: - Mission model

struct Mission: Identifiable {
    let id: String
    let title: String
    let done: Bool
}

// MARK: - Entry

struct SoloLevelingEntry: TimelineEntry {
    let date: Date
    let missions: [Mission]   // incomplete first, complete at bottom

    var doneCount: Int   { missions.filter { $0.done  }.count }
    var totalCount: Int  { missions.count }
    var allDone: Bool    { totalCount > 0 && doneCount == totalCount }

    static let placeholder = SoloLevelingEntry(
        date: Date(),
        missions: [
            Mission(id: "h-1", title: "Morning run 5 km",  done: true),
            Mission(id: "h-2", title: "Cold shower",       done: true),
            Mission(id: "h-3", title: "100 push-ups",      done: false),
            Mission(id: "s-1", title: "Evening review",    done: false),
            Mission(id: "h-4", title: "Meditate 10 min",   done: false),
            Mission(id: "s-2", title: "Journal entry",     done: false),
        ]
    )

    static let empty = SoloLevelingEntry(date: Date(), missions: [])
}

// MARK: - Provider

struct SoloLevelingProvider: TimelineProvider {
    let client = SupabaseClient()

    func placeholder(in context: Context) -> SoloLevelingEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (SoloLevelingEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        Task { completion(await fetchEntry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SoloLevelingEntry>) -> Void) {
        Task {
            let entry = await fetchEntry()
            let entries = (0..<4).map { offset -> SoloLevelingEntry in
                let d = Calendar.current.date(byAdding: .minute, value: offset * 15, to: Date()) ?? Date()
                return SoloLevelingEntry(date: d, missions: entry.missions)
            }
            completion(Timeline(entries: entries, policy: .atEnd))
        }
    }

    private func fetchEntry() async -> SoloLevelingEntry {
        let today = todayString()
        let uid   = Secrets.userID

        async let habitRows: [HabitRow] = (try? client.fetch(
            table: "pf_daily_habits",
            select: "id,title,color,sort_order",
            filters: ["user_id": "eq.\(uid)", "order": "sort_order.asc"]
        )) ?? []

        async let systemRows: [SystemRow] = (try? client.fetch(
            table: "pf_systems",
            select: "id,title,frequency,days_of_week,last_done,streak_count",
            filters: ["user_id": "eq.\(uid)"]
        )) ?? []

        let (habits, systems) = await (habitRows, systemRows)

        let completedHabitIds: Set<Int>
        if habits.isEmpty {
            completedHabitIds = []
        } else {
            let ids = habits.map { "\($0.id)" }.joined(separator: ",")
            let comps: [HabitCompletion] = (try? await client.fetch(
                table: "pf_habit_completions",
                select: "habit_id,date",
                filters: ["habit_id": "in.(\(ids))", "date": "eq.\(today)"]
            )) ?? []
            completedHabitIds = Set(comps.map { $0.habit_id })
        }

        var missions: [Mission] = []
        for h in habits {
            missions.append(Mission(id: "h-\(h.id)", title: h.title,
                                    done: completedHabitIds.contains(h.id)))
        }
        for s in systems where systemIsDue(s) {
            missions.append(Mission(id: "s-\(s.id)", title: s.title, done: false))
        }
        missions.sort { !$0.done && $1.done }

        return SoloLevelingEntry(date: Date(), missions: missions)
    }
}

// MARK: - Shared sub-views

private struct MissionRow: View {
    let mission: Mission

    var body: some View {
        HStack(spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(mission.done ? wGreen.opacity(0.10) : Color.clear)
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .strokeBorder(mission.done ? wGreen : wSep, lineWidth: 1.3)
                if mission.done {
                    Image(systemName: "checkmark")
                        .font(.system(size: 7, weight: .bold))
                        .foregroundColor(wGreen)
                }
            }
            .frame(width: 14, height: 14)

            Text(mission.title)
                .font(.system(size: 12, weight: mission.done ? .regular : .medium))
                .foregroundColor(mission.done ? wTertiary : wPrimary.opacity(0.85))
                .strikethrough(mission.done, color: wSep)
                .lineLimit(1)

            Spacer(minLength: 0)
        }
    }
}

private struct MissionFooter: View {
    let done: Int
    let total: Int

    var allDone: Bool { done == total && total > 0 }

    var body: some View {
        HStack {
            Text("\(done) done")
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(allDone ? wGreen : wSecondary)
            Spacer()
            if !allDone {
                Text("\(total - done) remaining")
                    .font(.system(size: 9))
                    .foregroundColor(wTertiary)
            }
        }
    }
}

// MARK: - Small view

struct SoloLevelingSmallView: View {
    let entry: SoloLevelingEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                CleanHeader(label: "MISSIONS")
                Spacer()
                if entry.totalCount > 0 {
                    Text("\(entry.doneCount)/\(entry.totalCount)")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(entry.allDone ? wGreen : wSecondary)
                }
            }
            .padding(.bottom, 8)

            CleanDivider().padding(.bottom, 10)

            if entry.totalCount == 0 {
                Spacer()
                Text("No missions\nassigned")
                    .font(.system(size: 12))
                    .foregroundColor(wTertiary)
                    .multilineTextAlignment(.leading)
                Spacer()
            } else if entry.allDone {
                Spacer()
                VStack(alignment: .leading, spacing: 4) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 22))
                        .foregroundColor(wGreen)
                    Text("All done")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(wGreen)
                }
                Spacer()
            } else {
                HStack(alignment: .lastTextBaseline, spacing: 4) {
                    Text("\(entry.totalCount - entry.doneCount)")
                        .font(.system(size: 38, weight: .bold, design: .rounded))
                        .foregroundColor(wPrimary)
                    Text("left")
                        .font(.system(size: 12))
                        .foregroundColor(wSecondary)
                        .padding(.bottom, 5)
                }

                Spacer(minLength: 4)

                if let next = entry.missions.first(where: { !$0.done }) {
                    Text(next.title)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(wPrimary.opacity(0.85))
                        .lineLimit(2)
                }
            }

            Spacer(minLength: 0)

            if entry.totalCount > 0 && !entry.allDone {
                CleanDivider().padding(.vertical, 6)
                MissionFooter(done: entry.doneCount, total: entry.totalCount)
            }
        }
        .padding(14)
    }
}

// MARK: - Medium view

struct SoloLevelingMediumView: View {
    let entry: SoloLevelingEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                CleanHeader(label: "MISSIONS")
                Spacer()
                if entry.totalCount > 0 {
                    Text("\(entry.doneCount)/\(entry.totalCount)")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(entry.allDone ? wGreen : wSecondary)
                }
            }
            .padding(.bottom, 8)

            CleanDivider().padding(.bottom, 10)

            if entry.missions.isEmpty {
                Spacer()
                Text("No missions assigned")
                    .font(.system(size: 11))
                    .foregroundColor(wTertiary)
                Spacer()
            } else {
                let left  = Array(entry.missions.prefix(3))
                let right = Array(entry.missions.dropFirst(3).prefix(3))

                HStack(alignment: .top, spacing: 0) {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(left) { m in MissionRow(mission: m) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    if !right.isEmpty {
                        Rectangle().fill(wSep).frame(width: 0.5).padding(.vertical, 2).padding(.horizontal, 10)

                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(right) { m in MissionRow(mission: m) }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }

                if entry.missions.count > 6 {
                    Text("+\(entry.missions.count - 6) more")
                        .font(.system(size: 9))
                        .foregroundColor(wTertiary)
                        .padding(.top, 4)
                }
            }

            Spacer(minLength: 0)

            CleanDivider().padding(.vertical, 6)
            MissionFooter(done: entry.doneCount, total: entry.totalCount)
        }
        .padding(14)
    }
}

// MARK: - Large view

struct SoloLevelingLargeView: View {
    let entry: SoloLevelingEntry

    var incomplete: [Mission] { entry.missions.filter { !$0.done } }
    var complete:   [Mission] { entry.missions.filter {  $0.done } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                CleanHeader(label: "MISSIONS")
                Spacer()
                if entry.totalCount > 0 {
                    Text("\(entry.doneCount)/\(entry.totalCount) done")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(entry.allDone ? wGreen : wSecondary)
                }
            }
            .padding(.bottom, 8)

            CleanDivider().padding(.bottom, 12)

            if entry.missions.isEmpty {
                Spacer()
                VStack(spacing: 6) {
                    Text("No missions assigned")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(wSecondary)
                    Text("Add habits or systems to begin.")
                        .font(.system(size: 10))
                        .foregroundColor(wTertiary)
                }
                .frame(maxWidth: .infinity)
                Spacer()
            } else if entry.allDone {
                Spacer()
                VStack(spacing: 10) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 32))
                        .foregroundColor(wGreen)
                    Text("All missions done")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(wPrimary)
                    Text("Great work today.")
                        .font(.system(size: 11))
                        .foregroundColor(wSecondary)
                }
                .frame(maxWidth: .infinity)
                Spacer()
            } else {
                if !incomplete.isEmpty {
                    Text("ACTIVE")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundColor(wTertiary)
                        .tracking(1)
                        .padding(.bottom, 7)

                    VStack(alignment: .leading, spacing: 7) {
                        ForEach(incomplete) { m in MissionRow(mission: m) }
                    }
                }

                if !complete.isEmpty {
                    CleanDivider().padding(.vertical, 10)

                    Text("COMPLETED")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundColor(wTertiary)
                        .tracking(1)
                        .padding(.bottom, 7)

                    VStack(alignment: .leading, spacing: 7) {
                        ForEach(complete) { m in MissionRow(mission: m) }
                    }
                }
            }

            Spacer(minLength: 0)

            if !entry.missions.isEmpty && !entry.allDone {
                CleanDivider().padding(.vertical, 8)
                MissionFooter(done: entry.doneCount, total: entry.totalCount)
            }
        }
        .padding(16)
    }
}

// MARK: - Entry view router

struct SoloLevelingWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: SoloLevelingEntry

    var body: some View {
        switch family {
        case .systemLarge:  SoloLevelingLargeView(entry: entry)
        case .systemMedium: SoloLevelingMediumView(entry: entry)
        default:            SoloLevelingSmallView(entry: entry)
        }
    }
}

// MARK: - Widget definition

struct SoloLevelingWidget: Widget {
    let kind = "SoloLevelingWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SoloLevelingProvider()) { entry in
            SoloLevelingWidgetEntryView(entry: entry)
                .widgetBackground(wBg)
        }
        .configurationDisplayName("System Status")
        .description("Daily missions — physical and hard activities to complete.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
