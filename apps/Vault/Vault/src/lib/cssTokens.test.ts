import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// A ratchet on App.css.
//
// Vault's stylesheet grew two disjoint palettes: the oklch scale on `:root`, and
// a hex palette that predates it. Measured before tokenising, only 1 of 234
// colour literals outside `:root` matched any token — they were not
// untokenised references to the scale, they were a second scale.
//
// The fifteen colours below each appeared three or more times, so they mean
// something, and they now have names. This asserts they stay named: the failure
// this prevents is somebody pasting `#3b82f6` into a new rule instead of
// `var(--accent)`, which re-forks the palette one line at a time and is
// invisible in review.
//
// It deliberately does NOT police the 92 colours used exactly once. A token used
// once is a rename, not an abstraction, and naming them is a design decision
// rather than a cleanup.

const CSS = readFileSync(resolve(__dirname, "../App.css"), "utf8");

/** Everything outside the `:root` block — where the declarations live. */
function outsideRoot(css: string): string {
  const root = /^:root\s*\{[\s\S]*?^\}/m.exec(css);
  if (!root) throw new Error("App.css has no :root block — the token table is gone");
  return css.slice(0, root.index) + css.slice(root.index + root[0].length);
}

const NAMED: Record<string, string> = {
  "--accent": "#3b82f6",
  "--accent-pdf": "#4f8ef7",
  "--on-accent": "#fff",
  "--danger-solid": "#ef4444",
  "--danger-pdf": "#e74c3c",
  "--danger-tint": "#fef2f2",
  "--handle": "#14b8a6",
  "--star": "#f59e0b",
  "--tool-canvas": "#5aa8d8",
  "--chem": "#16a34a",
  "--slate": "#475569",
  "--grey-mid": "#999",
  "--grey-strong": "#111",
  "--border-legacy": "#e2e2e6",
  "--tint-faint": "rgba(0,0,0,0.02)",
};

describe("App.css colour tokens", () => {
  it("declares every named colour on :root", () => {
    for (const [name, value] of Object.entries(NAMED)) {
      expect(CSS, `${name} is missing from :root`).toContain(`${name}: ${value};`);
    }
  });

  it("never writes a named colour as a literal outside :root", () => {
    const body = outsideRoot(CSS);
    const offenders: string[] = [];
    for (const [name, value] of Object.entries(NAMED)) {
      // Word boundary for hex so #111 does not match inside #1111ff.
      const re = new RegExp(value.startsWith("#") ? `${value}\\b` : value.replace(/[().]/g, "\\$&"), "g");
      const hits = body.match(re);
      if (hits) offenders.push(`${value} (${hits.length}x) — use var(${name})`);
    }
    expect(offenders, `hardcoded colours that already have a token:\n  ${offenders.join("\n  ")}`)
      .toEqual([]);
  });

  it("does not let the untokenised surface grow", () => {
    // 234 before, 130 after. A ceiling rather than an exact number: adding a
    // genuinely new one-off colour is allowed, re-forking the palette is not.
    const literals = outsideRoot(CSS).match(/oklch\([^)]*\)|#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? [];
    expect(literals.length).toBeLessThanOrEqual(130);
  });
});
