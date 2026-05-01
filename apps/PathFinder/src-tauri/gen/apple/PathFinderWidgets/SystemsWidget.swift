import WidgetKit
import SwiftUI

// MARK: - Entry

struct SystemsWidgetEntry: TimelineEntry {
    let date: Date
    let dueCount: Int
    let dueList: [SystemRow]
    let isPlaceholder: Bool

    var topTitle: String? { dueList.first?.title }
    var topStreak: Int   { dueList.first?.streak_count ?? 0 }

    static let placeholder = SystemsWidgetEntry(
        date: Date(),
        dueCount: 3,
        dueList: [
            SystemRow(id: 1, title: "Evening review",   frequency: "daily",  days_of_week: nil, last_done: nil, streak_count: 12),
            SystemRow(id: 2, title: "Morning pages",    frequency: "daily",  days_of_week: nil, last_done: nil, streak_count: 5),
            SystemRow(id: 3, title: "Weekly planning",  frequency: "weekly", days_of_week: nil, last_done: nil, streak_count: 8),
        ],
        isPlaceholder: true
    )
    static let empty = SystemsWidgetEntry(date: Date(), dueCount: 0, dueList: [], isPlaceholder: false)
}

// MARK: - Provider

struct SystemsProvider: TimelineProvider {
    let client = SupabaseClient()

    func placeholder(in context: Context) -> SystemsWidgetEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (SystemsWidgetEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        Task { completion(await fetchEntry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SystemsWidgetEntry>) -> Void) {
        Task {
            let entry = await fetchEntry()
            let entries = (0..<4).map { offset -> SystemsWidgetEntry in
                let d = Calendar.current.date(byAdding: .minute, value: offset * 15, to: Date()) ?? Date()
                return SystemsWidgetEntry(date: d, dueCount: entry.dueCount, dueList: entry.dueList, isPlaceholder: false)
            }
            completion(Timeline(entries: entries, policy: .atEnd))
        }
    }

    private func fetchEntry() async -> SystemsWidgetEntry {
        let systems: [SystemRow] = (try? await client.fetch(
            table: "pf_systems",
            select: "id,title,frequency,days_of_week,last_done,streak_count",
            filters: ["user_id": "eq.\(Secrets.userID)"]
        )) ?? []

        let due = systems
            .filter { systemIsDue($0) }
            .sorted { $0.streak_count > $1.streak_count }

        return SystemsWidgetEntry(date: Date(), dueCount: due.count, dueList: Array(due.prefix(6)), isPlaceholder: false)
    }
}

// MARK: - Row sub-view

struct SystemRowView: View {
    let sys: SystemRow

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .strokeBorder(wTertiary, lineWidth: 1.2)
                .frame(width: 12, height: 12)
            Text(sys.title)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(wPrimary.opacity(0.85))
                .lineLimit(1)
            Spacer()
            if sys.streak_count >= 2 {
                Text("×\(sys.streak_count)")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundColor(sys.streak_count >= 7 ? wAmber : wTertiary)
            }
        }
    }
}

// MARK: - Small view

struct SystemsSmallView: View {
    let entry: SystemsWidgetEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CleanHeader(label: "SYSTEMS")
                .padding(.bottom, 8)

            CleanDivider().padding(.bottom, 10)

            if entry.dueCount == 0 {
                Spacer()
                VStack(alignment: .leading, spacing: 4) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundColor(wGreen)
                    Text("All clear")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(wGreen)
                }
                Spacer()
            } else {
                HStack(alignment: .lastTextBaseline, spacing: 4) {
                    Text("\(entry.dueCount)")
                        .font(.system(size: 36, weight: .bold, design: .rounded))
                        .foregroundColor(wPrimary)
                    Text("due")
                        .font(.system(size: 12))
                        .foregroundColor(wSecondary)
                        .padding(.bottom, 4)
                }

                Spacer(minLength: 6)

                if let title = entry.topTitle {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(title)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(wPrimary.opacity(0.85))
                            .lineLimit(2)
                        if entry.topStreak > 0 {
                            Text("×\(entry.topStreak) streak")
                                .font(.system(size: 9, weight: .medium))
                                .foregroundColor(entry.topStreak >= 7 ? wAmber : wTertiary)
                        }
                    }
                }
            }

            Spacer(minLength: 0)
        }
        .padding(14)
    }
}

// MARK: - Medium view

struct SystemsMediumView: View {
    let entry: SystemsWidgetEntry

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            // Left: count
            VStack(alignment: .leading, spacing: 0) {
                CleanHeader(label: "SYSTEMS")
                    .padding(.bottom, 8)
                CleanDivider().padding(.bottom, 8)

                if entry.dueCount == 0 {
                    Spacer()
                    VStack(alignment: .leading, spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 22))
                            .foregroundColor(wGreen)
                        Text("All clear")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(wGreen)
                    }
                    Spacer()
                } else {
                    HStack(alignment: .lastTextBaseline, spacing: 3) {
                        Text("\(entry.dueCount)")
                            .font(.system(size: 40, weight: .bold, design: .rounded))
                            .foregroundColor(wPrimary)
                        Text("due")
                            .font(.system(size: 12))
                            .foregroundColor(wSecondary)
                            .padding(.bottom, 5)
                    }
                    Spacer(minLength: 0)
                }
            }
            .padding(14)
            .frame(width: 110)

            Rectangle().fill(wSep).frame(width: 0.5).padding(.vertical, 12)

            // Right: due systems list
            VStack(alignment: .leading, spacing: 6) {
                if entry.dueList.isEmpty {
                    Spacer()
                    Text("Nothing due today")
                        .font(.system(size: 10))
                        .foregroundColor(wTertiary)
                    Spacer()
                } else {
                    ForEach(entry.dueList, id: \.id) { sys in
                        SystemRowView(sys: sys)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Entry view router

struct SystemsWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: SystemsWidgetEntry

    var body: some View {
        switch family {
        case .systemMedium: SystemsMediumView(entry: entry)
        default:            SystemsSmallView(entry: entry)
        }
    }
}

// MARK: - Widget definition

struct SystemsWidget: Widget {
    let kind = "SystemsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SystemsProvider()) { entry in
            SystemsWidgetEntryView(entry: entry)
                .widgetBackground(wBg)
        }
        .configurationDisplayName("Systems Due")
        .description("Recurring systems that need attention today.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
