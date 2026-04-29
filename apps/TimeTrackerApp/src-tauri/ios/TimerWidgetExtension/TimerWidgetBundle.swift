import SwiftUI
import WidgetKit

@main
struct TimerWidgetBundle: WidgetBundle {
    @WidgetBundleBuilder
    var body: some Widget {
        // Regular home-screen / lock-screen widgets
        ActiveTimerWidget()
        QuickStartWidget()
        QuickSessionWidget()

        // Live Activity (Dynamic Island) — iOS 16.2+
        if #available(iOS 16.2, *) {
            TimerWidget()
        }
    }
}
