// Colour themes for the shadcn token palette — DERIVED, never listed.
//
// A colour theme here is one preset id. Everything it changes is computed from
// two numbers (an accent hue and chroma) by `colorThemeTokens`, so a theme can
// never go stale when the stylesheet grows: a token added to `:root` later is
// simply not overridden, and every theme inherits it. Storing ~30 literal
// values per theme would be the opposite — every new token is one every stored
// theme lacks. Same reasoning as Vault's `lib/theme.ts`, which this follows in
// approach (not in code: Vault's token names are its own).
//
// ── ⚠️ The invariant: a theme can never make text less legible ─────────────
//
// A theme only ever changes HUE and CHROMA of the neutral tokens. Their OKLCH
// LIGHTNESS is copied from the stylesheet (`LIGHT_L` / `DARK_L` below mirror
// apps/PathFinder/src/App.css exactly), and OKLCH lightness is perceptual — so
// every foreground/background pair keeps exactly the lightness distance the
// default palette has. The accent tokens (`--primary` and friends) are the only
// ones whose lightness is chosen here, and their pairs are asserted in the
// tests against MIN_PAIR_DL in both light and dark mode, for every preset.
//
// "neutral" is the default and returns null — the stylesheet, untouched. The
// engine must be a no-op at the default, or shipping it would silently move
// every colour judgement already made against the existing palette.

export type ColorThemeId = "neutral" | "blue" | "violet" | "green" | "teal" | "rose" | "orange";

export interface ColorThemePreset {
  id: ColorThemeId;
  label: string;
  /** OKLCH hue, degrees. */
  hue: number;
  /** Accent chroma. 0 for neutral. */
  chroma: number;
}

export const COLOR_THEMES: readonly ColorThemePreset[] = [
  { id: "neutral", label: "Neutral", hue: 0, chroma: 0 },
  { id: "blue", label: "Blue", hue: 255, chroma: 0.16 },
  { id: "violet", label: "Violet", hue: 292, chroma: 0.17 },
  { id: "green", label: "Green", hue: 150, chroma: 0.14 },
  { id: "teal", label: "Teal", hue: 190, chroma: 0.11 },
  { id: "rose", label: "Rose", hue: 10, chroma: 0.17 },
  { id: "orange", label: "Orange", hue: 50, chroma: 0.15 },
];

export const COLOR_THEME_DEFAULT: ColorThemeId = "neutral";

export function isColorThemeId(v: unknown): v is ColorThemeId {
  return typeof v === "string" && COLOR_THEMES.some((t) => t.id === v);
}

/**
 * The least OKLCH lightness distance any text/surface pair a theme sets may
 * have. 0.34 is the floor of legibility used across the ecosystem (Vault's
 * MIN_TEXT_DL). It is an ASSERTION checked by the tests, not the mechanism —
 * the mechanism is that neutral lightness is copied, and the accent
 * lightnesses below sit well clear of it.
 */
export const MIN_PAIR_DL = 0.34;

/** Neutral-token lightness, light mode — mirrors PathFinder's `:root`. */
const LIGHT_L: Record<string, number> = {
  "--background": 1, "--foreground": 0.145,
  "--card": 1, "--card-foreground": 0.145,
  "--popover": 1, "--popover-foreground": 0.145,
  "--secondary": 0.97, "--secondary-foreground": 0.205,
  "--muted": 0.97, "--muted-foreground": 0.556,
  "--accent": 0.97, "--accent-foreground": 0.205,
  "--border": 0.922, "--input": 0.922,
  "--sidebar": 0.985, "--sidebar-foreground": 0.145,
  "--sidebar-accent": 0.97, "--sidebar-accent-foreground": 0.205,
  "--sidebar-border": 0.922,
};

/**
 * Neutral-token lightness, dark mode — mirrors PathFinder's `.dark`.
 * `--border`, `--input` and `--sidebar-border` are deliberately absent: in dark
 * mode they are translucent whites (`oklch(1 0 0 / 10%)`), which already pick up
 * whatever tinted surface sits beneath them.
 */
const DARK_L: Record<string, number> = {
  "--background": 0.145, "--foreground": 0.985,
  "--card": 0.205, "--card-foreground": 0.985,
  "--popover": 0.205, "--popover-foreground": 0.985,
  "--secondary": 0.269, "--secondary-foreground": 0.985,
  "--muted": 0.269, "--muted-foreground": 0.708,
  "--accent": 0.269, "--accent-foreground": 0.985,
  "--sidebar": 0.205, "--sidebar-foreground": 0.985,
  "--sidebar-accent": 0.269, "--sidebar-accent-foreground": 0.985,
};

/** Every token any theme may set — the applier clears exactly these when a
 *  theme is removed, so switching back to neutral leaves no residue. */
export const COLOR_THEME_TOKENS: readonly string[] = Array.from(new Set([
  ...Object.keys(LIGHT_L), ...Object.keys(DARK_L),
  "--primary", "--primary-foreground", "--ring",
  "--sidebar-primary", "--sidebar-primary-foreground", "--sidebar-ring",
  "--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5",
]));

const round = (v: number, dp = 4) => Number(v.toFixed(dp));
const oklch = (l: number, c: number, h: number) => `oklch(${round(l)} ${round(c)} ${round(h, 1)})`;

/**
 * How much of the accent hue the neutrals carry. Small on purpose: a theme
 * should read as "this app is blue", not turn every card into a blue card.
 * Pure white (L ≥ 0.99) stays achromatic — there is no "blue white" in gamut,
 * and a near-white with chroma reads as a rendering fault.
 */
function neutralChroma(l: number, name: string, accentChroma: number): number {
  if (accentChroma === 0 || l >= 0.99) return 0;
  const isText = name.endsWith("foreground");
  // Text carries a touch more than surfaces; mid-grey text (muted-foreground)
  // the most, since it is where a hue is actually perceptible.
  const base = name === "--muted-foreground" ? 0.02 : isText ? 0.008 : 0.01;
  return Math.min(base, accentChroma * 0.12);
}

/**
 * Accent lightness per mode. Chosen so both directions hold:
 *  - `--primary` as a FILL under `--primary-foreground` text, and
 *  - `--primary` as TEXT (`text-primary`) on `--background`.
 * Light: 0.50 under 0.985 text (Δ0.485) and on a 1.0 page (Δ0.50).
 * Dark: 0.78 under 0.205 text (Δ0.575) and on a 0.145 page (Δ0.635).
 */
const ACCENT = {
  light: { primary: 0.5, primaryFg: 0.985, ring: 0.7, sidebarPrimary: 0.5, sidebarPrimaryFg: 0.985, charts: [0.82, 0.7, 0.6, 0.5, 0.4] },
  dark: { primary: 0.78, primaryFg: 0.205, ring: 0.58, sidebarPrimary: 0.55, sidebarPrimaryFg: 0.985, charts: [0.87, 0.75, 0.65, 0.55, 0.45] },
} as const;

/**
 * The CSS custom properties a theme sets, for the given mode, or `null` for
 * the neutral default (meaning: clear every override, use the stylesheet).
 * Unknown ids also return null — a stored value from a newer build degrades
 * to the default rather than to something half-applied.
 */
export function colorThemeTokens(id: ColorThemeId | string, dark: boolean): Record<string, string> | null {
  const preset = COLOR_THEMES.find((t) => t.id === id);
  if (!preset || preset.chroma === 0) return null;
  const { hue: h, chroma: c } = preset;

  const out: Record<string, string> = {};
  const table = dark ? DARK_L : LIGHT_L;
  for (const [name, l] of Object.entries(table)) {
    out[name] = oklch(l, neutralChroma(l, name, c), h);
  }

  const a = dark ? ACCENT.dark : ACCENT.light;
  out["--primary"] = oklch(a.primary, dark ? c * 0.85 : c, h);
  out["--primary-foreground"] = oklch(a.primaryFg, 0, h);
  out["--ring"] = oklch(a.ring, c * 0.6, h);
  out["--sidebar-primary"] = oklch(a.sidebarPrimary, c, h);
  out["--sidebar-primary-foreground"] = oklch(a.sidebarPrimaryFg, 0, h);
  out["--sidebar-ring"] = oklch(a.ring, c * 0.6, h);
  a.charts.forEach((l, i) => { out[`--chart-${i + 1}`] = oklch(l, c, h); });
  return out;
}

/** OKLCH lightness of a token value this module produced, for the tests and
 *  for the swatch UI. NaN for anything else. */
export function oklchLightness(value: string): number {
  const m = /^oklch\(\s*([0-9.]+)/.exec(value);
  return m ? Number(m[1]) : NaN;
}
