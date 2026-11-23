// Guards for the two appearance settings whose correctness depends on this
// app's stylesheet rather than on code: text size (App.css restates every
// arbitrary px font size) and colour themes (nexus-core's colorTheme.ts
// mirrors App.css's neutral lightness table). Both fail SILENTLY when they
// drift — a size that ignores the slider, a theme that shifts a lightness the
// legibility argument assumed fixed — so they are pinned here instead.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { colorThemeTokens, oklchLightness } from "../../../../packages/nexus-core/src/colorTheme";

const APP_SRC = resolve(__dirname, "..");
const CORE_SRC = resolve(__dirname, "../../../../packages/nexus-core/src");
const CSS = readFileSync(join(APP_SRC, "App.css"), "utf8");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const files = [...sourceFiles(APP_SRC), ...sourceFiles(CORE_SRC)];
const sources = files.map((f) => ({ f, text: readFileSync(f, "utf8") }));

describe("text size reaches every font size", () => {
  it("every arbitrary px font size used in the app has a scaled rule in App.css", () => {
    const sizes = new Set<string>();
    for (const { text } of sources) {
      for (const m of text.matchAll(/(?<![\w:-])text-\[(\d+)px\]/g)) sizes.add(m[1]);
    }
    expect(sizes.size).toBeGreaterThan(0); // the walk itself works
    for (const px of sizes) {
      expect(CSS, `missing .text-\\[${px}px\\] rule`).toContain(
        `.text-\\[${px}px\\] { font-size: calc(${px}px * var(--nexus-text-scale, 1)); }`,
      );
    }
  });

  it("no arbitrary font size carries a variant (the unlayered override would beat it)", () => {
    for (const { f, text } of sources) {
      expect(text, f).not.toMatch(/[\w-]+:text-\[\d+px\]/);
    }
  });

  it("no line mixes an arbitrary size with a variant named size", () => {
    for (const { f, text } of sources) {
      for (const line of text.split("\n")) {
        if (/(?<![\w:-])text-\[\d+px\]/.test(line) && /\b[\w-]+:text-(xs|sm|base|lg|xl|\dxl)\b/.test(line)) {
          throw new Error(`${f}: ${line.trim()}`);
        }
      }
    }
  });
});

/** The oklch() values declared in one top-level block of App.css. */
function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  const body = CSS.slice(start, CSS.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*(oklch\([^)]*\))/g)) out[m[1]] = m[2];
  return out;
}

const ACCENT_TOKENS = /^--(primary|primary-foreground|ring|sidebar-primary|sidebar-primary-foreground|sidebar-ring|chart-\d)$/;

describe("colour themes keep the stylesheet's neutral lightness", () => {
  for (const [selector, dark] of [[":root", false], [".dark", true]] as const) {
    it(`${selector}: every neutral token a theme sets has the stylesheet's lightness`, () => {
      const sheet = block(selector);
      const theme = colorThemeTokens("blue", dark)!;
      let checked = 0;
      for (const [name, value] of Object.entries(theme)) {
        if (ACCENT_TOKENS.test(name)) continue;
        expect(sheet[name], `${name} missing from ${selector}`).toBeDefined();
        expect(oklchLightness(value), name).toBe(oklchLightness(sheet[name]));
        checked++;
      }
      expect(checked).toBeGreaterThan(10);
    });
  }
});
