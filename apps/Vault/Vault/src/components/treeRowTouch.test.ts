import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// A ratchet on the rule that two book nodes were deleted for want of.
//
// The sidebar row's ⇄ ★ ⊘ × buttons are `visibility: hidden` and revealed by
// `.tree-item:hover` / `.tree-item.active`. Two properties of that combine into
// a delete gesture nobody asked for:
//
//   1. `visibility` RESERVES layout space, so × sits in a fixed slot in the row
//      whether or not it can be seen.
//   2. iOS applies a sticky `:hover` to whatever was just tapped, and `onSelect`
//      sets `.active` on the same tap.
//
// `.tree-label` is `flex: 1`, so the right-hand end of a row is still the label
// — and a double-tap there reveals × on the first tap and PRESSES it on the
// second. On an iPad that deleted two book nodes, with no backups on the free
// Supabase tier to restore them from.
//
// The fix is in `@media (hover: none)`: the row keeps only ⋯, and every action
// moves into its menu. This asserts the two ways that fix silently rots.

// Comments are stripped first: a rule's selector capture would otherwise swallow
// the comment block sitting above it, and every exact-selector comparison below
// would miss on whichever selector happened to be documented.
const CSS = readFileSync(resolve(__dirname, "../App.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** The bodies of every `@media` block whose query mentions `hover: none`. */
function hoverNoneBlocks(css: string): string {
  const out: string[] = [];
  const re = /@media[^{]*hover:\s*none[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    // Walk braces from the opening one so a nested rule can't end the block early.
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    out.push(css.slice(start, i - 1));
  }
  if (out.length === 0) throw new Error("App.css has no `@media (hover: none)` block — the touch guard is gone");
  return out.join("\n");
}

/** Selectors of rules in `css` whose body contains `decl`. */
function selectorsDeclaring(css: string, decl: RegExp): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    if (decl.test(m[2])) {
      for (const sel of m[1].split(",")) {
        const s = sel.trim().replace(/\s+/g, " ");
        if (s && !s.startsWith("@")) out.push(s);
      }
    }
  }
  return out;
}

// The row surfaces TreeRow actually renders. `.connections li:hover
// .delete-btn` also exists in App.css but nothing renders `.connections` any
// more (grep the components — zero hits), so there is no row there to protect.
const ROW_SURFACES = [".tree-item", ".node-list li"] as const;

// The destructive and near-destructive row controls. ⇄ share and ★ favourite
// are reversible in one tap and are excluded; ⊘ unlink is not — it strands a
// node at the root, where nothing names the parent it came from.
const GUARDED = [".delete-btn", ".unlink-btn"] as const;

describe("tree row actions on a touch pointer", () => {
  const touch = hoverNoneBlocks(CSS);
  const hidden = new Set(selectorsDeclaring(touch, /display:\s*none/));

  for (const btn of GUARDED) {
    it(`${btn} is never revealed on a touch pointer`, () => {
      // Every selector in the stylesheet that makes this button visible on a
      // row TreeRow renders.
      const revealed = selectorsDeclaring(CSS, /visibility:\s*visible/)
        .filter(s => s.includes(btn) && ROW_SURFACES.some(r => s.startsWith(r)));

      expect(revealed.length, `nothing reveals ${btn} any more — has the row changed shape?`)
        .toBeGreaterThan(0);

      // Coverage is per STATE, not by specificity: `display: none` and
      // `visibility: visible` are different properties and never compete, so a
      // hide rule only helps on the rows its own selector matches. Dropping
      // `.tree-item.active .delete-btn` from the touch block leaves × visible on
      // an `.active` row that is not also `:hover` — which, since the first tap
      // sets `.active`, is the whole bug. Hence an exact-selector check.
      for (const sel of revealed) {
        expect(
          hidden.has(sel),
          `${sel} reveals ${btn}, but \`@media (hover: none)\` has no ` +
          `\`${sel} { display: none }\` — the button stays reachable in that state`,
        ).toBe(true);
      }
    });
  }

  it("⋯ stays visible, because it is the only way to reach the hidden actions", () => {
    // Hiding the row's actions is only safe if the menu holding them can be
    // opened without a hover. A hover-gated ⋯ on a touch screen is a row with
    // no actions at all.
    const forced = new Set(
      selectorsDeclaring(touch, /visibility:\s*visible/).filter(s => s.includes(".node-menu-btn")),
    );
    expect(forced.size, "⋯ is not forced visible in the touch block").toBeGreaterThan(0);

    // And the unconditional form has to be there, or ⋯ is only visible in the
    // states the row was already in.
    expect(forced.has(".tree-item .node-menu-btn")).toBe(true);
  });

  it("the menu's touch-only action list is shown on a touch pointer and hidden otherwise", () => {
    expect(/\.node-menu-touch-actions\s*\{[^}]*display:\s*none/.test(CSS)).toBe(true);
    expect(/\.node-menu-touch-actions\s*\{\s*display:\s*flex/.test(touch)).toBe(true);
  });
});
