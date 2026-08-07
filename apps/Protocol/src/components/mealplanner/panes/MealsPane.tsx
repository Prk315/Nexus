import { useState } from "react";
import { ChefHat, Pencil, Trash2, Plus } from "lucide-react";
import { useAppDispatch } from "../../../store/hooks";
import { removeMeal } from "../../../store/slices/mealPlannerSlice";
import { CARD_STYLE } from "../../../lib/uiHelpers";
import { mealNutrition } from "../../../lib/mealNutrition";
import MealBuilder from "../MealBuilder";
import type { Food, Meal, MealItem } from "../../../store/types";

/**
 * Full CRUD surface for saved "My Meals" — create, read, edit, delete. Each
 * meal is a card showing its macros and ingredient preview; the whole ingredient
 * list is editable through MealBuilder (opened in edit mode).
 */
export default function MealsPane({
  meals, mealItemsById, foodsById,
}: {
  meals: Meal[];
  mealItemsById: Record<string, MealItem[]>;
  foodsById: Map<string, Food>;
}) {
  const dispatch = useAppDispatch();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Meal | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>My Meals</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Reusable combinations you can drop into any day in one tap.
          </div>
        </div>
        <button
          onClick={() => setCreating(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "var(--accent)", color: "var(--accent-fg)", border: "none", borderRadius: "var(--radius-sm)", fontWeight: 600, fontSize: 13, cursor: "pointer", flexShrink: 0 }}
        >
          <Plus size={14} /> New meal
        </button>
      </div>

      {meals.length === 0 ? (
        <div style={{ ...CARD_STYLE, padding: 40, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <ChefHat size={28} color="var(--text-muted)" />
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>No saved meals yet</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 320 }}>
            Build a meal from a combination of foods once, then log it any day without re-entering every ingredient.
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {meals.map((meal) => {
            const items = mealItemsById[meal.id] ?? [];
            const n = mealNutrition(meal.id, foodsById, mealItemsById);
            return (
              <div key={meal.id} style={{ ...CARD_STYLE, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {meal.name}
                    </div>
                    {meal.description && (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {meal.description}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button onClick={() => setEditing(meal)} title="Edit" style={iconBtn}>
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => setConfirmDelete(meal.id)} title="Delete" style={iconBtn}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Macro strip */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
                  {([
                    ["Cal", n.calories, ""],
                    ["P", n.protein_g, "g"],
                    ["C", n.carbs_g, "g"],
                    ["F", n.fat_g, "g"],
                  ] as const).map(([label, val, unit]) => (
                    <div key={label} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{Math.round(val ?? 0)}{unit}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {items.length === 0
                    ? "No ingredients"
                    : items
                        .map((it) => foodsById.get(it.food_id)?.name)
                        .filter(Boolean)
                        .join(" · ")}
                </div>

                {confirmDelete === meal.id && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Delete this meal?</span>
                    <button
                      onClick={() => { dispatch(removeMeal(meal.id)); setConfirmDelete(null); }}
                      style={{ background: "var(--danger, #e5484d)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", padding: "3px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                    >
                      Delete
                    </button>
                    <button onClick={() => setConfirmDelete(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {creating && <MealBuilder onClose={() => setCreating(false)} />}
      {editing && (
        <MealBuilder
          meal={editing}
          existingItems={mealItemsById[editing.id] ?? []}
          foodsById={foodsById}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
  padding: 5, cursor: "pointer", color: "var(--text-secondary)", display: "flex",
};
