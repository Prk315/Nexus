import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Entry

struct HabitItem: Identifiable {
    let id: String
    let name: String
    let time: String?      // "07:30", already trimmed
    let done: Bool
}

struct HabitsListEntry: TimelineEntry {
    let date: Date
    let today: String
    let items: [HabitItem]     // the current page only
    let doneCount: Int         // across everything scheduled today
    let totalCount: Int
    let page: Int
    let pageCount: Int
    /// Which session channel the read used — `.none` means it fell back to the
    /// anon key. Rendered in the header so the free-tier keychain question is
    /// answered by looking at the widget rather than trusting the build log.
    var authSource: AuthSource = .none

    static let placeholder = HabitsListEntry(
        date: Date(), today: "2026-08-04",
        items: [
            HabitItem(id: "1", name: "Morning mobility", time: "07:00", done: true),
            HabitItem(id: "2", name: "Read 20 pages",    time: nil,     done: true),
            HabitItem(id: "3", name: "Cold shower",      time: "08:15", done: false),
            HabitItem(id: "4", name: "Journal",          time: "21:30", done: false),
        ],
        doneCount: 2, totalCount: 4, page: 0, pageCount: 1
    )
}

// MARK: - Provider

struct HabitsListProvider: TimelineProvider {
    func placeholder(in context: Context) -> HabitsListEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (HabitsListEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        Task { completion(await fetchEntry(family: context.family)) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HabitsListEntry>) -> Void) {
        Task {
            let entry = await fetchEntry(family: context.family)
            // Taps reload the timeline explicitly, so this is only the passive
            // catch-up for edits made elsewhere (phone app, desktop, another device).
            let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    /// Rows visible at once. WidgetKit gives no scrolling, so anything beyond
    /// this is reached with the header's paging buttons.
    static func rowCapacity(_ family: WidgetFamily) -> Int {
        switch family {
        case .systemLarge: return 9
        default:           return 4
        }
    }

    private func fetchEntry(family: WidgetFamily) async -> HabitsListEntry {
        // Prefer a real user JWT bridged from the app; fall back to the anon key
        // so the widget keeps working while the keychain question is unsettled.
        let auth = await SessionStore.validAuth()
        let client = auth.map { SupabaseClient(accessToken: $0.token) } ?? SupabaseClient()
        let uid = auth?.userID ?? Secrets.userID
        let authSource = auth?.source ?? .none
        let today = todayString()

        async let habitRows: [HabitRow] = (try? client.fetch(
            table: "protocol_habits",
            select: "id,name,archived,repeat_days,scheduled_time,sort_order",
            filters: ["user_id": "eq.\(uid)", "archived": "eq.false", "order": "sort_order.asc"]
        )) ?? []

        async let completionRows: [HabitCompletionRow] = (try? client.fetch(
            table: "protocol_habit_completions",
            select: "habit_id,date",
            filters: ["user_id": "eq.\(uid)", "date": "eq.\(today)"]
        )) ?? []

        let (habits, completions) = await (habitRows, completionRows)

        // "Due today" is repeat_days only, matching Protocol's isScheduled():
        // a null repeat_days means every day.
        let weekday = mondayFirstWeekday(Date())
        let scheduled = habits.filter { habit in
            guard let days = habit.repeat_days else { return true }
            return days.contains(weekday)
        }

        let completedIDs = Set(completions.map { $0.habit_id })
        let overrides = WidgetStore.loadOverrides()

        var items: [HabitItem] = []
        for habit in scheduled {
            var done = completedIDs.contains(habit.id)
            if let override = overrides[WidgetStore.overrideKey(habit.id, today)] {
                if override.done == done {
                    // Server agreed — the optimistic state has served its purpose.
                    WidgetStore.clearOverride(habitID: habit.id, date: today)
                } else {
                    done = override.done
                }
            }
            items.append(HabitItem(
                id: habit.id,
                name: habit.name,
                time: habit.scheduled_time.map { String($0.prefix(5)) },
                done: done
            ))
        }

        let capacity = Self.rowCapacity(family)
        let pageCount = max(1, Int(ceil(Double(items.count) / Double(capacity))))
        // A shrinking list must not strand the view on a page that no longer exists.
        let page = min(WidgetStore.page(WidgetKind.habitsList), pageCount - 1)
        let start = page * capacity
        let pageItems = start < items.count
            ? Array(items[start..<min(start + capacity, items.count)])
            : []

        return HabitsListEntry(
            date: Date(), today: today, items: pageItems,
            doneCount: items.filter { $0.done }.count,
            totalCount: items.count,
            page: page, pageCount: pageCount,
            authSource: authSource
        )
    }
}

// MARK: - Row

@available(iOS 17.0, *)
struct HabitRowView: View {
    let item: HabitItem
    let today: String
    var compact: Bool = false

    var body: some View {
        Button(intent: ToggleHabitIntent(habitID: item.id, date: today, done: item.done)) {
            HStack(spacing: 9) {
                ZStack {
                    Circle()
                        .fill(item.done ? wGreen : Color.clear)
                    Circle()
                        .strokeBorder(item.done ? wGreen : wTertiary, lineWidth: 1.5)
                    if item.done {
                        Image(systemName: "checkmark")
                            .font(.system(size: compact ? 8 : 9, weight: .bold))
                            .foregroundColor(wBg)
                    }
                }
                .frame(width: compact ? 16 : 18, height: compact ? 16 : 18)

                Text(item.name)
                    .font(.system(size: compact ? 12 : 13, weight: .medium))
                    .foregroundColor(item.done ? wTertiary : wPrimary)
                    .strikethrough(item.done, color: wTertiary)
                    .lineLimit(1)

                Spacer(minLength: 4)

                if let time = item.time {
                    Text(time)
                        .font(.system(size: 9, weight: .medium, design: .rounded))
                        .foregroundColor(wTertiary)
                }
            }
            .padding(.vertical, 3)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Widget view

@available(iOS 17.0, *)
struct HabitsListView: View {
    @Environment(\.widgetFamily) var family
    let entry: HabitsListEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header.padding(.bottom, 7)
            CleanDivider().padding(.bottom, 7)

            if entry.totalCount == 0 {
                Spacer()
                Text("Nothing scheduled today")
                    .font(.system(size: 12))
                    .foregroundColor(wTertiary)
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: family == .systemLarge ? 3 : 2) {
                    ForEach(entry.items) { item in
                        HabitRowView(item: item, today: entry.today,
                                     compact: family != .systemLarge)
                    }
                }
                Spacer(minLength: 0)
                if family == .systemLarge { progressBar.padding(.top, 8) }
            }
        }
        .padding(14)
    }

    private var header: some View {
        HStack(spacing: 6) {
            CleanHeader(label: "HABITS")

            // Auth probe: green "kc" = shared keychain worked (the free-tier
            // question), blue "ag" = App Group, amber "anon" = no session at all.
            Text(entry.authSource == .none ? "anon" : entry.authSource.rawValue)
                .font(.system(size: 7, weight: .bold, design: .monospaced))
                .foregroundColor(authBadgeColor)
                .padding(.horizontal, 3)
                .padding(.vertical, 1)
                .background(
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(authBadgeColor.opacity(0.18))
                )

            Spacer(minLength: 4)

            Text("\(entry.doneCount)/\(entry.totalCount)")
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundColor(entry.doneCount == entry.totalCount && entry.totalCount > 0
                                 ? wGreen : wSecondary)

            if entry.pageCount > 1 {
                pageButton(systemName: "chevron.left", delta: -1)
                Text("\(entry.page + 1)/\(entry.pageCount)")
                    .font(.system(size: 9, weight: .medium, design: .rounded))
                    .foregroundColor(wTertiary)
                    .frame(minWidth: 22)
                pageButton(systemName: "chevron.right", delta: 1)
            }
        }
    }

    private var authBadgeColor: Color {
        switch entry.authSource {
        case .keychain: return wGreen      // the outcome we're testing for
        case .appGroup: return wBlue
        case .none:     return wAmber
        }
    }

    private func pageButton(systemName: String, delta: Int) -> some View {
        Button(intent: HabitPageIntent(delta: delta, pageCount: entry.pageCount)) {
            Image(systemName: systemName)
                .font(.system(size: 9, weight: .bold))
                .foregroundColor(wSecondary)
                .frame(width: 18, height: 18)
                .background(
                    RoundedRectangle(cornerRadius: 5, style: .continuous).fill(wSep)
                )
        }
        .buttonStyle(.plain)
    }

    private var progressBar: some View {
        let fraction = entry.totalCount > 0
            ? Double(entry.doneCount) / Double(entry.totalCount) : 0
        return GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(wSep)
                Capsule()
                    .fill(fraction >= 1 ? wGreen : wAccent)
                    .frame(width: max(2, geo.size.width * fraction))
            }
        }
        .frame(height: 4)
    }
}

// MARK: - Widget definition

struct HabitsListWidget: Widget {
    let kind = WidgetKind.habitsList

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: HabitsListProvider()) { entry in
            Group {
                if #available(iOS 17.0, *) {
                    HabitsListView(entry: entry)
                } else {
                    // Interactive widgets are iOS 17+; older systems get the ring.
                    SignedOutView()
                }
            }
            .widgetBackground(wBg)
        }
        .configurationDisplayName("Habits Checklist")
        .description("Tap a habit to complete it — tap again to un-complete. Page through with the arrows.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
