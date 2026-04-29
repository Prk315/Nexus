import WidgetKit
import SwiftUI

@main
struct PathFinderWidgetsBundle: WidgetBundle {
    var body: some Widget {
        SoloLevelingWidget()   // System Status (Solo Leveling aesthetic)
        TodayFocusWidget()
        HabitsWidget()
        SystemsWidget()
        GoalsWidget()
        TasksWidget()
    }
}
