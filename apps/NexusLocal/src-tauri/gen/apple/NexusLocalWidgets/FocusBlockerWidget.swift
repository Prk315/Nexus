import WidgetKit
import SwiftUI
import WebKit
import SafariServices

// MARK: - Why this widget exists
//
// A sideloaded free-tier app gets no BGTaskScheduler and no silent push. The
// widget extension is the only process on this phone that iOS wakes while the
// app is closed, so refreshing the Safari block rules is done as a side effect
// of the timeline refresh. Without it, blocking is only ever as current as the
// last time the app was opened — which defeats the point.
//
// The chain: `focus-evaluate` (pg_cron, every 5 min) → `blocking_state` row →
// this provider → App-Group WKContentRuleListStore → Safari blocker extension.

/// Must match `ContentBlockerBridge.swift`'s `kBlockerID` — the identifier is
/// what ties the compiled rule list to the Safari extension, and a mismatch
/// fails silently (compile succeeds, Safari never loads it).
private let kFocusBlockerID = "com.bastianthomsen.nexuslocal.SafariBlocker"

/// `blocking_state` lives in the productivity (TimeTracker) namespace, whose
/// rows are keyed `user_id = "default"` under anon-role RLS — see
/// `src-tauri/src/timetracker/mod.rs`. It is deliberately NOT `Secrets.userID`
/// (the Supabase auth uid used by the pf_/protocol_ tables): reading these
/// tables as an authenticated user returns an empty set, not an error. One
/// named reference so unit 8 can flip it in a single line if the producer ever
/// writes under the auth uid instead.
private let kBlockingStateUserID = kTimeTrackerUserID

/// Persisted across wakes so the error state can say "N sites still blocked"
/// rather than pretending nothing is blocked.
private let kLastAppliedCountKey = "focusBlockerLastAppliedCount"
private let kLastAppliedAtKey    = "focusBlockerLastAppliedAt"

// MARK: - Row model

/// All fields optional: the producer (unit 8) owns this table and the column set
/// may grow. A synthesised Codable uses `decodeIfPresent` for Optionals, so a
/// narrower select still decodes instead of throwing.
struct BlockingStateRow: Codable {
    let effective_domains: [String]?
    let effective_processes: [String]?
    let today_minutes: Int?
    let computed_at: String?
}

// MARK: - Fetch outcome
//
// Three states, deliberately NOT collapsed into one. `try? ... ?? []` (what the
// other widgets here do) makes "the network is down" indistinguishable from
// "block nothing", and a transient error would then silently switch blocking
// off — precisely the failure this whole design exists to prevent.
private enum BlockingFetch {
    /// An authoritative verdict exists. Compile it, even if it is empty — an
    /// empty `effective_domains` on a present row genuinely means "block
    /// nothing", and refusing to honour it would make blocking impossible to
    /// turn off.
    case verdict(BlockingStateRow)
    /// Request succeeded, no row for this user. No verdict has ever been
    /// computed; keep whatever is already compiled.
    case noVerdict
    /// Request failed. Keep the previously compiled rules in place.
    case unreachable(String)
}

// MARK: - Entry

enum FocusBlockerState {
    case active       // fresh verdict applied this wake
    case noVerdict    // server has not produced a row yet
    case unreachable  // fetch failed; previously compiled rules still in force
}

struct FocusBlockerEntry: TimelineEntry {
    let date: Date
    let domainCount: Int
    let processCount: Int
    let todayMinutes: Int?
    let computedAt: Date?
    let state: FocusBlockerState

    static let placeholder = FocusBlockerEntry(
        date: Date(), domainCount: 7, processCount: 3, todayMinutes: 184,
        computedAt: Date().addingTimeInterval(-120), state: .active
    )
}

// MARK: - Rule generation (mirrors src-tauri/src/content_blocker.rs)

/// "https://m.youtube.com/?ra=m" → "m.youtube.com"; "youtube.com" → "youtube.com"
func blockerHostname(from input: String) -> String {
    var s = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if s.hasPrefix("https://") {
        s = String(s.dropFirst("https://".count))
    } else if s.hasPrefix("http://") {
        s = String(s.dropFirst("http://".count))
    }
    for sep: Character in ["/", "?", "#"] {
        if let idx = s.firstIndex(of: sep) { s = String(s[s.startIndex..<idx]) }
    }
    // Drop a trailing :port (and only a port — an all-digit tail).
    if let colon = s.lastIndex(of: ":") {
        let tail = s[s.index(after: colon)...]
        if tail.allSatisfy({ $0.isASCII && $0.isNumber }) {
            s = String(s[s.startIndex..<colon])
        }
    }
    return s
}

/// Hostname characters WebKit will accept unescaped inside a url-filter regex.
/// Anything else (spaces, unicode, regex metacharacters) is rejected rather than
/// emitted: one malformed rule fails the *entire* compile, which silently
/// disables all blocking.
private let kHostnameAllowed = Set("abcdefghijklmnopqrstuvwxyz0123456789.-_")

func isBlockableHostname(_ host: String) -> Bool {
    guard !host.isEmpty, host.count <= 253 else { return false }
    return host.allSatisfy { kHostnameAllowed.contains($0) }
}

/// Generate the Safari content-blocker rules array. WebKit's regex engine has no
/// negated character classes `[^x]`, no end-anchor `$` (Code=6 on iOS 26) and no
/// lookaheads — `.*hostname` is the safe form, and it covers subdomains and
/// paths as a side effect because it matches any URL containing the host.
/// Returns "[]" for an empty list.
func generateBlockerRulesJSON(_ inputs: [String]) -> String {
    // Built as text rather than via JSONSerialization: dictionary key order out
    // of JSONSerialization is arbitrary, and this way the bytes are identical to
    // what `content_blocker.rs` produces for the same input. `isBlockableHostname`
    // has already restricted the host to [a-z0-9.-_], so the escaping backslash
    // is the only character here that needs JSON escaping — no quote, control
    // character or non-ASCII can reach this point.
    let rules: [String] = inputs.compactMap { input in
        let host = blockerHostname(from: input)
        guard isBlockableHostname(host) else { return nil }
        let escaped = host.replacingOccurrences(of: ".", with: "\\\\.")
        return "{\"trigger\":{\"url-filter\":\".*\(escaped)\"},\"action\":{\"type\":\"block\"}}"
    }
    return "[" + rules.joined(separator: ",") + "]"
}

// MARK: - Compile + reload, mirroring ContentBlockerBridge.swift

/// Resumes a continuation exactly once, whichever of the callback or the
/// deadline arrives first. Deliberately not a `withTaskGroup` race: a task group
/// awaits *all* its children before returning, so a callback that never fires
/// would hang the provider forever even after the timeout "won".
/// `@unchecked Sendable`: every field is guarded by `lock`.
private final class FirstResult: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<String, Never>?
    private var settled = false

    func attach(_ continuation: CheckedContinuation<String, Never>) {
        lock.lock(); defer { lock.unlock() }
        self.continuation = continuation
    }

    func settle(_ value: String) {
        lock.lock()
        let pending = settled ? nil : continuation
        settled = true
        continuation = nil
        lock.unlock()
        pending?.resume(returning: value)
    }
}

/// Bound every WebKit/SafariServices callback. WidgetKit gives the provider a
/// short budget and suspends the process the moment the timeline completes; a
/// completion handler that never fires would otherwise stall us until iOS kills
/// the process — with the rules half-applied and no timeline returned.
private func withDeadline(
    _ seconds: Double,
    _ start: @escaping (@escaping (String) -> Void) -> Void
) async -> String {
    let result = FirstResult()
    return await withCheckedContinuation { (cont: CheckedContinuation<String, Never>) in
        result.attach(cont)
        DispatchQueue.global().asyncAfter(deadline: .now() + seconds) { result.settle("timeout") }
        start { result.settle($0) }
    }
}

private func compileRules(into store: WKContentRuleListStore?, json: String) async -> String {
    guard let store = store else { return "no-store" }
    return await withDeadline(10) { finish in
        // `compileContentRuleList` is @MainActor in the SDK; the timeline
        // provider's Task runs off the main actor, so hop explicitly.
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                store.compileContentRuleList(forIdentifier: kFocusBlockerID,
                                             encodedContentRuleList: json) { _, err in
                    finish(err == nil ? "ok" : "err(\(err!.localizedDescription))")
                }
            }
        }
    }
}

private func reloadSafariBlocker() async -> String {
    await withDeadline(10) { finish in
        SFContentBlockerManager.reloadContentBlocker(withIdentifier: kFocusBlockerID) { err in
            finish(err == nil ? "ok" : "err(\(err!.localizedDescription))")
        }
    }
}

/// Write the rules into the App Group, compile them into both stores, then ask
/// Safari to reload. Awaited to completion *before* the timeline is returned —
/// fire-and-forget here means the process is suspended mid-compile and no rules
/// ever land.
@MainActor
private func applyBlockRules(domains: [String]) async -> String {
    let json = generateBlockerRulesJSON(domains)
    var log = "domains:\(domains.count) rules:\(json.count)B\n"

    // Always resolve through AppGroup — SideStore rewrites the group ID during
    // re-signing, so a hardcoded string silently yields a non-shared container.
    let groupID = AppGroup.identifier
    var groupStore: WKContentRuleListStore?

    if let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID) {
        log += "ctr:OK\n"
        // Keep the raw JSON in the App Group so the extension can also serve it
        // on iOS versions that still call beginRequest.
        let destURL = container.appendingPathComponent("blockerRules.json")
        do {
            try Data(json.utf8).write(to: destURL, options: .atomic)
            log += "wrote blockerRules.json\n"
        } catch {
            log += "write failed: \(error.localizedDescription)\n"
        }

        let storeURL = container.appendingPathComponent("ContentRuleListStore", isDirectory: true)
        try? FileManager.default.createDirectory(at: storeURL, withIntermediateDirectories: true)
        groupStore = WKContentRuleListStore(url: storeURL)
    } else {
        // Free-tier provisioning may not register the App Group at all (see
        // commit bbf60f1, ctr:NIL). Nothing shared is reachable; the default
        // store below is this extension's own container, not Safari's.
        log += "ctr:NIL — App Group container unavailable\n"
    }

    let defaultStore: WKContentRuleListStore? = WKContentRuleListStore.default()

    log += "compile(group): \(await compileRules(into: groupStore, json: json))\n"
    log += "compile(default): \(await compileRules(into: defaultStore, json: json))\n"
    // The Safari blocker extension target is currently absent from project.yml
    // (free-tier App ID budget; unit 9 restores it) — this call is expected to
    // error until then. Logged, non-fatal: the compiled rule list is what
    // matters and it is already in the shared store.
    log += "reload: \(await reloadSafariBlocker())\n"

    AppGroup.defaults?.set(domains.count, forKey: kLastAppliedCountKey)
    AppGroup.defaults?.set(Date().timeIntervalSince1970, forKey: kLastAppliedAtKey)
    return log
}

/// The bridge's own `writeDebugLog` is private and writes to `.documentDirectory`
/// — in this process that is the *extension's* container, invisible to the app's
/// debug panel. Write into the App Group under a distinct filename instead.
private func writeWidgetBlockerDebug(_ content: String) {
    guard let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: AppGroup.identifier
    ) else { return }
    let url = container.appendingPathComponent("widget_blocker_debug.txt")
    try? Data(content.utf8).write(to: url, options: .atomic)
}

// MARK: - Timestamp parsing

/// PostgREST returns timestamptz with a variable number of fractional digits and
/// occasionally without a zone; ISO8601DateFormatter alone rejects most of those.
func parseBlockingTimestamp(_ raw: String?) -> Date? {
    guard let raw = raw, !raw.isEmpty else { return nil }

    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = fractional.date(from: raw) { return d }

    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    if let d = plain.date(from: raw) { return d }

    let fmt = DateFormatter()
    fmt.locale = Locale(identifier: "en_US_POSIX")
    fmt.timeZone = TimeZone(identifier: "UTC")
    for pattern in ["yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXXXX",
                    "yyyy-MM-dd'T'HH:mm:ssXXXXX",
                    "yyyy-MM-dd'T'HH:mm:ss.SSSSSS",
                    "yyyy-MM-dd'T'HH:mm:ss"] {
        fmt.dateFormat = pattern
        if let d = fmt.date(from: raw) { return d }
    }
    return nil
}

// MARK: - Provider

struct FocusBlockerProvider: TimelineProvider {
    func placeholder(in context: Context) -> FocusBlockerEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (FocusBlockerEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        // Snapshots are for the gallery and can be requested rapidly; read the
        // state but do not recompile rules.
        Task { completion(await buildEntry(applyRules: false)) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FocusBlockerEntry>) -> Void) {
        Task {
            let entry = await buildEntry(applyRules: true)
            // 15 minutes, not 5. The server recomputes `blocking_state` every 5
            // minutes, but iOS budgets the actual widget refresh cadence
            // regardless of what we ask for — requesting faster than 15 gains
            // nothing and just burns the budget. Do not "optimise" this down.
            let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func fetchState() async -> BlockingFetch {
        let client = SupabaseClient()   // anon key; blocking_state is anon-readable
        let filters = ["user_id": "eq.\(kBlockingStateUserID)", "limit": "1"]

        // `today_minutes` exists in the schema (unit 1's migration declares it
        // `integer NOT NULL DEFAULT 0`), so the first select is the real one.
        // The fallback guards apply-order, not schema drift: migrations in this
        // repo never self-apply (see supabase/migrations/README.md), so the live
        // project can be running an older `blocking_state` while this build
        // already expects the column — and PostgREST answers an unknown column
        // in `select=` with a 400. A missing *display* field must never take the
        // rule refresh down with it.
        let selects = [
            "effective_domains,effective_processes,today_minutes,computed_at",
            "effective_domains,effective_processes,computed_at",
        ]

        var lastError = "unknown"
        for select in selects {
            do {
                let rows: [BlockingStateRow] = try await client.fetch(
                    table: "blocking_state", select: select, filters: filters
                )
                guard let row = rows.first else { return .noVerdict }
                return .verdict(row)
            } catch {
                lastError = "\(error)"
            }
        }
        return .unreachable(lastError)
    }

    private func buildEntry(applyRules: Bool) async -> FocusBlockerEntry {
        let now = Date()
        let result = await fetchState()

        switch result {
        case .verdict(let row):
            let domains = row.effective_domains ?? []
            if applyRules {
                let log = await applyBlockRules(domains: domains)
                writeWidgetBlockerDebug("[\(now)] verdict\n" + log)
            }
            return FocusBlockerEntry(
                date: now,
                domainCount: domains.count,
                processCount: (row.effective_processes ?? []).count,
                todayMinutes: row.today_minutes,
                computedAt: parseBlockingTimestamp(row.computed_at),
                state: .active
            )

        case .noVerdict:
            // `blocking_state` is deliberately not seeded, so "no row" means no
            // verdict has EVER been computed — genuinely different from
            // "computed, nothing blocked". Rules are left untouched rather than
            // cleared: the app's own ContentBlockerSync may have compiled a set
            // straight from `blocked_sites`, and clearing it because the cron
            // producer has not run yet would switch blocking off. The render
            // shows "not computed yet" rather than a count, per the guidance in
            // `timetracker/blocking_state.rs` — a stale count here would read as
            // an authoritative verdict that does not exist.
            if applyRules { writeWidgetBlockerDebug("[\(now)] no blocking_state row — rules untouched\n") }
            return FocusBlockerEntry(
                date: now, domainCount: 0, processCount: 0,
                todayMinutes: nil, computedAt: nil, state: .noVerdict
            )

        case .unreachable(let reason):
            // Previously compiled rules stay in force. This is the whole point.
            if applyRules { writeWidgetBlockerDebug("[\(now)] fetch failed, rules kept: \(reason)\n") }
            return FocusBlockerEntry(
                date: now, domainCount: lastAppliedCount(), processCount: 0,
                todayMinutes: nil, computedAt: lastAppliedAt(), state: .unreachable
            )
        }
    }

    private func lastAppliedCount() -> Int {
        AppGroup.defaults?.integer(forKey: kLastAppliedCountKey) ?? 0
    }

    private func lastAppliedAt() -> Date? {
        guard let ts = AppGroup.defaults?.double(forKey: kLastAppliedAtKey), ts > 0 else { return nil }
        return Date(timeIntervalSince1970: ts)
    }
}

// MARK: - Formatting

/// "just now" / "4m ago" / "2h ago" / "3d ago".
func blockerFreshness(_ computedAt: Date?, now: Date = Date()) -> String {
    guard let computedAt = computedAt else { return "never" }
    let secs = Int(max(0, now.timeIntervalSince(computedAt)))
    if secs < 60 { return "just now" }
    if secs < 3600 { return "\(secs / 60)m ago" }
    if secs < 86_400 { return "\(secs / 3600)h ago" }
    return "\(secs / 86_400)d ago"
}

/// Anything older than three server cycles means the producer stopped.
func blockerIsStale(_ computedAt: Date?, now: Date = Date()) -> Bool {
    guard let computedAt = computedAt else { return true }
    return now.timeIntervalSince(computedAt) > 15 * 60
}

private func stateColor(_ entry: FocusBlockerEntry) -> Color {
    switch entry.state {
    case .unreachable: return wAmber
    case .noVerdict:   return wTertiary
    case .active:      return blockerIsStale(entry.computedAt) ? wAmber : wGreen
    }
}

private func stateLabel(_ entry: FocusBlockerEntry) -> String {
    switch entry.state {
    case .unreachable: return "offline"
    case .noVerdict:   return "no verdict"
    case .active:      return blockerIsStale(entry.computedAt) ? "stale" : "live"
    }
}

/// Never claims a count is authoritative when it isn't.
private func blockerCaption(_ entry: FocusBlockerEntry) -> String {
    switch entry.state {
    case .active:      return "blocked in Safari"
    case .unreachable: return "last applied · offline"
    case .noVerdict:   return "not computed yet"
    }
}

// MARK: - Views

struct FocusBlockerSmallView: View {
    let entry: FocusBlockerEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                CleanHeader(label: "BLOCKING")
                Spacer()
                HStack(spacing: 4) {
                    Circle().fill(stateColor(entry)).frame(width: 6, height: 6)
                    Text(stateLabel(entry))
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(stateColor(entry))
                }
            }
            .padding(.bottom, 8)
            CleanDivider().padding(.bottom, 10)

            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(entry.state == .noVerdict ? "—" : "\(entry.domainCount)")
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundColor(entry.state == .active && entry.domainCount > 0 ? wAccent : wSecondary)
                if entry.state != .noVerdict {
                    Text(entry.domainCount == 1 ? "site" : "sites")
                        .font(.system(size: 12))
                        .foregroundColor(wTertiary)
                }
            }
            Text(blockerCaption(entry))
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(wTertiary)
                .lineLimit(1)

            Spacer(minLength: 0)
            CleanDivider().padding(.bottom, 6)
            HStack {
                Text("TODAY")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundColor(wTertiary)
                    .tracking(0.5)
                Spacer()
                Text(entry.todayMinutes.map(formatMinutes) ?? "—")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(wSecondary)
            }
            Text(entry.state == .noVerdict
                 ? "waiting for focus-evaluate"
                 : "updated \(blockerFreshness(entry.computedAt))")
                .font(.system(size: 9))
                .foregroundColor(wTertiary)
                .padding(.top, 2)
        }
        .padding(14)
    }
}

struct FocusBlockerAccessoryRectangularView: View {
    let entry: FocusBlockerEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("BLOCKING · \(stateLabel(entry))")
                .font(.system(size: 11, weight: .semibold))
                .widgetAccentable()
            Text(entry.state == .noVerdict
                 ? "not computed yet"
                 : "\(entry.domainCount) \(entry.domainCount == 1 ? "site" : "sites") · \(entry.todayMinutes.map(formatMinutes) ?? "—")")
                .font(.system(size: 13, weight: .medium))
            Text(entry.state == .noVerdict ? "waiting for focus-evaluate" : blockerFreshness(entry.computedAt))
                .font(.system(size: 11))
        }
    }
}

struct FocusBlockerWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: FocusBlockerEntry

    var body: some View {
        switch family {
        case .accessoryRectangular:
            // Lock-screen families are tinted and must stay transparent — the
            // opaque `wBg` used by the system families renders as a black box.
            FocusBlockerAccessoryRectangularView(entry: entry)
                .widgetBackground(Color.clear)
        default:
            FocusBlockerSmallView(entry: entry).widgetBackground(wBg)
        }
    }
}

struct FocusBlockerWidget: Widget {
    let kind = "NexusLocalFocusBlockerWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: FocusBlockerProvider()) { entry in
            FocusBlockerWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Focus Blocker")
        .description("Sites currently blocked, and how fresh the verdict is. Keeping this on a home screen is what keeps blocking up to date while the app is closed.")
        .supportedFamilies([.systemSmall, .accessoryRectangular])
    }
}
