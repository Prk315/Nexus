import type { CSSProperties } from "react";

/**
 * Food-quality tiers. A card's colour signals how well its nutrition data is
 * covered — the whole point being that a Frida row beats a plain log, and a
 * hand-curated "detailed" food beats even Frida.
 *
 *   normal → white  — USDA / Open Food Facts / manual
 *   silver → Frida   — source === "frida"
 *   gold   → detailed — owner flipped the `detailed` flag (see protocol_foods)
 *
 * Gold wins over silver: a Frida food someone then curated further is gold.
 */
export type FoodTier = "gold" | "silver" | "normal";

export function foodTier(f: { source?: string | null; detailed?: boolean | null }): FoodTier {
  if (f.detailed) return "gold";
  if (f.source === "frida") return "silver";
  return "normal";
}

export const TIER_LABEL: Record<FoodTier, string> = {
  gold: "Detailed",
  silver: "Frida",
  normal: "Basic",
};

/**
 * Border + background wash to merge onto a card/row for its tier. Colours are
 * theme vars (tokens.css), so they adapt to light/dark. `normal` returns {} so
 * the card keeps whatever neutral border/background it already had.
 *
 * `surface` picks which wash to blend over — a raised card (default) vs. an
 * inset row that sits on --bg — so the tint reads on both.
 */
export function tierCardStyle(tier: FoodTier, surface: "card" | "inset" = "card"): CSSProperties {
  if (tier === "normal") return {};
  return {
    border: `1px solid var(--tier-${tier}-border)`,
    background: surface === "inset" ? `var(--tier-${tier}-wash-inset)` : `var(--tier-${tier}-wash)`,
  };
}

/** Solid tier colour for a medallion/star icon (muted grey for normal). */
export function tierMedalColor(tier: FoodTier): string {
  return tier === "normal" ? "var(--text-muted)" : `var(--tier-${tier}-solid)`;
}

// ── Meal-level rating ────────────────────────────────────────────────────────
// A meal has no single source; it's rated by the AGGREGATE MEAN of its
// ingredients' tiers on a 0–3 scale — the three food tiers spaced evenly across
// it (white 0, silver 1.5, gold 3). The meal card's colour then rides that mean
// continuously from white → silver → gold, so a meal is exactly as trustworthy
// as its ingredients on average.

export const TIER_SCORE: Record<FoodTier, number> = { normal: 0, silver: 1.5, gold: 3 };

/** Mean ingredient tier score (0–3); null for a meal with no ingredients. */
export function mealRating(
  foods: Array<{ source?: string | null; detailed?: boolean | null }>,
): number | null {
  if (foods.length === 0) return null;
  const sum = foods.reduce((s, f) => s + TIER_SCORE[foodTier(f)], 0);
  return sum / foods.length;
}

/** color-mix helper — blend `pctA`% of `a` into `b`, resolved from theme vars. */
function mix(a: string, b: string, pctA: number): string {
  return `color-mix(in srgb, ${a} ${Math.round(Math.min(100, Math.max(0, pctA)))}%, ${b})`;
}

/**
 * Continuous border + wash for a 0–3 meal rating. Two linear segments meet at
 * silver (1.5): [0,1.5] neutral→silver, [1.5,3] silver→gold. Returns {} for a
 * null/zero rating so an unrated (empty) meal keeps its neutral card.
 */
export function ratingCardStyle(rating: number | null): CSSProperties {
  if (rating == null || rating <= 0) return {};
  const r = Math.min(3, rating);
  const border = r <= 1.5
    ? mix("var(--tier-silver-border)", "var(--border)", (r / 1.5) * 100)
    : mix("var(--tier-gold-border)", "var(--tier-silver-border)", ((r - 1.5) / 1.5) * 100);
  const wash = r <= 1.5
    ? mix("var(--tier-silver-wash)", "transparent", (r / 1.5) * 100)
    : mix("var(--tier-gold-wash)", "var(--tier-silver-wash)", ((r - 1.5) / 1.5) * 100);
  return { border: `1px solid ${border}`, background: wash };
}

/** Solid colour matching a 0–3 rating, for the rating badge/number. */
export function ratingMedalColor(rating: number | null): string {
  if (rating == null || rating <= 0) return "var(--text-muted)";
  const r = Math.min(3, rating);
  return r <= 1.5
    ? mix("var(--tier-silver-solid)", "var(--text-muted)", (r / 1.5) * 100)
    : mix("var(--tier-gold-solid)", "var(--tier-silver-solid)", ((r - 1.5) / 1.5) * 100);
}
