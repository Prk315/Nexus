#if os(iOS)
import ActivityKit
import Foundation

private let kAppGroup = "group.com.bastianthomsen.timetracker"

// MARK: - C entry points (called from Rust via extern "C")

/// Start a Live Activity for an active timer session.
/// taskNamePtr / projectNamePtr: null-terminated UTF-8 C strings.
/// startTimestamp: Unix timestamp (seconds since 1970) when the timer started.
@_silgen_name("start_live_activity_c")
public func startLiveActivityC(
    _ taskNamePtr: UnsafePointer<CChar>,
    _ projectNamePtr: UnsafePointer<CChar>,
    _ startTimestamp: Double
) {
    let taskName = String(cString: taskNamePtr)
    let projectName = String(cString: projectNamePtr)
    let startDate = Date(timeIntervalSince1970: startTimestamp)

    DispatchQueue.main.async {
        if #available(iOS 16.2, *) {
            launchTimerActivity(taskName: taskName, projectName: projectName, startDate: startDate)
        }
    }
}

/// End / dismiss any running timer Live Activity.
@_silgen_name("end_live_activity_c")
public func endLiveActivityC() {
    if #available(iOS 16.2, *) {
        Task.detached(priority: .userInitiated) {
            await endAllTimerActivities()
        }
    }
}

// MARK: - Implementation

@available(iOS 16.2, *)
private func launchTimerActivity(taskName: String, projectName: String, startDate: Date) {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else {
        writeActivityLog("Live Activities disabled by user or not supported")
        return
    }

    Task.detached(priority: .userInitiated) {
        // End any stale activities from a previous session before starting fresh.
        await endAllTimerActivities()

        let attributes = TimerAttributes(taskName: taskName, projectName: projectName)
        let contentState = TimerAttributes.ContentState(startDate: startDate)

        do {
            let activity = try Activity<TimerAttributes>.request(
                attributes: attributes,
                contentState: contentState,
                pushType: nil   // local-only — no APNs push token needed
            )
            writeActivityLog("Started Live Activity id=\(activity.id) task=\(taskName)")
            UserDefaults(suiteName: kAppGroup)?.set(activity.id, forKey: "timerActivityID")
        } catch {
            writeActivityLog("Failed to start Live Activity: \(error)")
        }
    }
}

@available(iOS 16.2, *)
private func endAllTimerActivities() async {
    for activity in Activity<TimerAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
    }
    UserDefaults(suiteName: kAppGroup)?.removeObject(forKey: "timerActivityID")
    writeActivityLog("Ended all timer Live Activities")
}

// MARK: - Debug logging

private func writeActivityLog(_ message: String) {
    guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
    let url = docs.appendingPathComponent("live_activity_debug.txt")
    let line = "\(Date()): \(message)\n"
    guard let data = line.data(using: .utf8) else { return }
    if FileManager.default.fileExists(atPath: url.path),
       let handle = try? FileHandle(forWritingTo: url) {
        handle.seekToEndOfFile()
        handle.write(data)
        try? handle.close()
    } else {
        try? data.write(to: url, options: .atomic)
    }
}
#endif
