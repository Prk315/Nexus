import WidgetKit
import SwiftUI

// MARK: - Entry

struct SystemsWidgetEntry: TimelineEntry {
    let date: Date
    let dueCount: Int
    let dueList: [SystemRow]     // for medium view
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

        return SystemsWidgetEntry(
            date: Date(),
            dueCount: due.count,
            dueList: Array(due.prefix(6)),
            isPlaceholder: false
        )
    }
}

// MARK: - Small View

struct SystemsSmallView: View {
    let entry: SystemsWidgetEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack(spacing: 4) {
                Circle().fill(Color.orange.opacity(0.9)).frame(width: 6, height: 6)
                Text("SYSTEMS")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(.orange)
                    .tracking(1.5)
            }
            .padding(.bottom, 10)

            if entry.dueCount == 0 {
                Spacer()
                VStack(spacing: 4) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 22))
                        .foregroundColor(.green.opacity(0.8))
                    Text("All done!")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(Color.white.opacity(0.7))
                }
                .frame(maxWidth: .infinity)
                Spacer()
            } else {
                HStack(alignment: .lastTextBaseline, spacing: 3) {
                    Text("\(entry.dueCount)")
                        .font(.system(size: 36, weight: .bold, design: .rounded))
                        .foregroundColor(.white)
                    Text("due")
                        .font(.system(size: 13))
                        .foregroundColor(Color.white.opacity(0.45))
                        .padding(.bottom, 4)
                }

                Spacer(minLength: 6)

                if let title = entry.topTitle {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(title)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(Color.white.opacity(0.85))
                            .lineLimit(2)
                        if entry.topStreak > 0 {
                            HStack(spacing: 2) {
                                Text("🔥").font(.system(size: 10))
                                Text("\(entry.topStreak) streak")
                                    .font(.system(size: 10))
                                    .foregroundColor(Color.orange.opacity(0.8))
                            }
                        }
                    }
                }
            }
        }
        .padding(14)
    }
}

// MARK: - Medium View

struct SystemsMediumView: View {
    let entry: SystemsWidgetEntry

    var body: some View {
        HStack(alignment: .top, spacing: 0) {

            // Left: count + status
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 4) {
                    Circle().fill(Color.orange.opacity(0.9)).frame(width: 6, height: 6)
                    Text("SYSTEMS")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(.orange)
                        .tracking(1.5)
                }

                if entry.dueCount == 0 {
                    Spacer()
                    VStack(spacing: 4) {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 26))
                            .foregroundColor(.green.opacity(0.8))
                        Text("All caught up")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(Color.white.opacity(0.6))
                    }
                    .frame(maxWidth: .infinity)
                    Spacer()
                } else {
                    HStack(alignment: .lastTextBaseline, spacing: 3) {
                        Text("\(entry.dueCount)")
                            .font(.system(size: 42, weight: .bold, design: .rounded))
                            .foregroundColor(.white)
                        Text("due")
                            .font(.system(size: 13))
                            .foregroundColor(Color.white.opacity(0.4))
                            .padding(.bottom, 6)
                    }
                    Spacer(minLength: 0)
                }
            }
            .padding(14)
            .frame(width: 110)

            // Divider
            Rectangle()
                .fill(Color.white.opacity(0.08))
                .frame(width: 1)
                .padding(.vertical, 12)

            // Right: list of due systems
            VStack(alignment: .leading, spacing: 5) {
                if entry.dueList.isEmpty {
                    Spacer()
                    Text("Nothing due today")
                        .font(.system(size: 11))
                        .foregroundColor(Color.white.opacity(0.3))
                    Spacer()
                } else {
                    ForEach(entry.dueList, id: \.id) { sys in
                        SystemRowView(sys: sys)
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct SystemRowView: View {
    let sys: SystemRow

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "arrow.trianglehead.2.counterclockwise")
                .font(.system(size: 9))
                .foregroundColor(Color.orange.opacity(0.7))
                .frame(width: 12)
            Text(sys.title)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(Color.white.opacity(0.85))
                .lineLimit(1)
            Spacer()
            if sys.streak_count >= 2 {
                HStack(spacing: 2) {
                    Text("🔥").font(.system(size: 9))
                    Text("\(sys.streak_count)")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(Color.orange.opacity(0.8))
                }
            }
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
                .widgetBackground(Color(red: 0.07, green: 0.07, blue: 0.09))
        }
        .configurationDisplayName("Systems Due")
        .description("Recurring systems that need attention today.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
