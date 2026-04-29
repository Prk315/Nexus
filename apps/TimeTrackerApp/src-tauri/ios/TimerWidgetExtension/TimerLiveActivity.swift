import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Lock Screen / Notification Center view

@available(iOS 16.2, *)
struct TimerLockScreenView: View {
    let context: ActivityViewContext<TimerAttributes>

    private var timerRange: ClosedRange<Date> {
        context.state.startDate...(context.state.startDate + 86400)
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "timer")
                .font(.title2)
                .foregroundStyle(.orange)

            VStack(alignment: .leading, spacing: 2) {
                Text(context.attributes.taskName)
                    .font(.headline)
                    .lineLimit(1)
                if !context.attributes.projectName.isEmpty {
                    Text(context.attributes.projectName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            Text(timerInterval: timerRange, countsDown: false)
                .font(.system(.title2, design: .monospaced, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.orange)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

// MARK: - Dynamic Island

@available(iOS 16.2, *)
struct TimerWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TimerAttributes.self) { context in
            // Lock Screen / Notification Center banner
            TimerLockScreenView(context: context)
                .activityBackgroundTint(Color.black.opacity(0.85))

        } dynamicIsland: { context in
            let timerRange = context.state.startDate...(context.state.startDate + 86400)

            return DynamicIsland {
                // Expanded (long-press) — split into leading + bottom regions
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        Image(systemName: "timer")
                            .foregroundStyle(.orange)
                        Text(context.attributes.taskName)
                            .font(.headline)
                            .lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: timerRange, countsDown: false)
                        .font(.system(.title3, design: .monospaced, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(.orange)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if !context.attributes.projectName.isEmpty {
                        HStack {
                            Image(systemName: "folder")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(context.attributes.projectName)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                            Spacer()
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: "timer")
                    .foregroundStyle(.orange)
                    .font(.callout)
            } compactTrailing: {
                Text(timerInterval: timerRange, countsDown: false)
                    .font(.system(.callout, design: .monospaced, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(.orange)
                    .frame(minWidth: 52, alignment: .trailing)
            } minimal: {
                Image(systemName: "timer")
                    .foregroundStyle(.orange)
                    .font(.callout)
            }
            .widgetURL(URL(string: "timetracker://open"))
        }
    }
}
