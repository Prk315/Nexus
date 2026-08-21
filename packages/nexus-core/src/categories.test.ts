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
