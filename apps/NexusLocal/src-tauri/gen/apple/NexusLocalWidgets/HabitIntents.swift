import AppIntents
import WidgetKit

// MARK: - Kinds (shared so intents can reload the right timelines)

enum WidgetKind {
    static let habitsList   = "NexusLocalHabitsListWidget"
    static let habitsRing   = "NexusLocalHabitsWidget"
    static let habitHeatmap = "NexusLocalHabitHeatmapWidget"
}

// MARK: - Toggle a habit straight from the home screen

/// WidgetKit allows exactly one interaction inside a widget: a tap on a
/// `Button`/`Toggle` backed by an AppIntent. There are no gestures and no
/// scrolling, so a single tap has to carry both directions — tapping an
/// incomplete habit completes it, tapping a complete one un-completes it.
///
/// Completion is a presence row in `protocol_habit_completions`
/// (INSERT = done, DELETE = not done), matching Protocol's
/// `addHabitCompletionToCloud` / `removeHabitCompletionFromCloud`.
@available(iOS 17.0, *)
struct ToggleHabitIntent: AppIntent {
    static var title: LocalizedStringResource = "Toggle Habit"
    static var description = IntentDescription("Mark a habit complete or incomplete.")
    /// Keep the tap inside the widget — never bounce the user into the app.
    static var openAppWhenRun: Bool = false
    /// Internal plumbing, not something to surface in Shortcuts.
    static var isDiscoverable: Bool = false

    @Parameter(title: "Habit ID") var habitID: String
    @Parameter(title: "Date")     var date: String
    @Parameter(title: "Done")     var done: Bool

    init() {}

    init(habitID: String, date: String, done: Bool) {
        self.habitID = habitID
        self.date = date
        self.done = done
    }

    func perform() async throws -> some IntentResult {
        let target = !done

        // Paint the new state immediately; the provider reconciles against the
        // server on the next fetch and drops the override once they agree.
        WidgetStore.setOverride(habitID: habitID, date: date, done: target)

        // Writes go through the habit-toggle Edge Function, never straight to
        // PostgREST: the anon key has no write policy on protocol_habit_completions
        // (revoked deliberately), and the function enforces ownership server-side
        // with the service role. It is also idempotent, so a double-tap can't
        // create duplicate completion rows.
        let ok = await SupabaseClient().callFunction(
            "habit-toggle",
            body: ["habitId": habitID, "date": date, "done": target]
        )

        // A failed write must not leave a lie on screen: drop the override so
        // the next fetch shows the truth rather than the intent.
        if !ok { WidgetStore.clearOverride(habitID: habitID, date: date) }

        WidgetCenter.shared.reloadTimelines(ofKind: WidgetKind.habitsList)
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetKind.habitsRing)
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetKind.habitHeatmap)
        return .result()
    }
}

// MARK: - Paging (widgets can't scroll, so we page)

@available(iOS 17.0, *)
struct HabitPageIntent: AppIntent {
    static var title: LocalizedStringResource = "Change Habit Page"
    static var openAppWhenRun: Bool = false
    static var isDiscoverable: Bool = false

    @Parameter(title: "Delta")     var delta: Int
    @Parameter(title: "Page Count") var pageCount: Int

    init() {}

    init(delta: Int, pageCount: Int) {
        self.delta = delta
        self.pageCount = pageCount
    }

    func perform() async throws -> some IntentResult {
        guard pageCount > 0 else { return .result() }
        let current = WidgetStore.page(WidgetKind.habitsList)
        // Wrap around, so paging never dead-ends on the last card.
        let next = ((current + delta) % pageCount + pageCount) % pageCount
        WidgetStore.setPage(WidgetKind.habitsList, next)
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetKind.habitsList)
        return .result()
    }
}
