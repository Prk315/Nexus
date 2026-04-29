import SwiftUI
import WidgetKit

// MARK: - Small view

struct ActiveTimerSmallView: View {
    let entry: TimerEntry

    private var startDate: Date {
        Date(timeIntervalSince1970: entry.state.startTimestamp)
    }

    private var todayFormatted: String {
        let h = entry.state.todayTotalSeconds / 3600
        let m = (entry.state.todayTotalSeconds % 3600) / 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: entry.state.isRunning ? "timer" : "clock")
                    .foregroundStyle(entry.state.isRunning ? .orange : .secondary)
                    .font(.callout)
                Spacer()
                if entry.state.isRunning {
                    Circle()
                        .fill(.orange)
                        .frame(width: 7, height: 7)
                }
            }

            Spacer()

            if entry.state.isRunning {
                Text(
                    timerInterval: startDate...(startDate + 86400),
                    countsDown: false
                )
                .font(.system(.title2, design: .monospaced, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(.orange)
                .minimumScaleFactor(0.7)
                .lineLimit(1)

                Text(entry.state.taskName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            } else {
                Text("No session")
                    .font(.headline)
                    .foregroundStyle(.secondary)

                Text("Today: \(todayFormatted)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

// MARK: - Medium view

struct ActiveTimerMediumView: View {
    let entry: TimerEntry

    private var startDate: Date {
        Date(timeIntervalSince1970: entry.state.startTimestamp)
    }

    private var todayFormatted: String {
        let h = entry.state.todayTotalSeconds / 3600
        let m = (entry.state.todayTotalSeconds % 3600) / 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }

    var body: some View {
        HStack(spacing: 16) {
            // Left: timer display
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Image(systemName: "timer")
                        .foregroundStyle(entry.state.isRunning ? .orange : .secondary)
                    Text(entry.state.isRunning ? "Tracking" : "Idle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if entry.state.isRunning {
                        Circle()
                            .fill(.orange)
                            .frame(width: 6, height: 6)
                    }
                }

                if entry.state.isRunning {
                    Text(
                        timerInterval: startDate...(startDate + 86400),
                        countsDown: false
                    )
                    .font(.system(.largeTitle, design: .monospaced, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(.orange)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                } else {
                    Text("--:--")
                        .font(.system(.largeTitle, design: .monospaced, weight: .bold))
                        .foregroundStyle(.secondary)
                }
            }

            Divider()

            // Right: task details + today total
            VStack(alignment: .leading, spacing: 6) {
                if entry.state.isRunning {
                    Label {
                        Text(entry.state.taskName)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(2)
                    } icon: {
                        Image(systemName: "doc.text")
                            .foregroundStyle(.secondary)
                    }

                    if !entry.state.projectName.isEmpty {
                        Label {
                            Text(entry.state.projectName)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        } icon: {
                            Image(systemName: "folder")
                                .foregroundStyle(.secondary)
                        }
                    }
                } else {
                    Text("No active session")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Label {
                    Text("Today: \(todayFormatted)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } icon: {
                    Image(systemName: "sum")
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Widget definition

struct ActiveTimerWidget: Widget {
    let kind = "ActiveTimerWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TimerProvider()) { entry in
            Group {
                if #available(iOS 17.0, *) {
                    ActiveTimerEntryView(entry: entry)
                        .containerBackground(Color(.secondarySystemBackground), for: .widget)
                } else {
                    ActiveTimerEntryView(entry: entry)
                        .background(Color(.secondarySystemBackground))
                }
            }
        }
        .configurationDisplayName("Active Timer")
        .description("See your current tracking session at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// Routes to the right layout based on widget family.
struct ActiveTimerEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: TimerEntry

    var body: some View {
        switch family {
        case .systemSmall: ActiveTimerSmallView(entry: entry)
        default:           ActiveTimerMediumView(entry: entry)
        }
    }
}
