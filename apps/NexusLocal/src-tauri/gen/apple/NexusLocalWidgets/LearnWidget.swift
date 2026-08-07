import WidgetKit
import SwiftUI

// MARK: - Row types (lr_ tables — see LEARN_PLAN.md + 20260806190000_learn_lr_schema.sql)

private struct LrUnitRow: Decodable { let unit_id: Int }
private struct LrUnitProgressRow: Decodable { let unit_id: Int }

/// Decodes any JSON value trivially, without inspecting the decoder — used
/// only to count elements of `due_concepts`. `learn-evaluate` (Phase 3) isn't
/// built yet, so the jsonb element shape isn't finalized; this avoids a
/// mismatched-type decode failure taking down the whole row for a field we
/// only need the length of.
private struct AnyJSONElement: Decodable {
    init(from decoder: Decoder) throws {}
}

private struct LrLearnStateRow: Decodable {
    let streak_days: Int?
    let due_concepts: [AnyJSONElement]?
}

// MARK: - Entry

struct LearnEntry: TimelineEntry, Codable {
    let date: Date
    let masteredUnits: Int
    let totalUnits: Int
    /// nil = `lr_learn_state` has never been computed for this user. This is
    /// the blocking_state-style invariant from LEARN_PLAN.md: a missing
    /// verdict row is NEVER "nothing due" — it must render as a distinct
    /// neutral state, never as a zero.
    let streakDays: Int?
    let dueCount: Int?
    /// True when this entry is a stale cache fallback because the live fetch
    /// failed outright (network/decoding). Distinct from a legitimate
    /// zero-row `lr_learn_state` response, which is a normal "no verdict yet"
    /// state and is NOT stale.
    var stale: Bool = false

    var fraction: Double { totalUnits > 0 ? Double(masteredUnits) / Double(totalUnits) : 0 }
    var hasVerdict: Bool { streakDays != nil }

    static let placeholder = LearnEntry(
        date: Date(), masteredUnits: 9, totalUnits: 28, streakDays: 4, dueCount: 3
    )
    /// Used only when there is no live data AND no cache at all (first ever
    /// run, offline) — 28 is the known LA unit count from LEARN_PLAN.md, not
    /// a guess that varies by user.
    static let noVerdictYet = LearnEntry(
        date: Date(), masteredUnits: 0, totalUnits: 28, streakDays: nil, dueCount: nil
    )
}

// MARK: - Cache (last-known entry, survives a failed fetch)

/// Mirrors WidgetStore's App-Group-with-fallback pattern: the timeline
/// provider runs inside the widget extension process either way, so the App
/// Group is a bonus (lets the host app see it too), never a requirement.
private enum LearnCache {
    private static var store: UserDefaults { AppGroup.defaults ?? .standard }
    private static let key = "learnWidget.lastEntry"

    static func load() -> LearnEntry? {
        guard let data = store.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(LearnEntry.self, from: data)
    }

    static func save(_ entry: LearnEntry) {
        guard let data = try? JSONEncoder().encode(entry) else { return }
        store.set(data, forKey: key)
    }
}

// MARK: - Provider

struct LearnProvider: TimelineProvider {
    func placeholder(in context: Context) -> LearnEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (LearnEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        Task { completion(await fetchEntry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<LearnEntry>) -> Void) {
        Task {
            let entry = await fetchEntry()
            let next = Calendar.current.date(byAdding: .minute, value: 20, to: Date()) ?? Date()
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func fetchEntry() async -> LearnEntry {
        // lr_ tables use the fixed "default" user_id — same posture as the
        // productivity stack, not the pf_/protocol_ auth-uid convention.
        let client = SupabaseClient()
        let uid = kTimeTrackerUserID

        async let unitRows: [LrUnitRow]? = try? client.fetch(
            table: "lr_unit", select: "unit_id"
        )
        async let progressRows: [LrUnitProgressRow]? = try? client.fetch(
            table: "lr_unit_progress", select: "unit_id",
            filters: ["user_id": "eq.\(uid)", "status": "eq.mastered"]
        )
        async let stateRows: [LrLearnStateRow]? = try? client.fetch(
            table: "lr_learn_state", select: "streak_days,due_concepts",
            filters: ["user_id": "eq.\(uid)"]
        )

        let (units, progress, state) = await (unitRows, progressRows, stateRows)

        // Any outright fetch/decoding failure keeps the last known entry
        // rather than rendering fabricated zeros — the "fail toward still
        // enforcing / still showing the last known truth" rule from
        // CLAUDE.md's blocking_state section applies here too.
        guard let units, let progress, let state else {
            let last = LearnCache.load() ?? .noVerdictYet
            return LearnEntry(
                date: Date(), masteredUnits: last.masteredUnits, totalUnits: last.totalUnits,
                streakDays: last.streakDays, dueCount: last.dueCount, stale: true
            )
        }

        // state.first == nil means the lr_learn_state row genuinely doesn't
        // exist yet (learn-evaluate/Phase 3 hasn't run for this user) — a
        // real, non-stale "no verdict yet" state, not a failure.
        let row = state.first
        let entry = LearnEntry(
            date: Date(),
            masteredUnits: progress.count,
            totalUnits: units.count,
            streakDays: row?.streak_days,
            dueCount: row?.due_concepts?.count,
            stale: false
        )
        LearnCache.save(entry)
        return entry
    }
}

// MARK: - Learn identity: indigo → fuchsia gradient (distinct from the
// single-tone wAccent used everywhere else)

private let wIndigo = Color(red: 0.38, green: 0.35, blue: 0.95)
private let wFuchsia = Color(red: 0.86, green: 0.32, blue: 0.85)
private let learnGradient = LinearGradient(
    colors: [wIndigo, wFuchsia], startPoint: .topLeading, endPoint: .bottomTrailing
)

// MARK: - Small reusable views

private struct LearnRing: View {
    let fraction: Double
    let size: CGFloat
    var body: some View {
        ZStack {
            Circle().stroke(wSep, lineWidth: size * 0.09)
            Circle()
                .trim(from: 0, to: max(0.001, fraction))
                .stroke(learnGradient, style: StrokeStyle(lineWidth: size * 0.09, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(Int((fraction * 100).rounded()))%")
                .font(.system(size: size * 0.20, weight: .bold, design: .rounded))
                .foregroundColor(wPrimary)
        }
        .frame(width: size, height: size)
    }
}

/// Header row with the offline dot swapped for the gradient dot, plus a
/// small stale indicator when this entry is a cache fallback.
private struct LearnHeader: View {
    var stale: Bool
    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(learnGradient).frame(width: 5, height: 5)
            Text("LEARN")
                .font(.system(size: 9, weight: .semibold))
                .foregroundColor(wSecondary)
                .tracking(1.2)
            Spacer()
            if stale {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 8, weight: .medium))
                    .foregroundColor(wTertiary)
            }
        }
    }
}

/// The "ingen dom endnu" neutral state — deliberately not a zero, per the
/// missing-verdict invariant.
private struct NoVerdictRow: View {
    var body: some View {
        HStack(spacing: 5) {
            Text("–")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(wTertiary)
            Text("ingen dom endnu")
                .font(.system(size: 9))
                .foregroundColor(wTertiary)
        }
    }
}

// MARK: - Data views

struct LearnSmallView: View {
    let entry: LearnEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            LearnHeader(stale: entry.stale).padding(.bottom, 10)
            CleanDivider().padding(.bottom, 10)
            Spacer(minLength: 0)
            HStack {
                Spacer()
                LearnRing(fraction: entry.fraction, size: 66)
                Spacer()
            }
            Spacer(minLength: 0)
            Text("\(entry.masteredUnits)/\(entry.totalUnits) mestret")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(wSecondary)
                .padding(.bottom, 4)

            if entry.hasVerdict {
                HStack(spacing: 10) {
                    Label("\(entry.streakDays ?? 0)", systemImage: "flame.fill")
                        .foregroundColor(wAmber)
                    Label("\(entry.dueCount ?? 0)", systemImage: "clock.fill")
                        .foregroundColor((entry.dueCount ?? 0) > 0 ? wBlue : wSecondary)
                }
                .font(.system(size: 10, weight: .semibold))
            } else {
                NoVerdictRow()
            }
        }
        .padding(14)
    }
}

struct LearnMediumView: View {
    let entry: LearnEntry
    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                LearnHeader(stale: entry.stale).padding(.bottom, 8)
                CleanDivider().padding(.bottom, 10)

                Text("\(entry.masteredUnits) af \(entry.totalUnits) moduler mestret")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(wPrimary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 0)

                if entry.hasVerdict {
                    HStack(spacing: 16) {
                        statBlock(label: "STREAK", value: "\(entry.streakDays ?? 0)",
                                  icon: "flame.fill", color: wAmber)
                        statBlock(label: "AFVENTER", value: "\(entry.dueCount ?? 0)",
                                  icon: "clock.fill",
                                  color: (entry.dueCount ?? 0) > 0 ? wBlue : wSecondary)
                    }
                } else {
                    NoVerdictRow()
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity)

            Rectangle().fill(wSep).frame(width: 0.5).padding(.vertical, 12)

            HStack {
                Spacer()
                LearnRing(fraction: entry.fraction, size: 84)
                Spacer()
            }
            .frame(width: 120)
        }
    }

    @ViewBuilder
    private func statBlock(label: String, value: String, icon: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 8, weight: .medium))
                .foregroundColor(wTertiary)
                .tracking(0.5)
            Label(value, systemImage: icon)
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundColor(color)
        }
    }
}

// MARK: - Widget definition

struct LearnWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: LearnEntry
    var body: some View {
        switch family {
        case .systemMedium: LearnMediumView(entry: entry)
        default:             LearnSmallView(entry: entry)
        }
    }
}

struct LearnWidget: Widget {
    let kind = "NexusLocalLearnWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LearnProvider()) { entry in
            LearnWidgetEntryView(entry: entry).widgetBackground(wBg)
        }
        .configurationDisplayName("Learn")
        .description("Moduler mestret, streak og afventende koncepter.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
