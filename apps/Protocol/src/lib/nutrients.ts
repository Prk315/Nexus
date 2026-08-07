// Single source of truth for the nutrient set — macros with their sub-categories
// (fibre/sugar under carbs, saturated/unsaturated/trans under fat), minerals and
// vitamins. Foods store these per 100g/ml; supplements store absolute per-dose.
// Everything downstream (totals, editors, breakdown) derives from NUTRIENT_META
// so adding a nutrient is a one-line change here.

export type NutrientGroup = "Macros" | "Minerals" | "Vitamins" | "Other" | "Supplements" | "Medication";

export interface NutrientMeta {
  key: string;
  label: string;
  unit: string;
  group: NutrientGroup;
  /** A sub-category of the row above it (indented in editors). */
  sub?: boolean;
}

// Mirrors the seeded nut_nutrient_types (names + units) so the two stay aligned.
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
  { key: "omega3_mg", label: "Omega-3", unit: "mg", group: "Macros", sub: true },
  { key: "epa_mg", label: "EPA (omega-3)", unit: "mg", group: "Macros", sub: true },
  { key: "dha_mg", label: "DHA (omega-3)", unit: "mg", group: "Macros", sub: true },
  { key: "ala_mg", label: "ALA (omega-3)", unit: "mg", group: "Macros", sub: true },
  { key: "omega6_mg", label: "Omega-6", unit: "mg", group: "Macros", sub: true },
  // Minerals
  { key: "sodium_mg", label: "Sodium", unit: "mg", group: "Minerals" },
  { key: "potassium_mg", label: "Potassium", unit: "mg", group: "Minerals" },
  { key: "calcium_mg", label: "Calcium", unit: "mg", group: "Minerals" },
  { key: "iron_mg", label: "Iron", unit: "mg", group: "Minerals" },
  { key: "magnesium_mg", label: "Magnesium", unit: "mg", group: "Minerals" },
  { key: "magnesium_l_threonate_mg", label: "Mag. L-Threonate", unit: "mg", group: "Minerals", sub: true },
  { key: "magnesium_glycinate_mg", label: "Mag. Glycinate", unit: "mg", group: "Minerals", sub: true },
  { key: "magnesium_citrate_mg", label: "Mag. Citrate", unit: "mg", group: "Minerals", sub: true },
  { key: "zinc_mg", label: "Zinc", unit: "mg", group: "Minerals" },
  { key: "phosphorus_mg", label: "Phosphorus", unit: "mg", group: "Minerals" },
  { key: "copper_mg", label: "Copper", unit: "mg", group: "Minerals" },
  { key: "manganese_mg", label: "Manganese", unit: "mg", group: "Minerals" },
  { key: "selenium_mcg", label: "Selenium", unit: "mcg", group: "Minerals" },
  { key: "iodine_mcg", label: "Iodine", unit: "mcg", group: "Minerals" },
  { key: "chloride_mg", label: "Chloride", unit: "mg", group: "Minerals" },
  { key: "chromium_mcg", label: "Chromium", unit: "mcg", group: "Minerals" },
  { key: "molybdenum_mcg", label: "Molybdenum", unit: "mcg", group: "Minerals" },
  // Vitamins
  { key: "vitamin_a_mcg", label: "Vitamin A", unit: "mcg", group: "Vitamins" },
  { key: "thiamin_mg", label: "Thiamin (B1)", unit: "mg", group: "Vitamins" },
  { key: "riboflavin_mg", label: "Riboflavin (B2)", unit: "mg", group: "Vitamins" },
  { key: "niacin_mg", label: "Niacin (B3)", unit: "mg", group: "Vitamins" },
  { key: "pantothenic_acid_mg", label: "Pantothenic (B5)", unit: "mg", group: "Vitamins" },
  { key: "vitamin_b6_mg", label: "Vitamin B6", unit: "mg", group: "Vitamins" },
  { key: "biotin_mcg", label: "Biotin (B7)", unit: "mcg", group: "Vitamins" },
  { key: "folate_mcg", label: "Folate (B9)", unit: "mcg", group: "Vitamins" },
  { key: "vitamin_b12_mcg", label: "Vitamin B12", unit: "mcg", group: "Vitamins" },
  { key: "vitamin_c_mg", label: "Vitamin C", unit: "mg", group: "Vitamins" },
  { key: "vitamin_d_mcg", label: "Vitamin D", unit: "mcg", group: "Vitamins" },
  { key: "vitamin_e_mg", label: "Vitamin E", unit: "mg", group: "Vitamins" },
  { key: "vitamin_k_mcg", label: "Vitamin K", unit: "mcg", group: "Vitamins" },
  // Other
  { key: "cholesterol_mg", label: "Cholesterol", unit: "mg", group: "Other" },
  { key: "water_ml", label: "Water", unit: "ml", group: "Other" },
  { key: "alcohol_g", label: "Alcohol", unit: "g", group: "Other" },
  { key: "caffeine_mg", label: "Caffeine", unit: "mg", group: "Other" },
  // Supplements (herbals / active compounds)
  { key: "apigenin_mg", label: "Apigenin", unit: "mg", group: "Supplements" },
  { key: "rhodiola_rosea_mg", label: "Rhodiola Rosea", unit: "mg", group: "Supplements" },
  { key: "ashwagandha_mg", label: "Ashwagandha", unit: "mg", group: "Supplements" },
  { key: "l_theanine_mg", label: "L-Theanine", unit: "mg", group: "Supplements" },
  { key: "creatine_g", label: "Creatine", unit: "g", group: "Supplements" },
  // Medication
  { key: "methylphenidate_mg", label: "Methylphenidate", unit: "mg", group: "Medication" },
] as const satisfies readonly NutrientMeta[];

export type NutrientKey = (typeof NUTRIENT_META)[number]["key"];

export const NUTRIENT_KEYS = NUTRIENT_META.map((m) => m.key) as NutrientKey[];

export const NUTRIENT_GROUPS: NutrientGroup[] = ["Macros", "Minerals", "Vitamins", "Other", "Supplements", "Medication"];

/** Every nutrient value, nullable. Foods and supplements both carry this shape. */
export type NutrientValues = Record<NutrientKey, number | null>;

/** A fresh all-null nutrient block — the base for new foods/supplements so an
 *  unfilled field means "not specified", not zero. */
export const EMPTY_NUTRIENTS: NutrientValues = Object.fromEntries(
  NUTRIENT_KEYS.map((k) => [k, null]),
) as NutrientValues;

const META_BY_KEY = Object.fromEntries(NUTRIENT_META.map((m) => [m.key, m])) as Record<NutrientKey, NutrientMeta>;
export const nutrientMeta = (key: NutrientKey): NutrientMeta => META_BY_KEY[key];
