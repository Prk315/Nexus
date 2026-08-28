import { describe, it, expect } from "vitest";
import { buildBlockRegistry, type BlockAction } from "./blockRegistry";
import { ICON_NAMES, type IconName } from "./icons";

// Built with EVERY gated action present. `buildBlockRegistry({})` leaves out
// the link dialog, the database insert, image picking, both maths and all the
// highlighters — which is most of the icons, and a coverage test that skips
// what it is meant to cover is worse than none.
const actions = buildBlockRegistry({
  onDatabaseInsert: () => {},
  onInlineMath: () => {},
  onBlockMath: () => {},
  onEditLink: () => {},
  onPickImage: () => {},
  onApplyHighlighter: () => {},
  onEditHighlighters: () => {},
  highlighters: [
    { name: "key", color: "#ff0" },
    { name: "term", color: "#0ff" },
  ] as never,
});

// Families where several actions share one icon ON PURPOSE, because something
// else is the differentiator: the swatch's colour, the face the button is set
// in, the label beside it in a menu. Anything not listed here that collides is
// the `⌄`-means-two-things bug coming back.
const SHARED: Array<{ icon: IconName; prefix: string; why: string }> = [
  { icon: "swatch", prefix: "cardColor:", why: "the swatch IS the colour" },
  { icon: "textColor", prefix: "color:", why: "the button is set in the colour" },
  { icon: "font", prefix: "font:", why: "the button is set in the face" },
  { icon: "language", prefix: "codeLang:", why: "the language name is the label" },
  { icon: "container", prefix: "container:", why: "the style name is the label" },
  { icon: "columns", prefix: "columns:", why: "the count is the label" },
  { icon: "highlighter", prefix: "highlight:", why: "the category name is the label" },
  { icon: "pageTextLarge", prefix: "noteText:", why: "four note sizes on a three-step scale" },
];

describe("every action has an icon from the set", () => {
  // ⚠️ The point of asserting this rather than allowing the fallback: a single
  // Unicode glyph among sixty SVGs is MORE obviously wrong than sixty
  // inconsistent glyphs were. One bad icon set beats two at once, so the mixed
  // state is refused here rather than appearing quietly in one surface.
  it("leaves nothing on the legacy glyph", () => {
    const missing = actions.filter((a) => !a.iconName).map((a) => a.id);
    expect(missing, `actions with no iconName: ${missing.join(", ")}`).toEqual([]);
  });

  it("names only icons that exist", () => {
    const unknown = actions
      .filter((a) => a.iconName && !ICON_NAMES.includes(a.iconName))
      .map((a) => `${a.id}→${a.iconName}`);
    expect(unknown, `unknown icon names: ${unknown.join(", ")}`).toEqual([]);
  });
});

describe("no two unrelated actions share an icon", () => {
  // ⚠️ The bug this is really for. Before the set, `⌄` was BOTH "fold this
  // heading" and "unfold everything" — two opposite actions, one glyph — and
  // `▭` was all four container styles as well as a note width. Neither is
  // visible in review; both are obvious the moment you look for them.
  it("collides only within a declared family", () => {
    const byIcon = new Map<IconName, BlockAction[]>();
    for (const a of actions) {
      if (!a.iconName) continue;
      byIcon.set(a.iconName, [...(byIcon.get(a.iconName) ?? []), a]);
    }

    const bad: string[] = [];
    for (const [icon, group] of byIcon) {
      if (group.length < 2) continue;
      const family = SHARED.find((f) => f.icon === icon);
      if (family && group.every((a) => a.id.startsWith(family.prefix))) continue;
      bad.push(`${icon}: ${group.map((a) => a.id).join(", ")}`);
    }
    expect(bad, `icons used by unrelated actions:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it("keeps the declared families honest", () => {
    // A family listed here that no longer shares an icon is a stale exemption,
    // and a stale exemption is a hole the next collision walks through.
    const stale = SHARED.filter(
      (f) => actions.filter((a) => a.iconName === f.icon).length < 2,
    ).map((f) => `${f.icon} (${f.why})`);
    expect(stale, `exemptions that no longer apply: ${stale.join(", ")}`).toEqual([]);
  });
});

describe("the set itself", () => {
  it("has no icon nobody uses", () => {
    // Not a style rule: an unused icon is a name someone will reach for and
    // find drawn for a different purpose than they expect.
    const used = new Set(actions.map((a) => a.iconName));
    const unused = ICON_NAMES.filter((n) => !used.has(n));
    expect(unused, `icons defined but unused: ${unused.join(", ")}`).toEqual([]);
  });
});
