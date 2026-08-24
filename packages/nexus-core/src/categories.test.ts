import { describe, expect, it } from "vitest";
import { CATEGORIES, UNCATEGORIZED, categoryTotals, subtract } from "./categories";
import type { Span } from "./coverage";

const MIN = 60_000;
/** Minute-of-day (from an arbitrary epoch 0) to ms, for readable spans. */
const min = (m: number): number => m * MIN;
const window: Span = { start: min(0), end: min(24 * 60) };

describe("subtract", () => {
  it("removes the covering spans from within the given span", () => {
    const result = subtract({ start: min(0), end: min(60) }, [{ start: min(10), end: min(20) }]);
    expect(result).toEqual([
      { start: min(0), end: min(10) },
      { start: min(20), end: min(60) },
    ]);
  });
});

describe("categoryTotals", () => {
  it("clips every span to the window before counting", () => {
    const totals = categoryTotals({
      screen: [{ name: "Xcode", spans: [{ start: min(-10), end: min(20) }] }],
      planned: [],
      training: [],
      appMap: new Map([["Xcode", "Deep work"]]),
      window,
    });
    // Only the [0, 20] portion inside the window counts: 20 minutes.
    expect(totals.get("Deep work")).toBe(20 * 60);
  });

  it("sends unmapped apps to the Uncategorized pseudo-category (rule 1)", () => {
    const totals = categoryTotals({
      screen: [{ name: "SomeRandomApp", spans: [{ start: min(0), end: min(15) }] }],
      planned: [],
      training: [],
      appMap: new Map(), // no mapping at all
      window,
    });
    expect(totals.get(UNCATEGORIZED)).toBe(15 * 60);
    expect(totals.has("Deep work")).toBe(false);
  });

  it("falls back to a case-insensitive title-prefix match when category is null (rule 2)", () => {
    const totals = categoryTotals({
      screen: [],
      planned: [
        {
          category: null,
          title: "deep work: refactor the thing",
          span: { start: min(0), end: min(30) },
        },
      ],
      training: [],
      appMap: new Map(),
      window,
    });
    expect(totals.get("Deep work")).toBe(30 * 60);
  });

  it("ignores planned blocks whose title matches no category and has no category set", () => {
    const totals = categoryTotals({
      screen: [],
      planned: [
        { category: null, title: "Untitled block", span: { start: min(0), end: min(30) } },
      ],
      training: [],
      appMap: new Map(),
      window,
    });
    expect(totals.size).toBe(0);
  });

  it("subtracts screen evidence from a planned block's contribution (rule 3)", () => {
    const totals = categoryTotals({
      // Mapped to a different category so the subtraction's effect on
      // "Deep work" isn't muddied by the screen span also landing there.
      screen: [{ name: "Slack", spans: [{ start: min(10), end: min(20) }] }],
      planned: [
        { category: "Deep work", title: "Deep work", span: { start: min(0), end: min(60) } },
      ],
      training: [],
      appMap: new Map([["Slack", "Social"]]),
      window,
    });
    // 60 minutes planned, minus the 10-minute overlap with screen evidence.
    expect(totals.get("Deep work")).toBe(50 * 60);
    expect(totals.get("Social")).toBe(10 * 60);
  });

  it("unions overlapping spans within a category before summing (rule 5)", () => {
    const totals = categoryTotals({
      screen: [],
      // Planned "Training" block overlaps the Garmin session; both attribute
      // to Training. Naively summing would double-count the [20, 30] overlap.
      planned: [
        { category: "Training", title: "Training", span: { start: min(20), end: min(50) } },
      ],
      training: [{ start: min(0), end: min(30) }],
      appMap: new Map(),
      window,
    });
    // union([0,30], [20,50]) = [0,50] = 50 minutes, not 30 + 30 = 60.
    expect(totals.get("Training")).toBe(50 * 60);
  });

  it("never receives Sleep as an input (rule 6, contract check)", () => {
    // categoryTotals has no `sleep` field in its input type at all — this
    // test exists so a future edit that adds one gets noticed in review.
    const totals = categoryTotals({
      screen: [],
      planned: [],
      training: [],
      appMap: new Map(),
      window,
    });
    expect(totals.has("Rest")).toBe(false);
  });

  // ── Nested blocks: children win, parent keeps only its remainder ────────
  // (PathFinder Week's nested cal blocks — a Deep-work segment scheduled
  // inside an Errands "transport" block.)

  it("does not double-count a nested child of a DIFFERENT category — parent keeps its remainder (rule 0)", () => {
    const totals = categoryTotals({
      screen: [],
      planned: [
        // Errands 10:00-13:00 (180min), Deep work child 11:00-11:45 (45min) inside it.
        { id: "p1", parentId: null, category: "Errands", title: "Transport", span: { start: min(600), end: min(780) } },
        { id: "c1", parentId: "p1", category: "Deep work", title: "School work", span: { start: min(660), end: min(705) } },
      ],
      training: [],
      appMap: new Map(),
      window,
    });
    expect(totals.get("Errands")).toBe((180 - 45) * 60);
    expect(totals.get("Deep work")).toBe(45 * 60);
  });

  it("a child of the SAME category as its parent still unions to the full span, not double the overlap (rule 0)", () => {
    const totals = categoryTotals({
      screen: [],
      planned: [
        // Deep work parent 10:00-12:00 (120min), Deep work child 10:30-10:45 (15min) inside it.
        { id: "p1", parentId: null, category: "Deep work", title: "Focus block", span: { start: min(600), end: min(720) } },
        { id: "c1", parentId: "p1", category: "Deep work", title: "Sub-focus", span: { start: min(630), end: min(645) } },
      ],
      training: [],
      appMap: new Map(),
      window,
    });
    // Parent remainder [600,630)+[645,720) union child [630,645) = one
    // contiguous [600,720) = 120 minutes, not 105 + 15 double-counted as if
    // they were unrelated same-category spans (they aren't — this IS the
    // "still correct" case, just arriving at the same number a non-nested
    // reading of the parent's un-reduced span also would).
    expect(totals.get("Deep work")).toBe(120 * 60);
  });

  it("recurses through a grandchild — each node subtracts only its own DIRECT children (rule 0)", () => {
    const totals = categoryTotals({
      screen: [],
      planned: [
        // Errands parent 10:00-13:00 (180min).
        { id: "p1", parentId: null, category: "Errands", title: "Transport", span: { start: min(600), end: min(780) } },
        // Deep work child of the parent, 10:30-12:30 (120min).
        { id: "c1", parentId: "p1", category: "Deep work", title: "School work", span: { start: min(630), end: min(750) } },
        // Social grandchild of the CHILD (not the parent), 11:00-11:15 (15min).
        { id: "g1", parentId: "c1", category: "Social", title: "Text a friend", span: { start: min(660), end: min(675) } },
      ],
      training: [],
      appMap: new Map(),
      window,
    });
    // Grandchild attributes fully as itself.
    expect(totals.get("Social")).toBe(15 * 60);
    // Child keeps its span minus its OWN direct child (the grandchild): 120 - 15.
    expect(totals.get("Deep work")).toBe((120 - 15) * 60);
    // Parent keeps its span minus its OWN direct child's ORIGINAL (un-reduced)
    // span — the child's full 120 minutes already covers the grandchild's
    // time too, so the parent excludes both in one subtraction: 180 - 120.
    expect(totals.get("Errands")).toBe((180 - 120) * 60);
    // No time lost and none double-counted across the three: 15+105+60=180.
    const sum = (totals.get("Social") ?? 0) + (totals.get("Deep work") ?? 0) + (totals.get("Errands") ?? 0);
    expect(sum).toBe(180 * 60);
  });

  it("a block with no id is simply never subtracted from, even if something claims it as a parent (defensive)", () => {
    const totals = categoryTotals({
      screen: [],
      planned: [
        // No `id` at all — pre-nesting callers keep working unchanged.
        { category: "Errands", title: "Transport", span: { start: min(600), end: min(780) } },
      ],
      training: [],
      appMap: new Map(),
      window,
    });
    expect(totals.get("Errands")).toBe(180 * 60);
  });

  it("seeds the same names the coverage_categories migration expects", () => {
    expect(CATEGORIES.map((c) => c.name)).toEqual([
      "Deep work",
      "Training",
      "Reading",
      "Social",
      "Errands",
      "Meals",
      "Rest",
    ]);
  });
});
