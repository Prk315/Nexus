import { describe, it, expect } from "vitest";
import {
  COLOR_THEMES, COLOR_THEME_DEFAULT, COLOR_THEME_TOKENS, MIN_PAIR_DL,
  colorThemeTokens, isColorThemeId, oklchLightness,
} from "./colorTheme";

const MODES = [false, true] as const;
const coloured = COLOR_THEMES.filter((t) => t.chroma > 0);

/** Every text-on-surface pair a theme can set, plus primary used as text on
 *  the page. If any of these collapses, some control becomes unreadable. */
const PAIRS: [string, string][] = [
  ["--foreground", "--background"],
  ["--card-foreground", "--card"],
  ["--popover-foreground", "--popover"],
  ["--secondary-foreground", "--secondary"],
  ["--muted-foreground", "--muted"],
  ["--muted-foreground", "--background"],
  ["--accent-foreground", "--accent"],
  ["--primary-foreground", "--primary"],
  ["--primary", "--background"],
  ["--sidebar-foreground", "--sidebar"],
  ["--sidebar-accent-foreground", "--sidebar-accent"],
  ["--sidebar-primary-foreground", "--sidebar-primary"],
];

describe("colour themes", () => {
  it("neutral is the default and is a no-op (null = keep the stylesheet)", () => {
    expect(COLOR_THEME_DEFAULT).toBe("neutral");
    expect(colorThemeTokens("neutral", false)).toBeNull();
    expect(colorThemeTokens("neutral", true)).toBeNull();
  });

  it("an unknown id (a value from a newer build) degrades to the default, never half-applies", () => {
    expect(colorThemeTokens("plaid", false)).toBeNull();
    expect(isColorThemeId("plaid")).toBe(false);
    expect(isColorThemeId("blue")).toBe(true);
  });

  for (const t of coloured) {
    for (const dark of MODES) {
      it(`${t.id} (${dark ? "dark" : "light"}): every text/surface pair stays ≥ ${MIN_PAIR_DL} apart in OKLCH lightness`, () => {
        const tokens = colorThemeTokens(t.id, dark)!;
        for (const [fg, bg] of PAIRS) {
          const dl = Math.abs(oklchLightness(tokens[fg]) - oklchLightness(tokens[bg]));
          expect(dl, `${fg} on ${bg}`).toBeGreaterThanOrEqual(MIN_PAIR_DL);
        }
      });
    }
  }

  it("a theme changes hue and chroma of the neutrals, never their lightness", () => {
    // Lightness is what decides legibility; copying it from the stylesheet
    // is the mechanism behind the invariant above. Two themes must therefore
    // agree on every neutral lightness exactly.
    for (const dark of MODES) {
      const a = colorThemeTokens("blue", dark)!;
      const b = colorThemeTokens("orange", dark)!;
      for (const name of ["--background", "--foreground", "--card", "--muted", "--muted-foreground", "--border"]) {
        if (!(name in a)) continue; // dark borders are translucent and untouched
        expect(oklchLightness(a[name]), name).toBe(oklchLightness(b[name]));
      }
    }
  });

  it("only ever sets tokens the applier knows how to clear", () => {
    for (const t of coloured) for (const dark of MODES) {
      for (const name of Object.keys(colorThemeTokens(t.id, dark)!)) {
        expect(COLOR_THEME_TOKENS).toContain(name);
      }
    }
  });

  it("presets are distinguishable — no two share an accent", () => {
    const primaries = coloured.map((t) => colorThemeTokens(t.id, false)!["--primary"]);
    expect(new Set(primaries).size).toBe(primaries.length);
  });

  it("pure white stays achromatic (there is no in-gamut tinted white)", () => {
    expect(colorThemeTokens("violet", false)!["--background"]).toMatch(/^oklch\(1 0 /);
  });
});
