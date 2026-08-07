import { useState } from "react";
import { X, Plus, Trash2, ChefHat, Pencil } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  addFood, addMeal, updateMeal, addMealItem, removeMealItem,
} from "../../store/slices/mealPlannerSlice";
import { CARD_STYLE, INPUT_STYLE, LABEL_STYLE, FIELD_GROUP } from "../../lib/uiHelpers";
import FoodPicker from "./FoodPicker";
import type { CreateFood, Food, Meal, MealItem } from "../../store/types";

interface DraftItem {
  key: string;
  /** Present when this row is an already-persisted meal item (edit mode). */
  itemId?: string;
  food: CreateFood;
  quantity: number;
}

function foodToCreate(f: Food): CreateFood {
  const { id: _id, user_id: _u, created_at: _c, ...rest } = f;
  return rest;
}

/**
 * Create OR edit a saved meal. Pass `meal` + `existingItems` to edit; omit them
 * to build a new one. On save (edit) it diffs the ingredient list — only the
 * added/removed items hit the network, so re-saving an untouched meal is cheap.
 */
export default function MealBuilder({
  meal, existingItems, foodsById, onClose,
}: {
  meal?: Meal;
  existingItems?: MealItem[];
  foodsById?: Map<string, Food>;
  onClose: () => void;
}) {
  const dispatch = useAppDispatch();
  const existingFoods = useAppSelector((s) => s.mealPlanner.foods);
  const editing = !!meal;

  const [name, setName] = useState(meal?.name ?? "");
  const [description, setDescription] = useState(meal?.description ?? "");
  const [items, setItems] = useState<DraftItem[]>(() =>
    (existingItems ?? []).flatMap((it) => {
      const food = foodsById?.get(it.food_id);
      if (!food) return [];
      return [{ key: crypto.randomUUID(), itemId: it.id, food: foodToCreate(food), quantity: it.quantity }];
    }),
  );
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  function addItem(food: CreateFood, grams: number) {
    setItems((list) => [...list, { key: crypto.randomUUID(), food, quantity: grams }]);
    setPicking(false);
  }

  function removeItem(key: string) {
    setItems((list) => list.filter((i) => i.key !== key));
  }

  const totalCalories = items.reduce((sum, i) => {
    const cal = i.food.calories ?? 0;
    return sum + cal * (i.quantity / 100);
  }, 0);

  /** Resolve a draft food to a food_id, reusing an existing catalog row when the
   *  same (source, external_id) is already present so we never duplicate. */
  async function resolveFoodId(food: CreateFood): Promise<string> {
    const existing = existingFoods.find(
      (f) => f.source === food.source && f.external_id === food.external_id && food.external_id != null,
    );
    return existing ? existing.id : (await dispatch(addFood(food)).unwrap()).id;
  }

  async function save() {
    if (!name.trim() || items.length === 0) return;
    setSaving(true);
    try {
      if (editing && meal) {
        // 1. Name / description.
        await dispatch(updateMeal({
          id: meal.id, name: name.trim(), description: description.trim() || null,
          created_at: meal.created_at,
        })).unwrap();
        // 2. Removed items.
        const keptIds = new Set(items.filter((i) => i.itemId).map((i) => i.itemId!));
        for (const it of existingItems ?? []) {
          if (!keptIds.has(it.id)) {
            await dispatch(removeMealItem({ id: it.id, mealId: meal.id })).unwrap();
          }
        }
        // 3. Newly added items.
        const added = items.filter((i) => !i.itemId);
        for (let i = 0; i < added.length; i++) {
          const foodId = await resolveFoodId(added[i].food);
          await dispatch(addMealItem({
            meal_id: meal.id, food_id: foodId, quantity: added[i].quantity,
            sort_order: (existingItems?.length ?? 0) + i,
          })).unwrap();
        }
      } else {
        const created = await dispatch(addMeal({ name: name.trim(), description: description.trim() || null })).unwrap();
        for (let i = 0; i < items.length; i++) {
          const foodId = await resolveFoodId(items[i].food);
          await dispatch(addMealItem({ meal_id: created.id, food_id: foodId, quantity: items[i].quantity, sort_order: i })).unwrap();
        }
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: 60, zIndex: 110,
      }}
      onClick={onClose}
    >
      <div
        style={{ ...CARD_STYLE, width: 480, maxHeight: "80vh", overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15, color: "var(--text)" }}>
            {editing ? <Pencil size={16} color="var(--accent)" /> : <ChefHat size={16} color="var(--accent)" />}
            {editing ? "Edit meal" : "New meal"}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
            <X size={16} />
          </button>
        </div>

        {picking ? (
          <FoodPicker localFoods={existingFoods} onPick={addItem} />
        ) : (
          <>
            <div style={FIELD_GROUP}>
              <label style={LABEL_STYLE}>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Post-workout bowl" style={INPUT_STYLE} autoFocus />
            </div>
            <div style={FIELD_GROUP}>
              <label style={LABEL_STYLE}>Description (optional)</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A quick note about this meal" style={INPUT_STYLE} />
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Ingredients
                </span>
                {items.length > 0 && (
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{Math.round(totalCalories)} kcal total</span>
                )}
              </div>

              {items.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                  {items.map((i) => (
                    <div key={i.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 12 }}>
                      <span style={{ flex: 1, minWidth: 0, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {i.food.name}
                      </span>
                      <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                        {i.quantity}{i.food.serving_unit}
                      </span>
                      <button onClick={() => removeItem(i.key)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 0, flexShrink: 0 }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => setPicking(true)}
                style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 12px", fontSize: 12, color: "var(--text-secondary)", cursor: "pointer", width: "100%", justifyContent: "center" }}
              >
                <Plus size={13} /> Add ingredient
              </button>
            </div>

            <button
              onClick={save}
              disabled={!name.trim() || items.length === 0 || saving}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                padding: "9px 16px", background: "var(--accent)", color: "var(--accent-fg)", border: "none",
                borderRadius: "var(--radius-sm)", fontWeight: 600, fontSize: 13, cursor: "pointer",
                opacity: !name.trim() || items.length === 0 || saving ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : editing ? "Save changes" : "Save meal"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
