// Vault's colour scheme, derived rather than listed.
//
// ── Why derive at all ──────────────────────────────────────────────────────
//
// A theme could be 62 stored token values. That is what "custom colour scheme"
// usually means, and it is a trap: every new token added to `:root` afterwards
// is a token every stored theme lacks, so themes silently rot as the app grows.
// A derived theme has no such surface — it is six numbers, and a token added
// tomorrow is derived for every theme that already exists.
//
// It is only possible because the palette is OKLCH. Lightness in OKLCH is
// perceptual, so "one step darker" is a subtraction and means the same thing at
// every hue. The same arithmetic in hex or HSL produces a ramp that is visibly
// uneven and, worse, whose contrast depends on hue — a yellow and a blue at the
// same HSL lightness are nowhere near the same brightness.
//
// ── ⚠️ The invariant: no theme can make text unreadable ─────────────────────
//
// Every foreground lightness is derived by moving AWAY from the surface, and the
// direction flips at DARK_BELOW. Because that threshold sits at the MIDPOINT of
// the lightness range, the far end is never closer than ~0.48 — so body text
// cannot approach the background from either side. This is the one property a
// colour picker cannot be trusted with: a user dragging a lightness slider
// passes through "text the same colour as the background", and an app that
// renders that state has lost its own settings panel. The tests sweep the whole
// range rather than checking three positions someone thought to try.
//
// ── Storage is per DEVICE, and that is a decision ──────────────────────────
//
// The theme lives in localStorage, not in Postgres. A Mac in a lit room and an
// iPad in bed genuinely want different schemes, so a per-account theme would be
// the wrong shape rather than a better one. The cost is that it does not follow
// you to a new browser; the upgrade path is a `vault_prefs` row keyed by device,
// not a rewrite.

export interface Theme {
  /** Surface lightness, 0..1. Below DARK_BELOW the theme is dark and the whole
   *  ramp inverts — see `step`. */
  bg: number;
  /** Chroma of the NEUTRALS. 0 is a pure grey app; a little warms every
   *  surface without turning anything into a colour. */
  tint: number;
  /** Hue of the neutrals, degrees. */
  tintHue: number;
  /** Accent hue, degrees. */
  accentHue: number;
  /** Accent chroma. */
  accentChroma: number;
  /** Extra separation between text and surface, added on top of the minimum. */
  contrast: number;
}

export const DEFAULT_THEME: Theme = {
  bg: 1, tint: 0, tintHue: 0, accentHue: 265, accentChroma: 0.1, contrast: 0,
};

/** Below this surface lightness the ramp inverts. */
export const DARK_BELOW = 0.5;

/**
 * The least lightness distance between body text and the surface it sits on.
 *
 * This is an ASSERTION, not the mechanism — and the distinction cost a test
 * failure worth keeping the note about. Making it the mechanism (body text at
 * exactly this distance) turned the default theme's black body text into a mid
 * grey, because 0.34 is the floor of legibility and nowhere near where body
 * text should sit.
 *
 * What actually guarantees it is the ramp inverting at DARK_BELOW = 0.5. A
 * light theme's surface is never below 0.5 and a dark theme's is never above
 * it, so the distance to the far end is at least 0.48 in either direction, and
 * TEXT_DL's own values are larger still. 0.34 therefore holds with room, at
 * every slider position, by construction rather than by tuning.
 */
export const MIN_TEXT_DL = 0.34;

/**
 * How far each text level sits from the surface.
 *
 * These reproduce the existing palette exactly at the default theme — the
 * engine has to be a no-op against the stylesheet it replaces, or shipping it
 * silently invalidates every colour judgement made so far.
 */
const TEXT_DL = {
  main: 0.855, soft: 0.795, primary: 0.70, secondary: 0.58, muted: 0.444,
  subdued: 0.35, ghost: 0.26, dim: 0.18, invisible: 0.12,
} as const;

/** Bounds for every seed. A slider outside these has no meaning. */
export const THEME_BOUNDS = {
  bg: [0.08, 1] as const,
  tint: [0, 0.03] as const,
  tintHue: [0, 360] as const,
  accentHue: [0, 360] as const,
  accentChroma: [0, 0.2] as const,
  contrast: [0, 0.18] as const,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Coerce anything — a stored blob from an older build, a hand-edited value —
 *  into a theme that is safe to render. Never throws. */
export function normalizeTheme(raw: unknown): Theme {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (k: keyof Theme) => {
    const v = o[k];
    const [lo, hi] = THEME_BOUNDS[k];
    return typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : DEFAULT_THEME[k];
  };
  return {
    bg: num("bg"),
    tint: num("tint"),
    tintHue: num("tintHue"),
    accentHue: num("accentHue"),
    accentChroma: num("accentChroma"),
    contrast: num("contrast"),
  };
}

export function isDark(t: Theme): boolean {
  return t.bg < DARK_BELOW;
}

/**
 * Move `n` steps away from the surface, in the direction that is legible.
 *
 * ⚠️ The direction flips for a dark theme, and this is the single line that
 * makes dark mode work rather than merely be dark. On a light surface "raised"
 * and "text" both go DOWN in lightness; on a dark one they both go UP. Getting
 * it wrong yields a dark theme whose borders and inputs are invisible because
 * they are darker than a surface that is already nearly black.
 */
function step(t: Theme, n: number): number {
  const dir = isDark(t) ? 1 : -1;
  return clamp(t.bg + dir * n, 0.02, 1);
}

const oklch = (l: number, c: number, h: number, alpha?: number) =>
  `oklch(${round(l)} ${round(c)} ${round(h, 1)}${alpha === undefined ? "" : ` / ${round(alpha * 100, 1)}%`})`;

const round = (v: number, dp = 4) => Number(v.toFixed(dp));

/**
 * The theme as CSS custom properties.
 *
 * Only the tokens whose VALUE depends on the scheme. Motion, z-index and the
 * shadow geometry are deliberately absent: they are not colours, and a theme
 * that could change them would be a theme that can break layout.
 */
export function themeTokens(t: Theme): Record<string, string> {
  const c = t.tint;
  const h = t.tintHue;

  // Surfaces, ordered from furthest-behind to nearest-front. Each is a step
  // away from the base, so the whole ramp inverts together for a dark theme.
  const surface = (n: number) => oklch(step(t, n), c, h);

  // Text. `contrast` scales the whole ramp rather than adding a constant: adding
  // one would push the faintest hairline as far as the body text, collapsing
  // nine distinguishable levels into two.
  const text = (dl: number) => oklch(step(t, dl * (1 + t.contrast * 4)), c, h);

  const accent = (l: number, chroma = t.accentChroma) => oklch(l, chroma, t.accentHue);
  // Accent lightness must also work against the surface, so it is derived the
  // same way rather than pinned — a mid-blue on a near-black surface is a link
  // nobody can read.
  const accentL = clamp(isDark(t) ? t.bg + 0.42 : t.bg - 0.55, 0.35, 0.82);

  const shadowAlpha = isDark(t) ? 0.55 : 0.08;
  const shade = (a: number, blur: string) => `${blur} oklch(0 0 0 / ${round(a * 100, 1)}%)`;

  return {
    "--bg-void": surface(0.09),
    "--bg-deep": surface(0.04),
    "--bg-dark": surface(0.025),
    "--bg-mid": surface(0.04),
    "--bg-base": surface(0),
    "--bg-subtle": surface(0.015),
    "--bg-raised": surface(0.03),
    "--bg-muted": surface(0.078),

    "--border-faint": surface(0.05),
    "--border-base": surface(0.078),
    "--border-strong": surface(0.12),

    "--fg-bright": oklch(isDark(t) ? 1 : 0, c, h),
    "--fg-base": text(TEXT_DL.main),
    "--fg-main": text(TEXT_DL.main),
    "--fg-soft": text(TEXT_DL.soft),
    "--fg-primary": text(TEXT_DL.primary),
    "--fg-secondary": text(TEXT_DL.secondary),
    "--fg-muted": text(TEXT_DL.muted),
    "--fg-subdued": text(TEXT_DL.subdued),
    "--fg-ghost": text(TEXT_DL.ghost),
    "--fg-dim": text(TEXT_DL.dim),
    "--fg-invisible": text(TEXT_DL.invisible),

    // Shadows are much stronger on a dark surface: a 6%-black shadow over
    // near-black is not a shadow, it is nothing, and every card loses its edge.
    "--shadow-xs": shade(shadowAlpha * 0.75, "0 1px 2px"),
    "--shadow-sm": `${shade(shadowAlpha, "0 2px 8px")}, ${shade(shadowAlpha * 0.6, "0 1px 2px")}`,
    "--shadow-md": `${shade(shadowAlpha * 1.25, "0 4px 20px")}, ${shade(shadowAlpha * 0.75, "0 2px 6px")}`,
    "--shadow-lg": `${shade(shadowAlpha * 1.5, "0 12px 40px")}, ${shade(shadowAlpha * 0.9, "0 4px 12px")}`,

    "--edge-in": accent(accentL),
    "--edge-in-bg": accent(step(t, 0.04), t.accentChroma * 0.25),
    "--edge-in-border": accent(step(t, 0.12), t.accentChroma * 0.5),
    "--accent": accent(accentL),
    "--accent-pdf": accent(accentL),
    "--on-accent": oklch(isDark(t) ? 0.12 : 1, 0, 0),

    // The semantic accents keep their OWN hues. A theme may not recolour
    // "destructive" — a delete button that is not red because the user picked a
    // green scheme is a theme changing what a control MEANS. Only their
    // lightness follows the surface, so they stay visible on a dark one.
    "--destructive": oklch(clamp(isDark(t) ? 0.68 : 0.577, 0.4, 0.8), 0.245, 27.325),
    "--destructive-bg": oklch(step(t, 0.045), 0.02, 27),
    "--destructive-border": oklch(step(t, 0.12), 0.06, 27),
    "--success": oklch(clamp(isDark(t) ? 0.7 : 0.5, 0.4, 0.8), 0.15, 140),
    "--success-bright": oklch(clamp(isDark(t) ? 0.75 : 0.45, 0.4, 0.85), 0.17, 145),
    "--success-bg": oklch(step(t, 0.045), 0.03, 145),
    "--success-border": oklch(step(t, 0.12), 0.07, 145),
    "--warning": oklch(clamp(isDark(t) ? 0.72 : 0.55, 0.4, 0.82), 0.12, 82),
    "--edge-out": oklch(clamp(isDark(t) ? 0.68 : 0.45, 0.4, 0.8), 0.12, 145),
    "--edge-out-bg": oklch(step(t, 0.045), 0.03, 145),
    "--edge-out-border": oklch(step(t, 0.12), 0.06, 145),

    // A selection tint must read on both ends of the ramp; on a dark surface it
    // has to be lighter than the row, not darker.
    "--table-selected": oklch(isDark(t) ? 0.75 : 0.5, 0.15, t.accentHue, isDark(t) ? 0.14 : 0.1),
  };
}

/** Named starting points. Custom tuning starts from one of these. */
export const PRESETS: Array<{ id: string; name: string; theme: Theme }> = [
  { id: "paper", name: "Paper", theme: DEFAULT_THEME },
  { id: "warm", name: "Warm", theme: { bg: 0.985, tint: 0.006, tintHue: 75, accentHue: 40, accentChroma: 0.11, contrast: 0 } },
  { id: "cool", name: "Cool", theme: { bg: 0.995, tint: 0.004, tintHue: 250, accentHue: 250, accentChroma: 0.12, contrast: 0 } },
  { id: "dusk", name: "Dusk", theme: { bg: 0.24, tint: 0.008, tintHue: 265, accentHue: 265, accentChroma: 0.11, contrast: 0.02 } },
  { id: "ink", name: "Ink", theme: { bg: 0.14, tint: 0, tintHue: 0, accentHue: 220, accentChroma: 0.1, contrast: 0.04 } },
];

export const THEME_KEY = "vault-theme";

/** Read the stored theme. A corrupt or older value yields the default rather
 *  than throwing — a theme is never worth failing a boot over. */
export function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw ? normalizeTheme(JSON.parse(raw)) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function storeTheme(t: Theme): void {
  try { localStorage.setItem(THEME_KEY, JSON.stringify(t)); } catch { /* private mode */ }
}

/**
 * Write the theme onto an element's inline style.
 *
 * Inline on `<html>` rather than a stylesheet: a custom property set inline
 * wins over `:root` without needing `!important` and without a specificity
 * argument, and it is one property write per token rather than a re-parse.
 *
 * `color-scheme` is set too, and it is not cosmetic — it is what makes the
 * scrollbars, form controls and the caret follow the theme. Without it a dark
 * Vault has white scrollbars.
 */
export function applyTheme(el: HTMLElement, t: Theme): void {
  const tokens = themeTokens(t);
  for (const [k, v] of Object.entries(tokens)) el.style.setProperty(k, v);
  el.style.colorScheme = isDark(t) ? "dark" : "light";
}
