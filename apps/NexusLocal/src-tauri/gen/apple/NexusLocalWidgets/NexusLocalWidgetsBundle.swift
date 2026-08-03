import WidgetKit
import SwiftUI

@main
struct NexusLocalWidgetsBundle: WidgetBundle {
    @WidgetBundleBuilder
    var body: some Widget {
        TodayWidget()
        HabitsWidget()
        SleepWidget()
        TasksWidget()
        TimeTrackerWidget()

        // Live Activity (lock screen + Dynamic Island) — iOS 16.2+
        if #available(iOS 16.2, *) {
            TimerWidget()
        }
    }
}
