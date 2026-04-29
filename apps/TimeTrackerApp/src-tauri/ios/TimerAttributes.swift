#if os(iOS)
import ActivityKit
import Foundation

/// Shared between the main app and the TimerWidget extension.
/// Both targets compile this same file so ActivityKit can match the type
/// across process boundaries.
struct TimerAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// Unix timestamp of when the timer was started (or resumed after pause).
        var startDate: Date
    }

    var taskName: String
    var projectName: String
}
#endif
