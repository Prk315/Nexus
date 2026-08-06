import AppIntents
import WidgetKit

// MARK: - Kind

extension WidgetKind {
    /// Must match `TimeTrackerWidget.kind` — the intents below reload this
    /// timeline, and a typo would leave the widget showing the pre-tap state
    /// until its next scheduled refresh, up to 20 minutes later.
    static let timeTracker = "NexusLocalTimeTrackerWidget"
}

/// Shown when the widget has never seen a completed entry to borrow a name from.
let kDefaultSessionTaskName = "Focus"

// MARK: - Start / stop a timer straight from the home screen

/// The widget extension is the only process iOS wakes while the app is closed on
/// a free-tier sideloaded install (no `BGTaskScheduler`, no silent push), and
/// WidgetKit allows exactly one interaction inside a widget: a tap on a
/// `Button`/`Toggle` backed by an `AppIntent`. That is the whole mechanism by
/// which a session can be started or stopped without launching the app.
///
/// Writes go through the `session-toggle` Edge Function, never straight to
/// PostgREST — the same rule as `ToggleHabitIntent`. `SupabaseClient` exposes no
/// generic write path on purpose.
///
/// Widgets have no text field, so the task name cannot be typed here. The
/// provider passes one in when it builds the timeline (the most recent completed
/// entry's name, falling back to `kDefaultSessionTaskName`); renaming happens in
/// the app.
@available(iOS 17.0, *)
struct StartSessionIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Timer"
    static var description = IntentDescription("Start a time-tracking session.")
    /// Keep the tap inside the widget — never bounce the user into the app.
    static var openAppWhenRun: Bool = false
    /// Internal plumbing, not something to surface in Shortcuts.
    static var isDiscoverable: Bool = false

    @Parameter(title: "Task Name") var taskName: String
    @Parameter(title: "Project")   var project: String

    init() {}

    init(taskName: String, project: String = "") {
        self.taskName = taskName
        self.project = project
    }

    func perform() async throws -> some IntentResult {
        let name = taskName.trimmingCharacters(in: .whitespacesAndNewlines)
        // The function rejects a blank name (active_sessions.task_name is NOT
        // NULL); substitute rather than send a tap the server will 400.
        let resolved = name.isEmpty ? kDefaultSessionTaskName : name

        // Paint the running state immediately; the provider reconciles against
        // the server on the next fetch and drops the override once they agree.
        WidgetStore.setSessionOverride(
            running: true, taskName: resolved, startedAt: Date().timeIntervalSince1970
        )

        var body: [String: Any] = ["action": "start", "taskName": resolved]
        let trimmedProject = project.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedProject.isEmpty { body["project"] = trimmedProject }

        let ok = await SupabaseClient().callFunction(
            "session-toggle", body: body, key: Secrets.widgetSessionKey
        )

        // A failed write must not leave a lie on screen: drop the override so
        // the next fetch shows the truth rather than the intent.
        if !ok { WidgetStore.clearSessionOverride() }

        WidgetCenter.shared.reloadTimelines(ofKind: WidgetKind.timeTracker)
        return .result()
    }
}

/// Stop takes no parameters: `active_sessions` has `UNIQUE(user_id)`, so the
/// server row is the only description of what is being stopped. Sending a task
/// name from a stale timeline could only ever disagree with it.
@available(iOS 17.0, *)
struct StopSessionIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop Timer"
    static var description = IntentDescription("Stop the running time-tracking session.")
    static var openAppWhenRun: Bool = false
    static var isDiscoverable: Bool = false

    init() {}

    func perform() async throws -> some IntentResult {
        WidgetStore.setSessionOverride(running: false, taskName: nil, startedAt: nil)

        let ok = await SupabaseClient().callFunction(
            "session-toggle", body: ["action": "stop"], key: Secrets.widgetSessionKey
        )

        if !ok { WidgetStore.clearSessionOverride() }

        WidgetCenter.shared.reloadTimelines(ofKind: WidgetKind.timeTracker)
        return .result()
    }
}
