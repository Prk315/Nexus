import WidgetKit
import SwiftUI

struct SleepEntry: TimelineEntry {
    let date: Date
    let hasData: Bool
    let nightDate: String
    let score: Double?
    let durationMin: Int
    let deepMin: Int
    let remMin: Int
    let lightMin: Int
    var signedOut: Bool = false

    static let placeholder = SleepEntry(
        date: Date(), hasData: true, nightDate: "2026-08-02", score: 7.4,
        durationMin: 394, deepMin: 74, remMin: 91, lightMin: 229
    )
    static let signedOut = SleepEntry(
        date: Date(), hasData: false, nightDate: "", score: nil,
        durationMin: 0, deepMin: 0, remMin: 0, lightMin: 0, signedOut: true
    )
    static let empty = SleepEntry(
        date: Date(), hasData: false, nightDate: "", score: nil,
        durationMin: 0, deepMin: 0, remMin: 0, lightMin: 0
    )
}

struct SleepProvider: TimelineProvider {
    func placeholder(in context: Context) -> SleepEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (SleepEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        Task { completion(await fetchEntry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SleepEntry>) -> Void) {
        Task {
            let entry = await fetchEntry()
            // Refresh a few times through the morning; sleep updates once a day.
            let next = Calendar.current.date(byAdding: .hour, value: entry.signedOut ? 1 : 3, to: Date()) ?? Date()
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func fetchEntry() async -> SleepEntry {
        let client = SupabaseClient()          // anon key; App Group unavailable on free-tier
        let rows: [SleepRow] = (try? await client.fetch(
            table: "protocol_sleep",
            select: "date,quality_score,duration_min,deep_sleep_min,rem_sleep_min,light_sleep_min",
            filters: ["user_id": "eq.\(Secrets.userID)", "order": "date.desc", "limit": "1"]
        )) ?? []
        guard let s = rows.first else { return .empty }
        return SleepEntry(
            date: Date(), hasData: true, nightDate: s.date, score: s.quality_score,
            durationMin: s.duration_min ?? 0, deepMin: s.deep_sleep_min ?? 0,
            remMin: s.rem_sleep_min ?? 0, lightMin: s.light_sleep_min ?? 0
        )
    }
}

private func scoreColor(_ score: Double?) -> Color {
    guard let s = score else { return wSecondary }
    if s >= 7.5 { return wGreen }
    if s >= 5 { return wAmber }
    return wRed
}

struct SleepSmallView: View {
    let entry: SleepEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CleanHeader(label: "SLEEP").padding(.bottom, 8)
            CleanDivider().padding(.bottom, 10)
            if entry.hasData {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(entry.score != nil ? String(format: "%.1f", entry.score!) : "—")
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                        .foregroundColor(scoreColor(entry.score))
                    Text("/10").font(.system(size: 12)).foregroundColor(wTertiary)
                }
                Text(formatMinutes(entry.durationMin))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(wSecondary)
                Spacer(minLength: 0)
                CleanDivider().padding(.bottom, 6)
                HStack(spacing: 8) {
                    stageTag("D", entry.deepMin, wAccent)
                    stageTag("R", entry.remMin, wBlue)
                    stageTag("L", entry.lightMin, wSecondary)
                }
            } else {
                Text("No sleep data").font(.system(size: 12)).foregroundColor(wTertiary)
                Spacer(minLength: 0)
            }
        }
        .padding(14)
    }

    private func stageTag(_ label: String, _ min: Int, _ color: Color) -> some View {
        HStack(spacing: 2) {
            Circle().fill(color).frame(width: 5, height: 5)
            Text("\(min)").font(.system(size: 10, weight: .semibold)).foregroundColor(wSecondary)
        }
    }
}

struct SleepMediumView: View {
    let entry: SleepEntry
    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                CleanHeader(label: "SLEEP").padding(.bottom, 8)
                CleanDivider().padding(.bottom, 10)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(entry.score != nil ? String(format: "%.1f", entry.score!) : "—")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .foregroundColor(scoreColor(entry.score))
                    Text("/10").font(.system(size: 13)).foregroundColor(wTertiary)
                }
                Text(formatMinutes(entry.durationMin))
                    .font(.system(size: 12, weight: .medium)).foregroundColor(wSecondary)
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)

            Rectangle().fill(wSep).frame(width: 0.5).padding(.vertical, 12)

            VStack(alignment: .leading, spacing: 10) {
                stageRow("Deep", entry.deepMin, wAccent)
                stageRow("REM", entry.remMin, wBlue)
                stageRow("Light", entry.lightMin, wSecondary)
            }
            .padding(14)
            .frame(width: 130)
        }
    }

    private func stageRow(_ label: String, _ min: Int, _ color: Color) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(label).font(.system(size: 11)).foregroundColor(wSecondary)
            Spacer()
            Text(formatMinutes(min)).font(.system(size: 11, weight: .semibold)).foregroundColor(wPrimary)
        }
    }
}

struct SleepWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: SleepEntry
    var body: some View {
        if entry.signedOut {
            SignedOutView()
        } else if family == .systemMedium {
            SleepMediumView(entry: entry)
        } else {
            SleepSmallView(entry: entry)
        }
    }
}

struct SleepWidget: Widget {
    let kind = "NexusLocalSleepWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SleepProvider()) { entry in
            SleepWidgetEntryView(entry: entry).widgetBackground(wBg)
        }
        .configurationDisplayName("Sleep")
        .description("Last night's sleep score and stages.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
