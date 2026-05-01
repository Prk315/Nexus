import SwiftUI
import WidgetKit

private let kAccent = Color.indigo

/// Shown by every widget when the PathFinder app has not yet been opened and
/// the App Groups UserDefaults key `pf_user_id` is absent. Tapping the widget
/// opens PathFinder (default WidgetKit tap behaviour).
struct NotConnectedView: View {
    @Environment(\.widgetFamily) var family

    var body: some View {
        ZStack {
            wBg
            switch family {
            case .systemSmall:
                smallContent
            case .systemLarge:
                largeContent
            default:
                mediumContent
            }
        }
    }

    // ── Small ─────────────────────────────────────────────────────────────────

    private var smallContent: some View {
        VStack(spacing: 0) {
            Spacer()

            compassIcon(size: 40)
                .padding(.bottom, 10)

            Text("PathFinder")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(wPrimary)
                .padding(.bottom, 4)

            Text("Open to connect")
                .font(.system(size: 10))
                .foregroundColor(wTertiary)

            Spacer()
        }
        .padding(14)
    }

    // ── Medium ────────────────────────────────────────────────────────────────

    private var mediumContent: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                header
                Spacer(minLength: 0)
                compassIcon(size: 30)
                Spacer(minLength: 0)
                Text("Open the app\nto get started")
                    .font(.system(size: 11))
                    .foregroundColor(wTertiary)
                    .lineSpacing(2)
            }
            .padding(14)
            .frame(maxWidth: .infinity)

            Rectangle()
                .fill(wSep)
                .frame(width: 0.5)
                .padding(.vertical, 12)

            VStack(alignment: .leading, spacing: 10) {
                stepRow(n: "1", text: "Open PathFinder")
                stepRow(n: "2", text: "Add your goals")
                stepRow(n: "3", text: "Widgets sync here")
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity)
        }
    }

    // ── Large ─────────────────────────────────────────────────────────────────

    private var largeContent: some View {
        VStack(spacing: 0) {
            header
                .padding(.bottom, 24)

            Spacer()

            compassIcon(size: 60)
                .padding(.bottom, 16)

            Text("Not Connected")
                .font(.system(size: 18, weight: .bold))
                .foregroundColor(wPrimary)
                .padding(.bottom, 6)

            Text("Open PathFinder to sync your\ngoals, habits, and systems.")
                .font(.system(size: 12))
                .foregroundColor(wSecondary)
                .multilineTextAlignment(.center)

            Spacer()

            VStack(alignment: .leading, spacing: 14) {
                stepRow(n: "1", text: "Open PathFinder on your iPhone")
                stepRow(n: "2", text: "Set up your goals and habits")
                stepRow(n: "3", text: "Widgets sync automatically")
            }
            .padding(.bottom, 8)

            Spacer()
        }
        .padding(16)
    }

    // ── Reusable sub-views ────────────────────────────────────────────────────

    private var header: some View {
        HStack(spacing: 5) {
            Circle().fill(kAccent).frame(width: 6, height: 6)
            Text("PATHFINDER")
                .font(.system(size: 9, weight: .semibold))
                .foregroundColor(kAccent)
                .tracking(1.5)
            Spacer()
        }
    }

    private func compassIcon(size: CGFloat) -> some View {
        ZStack {
            Circle()
                .fill(kAccent.opacity(0.08))
                .frame(width: size * 1.2, height: size * 1.2)
            Circle()
                .strokeBorder(kAccent.opacity(0.20), lineWidth: 1.2)
                .frame(width: size * 1.2, height: size * 1.2)
            Image(systemName: "location.north.fill")
                .font(.system(size: size * 0.5, weight: .medium))
                .foregroundColor(kAccent.opacity(0.80))
        }
    }

    private func stepRow(n: String, text: String) -> some View {
        HStack(spacing: 8) {
            Text(n)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(kAccent)
                .frame(width: 18, height: 18)
                .background(Circle().fill(kAccent.opacity(0.10)))
            Text(text)
                .font(.system(size: 11))
                .foregroundColor(wSecondary)
            Spacer(minLength: 0)
        }
    }
}
