#if os(iOS)
import ActivityKit
import Foundation

/// Shared between the main app and the NexusLocalWidgets extension. Both targets
/// compile this same file so ActivityKit can match the type across the process
/// boundary. Elapsed time renders from `startDate` via Text(timerInterval:) —
/// no tick updates are pushed.
struct TimerAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var startDate: Date
    }

    var taskName: String
    var projectName: String
}
#endif
