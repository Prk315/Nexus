// A curated background tint for Container/Callout cards — shared by both,
// since "make this card a colour" is one idea whether the card is a callout
// or a plain group.
//
// A short fixed list, not a colour wheel: the same reasoning TEXT_COLORS in
// blockRegistry.ts already documents — an arbitrary hex picker produces
// documents that look like ransom notes and can't be restyled later. These
// are Vault's own semantic hues so a coloured card matches the rest of the
// app's palette in both themes.

export interface CardColor {
  id: string;
  label: string;
  /** Accent used for borders/icons; null means "no override, use the variant/style default". */
  accent: string | null;
  /** Background tint; null means "no override". */
  bg: string | null;
}

export const CARD_COLORS: CardColor[] = [
  { id: "default", label: "Default", accent: null, bg: null },
  { id: "gray", label: "Gray", accent: "oklch(0.55 0 0)", bg: "oklch(0.96 0 0)" },
  { id: "red", label: "Red", accent: "oklch(0.577 0.245 27.325)", bg: "oklch(0.97 0.02 27)" },
  { id: "amber", label: "Amber", accent: "oklch(0.55 0.12 82)", bg: "color-mix(in oklab, oklch(0.58 0.14 85) 22%, var(--bg-base))" },
  { id: "green", label: "Green", accent: "oklch(0.50 0.15 140)", bg: "oklch(0.96 0.03 145)" },
  { id: "blue", label: "Blue", accent: "oklch(0.40 0.10 265)", bg: "oklch(0.96 0.02 265)" },
  { id: "purple", label: "Purple", accent: "oklch(0.45 0.18 300)", bg: "oklch(0.96 0.03 300)" },
];

const CARD_COLOR_IDS = new Set(CARD_COLORS.map((c) => c.id));

export function isCardColorId(v: string | null | undefined): v is string {
  return !!v && CARD_COLOR_IDS.has(v);
}

/**
 * The inline custom properties for a chosen colour, or `{}` for "default" /
 * null — rendered separately from `data-color` (the attribute's own
 * renderHTML) so the two never fight over the `style` string.
 */
export function cardColorStyle(color: string | null | undefined): Record<string, string> {
  if (!color || color === "default") return {};
  const c = CARD_COLORS.find((x) => x.id === color);
  if (!c || !c.bg || !c.accent) return {};
  return { style: `--card-tint:${c.bg};--card-accent:${c.accent}` };
}
