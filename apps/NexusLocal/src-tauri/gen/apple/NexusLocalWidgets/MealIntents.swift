import AppIntents
import WidgetKit

// MARK: - Mark a planned meal eaten / not eaten

/// One tap, both directions, same optimistic-override pattern as habits and
/// quick tasks. Writes go through the `meal-log` edge function with its own
/// scoped secret (WIDGET_MEAL_KEY) — the anon key can read the plan but never
/// write it.
@available(iOS 17.0, *)
struct ToggleMealLoggedIntent: AppIntent {
    static var title: LocalizedStringResource = "Toggle Meal Logged"
    static var description = IntentDescription("Mark a planned meal as eaten or not eaten.")
    /// Keep the tap inside the widget — never bounce the user into the app.
    static var openAppWhenRun: Bool = false
    static var isDiscoverable: Bool = false

    @Parameter(title: "Entry ID") var entryID: String
    @Parameter(title: "Logged")   var logged: Bool

    init() {}

    init(entryID: String, logged: Bool) {
        self.entryID = entryID
        self.logged = logged
    }

    func perform() async throws -> some IntentResult {
        let target = !logged
        let key = "meal-entry-\(entryID)"
        let today = todayString()

        WidgetStore.setOverride(habitID: key, date: today, done: target)

        let ok = await SupabaseClient().callFunction(
            "meal-log",
            body: ["action": "toggle", "entryId": entryID, "logged": target],
            key: Secrets.widgetMealKey
        )

        // A failed write must not leave a lie on screen.
        if !ok { WidgetStore.clearOverride(habitID: key, date: today) }

        WidgetCenter.shared.reloadTimelines(ofKind: WidgetKind.mealLog)
        return .result()
    }
}

// MARK: - Quick-log a saved meal into today's plan

/// Shown when a slot has nothing planned: one tap inserts an entry for today
/// already marked logged. There is no optimistic row for an insert (the widget
/// doesn't know the new id), so this reloads the timeline and lets the fetch
/// paint it — the ~1s delay is acceptable for the rarer path.
@available(iOS 17.0, *)
struct QuickLogMealIntent: AppIntent {
    static var title: LocalizedStringResource = "Quick Log Meal"
    static var description = IntentDescription("Log a saved meal for today.")
    static var openAppWhenRun: Bool = false
    static var isDiscoverable: Bool = false

    @Parameter(title: "Meal ID") var mealID: String
    @Parameter(title: "Slot")    var slot: String
    @Parameter(title: "Date")    var date: String

    init() {}

    init(mealID: String, slot: String, date: String) {
        self.mealID = mealID
        self.slot = slot
        self.date = date
    }

    func perform() async throws -> some IntentResult {
        _ = await SupabaseClient().callFunction(
            "meal-log",
            body: ["action": "log", "date": date, "slot": slot, "mealId": mealID],
            key: Secrets.widgetMealKey
        )
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetKind.mealLog)
        return .result()
    }
}
