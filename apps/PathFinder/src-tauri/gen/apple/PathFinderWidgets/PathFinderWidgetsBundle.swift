import WidgetKit
import SwiftUI

@main
struct PathFinderWidgetsBundle: WidgetBundle {
    var body: some Widget {
        SoloLevelingWidget()
        TodayFocusWidget()
        HabitsWidget()
        SystemsWidget()
        GoalsWidget()
        TasksWidget()
        TimeStatsWidget()
        DailyTimelineWidget()
        DailyScheduleWidget()
    }
}
