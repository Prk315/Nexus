import { Fragment } from "react";
import { ChevronLeft, ChevronRight, Plus, Check, Trash2 } from "lucide-react";
import { CARD_STYLE } from "../../../lib/uiHelpers";
import { entryNutrition } from "../../../lib/mealNutrition";
import type { Food, Meal, MealItem, MealPlanEntry, MealSlot } from "../../../store/types";

const SLOTS: { id: MealSlot; label: string }[] = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "snack", label: "Snacks" },
];

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The weekly plan grid — 7 days × 4 slots. Each cell lists its entries with a
 * "did you actually eat this" toggle, plus an inline add button. Pure view: all
 * data + callbacks come from the parent so the pane holds no state of its own.
 */
export default function PlanPane({
  days, today, weekLabel, isThisWeek,
  entriesByDaySlot, foodsById, mealsById, mealItemsById,
  onPrevWeek, onNextWeek, onThisWeek, onAddSlot, onToggle, onRemove,
}: {
  days: string[];
  today: string;
  weekLabel: string;
  isThisWeek: boolean;
  entriesByDaySlot: Map<string, MealPlanEntry[]>;
  foodsById: Map<string, Food>;
  mealsById: Map<string, Meal>;
  mealItemsById: Record<string, MealItem[]>;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onThisWeek: () => void;
  onAddSlot: (date: string, slot: MealSlot) => void;
  onToggle: (id: string, logged: boolean) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Week navigation */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onPrevWeek} style={{ background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 6, cursor: "pointer", color: "var(--text-secondary)" }}>
          <ChevronLeft size={16} />
        </button>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{weekLabel}</span>
        <button onClick={onNextWeek} style={{ background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 6, cursor: "pointer", color: "var(--text-secondary)" }}>
          <ChevronRight size={16} />
        </button>
        {!isThisWeek && (
          <button onClick={onThisWeek} style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            This week
          </button>
        )}
      </div>

      {/* Weekly grid */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: `100px repeat(7, minmax(150px, 1fr))`, gap: 8, minWidth: 900 }}>
          <div />
          {days.map((d, i) => (
            <div key={d} style={{ textAlign: "center", padding: "6px 0" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>{DAY_LABELS[i]}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: d === today ? "var(--accent)" : "var(--text)" }}>{d.slice(5)}</div>
            </div>
          ))}

          {SLOTS.map(({ id: slot, label }) => (
            <Fragment key={slot}>
              <div style={{ display: "flex", alignItems: "center", fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
                {label}
              </div>
              {days.map((d) => {
                const entries = entriesByDaySlot.get(`${d}__${slot}`) ?? [];
                return (
                  <div key={`${slot}-${d}`} style={{ ...CARD_STYLE, padding: 8, minHeight: 64, display: "flex", flexDirection: "column", gap: 4 }}>
                    {entries.map((e) => {
                      const name = e.food_id
                        ? foodsById.get(e.food_id)?.name ?? "…"
                        : mealsById.get(e.meal_id ?? "")?.name ?? "…";
                      const n = entryNutrition(e, foodsById, mealsById, mealItemsById);
                      return (
                        <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                          <button
                            onClick={() => onToggle(e.id, !e.logged)}
                            title={e.logged ? "Mark as not eaten" : "Mark as eaten"}
                            style={{
                              width: 14, height: 14, borderRadius: "50%", flexShrink: 0, padding: 0,
                              background: e.logged ? "var(--accent)" : "transparent",
                              border: `1.5px solid ${e.logged ? "var(--accent)" : "var(--border)"}`,
                              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                            }}
                          >
                            {e.logged && <Check size={9} strokeWidth={4} color="var(--accent-fg)" />}
                          </button>
                          <span style={{ flex: 1, minWidth: 0, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {name}
                          </span>
                          <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{n?.calories != null ? Math.round(n.calories) : "—"}</span>
                          <button onClick={() => onRemove(e.id)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 0, flexShrink: 0 }}>
                            <Trash2 size={10} />
                          </button>
                        </div>
                      );
                    })}
                    <button
                      onClick={() => onAddSlot(d, slot)}
                      style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", padding: "2px 0" }}
                    >
                      <Plus size={11} /> Add
                    </button>
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
