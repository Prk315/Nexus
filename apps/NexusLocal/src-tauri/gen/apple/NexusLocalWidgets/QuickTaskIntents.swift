import AppIntents
import WidgetKit

// MARK: - Kinds

extension WidgetKind {
    static let quickTasks = "NexusLocalQuickTasksWidget"
    static let mealLog    = "NexusLocalMealLogWidget"
}

// MARK: - Complete / reopen a quick task from the home screen

/// Same shape as `ToggleHabitIntent`: one tap carries both directions, the
/// write goes through a scoped edge function (`task-quick`, WIDGET_TASK_KEY),
/// and an optimistic override repaints the row before the server agrees.
///
/// The override map is shared with habits (`WidgetStore`); the `pf-task-`
/// prefix namespaces integer task ids away from habit UUIDs.
@available(iOS 17.0, *)
struct ToggleQuickTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Toggle Quick Task"
    static var description = IntentDescription("Complete or reopen a quick task.")
    /// Keep the tap inside the widget — never bounce the user into the app.
    static var openAppWhenRun: Bool = false
    static var isDiscoverable: Bool = false

    @Parameter(title: "Task ID") var taskID: Int
    @Parameter(title: "Done")    var done: Bool

    init() {}

    init(taskID: Int, done: Bool) {
        self.taskID = taskID
        self.done = done
    }

    func perform() async throws -> some IntentResult {
        let target = !done
        let key = "pf-task-\(taskID)"
        let today = todayString()

        WidgetStore.setOverride(habitID: key, date: today, done: target)

        let ok = await SupabaseClient().callFunction(
            "task-quick",
            body: ["action": "toggle", "taskId": taskID, "done": target],
            key: Secrets.widgetTaskKey
        )

        // A failed write must not leave a lie on screen.
        if !ok { WidgetStore.clearOverride(habitID: key, date: today) }

        WidgetCenter.shared.reloadTimelines(ofKind: WidgetKind.quickTasks)
        return .result()
    }
}

// MARK: - Paging (same mechanism as the habits checklist)

@available(iOS 17.0, *)
struct QuickTaskPageIntent: AppIntent {
    static var title: LocalizedStringResource = "Change Quick Task Page"
    static var openAppWhenRun: Bool = false
    static var isDiscoverable: Bool = false

    @Parameter(title: "Delta")      var delta: Int
    @Parameter(title: "Page Count") var pageCount: Int

    init() {}

    init(delta: Int, pageCount: Int) {
        self.delta = delta
        self.pageCount = pageCount
    }

    func perform() async throws -> some IntentResult {
        guard pageCount > 0 else { return .result() }
        let current = WidgetStore.page(WidgetKind.quickTasks)
        // Wrap around, so paging never dead-ends on the last card.
        let next = ((current + delta) % pageCount + pageCount) % pageCount
        WidgetStore.setPage(WidgetKind.quickTasks, next)
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetKind.quickTasks)
        return .result()
    }
}

// MARK: - Add Task (Siri / Shortcuts capture)

/// Widgets can't take text input, so in-widget "create" is a link into the
/// app. This intent is the *other* capture path: discoverable in Shortcuts and
/// Siri ("Add Quick Task"), it takes dictated/typed text and posts it through
/// the same scoped function. `openAppWhenRun` stays false — capture should not
/// yank the phone into the app.
@available(iOS 17.0, *)
struct AddQuickTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Add Quick Task"
    static var description = IntentDescription("Add a reminder, chore or shopping item to Nexus.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Title") var text: String

    @Parameter(title: "List", default: .reminder)
    var category: QuickTaskCategory

    init() {}

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .result(dialog: "Nothing to add.")
        }
        let ok = await SupabaseClient().callFunction(
            "task-quick",
            body: ["action": "create", "title": trimmed, "category": category.rawValue],
            key: Secrets.widgetTaskKey
        )
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetKind.quickTasks)
        // Literal directly in argument position: a ternary of two string
        // literals is a String, which does NOT convert to IntentDialog.
        if ok {
            return .result(dialog: "Added to \(category.rawValue)s.")
        }
        return .result(dialog: "Couldn't reach Nexus.")
    }
}

enum QuickTaskCategory: String, AppEnum {
    case reminder, chore, shopping

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "List")
    static var caseDisplayRepresentations: [QuickTaskCategory: DisplayRepresentation] = [
        .reminder: "Reminders",
        .chore: "Chores",
        .shopping: "Shopping",
    ]
}
