import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Rows / entry

struct MealPlanEntryRow: Codable {
    let id: String
    let slot: String
    let logged: Bool
    let meal_id: String?
    let food_id: String?
}

struct NamedRow: Codable {
    let id: String
    let name: String
}

struct MealEntryItem: Identifiable {
    let id: String
    let name: String
    let slot: String
    let logged: Bool
}

struct MealSuggestion: Identifiable {
    let id: String     // meal id
    let name: String
}

struct MealLogEntry: TimelineEntry {
    let date: Date
    let today: String
    let items: [MealEntryItem]
    let loggedCount: Int
    /// Saved meals offered for one-tap logging when nothing is planned.
    let suggestions: [MealSuggestion]
    /// The slot a suggestion tap logs into, picked by time of day.
    let suggestedSlot: String

    static let placeholder = MealLogEntry(
        date: Date(), today: "2026-08-13",
        items: [
            MealEntryItem(id: "1", name: "Skyr + granola", slot: "breakfast", logged: true),
            MealEntryItem(id: "2", name: "Chicken & rice", slot: "lunch", logged: false),
            MealEntryItem(id: "3", name: "Salmon bowl", slot: "dinner", logged: false),
        ],
        loggedCount: 1, suggestions: [], suggestedSlot: "lunch"
    )
}

/// Slot by wall clock: breakfast until 11, lunch until 15, dinner until 21,
/// snack after — for quick-logging when nothing is planned.
func currentSlot(_ date: Date = Date()) -> String {
    let hour = Calendar.current.component(.hour, from: date)
    switch hour {
    case ..<11:  return "breakfast"
    case ..<15:  return "lunch"
    case ..<21:  return "dinner"
    default:     return "snack"
    }
}

func slotIcon(_ s: String) -> String {
    switch s {
    case "breakfast": return "🌅"
    case "lunch":     return "☀️"
    case "dinner":    return "🌙"
    default:          return "🍎"
    }
}

// MARK: - Provider

struct MealLogProvider: TimelineProvider {
    func placeholder(in context: Context) -> MealLogEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (MealLogEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        Task { completion(await fetchEntry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MealLogEntry>) -> Void) {
        Task {
            let entry = await fetchEntry()
            let next = Calendar.current.date(byAdding: .minute, value: 20, to: Date()) ?? Date()
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func fetchEntry() async -> MealLogEntry {
        let client = SupabaseClient()          // anon key; widget_anon_read covers the plan + own foods
        let today = todayString()

        let rows: [MealPlanEntryRow] = (try? await client.fetch(
            table: "protocol_meal_plan_entries",
            select: "id,slot,logged,meal_id,food_id",
            filters: [
                "user_id": "eq.\(Secrets.userID)",
                "date": "eq.\(today)",
                "order": "sort_order.asc",
            ]
        )) ?? []

        // Resolve names. Meals are anon-readable via the shared-library policy;
        // foods only where contributed by the owner (widget_anon_read) — an
        // unresolvable one falls back to a generic label rather than hiding.
        let mealIDs = rows.compactMap { $0.meal_id }
        let foodIDs = rows.compactMap { $0.food_id }

        async let mealRows: [NamedRow] = mealIDs.isEmpty ? [] : (try? client.fetch(
            table: "protocol_meals",
            select: "id,name",
            filters: ["id": "in.(\(mealIDs.joined(separator: ",")))"]
        )) ?? []
        async let foodRows: [NamedRow] = foodIDs.isEmpty ? [] : (try? client.fetch(
            table: "protocol_foods",
            select: "id,name",
            filters: ["id": "in.(\(foodIDs.joined(separator: ",")))"]
        )) ?? []

        let (meals, foods) = await (mealRows, foodRows)
        let nameByID = Dictionary(uniqueKeysWithValues: (meals + foods).map { ($0.id, $0.name) })

        let overrides = WidgetStore.loadOverrides()

        var items: [MealEntryItem] = []
        for r in rows {
            var logged = r.logged
            if let o = overrides[WidgetStore.overrideKey("meal-entry-\(r.id)", today)] {
                if o.done == logged {
                    // Server agreed — the optimistic state has served its purpose.
                    WidgetStore.clearOverride(habitID: "meal-entry-\(r.id)", date: today)
                } else {
                    logged = o.done
                }
            }
            let refID = r.meal_id ?? r.food_id
            items.append(MealEntryItem(
                id: r.id,
                name: refID.flatMap { nameByID[$0] } ?? "Meal",
                slot: r.slot,
                logged: logged
            ))
        }

        // Nothing planned → offer saved meals for one-tap logging.
        var suggestions: [MealSuggestion] = []
        if items.isEmpty {
            let saved: [NamedRow] = (try? await client.fetch(
                table: "protocol_meals",
                select: "id,name",
                filters: ["order": "name.asc", "limit": "4"]
            )) ?? []
            suggestions = saved.map { MealSuggestion(id: $0.id, name: $0.name) }
        }

        return MealLogEntry(
            date: Date(), today: today, items: items,
            loggedCount: items.filter { $0.logged }.count,
            suggestions: suggestions,
            suggestedSlot: currentSlot()
        )
    }
}

// MARK: - Row views

@available(iOS 17.0, *)
struct MealEntryRowView: View {
    let item: MealEntryItem

    var body: some View {
        Button(intent: ToggleMealLoggedIntent(entryID: item.id, logged: item.logged)) {
            HStack(spacing: 9) {
                ZStack {
                    Circle().fill(item.logged ? wGreen : Color.clear)
                    Circle().strokeBorder(item.logged ? wGreen : wTertiary, lineWidth: 1.5)
                    if item.logged {
                        Image(systemName: "checkmark")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundColor(wBg)
                    }
                }
                .frame(width: 16, height: 16)

                Text(slotIcon(item.slot))
                    .font(.system(size: 10))

                Text(item.name)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(item.logged ? wTertiary : wPrimary)
                    .strikethrough(item.logged, color: wTertiary)
                    .lineLimit(1)

                Spacer(minLength: 4)

                Text(item.slot)
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundColor(wTertiary)
                    .textCase(.uppercase)
            }
            .padding(.vertical, 3)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

@available(iOS 17.0, *)
struct MealSuggestionRowView: View {
    let suggestion: MealSuggestion
    let slot: String
    let today: String

    var body: some View {
        Button(intent: QuickLogMealIntent(mealID: suggestion.id, slot: slot, date: today)) {
            HStack(spacing: 9) {
                Image(systemName: "plus.circle")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(wAccent)
                Text(suggestion.name)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(wPrimary)
                    .lineLimit(1)
                Spacer(minLength: 4)
            }
            .padding(.vertical, 3)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Widget view

@available(iOS 17.0, *)
struct MealLogView: View {
    let entry: MealLogEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                CleanHeader(label: "MEALS")
                Spacer(minLength: 4)
                Text("\(entry.loggedCount)/\(entry.items.count) logged")
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundColor(
                        entry.items.count > 0 && entry.loggedCount == entry.items.count
                            ? wGreen : wSecondary
                    )
            }
            .padding(.bottom, 7)
            CleanDivider().padding(.bottom, 7)

            if entry.items.isEmpty {
                if entry.suggestions.isEmpty {
                    Spacer()
                    Text("Nothing planned — add meals in the app")
                        .font(.system(size: 11))
                        .foregroundColor(wTertiary)
                        .frame(maxWidth: .infinity, alignment: .center)
                    Spacer()
                } else {
                    Text("Quick log \(entry.suggestedSlot):")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(wTertiary)
                        .padding(.bottom, 2)
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(entry.suggestions) { s in
                            MealSuggestionRowView(
                                suggestion: s, slot: entry.suggestedSlot, today: entry.today
                            )
                        }
                    }
                    Spacer(minLength: 0)
                }
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(entry.items.prefix(4)) { item in
                        MealEntryRowView(item: item)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(14)
    }
}

// MARK: - Widget definition

struct MealLogWidget: Widget {
    let kind = WidgetKind.mealLog

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MealLogProvider()) { entry in
            Group {
                if #available(iOS 17.0, *) {
                    MealLogView(entry: entry)
                } else {
                    // Interactive widgets are iOS 17+.
                    SignedOutView()
                }
            }
            .widgetBackground(wBg)
        }
        .configurationDisplayName("Quick Meal Log")
        .description("Today's meal plan — tap to mark eaten, or quick-log a saved meal.")
        .supportedFamilies([.systemMedium])
    }
}
