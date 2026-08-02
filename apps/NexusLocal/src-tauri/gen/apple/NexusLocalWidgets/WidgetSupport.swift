import SwiftUI
import Foundation

// MARK: - Palette (Nexus Local — dark, matches the host app)

let wBg        = Color(red: 0.04, green: 0.04, blue: 0.06)
let wPrimary   = Color(red: 0.90, green: 0.91, blue: 0.94)
let wSecondary = Color(red: 0.58, green: 0.60, blue: 0.66)
let wTertiary  = Color(red: 0.38, green: 0.40, blue: 0.46)
let wSep       = Color(red: 1.0, green: 1.0, blue: 1.0).opacity(0.08)

let wAccent    = Color(red: 0.55, green: 0.36, blue: 0.96)  // indigo/fuchsia
let wBlue      = Color(red: 0.36, green: 0.56, blue: 0.98)
let wRed       = Color(red: 0.95, green: 0.35, blue: 0.38)

// MARK: - Small reusable views

struct CleanHeader: View {
    let label: String
    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(wAccent).frame(width: 5, height: 5)
            Text(label)
                .font(.system(size: 9, weight: .semibold))
                .foregroundColor(wSecondary)
                .tracking(1.2)
        }
    }
}

struct CleanDivider: View {
    var body: some View {
        Rectangle().fill(wSep).frame(height: 0.5)
    }
}

// MARK: - WidgetKit background compatibility (iOS 17 containerBackground)

extension View {
    @ViewBuilder
    func widgetBackground(_ color: Color) -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(color, for: .widget)
        } else {
            self.background(color)
        }
    }
}

// MARK: - Date helper

func todayString() -> String {
    let fmt = DateFormatter()
    fmt.dateFormat = "yyyy-MM-dd"
    fmt.timeZone = TimeZone.current
    return fmt.string(from: Date())
}

// MARK: - Supabase row types used by the Today widget

struct PrimaryGoalRow: Codable {
    let text: String
}

struct SecondaryGoalRow: Codable {
    let id: Int
}

struct TaskRow: Codable {
    let id: Int
    let done: Bool
    let due_date: String?
}
