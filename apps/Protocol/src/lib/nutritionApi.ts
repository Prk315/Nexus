/**
 * Real-food nutrition lookup — searches Open Food Facts (branded/packaged
 * products), USDA FoodData Central (whole foods, richest micronutrient profile),
 * and Frida/DTU (Danish national food database, static reference table) in
 * parallel. All values are normalized to "per 100g/100ml" to match the
 * `protocol_foods` row shape; the caller applies a serving multiplier.
 *
 * Each result carries a `nutrients` partial keyed by the app's canonical
 * NUTRIENT_KEYS (lib/nutrients.ts). USDA's response for whole foods contains the
 * full profile — every vitamin, mineral, amino acid and fatty acid — so we map
 * as much of it as we have keys for, rather than only the headline macros.
 *
 * USDA requires a free API key (https://api.data.gov/signup — instant). Falls
 * back to the public DEMO_KEY (rate-limited) if VITE_USDA_API_KEY isn't set.
 *
 * Frida has no browser-usable API (no CORS on fcdb.fooddata.dk), so its ~1390
 * foods are imported once into `protocol_foods_dk` and queried directly. That
 * table only carries the headline nutrients, so Frida depth is limited to those.
 */

import { getSupabaseClient } from "./supabase";
import { NUTRIENT_KEYS, type NutrientKey, type NutrientValues } from "./nutrients";

export interface FoodSearchResult {
  source: "usda" | "openfoodfacts" | "frida";
  external_id: string;
  name: string;
  brand: string | null;
  /** Open Food Facts / Frida — e.g. "Denmark". Lets the UI flag Danish/EU results. */
  country: string | null;
  /** Per-100g nutrient values, only the keys the source actually provided. */
  nutrients: Partial<NutrientValues>;
}

const USDA_API_KEY = (import.meta.env.VITE_USDA_API_KEY as string) || "DEMO_KEY";
const OFF_USER_AGENT = "ProtocolMealPlanner/1.0 (contact: protocol-app@local)";

/** "en:denmark" -> "Denmark"; picks the first tag when a product lists several markets. */
function readableCountry(tags: string[] | undefined): string | null {
  const first = tags?.[0];
  if (!first) return null;
  const name = first.includes(":") ? first.slice(first.indexOf(":") + 1) : first;
  return name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Open Food Facts ──────────────────────────────────────────────────────────

/** OFF nutriment key (per-100g) → our key. Only the reliably-populated,
 *  consistently-united fields; OFF's micronutrient units are too inconsistent to
 *  trust, so we stick to energy, macros and the fat sub-types (all grams). */
const OFF_MAP: { off: string; key: NutrientKey; factor?: number }[] = [
  { off: "energy-kcal_100g", key: "calories" },
  { off: "proteins_100g", key: "protein_g" },
  { off: "carbohydrates_100g", key: "carbs_g" },
  { off: "fiber_100g", key: "fiber_g" },
  { off: "sugars_100g", key: "sugar_g" },
  { off: "fat_100g", key: "fat_g" },
  { off: "saturated-fat_100g", key: "saturated_fat_g" },
  { off: "monounsaturated-fat_100g", key: "monounsaturated_fat_g" },
  { off: "polyunsaturated-fat_100g", key: "polyunsaturated_fat_g" },
  { off: "trans-fat_100g", key: "trans_fat_g" },
  { off: "sodium_100g", key: "sodium_mg", factor: 1000 }, // OFF sodium is grams
];

async function searchOpenFoodFacts(query: string): Promise<FoodSearchResult[]> {
  const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(query)}&page_size=10&fields=product_name,brands,nutriments,code,countries_tags`;
  const res = await fetch(url, { headers: { "User-Agent": OFF_USER_AGENT } });
  if (!res.ok) return [];
  const data = await res.json();
  const hits: Record<string, unknown>[] = data.hits ?? [];

  return hits
    .map((hit): FoodSearchResult | null => {
      const n = (hit.nutriments as Record<string, number>) ?? {};
      const name = (hit.product_name as string) || "";
      if (!name || n["energy-kcal_100g"] == null) return null; // skip incomplete entries
      const brands = hit.brands as string[] | string | undefined;
      const nutrients: Partial<NutrientValues> = {};
      for (const { off, key, factor } of OFF_MAP) {
        const v = n[off];
        if (typeof v === "number") nutrients[key] = v * (factor ?? 1);
      }
      return {
        source: "openfoodfacts",
        external_id: String(hit.code ?? ""),
        name,
        brand: Array.isArray(brands) ? brands[0] ?? null : brands || null,
        country: readableCountry(hit.countries_tags as string[] | undefined),
        nutrients,
      };
    })
    .filter((f): f is FoodSearchResult => f != null);
}

// ── USDA FoodData Central ────────────────────────────────────────────────────

/** USDA `nutrientName` → our key (+ unit factor where USDA's native unit differs
 *  from ours). USDA reports fatty acids and amino acids in grams; our omega/EPA/
 *  DHA/ALA keys are milligrams, hence ×1000. Everything else lines up (minerals
 *  in mg, trace vitamins/minerals in µg, macros/aminos/fat-types in g). */
const USDA_MAP: Record<string, { key: NutrientKey; factor?: number }> = {
  // Energy + macros
  "Protein": { key: "protein_g" },
  "Carbohydrate, by difference": { key: "carbs_g" },
  "Total lipid (fat)": { key: "fat_g" },
  "Fiber, total dietary": { key: "fiber_g" },
  "Total Sugars": { key: "sugar_g" },
  "Sugars, total including NLEA": { key: "sugar_g" },
  "Sugars, added": { key: "added_sugar_g" },
  "Water": { key: "water_ml" },
  "Alcohol, ethyl": { key: "alcohol_g" },
  "Caffeine": { key: "caffeine_mg" },
  // Fat sub-types
  "Fatty acids, total saturated": { key: "saturated_fat_g" },
  "Fatty acids, total monounsaturated": { key: "monounsaturated_fat_g" },
  "Fatty acids, total polyunsaturated": { key: "polyunsaturated_fat_g" },
  "Fatty acids, total trans": { key: "trans_fat_g" },
  "Cholesterol": { key: "cholesterol_mg" },
  "PUFA 20:5 n-3 (EPA)": { key: "epa_mg", factor: 1000 },
  "PUFA 22:6 n-3 (DHA)": { key: "dha_mg", factor: 1000 },
  "PUFA 18:3 n-3 c,c,c (ALA)": { key: "ala_mg", factor: 1000 },
  "PUFA 18:2 n-6 c,c": { key: "omega6_mg", factor: 1000 },
  // Minerals
  "Sodium, Na": { key: "sodium_mg" },
  "Potassium, K": { key: "potassium_mg" },
  "Calcium, Ca": { key: "calcium_mg" },
  "Iron, Fe": { key: "iron_mg" },
  "Magnesium, Mg": { key: "magnesium_mg" },
  "Phosphorus, P": { key: "phosphorus_mg" },
  "Zinc, Zn": { key: "zinc_mg" },
  "Copper, Cu": { key: "copper_mg" },
  "Manganese, Mn": { key: "manganese_mg" },
  "Selenium, Se": { key: "selenium_mcg" },
  "Iodine, I": { key: "iodine_mcg" },
  "Fluoride, F": { key: "fluoride_mcg" },
  // Vitamins
  "Vitamin A, RAE": { key: "vitamin_a_mcg" },
  "Thiamin": { key: "thiamin_mg" },
  "Riboflavin": { key: "riboflavin_mg" },
  "Niacin": { key: "niacin_mg" },
  "Pantothenic acid": { key: "pantothenic_acid_mg" },
  "Vitamin B-6": { key: "vitamin_b6_mg" },
  "Biotin": { key: "biotin_mcg" },
  "Folate, total": { key: "folate_mcg" },
  "Vitamin B-12": { key: "vitamin_b12_mcg" },
  "Vitamin C, total ascorbic acid": { key: "vitamin_c_mg" },
  "Vitamin D (D2 + D3)": { key: "vitamin_d_mcg" },
  "Vitamin E (alpha-tocopherol)": { key: "vitamin_e_mg" },
  "Vitamin K (phylloquinone)": { key: "vitamin_k_mcg" },
  "Choline, total": { key: "choline_mg" },
  // Amino acids (grams → our _g keys)
  "Tryptophan": { key: "tryptophan_g" },
  "Threonine": { key: "threonine_g" },
  "Isoleucine": { key: "isoleucine_g" },
  "Leucine": { key: "leucine_g" },
  "Lysine": { key: "lysine_g" },
  "Methionine": { key: "methionine_g" },
  "Cystine": { key: "cystine_g" },
  "Phenylalanine": { key: "phenylalanine_g" },
  "Tyrosine": { key: "tyrosine_g" },
  "Valine": { key: "valine_g" },
  "Arginine": { key: "arginine_g" },
  "Histidine": { key: "histidine_g" },
  "Glycine": { key: "glycine_g" },
};

async function searchUSDA(query: string): Promise<FoodSearchResult[]> {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=10&api_key=${USDA_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  const foods: Record<string, unknown>[] = data.foods ?? [];

  return foods.map((food): FoodSearchResult => {
    const nutrients: Partial<NutrientValues> = {};
    const rows = (food.foodNutrients as { nutrientName: string; unitName?: string; value: number }[]) ?? [];
    let energyKj: number | null = null;
    for (const n of rows) {
      // Energy appears as both KCAL and kJ rows; prefer kcal, fall back to
      // converting kJ so a food is never dropped for lacking a kcal row.
      if (n.nutrientName === "Energy") {
        if (n.unitName === "KCAL" && typeof n.value === "number") nutrients.calories = n.value;
        else if (n.unitName === "KJ" && typeof n.value === "number") energyKj = n.value;
        continue;
      }
      const map = USDA_MAP[n.nutrientName];
      if (map && nutrients[map.key] == null && typeof n.value === "number") {
        nutrients[map.key] = n.value * (map.factor ?? 1);
      }
    }
    if (nutrients.calories == null && energyKj != null) nutrients.calories = Math.round(energyKj / 4.184);
    return {
      source: "usda",
      external_id: String(food.fdcId ?? ""),
      name: (food.description as string) || "",
      brand: (food.brandName as string) || (food.brandOwner as string) || null,
      country: null, // USDA is US-only; no market metadata to surface
      nutrients,
    };
  }).filter((f) => f.name && f.nutrients.calories != null);
}

// ── Frida (Danish reference table) ───────────────────────────────────────────

const EU_COUNTRIES = new Set([
  "Denmark", "Sweden", "Norway", "Germany", "Netherlands", "Finland", "France",
  "Belgium", "Austria", "Poland", "Italy", "Spain", "Ireland",
]);

async function searchFridaDK(query: string): Promise<FoodSearchResult[]> {
  const sb = getSupabaseClient();
  const term = query.trim();
  const { data, error } = await sb
    .from("protocol_foods_dk")
    .select("*")
    .or(`name_da.ilike.%${term}%,name_en.ilike.%${term}%`)
    .limit(10);
  if (error || !data) return [];

  return data.map((row): FoodSearchResult => {
    // protocol_foods_dk now carries the full Frida/FCDB nutrient set — read every
    // NUTRIENT_KEY column that's present (numeric, or a numeric string from
    // PostgREST), so deep micros/amino-acids/fatty-acids flow through.
    const r = row as Record<string, unknown>;
    const nutrients: Partial<NutrientValues> = {};
    for (const k of NUTRIENT_KEYS) {
      const v = r[k];
      const num = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : null;
      if (num != null && !Number.isNaN(num)) nutrients[k] = num;
    }
    return {
      source: "frida",
      external_id: String(row.id),
      name: row.name_da,
      brand: row.name_en,
      country: "Denmark",
      nutrients,
    };
  });
}

/** Searches all sources in parallel; a failure in one doesn't block the others. */
export async function searchFoods(query: string): Promise<FoodSearchResult[]> {
  if (!query.trim()) return [];
  const [usda, off, frida] = await Promise.allSettled([
    searchUSDA(query),
    searchOpenFoodFacts(query),
    searchFridaDK(query),
  ]);
  const usdaResults = usda.status === "fulfilled" ? usda.value : [];
  const offResults = off.status === "fulfilled" ? off.value : [];
  const fridaResults = frida.status === "fulfilled" ? frida.value : [];
  // Danish first, then other EU markets, then the rest — OFF's own relevance
  // order is preserved within each group.
  const rank = (f: FoodSearchResult) => (f.country === "Denmark" ? 0 : f.country && EU_COUNTRIES.has(f.country) ? 1 : 2);
  const sortedOff = [...offResults].sort((a, b) => rank(a) - rank(b));
  // Frida first — the official Danish reference database — then USDA
  // (richest micronutrients for whole foods), then Open Food Facts.
  return [...fridaResults, ...usdaResults, ...sortedOff];
}
