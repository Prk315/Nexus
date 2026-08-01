/**
 * Real-food nutrition lookup — searches Open Food Facts (branded/packaged
 * products), USDA FoodData Central (whole foods, richer micronutrients), and
 * Frida/DTU (Danish national food database, static reference table) in
 * parallel. All values are normalized to "per 100g/100ml" to match a single
 * `protocol_foods` row shape; the caller applies a serving multiplier.
 *
 * USDA requires a free API key (https://api.data.gov/signup — instant, no
 * approval wait). Falls back to the public DEMO_KEY (rate-limited, shared
 * across everyone using it) if VITE_USDA_API_KEY isn't set.
 *
 * Frida has no browser-usable API (no CORS on fcdb.fooddata.dk), so its
 * ~1390 foods are imported once into the `protocol_foods_dk` Supabase table
 * and queried directly.
 */

import { getSupabaseClient } from "./supabase";

export interface FoodSearchResult {
  source: "usda" | "openfoodfacts" | "frida";
  external_id: string;
  name: string;
  brand: string | null;
  /** Open Food Facts only — e.g. "Denmark". Lets the UI flag Danish/EU results. */
  country: string | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
  potassium_mg: number | null;
  calcium_mg: number | null;
  iron_mg: number | null;
  vitamin_c_mg: number | null;
  vitamin_d_mcg: number | null;
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
      return {
        source: "openfoodfacts",
        external_id: String(hit.code ?? ""),
        name,
        brand: Array.isArray(brands) ? brands[0] ?? null : brands || null,
        country: readableCountry(hit.countries_tags as string[] | undefined),
        calories: n["energy-kcal_100g"] ?? null,
        protein_g: n["proteins_100g"] ?? null,
        carbs_g: n["carbohydrates_100g"] ?? null,
        fat_g: n["fat_100g"] ?? null,
        fiber_g: n["fiber_100g"] ?? null,
        sugar_g: n["sugars_100g"] ?? null,
        sodium_mg: n["sodium_100g"] != null ? n["sodium_100g"] * 1000 : null,
        potassium_mg: null,
        calcium_mg: null,
        iron_mg: null,
        vitamin_c_mg: null,
        vitamin_d_mcg: null,
      };
    })
    .filter((f): f is FoodSearchResult => f != null);
}

const USDA_NUTRIENT_MAP: Record<string, keyof FoodSearchResult> = {
  "Energy": "calories",
  "Protein": "protein_g",
  "Carbohydrate, by difference": "carbs_g",
  "Total lipid (fat)": "fat_g",
  "Fiber, total dietary": "fiber_g",
  "Total Sugars": "sugar_g",
  "Sugars, total including NLEA": "sugar_g",
  "Sodium, Na": "sodium_mg",
  "Potassium, K": "potassium_mg",
  "Calcium, Ca": "calcium_mg",
  "Iron, Fe": "iron_mg",
  "Vitamin C, total ascorbic acid": "vitamin_c_mg",
  "Vitamin D (D2 + D3)": "vitamin_d_mcg",
};

async function searchUSDA(query: string): Promise<FoodSearchResult[]> {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=10&api_key=${USDA_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  const foods: Record<string, unknown>[] = data.foods ?? [];

  return foods.map((food): FoodSearchResult => {
    const result: FoodSearchResult = {
      source: "usda",
      external_id: String(food.fdcId ?? ""),
      name: (food.description as string) || "",
      brand: (food.brandName as string) || (food.brandOwner as string) || null,
      country: null, // USDA is US-only; no market metadata to surface
      calories: null, protein_g: null, carbs_g: null, fat_g: null,
      fiber_g: null, sugar_g: null, sodium_mg: null, potassium_mg: null,
      calcium_mg: null, iron_mg: null, vitamin_c_mg: null, vitamin_d_mcg: null,
    };
    const nutrients = (food.foodNutrients as { nutrientName: string; value: number }[]) ?? [];
    for (const n of nutrients) {
      const key = USDA_NUTRIENT_MAP[n.nutrientName];
      // Energy row appears twice (KCAL and kJ) — keep whichever comes first (KCAL, per USDA's ordering)
      if (key && result[key] == null) {
        (result[key] as number | null) = n.value;
      }
    }
    return result;
  }).filter((f) => f.name && f.calories != null);
}

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

  return data.map((row): FoodSearchResult => ({
    source: "frida",
    external_id: String(row.id),
    name: row.name_da,
    brand: row.name_en,
    country: "Denmark",
    calories: row.calories,
    protein_g: row.protein_g,
    carbs_g: row.carbs_g,
    fat_g: row.fat_g,
    fiber_g: row.fiber_g,
    sugar_g: row.sugar_g,
    sodium_mg: row.sodium_mg,
    potassium_mg: row.potassium_mg,
    calcium_mg: row.calcium_mg,
    iron_mg: row.iron_mg,
    vitamin_c_mg: row.vitamin_c_mg,
    vitamin_d_mcg: row.vitamin_d_mcg,
  }));
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
  // (richer micronutrients for whole foods), then Open Food Facts.
  return [...fridaResults, ...usdaResults, ...sortedOff];
}
