import WidgetKit
import SwiftUI

// ── Design tokens ──────────────────────────────────────────────────────────────

private let kBg    = Color(red: 0.02, green: 0.02, blue: 0.07)
private let kGlow1 = Color(red: 0.48, green: 0.22, blue: 0.92)   // violet
private let kGlow2 = Color(red: 0.20, green: 0.45, blue: 1.00)   // blue
private let kText  = Color(red: 0.82, green: 0.86, blue: 1.00)   // pale blue-white
private let kDim   = Color(red: 0.40, green: 0.45, blue: 0.70)   // muted blue-gray
private let kDone  = Color(red: 0.18, green: 0.75, blue: 0.50)   // emerald — completed

// ── Mission model ─────────────────────────────────────────────────────────────

struct Mission: Identifiable {
    let id: String       // "h-\(id)" or "s-\(id)" to avoid collisions
    let title: String
    let done: Bool
}

// ── Entry ─────────────────────────────────────────────────────────────────────

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

// ── Provider ──────────────────────────────────────────────────────────────────

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

        // 1. Habits (daily recurring activities)
        async let habitRows: [HabitRow] = (try? client.fetch(
            table: "pf_daily_habits",
            select: "id,title,color,sort_order",
            filters: ["user_id": "eq.\(uid)", "order": "sort_order.asc"]
        )) ?? []

        // 2. Systems due today (recurring hard tasks)
        async let systemRows: [SystemRow] = (try? client.fetch(
            table: "pf_systems",
            select: "id,title,frequency,days_of_week,last_done,streak_count",
            filters: ["user_id": "eq.\(uid)"]
        )) ?? []

        let (habits, systems) = await (habitRows, systemRows)

        // Fetch today's habit completions
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

        // Build mission list
        var missions: [Mission] = []

        // Habits → always shown, marked done if completed today
        for h in habits {
            missions.append(Mission(
                id: "h-\(h.id)",
                title: h.title,
                done: completedHabitIds.contains(h.id)
            ))
        }

        // Systems → shown if due today (not done), hidden if already handled
        for s in systems where systemIsDue(s) {
            missions.append(Mission(id: "s-\(s.id)", title: s.title, done: false))
        }

        // Sort: incomplete first, done at bottom
        missions.sort { !$0.done && $1.done }

        return SoloLevelingEntry(date: Date(), missions: missions)
    }
}

// ── Shared sub-views ──────────────────────────────────────────────────────────

private struct SystemBorder: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
            .strokeBorder(
                LinearGradient(
                    colors: [kGlow1, kGlow2, kGlow1],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                lineWidth: 1.2
            )
            .opacity(0.7)
    }
}

private struct CornerBracket: View {
    var body: some View {
        ZStack(alignment: .topLeading) {
            Rectangle().fill(kGlow1).frame(width: 10, height: 1.5)
            Rectangle().fill(kGlow1).frame(width: 1.5, height: 10)
        }
    }
}

private struct CornerDecorations: View {
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            CornerBracket().position(x: 12, y: 12)
            CornerBracket().scaleEffect(x: -1, y:  1, anchor: .center).position(x: w - 12, y: 12)
            CornerBracket().scaleEffect(x:  1, y: -1, anchor: .center).position(x: 12,     y: h - 12)
            CornerBracket().scaleEffect(x: -1, y: -1, anchor: .center).position(x: w - 12, y: h - 12)
        }
        .opacity(0.65)
    }
}

private struct GlowDivider: View {
    var body: some View {
        Rectangle()
            .fill(LinearGradient(
                colors: [kGlow1.opacity(0), kGlow1.opacity(0.35), kGlow1.opacity(0)],
                startPoint: .leading, endPoint: .trailing
            ))
            .frame(height: 1)
    }
}

private struct SystemHeader: View {
    var body: some View {
        HStack(spacing: 0) {
            Text("[ ")
                .font(.system(size: 8, weight: .light, design: .monospaced))
                .foregroundColor(kDim)
            Text("SYSTEM NOTIFICATION")
                .font(.system(size: 8, weight: .semibold, design: .monospaced))
                .foregroundColor(kGlow2)
                .tracking(0.8)
            Text(" ]")
                .font(.system(size: 8, weight: .light, design: .monospaced))
                .foregroundColor(kDim)
        }
    }
}

private struct MissionRow: View {
    let mission: Mission

    var body: some View {
        HStack(spacing: 8) {
            // Checkbox
            ZStack {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .strokeBorder(
                        mission.done ? kDone : kDim.opacity(0.5),
                        lineWidth: 1.2
                    )
                    .frame(width: 13, height: 13)
                if mission.done {
                    Image(systemName: "checkmark")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundColor(kDone)
                }
            }

            Text(mission.title)
                .font(.system(size: 12, weight: mission.done ? .regular : .medium))
                .foregroundColor(mission.done ? kDim.opacity(0.6) : kText)
                .strikethrough(mission.done, color: kDim.opacity(0.4))
                .lineLimit(1)

            Spacer(minLength: 0)
        }
    }
}

private struct CompletionFooter: View {
    let done: Int
    let total: Int

    var allDone: Bool { done == total && total > 0 }

    var body: some View {
        HStack(spacing: 5) {
            if allDone {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 10))
                    .foregroundColor(kDone)
                Text("ALL MISSIONS COMPLETE")
                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .foregroundColor(kDone)
                    .tracking(0.5)
            } else {
                Text("\(done)/\(total)")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundColor(kDim)
                Text("COMPLETE")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(kDim.opacity(0.6))
                    .tracking(0.5)
                Spacer()
                Text("\(total - done) REMAINING")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(kGlow1.opacity(0.7))
            }
        }
    }
}

// ── Small View ────────────────────────────────────────────────────────────────

struct SoloLevelingSmallView: View {
    let entry: SoloLevelingEntry

    var body: some View {
        ZStack {
            CornerDecorations()

            VStack(alignment: .leading, spacing: 0) {
                SystemHeader()
                    .padding(.bottom, 8)

                GlowDivider()
                    .padding(.bottom, 8)

                // Big completion count
                if entry.totalCount == 0 {
                    Spacer()
                    Text("No missions\nassigned")
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(kDim.opacity(0.5))
                        .multilineTextAlignment(.leading)
                    Spacer()
                } else if entry.allDone {
                    Spacer()
                    VStack(alignment: .leading, spacing: 4) {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 22))
                            .foregroundColor(kDone)
                        Text("ALL CLEAR")
                            .font(.system(size: 11, weight: .black, design: .monospaced))
                            .foregroundColor(kDone)
                            .tracking(1)
                    }
                    Spacer()
                } else {
                    // Remaining count prominent
                    HStack(alignment: .lastTextBaseline, spacing: 4) {
                        Text("\(entry.totalCount - entry.doneCount)")
                            .font(.system(size: 38, weight: .black, design: .rounded))
                            .foregroundColor(.white)
                        Text("left")
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundColor(kDim)
                            .padding(.bottom, 5)
                    }

                    Spacer(minLength: 4)

                    // Next incomplete mission
                    if let next = entry.missions.first(where: { !$0.done }) {
                        HStack(spacing: 5) {
                            Image(systemName: "chevron.right")
                                .font(.system(size: 8, weight: .bold))
                                .foregroundColor(kGlow1)
                            Text(next.title)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(kText.opacity(0.85))
                                .lineLimit(2)
                        }
                    }
                }

                Spacer(minLength: 0)

                // Footer count
                if entry.totalCount > 0 && !entry.allDone {
                    GlowDivider().padding(.vertical, 6)
                    CompletionFooter(done: entry.doneCount, total: entry.totalCount)
                }
            }
            .padding(14)
        }
        .overlay(SystemBorder())
    }
}

// ── Medium View ───────────────────────────────────────────────────────────────

struct SoloLevelingMediumView: View {
    let entry: SoloLevelingEntry

    var body: some View {
        ZStack {
            CornerDecorations()

            VStack(alignment: .leading, spacing: 0) {
                // Header row
                HStack {
                    SystemHeader()
                    Spacer()
                    if entry.totalCount > 0 {
                        Text("\(entry.doneCount)/\(entry.totalCount)")
                            .font(.system(size: 9, weight: .semibold, design: .monospaced))
                            .foregroundColor(entry.allDone ? kDone : kDim)
                    }
                }
                .padding(.bottom, 8)

                GlowDivider().padding(.bottom, 10)

                // Section label
                HStack(spacing: 4) {
                    Image(systemName: "scroll")
                        .font(.system(size: 8))
                        .foregroundColor(kDim)
                    Text("DAILY MISSIONS")
                        .font(.system(size: 8, weight: .semibold, design: .monospaced))
                        .foregroundColor(kDim)
                        .tracking(1)
                }
                .padding(.bottom, 8)

                if entry.missions.isEmpty {
                    Spacer()
                    Text("No missions assigned")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(kDim.opacity(0.4))
                    Spacer()
                } else {
                    // Show up to 6 missions in two columns
                    let left  = Array(entry.missions.prefix(3))
                    let right = Array(entry.missions.dropFirst(3).prefix(3))

                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(left)  { m in MissionRow(mission: m) }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)

                        if !right.isEmpty {
                            // Subtle column divider
                            Rectangle()
                                .fill(kGlow1.opacity(0.15))
                                .frame(width: 1)
                                .padding(.vertical, 2)

                            VStack(alignment: .leading, spacing: 6) {
                                ForEach(right) { m in MissionRow(mission: m) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }

                    if entry.missions.count > 6 {
                        Text("+ \(entry.missions.count - 6) more")
                            .font(.system(size: 8, design: .monospaced))
                            .foregroundColor(kDim.opacity(0.4))
                            .padding(.top, 4)
                    }
                }

                Spacer(minLength: 0)

                GlowDivider().padding(.vertical, 8)
                CompletionFooter(done: entry.doneCount, total: entry.totalCount)
            }
            .padding(14)
        }
        .overlay(SystemBorder())
    }
}

// ── Large View ────────────────────────────────────────────────────────────────

struct SoloLevelingLargeView: View {
    let entry: SoloLevelingEntry

    var incomplete: [Mission] { entry.missions.filter { !$0.done } }
    var complete:   [Mission] { entry.missions.filter {  $0.done } }

    var body: some View {
        ZStack {
            CornerDecorations()

            VStack(alignment: .leading, spacing: 0) {
                // Header
                HStack {
                    SystemHeader()
                    Spacer()
                    if entry.totalCount > 0 {
                        Text("\(entry.doneCount)/\(entry.totalCount) COMPLETE")
                            .font(.system(size: 8, weight: .semibold, design: .monospaced))
                            .foregroundColor(entry.allDone ? kDone : kDim)
                    }
                }
                .padding(.bottom, 8)

                GlowDivider().padding(.bottom, 12)

                if entry.missions.isEmpty {
                    Spacer()
                    VStack(spacing: 6) {
                        Text("[ NO MISSIONS ASSIGNED ]")
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                            .foregroundColor(kDim.opacity(0.4))
                        Text("Add habits or systems to begin.")
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundColor(kDim.opacity(0.25))
                    }
                    .frame(maxWidth: .infinity)
                    Spacer()
                } else if entry.allDone {
                    Spacer()
                    VStack(spacing: 10) {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 34))
                            .foregroundColor(kDone)
                        Text("ALL MISSIONS COMPLETE")
                            .font(.system(size: 13, weight: .black, design: .monospaced))
                            .foregroundColor(kDone)
                            .tracking(1)
                        Text("You may rest, Hunter.")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(kDim.opacity(0.5))
                    }
                    .frame(maxWidth: .infinity)
                    Spacer()
                } else {
                    // Active missions section
                    if !incomplete.isEmpty {
                        HStack(spacing: 4) {
                            Image(systemName: "exclamationmark.circle")
                                .font(.system(size: 8))
                                .foregroundColor(kGlow1.opacity(0.8))
                            Text("ACTIVE MISSIONS")
                                .font(.system(size: 8, weight: .semibold, design: .monospaced))
                                .foregroundColor(kGlow1.opacity(0.8))
                                .tracking(1)
                        }
                        .padding(.bottom, 7)

                        VStack(alignment: .leading, spacing: 7) {
                            ForEach(incomplete) { m in MissionRow(mission: m) }
                        }
                    }

                    // Completed section
                    if !complete.isEmpty {
                        GlowDivider()
                            .padding(.vertical, 10)

                        HStack(spacing: 4) {
                            Image(systemName: "checkmark.circle")
                                .font(.system(size: 8))
                                .foregroundColor(kDone.opacity(0.7))
                            Text("COMPLETED")
                                .font(.system(size: 8, weight: .semibold, design: .monospaced))
                                .foregroundColor(kDone.opacity(0.7))
                                .tracking(1)
                        }
                        .padding(.bottom, 7)

                        VStack(alignment: .leading, spacing: 7) {
                            ForEach(complete) { m in MissionRow(mission: m) }
                        }
                    }
                }

                Spacer(minLength: 0)

                if !entry.missions.isEmpty && !entry.allDone {
                    GlowDivider().padding(.vertical, 8)
                    CompletionFooter(done: entry.doneCount, total: entry.totalCount)
                }
            }
            .padding(16)
        }
        .overlay(SystemBorder())
    }
}

// ── Entry view router ─────────────────────────────────────────────────────────

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

// ── Widget definition ─────────────────────────────────────────────────────────

struct SoloLevelingWidget: Widget {
    let kind = "SoloLevelingWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SoloLevelingProvider()) { entry in
            SoloLevelingWidgetEntryView(entry: entry)
                .widgetBackground(kBg)
        }
        .configurationDisplayName("System Status")
        .description("Daily missions — physical and hard activities to complete.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
