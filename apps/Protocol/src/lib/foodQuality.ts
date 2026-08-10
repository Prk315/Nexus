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
