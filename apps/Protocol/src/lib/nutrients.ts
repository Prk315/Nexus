// Single source of truth for the nutrient set — macros with their sub-categories
// (fibre/sugar under carbs, saturated/unsaturated/trans under fat), minerals and
// vitamins. Foods store these per 100g/ml; supplements store absolute per-dose.
// Everything downstream (totals, editors, breakdown) derives from NUTRIENT_META
// so adding a nutrient is a one-line change here.

export type NutrientGroup = "Macros" | "Minerals" | "Vitamins";

export interface NutrientMeta {
  key: string;
  label: string;
  unit: string;
  group: NutrientGroup;
  /** A sub-category of the macro above it (indented in editors). */
  sub?: boolean;
}

export const NUTRIENT_META = [
  // Macros
  { key: "calories", label: "Calories", unit: "kcal", group: "Macros" },
  { key: "protein_g", label: "Protein", unit: "g", group: "Macros" },
  { key: "carbs_g", label: "Carbs", unit: "g", group: "Macros" },
  { key: "fiber_g", label: "Fibre", unit: "g", group: "Macros", sub: true },
  { key: "sugar_g", label: "Sugar", unit: "g", group: "Macros", sub: true },
  { key: "added_sugar_g", label: "Added sugar", unit: "g", group: "Macros", sub: true },
  { key: "fat_g", label: "Fat", unit: "g", group: "Macros" },
  { key: "saturated_fat_g", label: "Saturated", unit: "g", group: "Macros", sub: true },
  { key: "monounsaturated_fat_g", label: "Monounsat.", unit: "g", group: "Macros", sub: true },
  { key: "polyunsaturated_fat_g", label: "Polyunsat.", unit: "g", group: "Macros", sub: true },
  { key: "trans_fat_g", label: "Trans", unit: "g", group: "Macros", sub: true },
  { key: "cholesterol_mg", label: "Cholesterol", unit: "mg", group: "Macros" },
  // Minerals
  { key: "sodium_mg", label: "Sodium", unit: "mg", group: "Minerals" },
  { key: "potassium_mg", label: "Potassium", unit: "mg", group: "Minerals" },
  { key: "calcium_mg", label: "Calcium", unit: "mg", group: "Minerals" },
  { key: "iron_mg", label: "Iron", unit: "mg", group: "Minerals" },
  { key: "magnesium_mg", label: "Magnesium", unit: "mg", group: "Minerals" },
  { key: "zinc_mg", label: "Zinc", unit: "mg", group: "Minerals" },
  // Vitamins
  { key: "vitamin_a_mcg", label: "Vitamin A", unit: "mcg", group: "Vitamins" },
  { key: "vitamin_c_mg", label: "Vitamin C", unit: "mg", group: "Vitamins" },
  { key: "vitamin_d_mcg", label: "Vitamin D", unit: "mcg", group: "Vitamins" },
  { key: "vitamin_e_mg", label: "Vitamin E", unit: "mg", group: "Vitamins" },
  { key: "vitamin_k_mcg", label: "Vitamin K", unit: "mcg", group: "Vitamins" },
  { key: "vitamin_b12_mcg", label: "Vitamin B12", unit: "mcg", group: "Vitamins" },
  { key: "folate_mcg", label: "Folate", unit: "mcg", group: "Vitamins" },
] as const satisfies readonly NutrientMeta[];

export type NutrientKey = (typeof NUTRIENT_META)[number]["key"];

export const NUTRIENT_KEYS = NUTRIENT_META.map((m) => m.key) as NutrientKey[];

export const NUTRIENT_GROUPS: NutrientGroup[] = ["Macros", "Minerals", "Vitamins"];

/** Every nutrient value, nullable. Foods and supplements both carry this shape. */
export type NutrientValues = Record<NutrientKey, number | null>;

/** A fresh all-null nutrient block — the base for new foods/supplements so an
 *  unfilled field means "not specified", not zero. */
export const EMPTY_NUTRIENTS: NutrientValues = Object.fromEntries(
  NUTRIENT_KEYS.map((k) => [k, null]),
) as NutrientValues;

const META_BY_KEY = Object.fromEntries(NUTRIENT_META.map((m) => [m.key, m])) as Record<NutrientKey, NutrientMeta>;
export const nutrientMeta = (key: NutrientKey): NutrientMeta => META_BY_KEY[key];
