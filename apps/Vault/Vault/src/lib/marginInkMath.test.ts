import { describe, expect, it } from "vitest";
import { coalescedOf, emaNext, pressureOf, segmentWidths } from "./marginInkMath";

describe("coalescedOf", () => {
  // ⚠️ The empty-array trap is the reason this helper exists: `?? [e]` does
  // not cover a coalesced list that came back [], and a move contributing no
  // points reads as dropped ink on fast strokes.
  it("falls back to the parent event when the list is EMPTY, not only when absent", () => {
    const e = { getCoalescedEvents: () => [] } as unknown as PointerEvent;
    expect(coalescedOf(e)).toEqual([e]);
  });
  it("falls back when the API is missing entirely", () => {
    const e = {} as PointerEvent;
    expect(coalescedOf(e)).toEqual([e]);
  });
  it("passes a populated list through", () => {
    const a = {} as PointerEvent, b = {} as PointerEvent;
    const e = { getCoalescedEvents: () => [a, b] } as unknown as PointerEvent;
    expect(coalescedOf(e)).toEqual([a, b]);
  });
});

describe("pressureOf", () => {
  it("maps the mouse's 0 to the neutral 0.5, not to an invisible stroke", () => {
    expect(pressureOf({ pressure: 0 })).toBe(0.5);
  });
  it("passes real pen pressure through", () => {
    expect(pressureOf({ pressure: 0.83 })).toBe(0.83);
  });
});

describe("emaNext", () => {
  it("converges toward the input without jumping to it", () => {
    let p = 0.5;
    p = emaNext(p, 1);
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(1);
    for (let i = 0; i < 40; i++) p = emaNext(p, 1);
    expect(p).toBeCloseTo(1, 2);
  });
  it("is the identity at the fixpoint", () => {
    expect(emaNext(0.7, 0.7)).toBe(0.7);
  });
});

describe("segmentWidths", () => {
  // The bug this guards against: one stroke() call per path means one
  // lineWidth per path — variable width REQUIRES per-segment widths, and a
  // renderer that stops consuming them regresses to uniform strokes with no
  // visual test to catch it. At least assert the widths themselves vary.
  it("varies with pressure along the stroke", () => {
    const pts = [0, 0, 0.2, 10, 0, 0.5, 20, 0, 0.9];
    const w = segmentWidths(pts, 2);
    expect(w).toHaveLength(2);
    expect(w[1]).toBeGreaterThan(w[0]);
  });
  it("never goes below the visibility floor", () => {
    const pts = [0, 0, 0, 1, 1, 0];
    expect(segmentWidths(pts, 0.1)[0]).toBe(0.5);
  });
  it("returns one width per segment", () => {
    const pts = new Array(5 * 3).fill(0.5);
    expect(segmentWidths(pts, 2)).toHaveLength(4);
  });
});
