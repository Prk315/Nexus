import ActivityKit
import SwiftUI
import WidgetKit

// Elapsed time renders from an open-ended range so it counts up on its own.
private func timerRange(_ start: Date) -> ClosedRange<Date> {
    start...(start + 86_400)
}

// MARK: - Lock Screen / Notification Center

@available(iOS 16.2, *)
struct TimerLockScreenView: View {
    let context: ActivityViewContext<TimerAttributes>
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "timer").font(.title2).foregroundStyle(wAccent)
            VStack(alignment: .leading, spacing: 2) {
                Text(context.attributes.taskName).font(.headline).lineLimit(1)
                if !context.attributes.projectName.isEmpty {
                    Text(context.attributes.projectName)
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer()
            Text(timerInterval: timerRange(context.state.startDate), countsDown: false)
                .font(.system(.title2, design: .monospaced, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(wAccent)
                .frame(maxWidth: 90, alignment: .trailing)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }
}

// MARK: - Dynamic Island + Live Activity config

@available(iOS 16.2, *)
struct TimerWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TimerAttributes.self) { context in
            TimerLockScreenView(context: context)
                .activityBackgroundTint(Color.black.opacity(0.85))
        } dynamicIsland: { context in
            let range = timerRange(context.state.startDate)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        Image(systemName: "timer").foregroundStyle(wAccent)
                        Text(context.attributes.taskName).font(.headline).lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: range, countsDown: false)
                        .font(.system(.title3, design: .monospaced, weight: .bold))
                        .monospacedDigit().foregroundStyle(wAccent)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if !context.attributes.projectName.isEmpty {
                        HStack {
                            Image(systemName: "folder").font(.caption).foregroundStyle(.secondary)
                            Text(context.attributes.projectName)
                                .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                            Spacer()
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: "timer").foregroundStyle(wAccent).font(.callout)
            } compactTrailing: {
                Text(timerInterval: range, countsDown: false)
                    .font(.system(.callout, design: .monospaced, weight: .medium))
                    .monospacedDigit().foregroundStyle(wAccent)
                    .frame(minWidth: 52, alignment: .trailing)
            } minimal: {
                Image(systemName: "timer").foregroundStyle(wAccent).font(.callout)
            }
            .widgetURL(URL(string: "nexuslocal://open"))
        }
    }
}
