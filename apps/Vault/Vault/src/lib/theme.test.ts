import { describe, it, expect } from "vitest";
import {
  themeTokens, normalizeTheme, isDark, DEFAULT_THEME, PRESETS,
  MIN_TEXT_DL, THEME_BOUNDS, DARK_BELOW, type Theme,
} from "./theme";

/** The L of an `oklch(L C H)` string. */
function lightness(token: string): number {
  const m = /^oklch\(([-\d.]+)/.exec(token);
  if (!m) throw new Error(`not an oklch value: ${token}`);
  return Number(m[1]);
}

/** Every seed combination worth checking, coarsely swept. Cheap enough to run
 *  exhaustively, which is the point — the invariant must hold everywhere the
 *  slider can go, not at the three positions someone thought to try. */
function sweep(): Theme[] {
  const out: Theme[] = [];
  for (let bg = THEME_BOUNDS.bg[0]; bg <= THEME_BOUNDS.bg[1]; bg += 0.04) {
    for (const contrast of [0, 0.09, THEME_BOUNDS.contrast[1]]) {
      for (const tint of [0, THEME_BOUNDS.tint[1]]) {
        for (const accentHue of [0, 120, 265, 359]) {
          out.push({ bg, tint, tintHue: 40, accentHue, accentChroma: 0.12, contrast });
        }
      }
    }
  }
  return out;
}

describe("the readability invariant", () => {
  // ⚠️ The property the whole module exists to guarantee. A user dragging a
  // lightness slider passes through "text the same colour as the background",
  // and an app that renders that state has lost its own settings panel.
  it("keeps body text at least MIN_TEXT_DL from the surface, at every setting", () => {
    for (const t of sweep()) {
      const k = themeTokens(t);
      const d = Math.abs(lightness(k["--fg-main"]) - lightness(k["--bg-base"]));
      expect(d, `bg=${t.bg.toFixed(2)} contrast=${t.contrast}`).toBeGreaterThanOrEqual(MIN_TEXT_DL - 1e-9);
    }
  });

  it("keeps even the faintest text on the correct side of the surface", () => {
    for (const t of sweep()) {
      const k = themeTokens(t);
      const bg = lightness(k["--bg-base"]);
      // Not "far enough to read" — --fg-invisible is a hairline by design — but
      // it must not cross the surface, which would make it lighter than the
      // page on a light theme and vanish.
      const faint = lightness(k["--fg-invisible"]);
      if (isDark(t)) expect(faint, `bg=${t.bg}`).toBeGreaterThan(bg);
      else expect(faint, `bg=${t.bg}`).toBeLessThan(bg);
    }
  });
});

describe("the ramp inverts for a dark theme", () => {
  // The single line that makes dark mode work rather than merely be dark:
  // on a dark surface "raised" must be LIGHTER, or every input and border is
  // darker than a page that is already nearly black, i.e. invisible.
  it("puts raised surfaces above the base when dark and below it when light", () => {
    for (const t of sweep()) {
      const k = themeTokens(t);
      const base = lightness(k["--bg-base"]);
      const raised = lightness(k["--bg-raised"]);
      const border = lightness(k["--border-strong"]);
      if (isDark(t)) {
        expect(raised, `bg=${t.bg}`).toBeGreaterThan(base);
        expect(border, `bg=${t.bg}`).toBeGreaterThan(base);
      } else {
        expect(raised, `bg=${t.bg}`).toBeLessThan(base);
        expect(border, `bg=${t.bg}`).toBeLessThan(base);
      }
    }
  });

  it("orders the surface ramp monotonically, so depth reads consistently", () => {
    for (const t of sweep()) {
      const k = themeTokens(t);
      const away = (tok: string) => Math.abs(lightness(k[tok]) - lightness(k["--bg-base"]));
      // subtle < raised < muted, measured as distance from the base — the same
      // order in both directions, which is what makes one stylesheet serve both.
      expect(away("--bg-subtle")).toBeLessThanOrEqual(away("--bg-raised"));
      expect(away("--bg-raised")).toBeLessThanOrEqual(away("--bg-muted"));
      expect(away("--border-faint")).toBeLessThanOrEqual(away("--border-base"));
      expect(away("--border-base")).toBeLessThanOrEqual(away("--border-strong"));
    }
  });

  it("orders the text ramp from strongest to faintest", () => {
    for (const t of sweep()) {
      const k = themeTokens(t);
      const away = (tok: string) => Math.abs(lightness(k[tok]) - lightness(k["--bg-base"]));
      const order = ["--fg-main", "--fg-soft", "--fg-primary", "--fg-secondary",
                     "--fg-muted", "--fg-subdued", "--fg-ghost", "--fg-dim", "--fg-invisible"];
      for (let i = 1; i < order.length; i++) {
        expect(away(order[i]), `${order[i]} vs ${order[i - 1]} at bg=${t.bg}`)
          .toBeLessThanOrEqual(away(order[i - 1]) + 1e-9);
      }
    }
  });
});

describe("what a theme may not change", () => {
  // A delete button that is not red because the user picked a green scheme is
  // a theme changing what a control MEANS, not how it looks.
  it("keeps the semantic hues regardless of the accent", () => {
    const green = themeTokens({ ...DEFAULT_THEME, accentHue: 140 });
    const pink = themeTokens({ ...DEFAULT_THEME, accentHue: 340 });
    const hue = (v: string) => /^oklch\([-\d.]+ [-\d.]+ ([-\d.]+)/.exec(v)![1];
    expect(hue(green["--destructive"])).toBe(hue(pink["--destructive"]));
    expect(hue(green["--success"])).toBe(hue(pink["--success"]));
    // …while the accent itself does follow.
    expect(hue(green["--accent"])).not.toBe(hue(pink["--accent"]));
  });

  it("emits no motion, z-index or layout token", () => {
    const keys = Object.keys(themeTokens(DEFAULT_THEME));
    for (const forbidden of ["--ease", "--duration", "--keyboard-zindex"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("strengthens shadows on a dark surface, where a 6% black is nothing", () => {
    const pct = (v: string) => Number(/([\d.]+)%/.exec(v)![1]);
    expect(pct(themeTokens(PRESETS.find((p) => p.id === "ink")!.theme)["--shadow-sm"]))
      .toBeGreaterThan(pct(themeTokens(DEFAULT_THEME)["--shadow-sm"]));
  });
});

describe("normalizeTheme", () => {
  // A stored blob from an older build, or a hand-edited one. Never throws, and
  // never yields a theme that the invariant above would fail on.
  it("clamps, substitutes and never throws", () => {
    expect(normalizeTheme(null)).toEqual(DEFAULT_THEME);
    expect(normalizeTheme("nonsense")).toEqual(DEFAULT_THEME);
    expect(normalizeTheme({ bg: 99 }).bg).toBe(THEME_BOUNDS.bg[1]);
    expect(normalizeTheme({ bg: -5 }).bg).toBe(THEME_BOUNDS.bg[0]);
    expect(normalizeTheme({ bg: Number.NaN }).bg).toBe(DEFAULT_THEME.bg);
    expect(normalizeTheme({ bg: "0.5" }).bg).toBe(DEFAULT_THEME.bg);
    expect(normalizeTheme({ contrast: 999 }).contrast).toBe(THEME_BOUNDS.contrast[1]);
  });

  it("a normalised arbitrary object still satisfies the readability invariant", () => {
    for (const junk of [{}, { bg: 0.5 }, { bg: 1e9, contrast: -1 }, { accentChroma: 5 }]) {
      const k = themeTokens(normalizeTheme(junk));
      expect(Math.abs(lightness(k["--fg-main"]) - lightness(k["--bg-base"])))
        .toBeGreaterThanOrEqual(MIN_TEXT_DL - 1e-9);
    }
  });
});

describe("presets", () => {
  it("are each already normalised, so picking one changes nothing silently", () => {
    for (const p of PRESETS) expect(normalizeTheme(p.theme), p.id).toEqual(p.theme);
  });

  it("include both a light and a dark option", () => {
    expect(PRESETS.some((p) => isDark(p.theme))).toBe(true);
    expect(PRESETS.some((p) => !isDark(p.theme))).toBe(true);
    expect(isDark(DEFAULT_THEME)).toBe(false);
  });

  it("reproduce today's palette in the default", () => {
    // The default must be a no-op against the stylesheet it replaces, or every
    // existing screenshot and every colour judgement made so far is invalidated
    // by shipping the theme engine at all.
    const k = themeTokens(DEFAULT_THEME);
    expect(lightness(k["--bg-base"])).toBe(1);
    expect(lightness(k["--bg-muted"])).toBeCloseTo(0.922, 2);
    expect(lightness(k["--border-base"])).toBeCloseTo(0.922, 2);
    expect(lightness(k["--fg-main"])).toBeCloseTo(0.145, 2);
    expect(lightness(k["--fg-muted"])).toBeCloseTo(0.556, 2);
  });

  it("agrees with DARK_BELOW about which side it is on", () => {
    for (const p of PRESETS) expect(isDark(p.theme)).toBe(p.theme.bg < DARK_BELOW);
  });
});
