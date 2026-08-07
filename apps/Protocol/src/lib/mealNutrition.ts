import { NUTRIENT_KEYS, type NutrientKey, type NutrientValues } from "./nutrients";
import type { Food, Meal, MealItem, MealPlanEntry } from "../store/types";

export { NUTRIENT_KEYS };
export type NutrientTotals = Record<NutrientKey, number>;

const EMPTY: NutrientTotals = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])) as NutrientTotals;

/** Scale any nutrient-bearing object (food per-100g × qty/100, or a supplement
 *  dose × 1). Nulls are treated as 0. */
export function scaleNutrients(src: Partial<NutrientValues>, factor: number): NutrientTotals {
  const out = {} as NutrientTotals;
  for (const k of NUTRIENT_KEYS) {
    const v = src[k];
    out[k] = v != null ? v * factor : 0;
  }
  return out;
}

function addInto(totals: NutrientTotals, add: NutrientTotals): NutrientTotals {
  const out = { ...totals };
  for (const k of NUTRIENT_KEYS) out[k] += add[k];
  return out;
}

/** Sums a meal's items (each item's food, scaled by its own quantity/100). */
export function mealNutrition(
  mealId: string,
  foodsById: Map<string, Food>,
  mealItemsById: Record<string, MealItem[]>,
): NutrientTotals {
  const items = mealItemsById[mealId] ?? [];
  let totals = EMPTY;
  for (const item of items) {
    const food = foodsById.get(item.food_id);
    if (!food) continue;
    totals = addInto(totals, scaleNutrients(food,item.quantity / 100));
  }
  return totals;
}

/** Nutrition for a single plan entry — handles both a direct food and a named meal. */
export function entryNutrition(
  entry: MealPlanEntry,
  foodsById: Map<string, Food>,
  mealsById: Map<string, Meal>,
  mealItemsById: Record<string, MealItem[]>,
): NutrientTotals | null {
  if (entry.food_id) {
    const food = foodsById.get(entry.food_id);
    if (!food) return null;
    return scaleNutrients(food,entry.quantity / 100);
  }
  if (entry.meal_id) {
    if (!mealsById.has(entry.meal_id)) return null;
    return mealNutrition(entry.meal_id, foodsById, mealItemsById);
  }
  return null;
}

export function sumNutrition(list: (NutrientTotals | null)[]): NutrientTotals {
  let totals = EMPTY;
  for (const n of list) {
    if (!n) continue;
    totals = addInto(totals, n);
  }
  return totals;
}
