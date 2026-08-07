import WidgetKit
import SwiftUI

@main
struct NexusLocalWidgetsBundle: WidgetBundle {
    @WidgetBundleBuilder
    var body: some Widget {
        TodayWidget()
        HabitsWidget()
        HabitsListWidget()
        HabitHeatmapWidget()
        ExerciseHeatmapWidget()
        SleepWidget()
        TasksWidget()
        TimeTrackerWidget()
        LearnWidget()
        // Also the autonomy mechanism for Safari blocking: its timeline refresh
        // is what recompiles the block rules while the app is closed.
        FocusBlockerWidget()

        // Live Activity (lock screen + Dynamic Island) — iOS 16.2+
        if #available(iOS 16.2, *) {
            TimerWidget()
        }
    }
}
