import WidgetKit

// MARK: - Timeline entry

struct TimerEntry: TimelineEntry {
    let date: Date
    let state: SharedTimerState
}

// MARK: - Provider (shared by all widgets)

struct TimerProvider: TimelineProvider {
    func placeholder(in context: Context) -> TimerEntry {
        TimerEntry(date: .now, state: .empty)
    }

    func getSnapshot(in context: Context, completion: @escaping (TimerEntry) -> Void) {
        completion(TimerEntry(date: .now, state: loadSharedTimerState()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TimerEntry>) -> Void) {
        let state = loadSharedTimerState()
        let entry = TimerEntry(date: .now, state: state)

        // If a timer is running, re-check in 15 min to keep today's total fresh.
        // The actual elapsed display uses Text(timerInterval:) which auto-ticks.
        // If idle, check every 30 min.
        let next = Calendar.current.date(
            byAdding: .minute,
            value: state.isRunning ? 15 : 30,
            to: .now
        ) ?? .now.addingTimeInterval(900)

        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}
