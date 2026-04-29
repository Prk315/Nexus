#if os(iOS)
import Foundation
import WidgetKit

private let kAppGroup  = "group.com.bastianthomsen.timetracker"
private let kStateKey  = "timerWidgetState"

/// Called from Rust after every timer state change.
/// `jsonPtr` points to a null-terminated UTF-8 JSON string matching
/// `SharedTimerState` (see TimerWidgetExtension/SharedTimerState.swift).
@_silgen_name("sync_widget_state_c")
public func syncWidgetStateC(_ jsonPtr: UnsafePointer<CChar>) {
    let json = String(cString: jsonPtr)
    DispatchQueue.main.async {
        // Write to App Group so all widget extensions can read it.
        UserDefaults(suiteName: kAppGroup)?.set(json, forKey: kStateKey)
        // Tell WidgetKit to re-run all timeline providers.
        WidgetCenter.shared.reloadAllTimelines()
    }
}
#endif
