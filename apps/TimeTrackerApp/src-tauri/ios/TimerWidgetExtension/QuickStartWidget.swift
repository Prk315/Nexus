import SwiftUI
import WidgetKit

// MARK: - Row

struct QuickStartRow: View {
    let task: RecentTask
    let index: Int

    var body: some View {
        Link(destination: URL(string: "timetracker://start?task=\(task.taskName.urlEncoded)&project=\(task.projectName.urlEncoded)")!) {
            HStack(spacing: 10) {
                Text("\(index + 1)")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .frame(width: 14)

                VStack(alignment: .leading, spacing: 1) {
                    Text(task.taskName)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    if !task.projectName.isEmpty {
                        Text(task.projectName)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer()

                Image(systemName: "play.circle.fill")
                    .foregroundStyle(.orange)
                    .font(.title3)
            }
            .padding(.vertical, 4)
        }
    }
}

// MARK: - View

struct QuickStartView: View {
    let entry: TimerEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Image(systemName: "bolt.fill")
                    .foregroundStyle(.orange)
                    .font(.caption)
                Text("Quick Start")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
            }
            .padding(.bottom, 8)

            if entry.state.recentTasks.isEmpty {
                Spacer()
                Text("No recent tasks")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer()
            } else {
                let tasks = Array(entry.state.recentTasks.prefix(4))
                ForEach(Array(tasks.enumerated()), id: \.element.id) { index, task in
                    QuickStartRow(task: task, index: index)
                    if index < tasks.count - 1 {
                        Divider()
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Widget definition

struct QuickStartWidget: Widget {
    let kind = "QuickStartWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TimerProvider()) { entry in
            Group {
                if #available(iOS 17.0, *) {
                    QuickStartView(entry: entry)
                        .containerBackground(Color(.secondarySystemBackground), for: .widget)
                } else {
                    QuickStartView(entry: entry)
                        .background(Color(.secondarySystemBackground))
                }
            }
        }
        .configurationDisplayName("Quick Start")
        .description("Jump back into a recent task.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

// MARK: - String URL encoding helper

private extension String {
    var urlEncoded: String {
        addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? self
    }
}
