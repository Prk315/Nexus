import SwiftUI

// MARK: - Clean light palette

let wBg        = Color.white
let wPrimary   = Color(red: 0.06, green: 0.06, blue: 0.09)
let wSecondary = Color(red: 0.48, green: 0.49, blue: 0.52)
let wTertiary  = Color(red: 0.74, green: 0.75, blue: 0.77)
let wSep       = Color(red: 0.90, green: 0.90, blue: 0.93)

let wBlue      = Color(red: 0.22, green: 0.52, blue: 0.97)
let wTeal      = Color(red: 0.08, green: 0.73, blue: 0.62)
let wGreen     = Color(red: 0.12, green: 0.75, blue: 0.40)
let wPurple    = Color(red: 0.55, green: 0.30, blue: 0.95)
let wAmber     = Color(red: 0.97, green: 0.68, blue: 0.08)
let wRed       = Color(red: 0.93, green: 0.20, blue: 0.22)

struct CleanHeader: View {
    let label: String
    var body: some View {
        Text(label)
            .font(.system(size: 9, weight: .semibold))
            .foregroundColor(wSecondary)
            .tracking(1.2)
    }
}

struct CleanDivider: View {
    var body: some View {
        Rectangle().fill(wSep).frame(height: 0.5)
    }
}
