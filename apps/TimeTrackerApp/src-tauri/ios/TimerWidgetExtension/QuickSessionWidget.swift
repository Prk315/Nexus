import SwiftUI
import WidgetKit

// MARK: - View

struct QuickSessionView: View {
    let entry: TimerEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "plus.circle.fill")
                    .foregroundStyle(.orange)
                    .font(.callout)
                Text("Log Past Session")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
            }

            Spacer()

            // Deep-link into the app's Quick Session sheet
            Link(destination: URL(string: "timetracker://log-session")!) {
                Label("Add Session", systemImage: "clock.badge.plus")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(.orange)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }

            // Show last used task as a hint
            if let last = entry.state.recentTasks.first {
                Text("Last: \(last.taskName)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Widget definition

struct QuickSessionWidget: Widget {
    let kind = "QuickSessionWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TimerProvider()) { entry in
            Group {
                if #available(iOS 17.0, *) {
                    QuickSessionView(entry: entry)
                        .containerBackground(Color(.secondarySystemBackground), for: .widget)
                } else {
                    QuickSessionView(entry: entry)
                        .background(Color(.secondarySystemBackground))
                }
            }
        }
        .configurationDisplayName("Log Session")
        .description("Quickly add a past tracking session you forgot to start.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
