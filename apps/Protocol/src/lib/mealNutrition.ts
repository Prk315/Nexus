import type { Food, Meal, MealItem, MealPlanEntry } from "../store/types";

export const NUTRIENT_KEYS = [
  "calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g",
  "sodium_mg", "potassium_mg", "calcium_mg", "iron_mg", "vitamin_c_mg", "vitamin_d_mcg",
] as const;

export type NutrientTotals = Record<(typeof NUTRIENT_KEYS)[number], number>;

const EMPTY: NutrientTotals = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])) as NutrientTotals;

function scaleFood(food: Food, factor: number): NutrientTotals {
  const scale = (v: number | null) => (v != null ? v * factor : 0);
  return {
    calories: scale(food.calories), protein_g: scale(food.protein_g), carbs_g: scale(food.carbs_g),
    fat_g: scale(food.fat_g), fiber_g: scale(food.fiber_g), sugar_g: scale(food.sugar_g),
    sodium_mg: scale(food.sodium_mg), potassium_mg: scale(food.potassium_mg), calcium_mg: scale(food.calcium_mg),
    iron_mg: scale(food.iron_mg), vitamin_c_mg: scale(food.vitamin_c_mg), vitamin_d_mcg: scale(food.vitamin_d_mcg),
  };
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
    totals = addInto(totals, scaleFood(food, item.quantity / 100));
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
    return scaleFood(food, entry.quantity / 100);
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
