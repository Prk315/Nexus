import { useState } from "react";
import { X, Plus, Trash2, ChefHat } from "lucide-react";
import { useAppDispatch } from "../../store/hooks";
import { removeMeal } from "../../store/slices/mealPlannerSlice";
import { CARD_STYLE } from "../../lib/uiHelpers";
import { mealNutrition } from "../../lib/mealNutrition";
import FoodPicker from "./FoodPicker";
import MealBuilder from "./MealBuilder";
import type { CreateFood, Food, Meal, MealItem } from "../../store/types";

type Tab = "search" | "meals";

export default function FoodSearchPanel({
  localFoods, meals, mealItemsById, foodsById, onPick, onPickMeal, onClose,
}: {
  localFoods: Food[];
  meals: Meal[];
  mealItemsById: Record<string, MealItem[]>;
  foodsById: Map<string, Food>;
  onPick: (food: CreateFood, grams: number) => void;
  onPickMeal: (mealId: string) => void;
  onClose: () => void;
}) {
  const dispatch = useAppDispatch();
  const [tab, setTab] = useState<Tab>("search");
  const [building, setBuilding] = useState(false);

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: 60, zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{ ...CARD_STYLE, width: 480, maxHeight: "80vh", overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>Add to plan</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)" }}>
          {([["search", "Search Foods"], ["meals", "My Meals"]] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                padding: "8px 4px", marginRight: 16,
                fontSize: 13, fontWeight: 600,
                color: tab === id ? "var(--accent)" : "var(--text-muted)",
                borderBottom: `2px solid ${tab === id ? "var(--accent)" : "transparent"}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "search" && <FoodPicker localFoods={localFoods} onPick={onPick} />}

        {tab === "meals" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {meals.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>
                No saved meals yet — build one from a combination of foods.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {meals.map((meal) => {
                  const n = mealNutrition(meal.id, foodsById, mealItemsById);
                  const itemCount = (mealItemsById[meal.id] ?? []).length;
                  return (
                    <div
                      key={meal.id}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                        padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                      }}
                    >
                      <button
                        onClick={() => onPickMeal(meal.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", flex: 1, minWidth: 0, padding: 0 }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {meal.name}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {itemCount} item{itemCount === 1 ? "" : "s"} · {Math.round(n.calories)} kcal
                        </div>
                      </button>
                      <button onClick={() => onPickMeal(meal.id)} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, flexShrink: 0 }}>
                        <Plus size={16} />
                      </button>
                      <button onClick={() => dispatch(removeMeal(meal.id))} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 0, flexShrink: 0 }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              onClick={() => setBuilding(true)}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "none", border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)", padding: "9px 12px", fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" }}
            >
              <ChefHat size={14} /> Build a new meal
            </button>
          </div>
        )}
      </div>

      {building && <MealBuilder onClose={() => setBuilding(false)} />}
    </div>
  );
}
