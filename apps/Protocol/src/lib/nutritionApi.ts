/**
 * Real-food nutrition lookup — searches Open Food Facts (branded/packaged
 * products) and USDA FoodData Central (whole foods, richer micronutrients)
 * in parallel. All values are normalized to "per 100g/100ml" to match a
 * single `protocol_foods` row shape; the caller applies a serving multiplier.
 *
 * USDA requires a free API key (https://api.data.gov/signup — instant, no
 * approval wait). Falls back to the public DEMO_KEY (rate-limited, shared
 * across everyone using it) if VITE_USDA_API_KEY isn't set.
 */

export interface FoodSearchResult {
  source: "usda" | "openfoodfacts";
  external_id: string;
  name: string;
  brand: string | null;
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

async function searchOpenFoodFacts(query: string): Promise<FoodSearchResult[]> {
  const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(query)}&page_size=10&fields=product_name,brands,nutriments,code`;
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

/** Searches both sources in parallel; a failure in one doesn't block the other. */
export async function searchFoods(query: string): Promise<FoodSearchResult[]> {
  if (!query.trim()) return [];
  const [usda, off] = await Promise.allSettled([searchUSDA(query), searchOpenFoodFacts(query)]);
  const usdaResults = usda.status === "fulfilled" ? usda.value : [];
  const offResults = off.status === "fulfilled" ? off.value : [];
  // USDA first — richer micronutrient data, generally more reliable for whole foods
  return [...usdaResults, ...offResults];
}
