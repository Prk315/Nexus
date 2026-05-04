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

// MARK: - Lock screen: Circular

struct ActiveTimerCircularView: View {
    let entry: TimerEntry

    private var startDate: Date {
        Date(timeIntervalSince1970: entry.state.startTimestamp)
    }

    var body: some View {
        if entry.state.isRunning {
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 2) {
                    Image(systemName: "timer")
                        .font(.system(size: 12))
                    Text(
                        timerInterval: startDate...(startDate + 86400),
                        countsDown: false
                    )
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .monospacedDigit()
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                }
            }
        } else {
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 2) {
                    Image(systemName: "clock")
                        .font(.system(size: 14))
                    Text(todayFormatted)
                        .font(.system(size: 10, weight: .medium))
                }
            }
        }
    }

    private var todayFormatted: String {
        let h = entry.state.todayTotalSeconds / 3600
        let m = (entry.state.todayTotalSeconds % 3600) / 60
        return h > 0 ? "\(h)h\(m)m" : "\(m)m"
    }
}

// MARK: - Lock screen: Rectangular

struct ActiveTimerRectangularView: View {
    let entry: TimerEntry

    private var startDate: Date {
        Date(timeIntervalSince1970: entry.state.startTimestamp)
    }

    var body: some View {
        if entry.state.isRunning {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Image(systemName: "timer")
                        .font(.system(size: 11))
                    Text(
                        timerInterval: startDate...(startDate + 86400),
                        countsDown: false
                    )
                    .font(.system(size: 13, weight: .bold, design: .monospaced))
                    .monospacedDigit()
                }
                Text(entry.state.taskName)
                    .font(.system(size: 11))
                    .lineLimit(1)
                if !entry.state.projectName.isEmpty {
                    Text(entry.state.projectName)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Image(systemName: "clock")
                        .font(.system(size: 11))
                    Text("No active session")
                        .font(.system(size: 12, weight: .medium))
                }
                Text("Today: \(todayFormatted)")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var todayFormatted: String {
        let h = entry.state.todayTotalSeconds / 3600
        let m = (entry.state.todayTotalSeconds % 3600) / 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }
}

// MARK: - Lock screen: Inline

struct ActiveTimerInlineView: View {
    let entry: TimerEntry

    var body: some View {
        if entry.state.isRunning {
            Label(entry.state.taskName.isEmpty ? "Tracking..." : entry.state.taskName, systemImage: "timer")
        } else {
            let h = entry.state.todayTotalSeconds / 3600
            let m = (entry.state.todayTotalSeconds % 3600) / 60
            let t = h > 0 ? "\(h)h \(m)m" : "\(m)m today"
            Label(t, systemImage: "clock")
        }
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
        .supportedFamilies([
            .systemSmall, .systemMedium,
            .accessoryCircular, .accessoryRectangular, .accessoryInline
        ])
    }
}

// Routes to the right layout based on widget family.
struct ActiveTimerEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: TimerEntry

    var body: some View {
        switch family {
        case .systemSmall:          ActiveTimerSmallView(entry: entry)
        case .systemMedium:         ActiveTimerMediumView(entry: entry)
        case .accessoryCircular:    ActiveTimerCircularView(entry: entry)
        case .accessoryRectangular: ActiveTimerRectangularView(entry: entry)
        case .accessoryInline:      ActiveTimerInlineView(entry: entry)
        default:                    ActiveTimerMediumView(entry: entry)
        }
    }
}
