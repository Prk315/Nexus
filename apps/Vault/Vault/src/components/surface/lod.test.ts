import { describe, it, expect } from "vitest";
import {
  CARD_BELOW,
  cellRect,
  describeSize,
  detailFor,
  gridExtent,
  isOnScreen,
  visibleIndices,
} from "./lod";
import { CELL_H, CELL_W, GAP, type Brick, type LeafNode } from "./model";
import { DEFAULT_VIEW, effectiveZoom, initialState, reduceAll, type View } from "./focus";

function leaf(id: string, x: number, y: number, w = 1, h = 1): LeafNode {
  return { kind: "leaf", id, pos: { x, y, w, h }, renderer: "placeholder" };
}

describe("detail threshold", () => {
  it("draws a card below the threshold and the real component at or above it", () => {
    expect(detailFor(1)).toBe("full");
    expect(detailFor(CARD_BELOW)).toBe("full");
    expect(detailFor(CARD_BELOW - 0.01)).toBe("card");
    expect(detailFor(0.2)).toBe("card");
  });

  it("is driven by the EFFECTIVE zoom, so zooming the root cards a nested leaf", () => {
    const state = initialState({
      v: 1,
      root: {
        kind: "grid", id: "root", pos: { x: 0, y: 0, w: 4, h: 4 },
        viewport: "pan-zoom", cols: 4, rows: 4,
        children: [{
          kind: "grid", id: "inner", pos: { x: 0, y: 0, w: 2, h: 2 },
          viewport: "pan-zoom", cols: 2, rows: 2, children: [leaf("a", 0, 0)],
        }],
      },
    });
    // The inner container's OWN zoom never changes; only the root's does.
    const zoomedOut = reduceAll(state, [{ type: "zoom", factor: 0.5, ox: 0, oy: 0 }]);
    expect(effectiveZoom(zoomedOut.focus, [0])).toBe(0.5);
    expect(detailFor(effectiveZoom(zoomedOut.focus, [0]))).toBe("card");
    expect(detailFor(effectiveZoom(state.focus, [0]))).toBe("full");
  });
});

describe("cell geometry", () => {
  it("places a 1×1 brick at the origin and spans gaps for larger ones", () => {
    expect(cellRect({ x: 0, y: 0, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: CELL_W, h: CELL_H });
    expect(cellRect({ x: 1, y: 0, w: 1, h: 1 })).toEqual({
      x: CELL_W + GAP, y: 0, w: CELL_W, h: CELL_H,
    });
    // A 2-wide brick swallows the gap between its two cells.
    expect(cellRect({ x: 0, y: 0, w: 2, h: 1 }).w).toBe(2 * CELL_W + GAP);
  });

  it("measures a grid's content extent", () => {
    expect(gridExtent(2, 1)).toEqual({ x: 0, y: 0, w: 2 * CELL_W + GAP, h: CELL_H });
  });

  it("describes a size for the placeholder card", () => {
    expect(describeSize({ x: 3, y: 1, w: 2, h: 1 })).toBe("2 × 1 cells");
  });
});

describe("off-screen culling", () => {
  const viewport = { w: 800, h: 600 };

  it("keeps a brick under the viewport and drops one far outside", () => {
    expect(isOnScreen(cellRect({ x: 0, y: 0, w: 1, h: 1 }), DEFAULT_VIEW, viewport, 0)).toBe(true);
    expect(isOnScreen(cellRect({ x: 20, y: 0, w: 1, h: 1 }), DEFAULT_VIEW, viewport, 0)).toBe(false);
  });

  it("follows the pan: what was off to the right comes on when you pan left", () => {
    const rect = cellRect({ x: 4, y: 0, w: 1, h: 1 }); // x = 4*(320+12) = 1328
    expect(isOnScreen(rect, DEFAULT_VIEW, viewport, 0)).toBe(false);
    const panned: View = { x: -1200, y: 0, zoom: 1 };
    expect(isOnScreen(rect, panned, viewport, 0)).toBe(true);
  });

  it("follows the zoom: zooming out brings more of the surface into view", () => {
    const rect = cellRect({ x: 4, y: 0, w: 1, h: 1 });
    expect(isOnScreen(rect, { x: 0, y: 0, zoom: 1 }, viewport, 0)).toBe(false);
    expect(isOnScreen(rect, { x: 0, y: 0, zoom: 0.5 }, viewport, 0)).toBe(true);
  });

  it("holds a band around the viewport so a nudge does not remount a viewer", () => {
    // 100px off the right edge: culled with no margin, kept with the default one.
    const rect = { x: 900, y: 0, w: 200, h: 200 };
    expect(isOnScreen(rect, DEFAULT_VIEW, viewport, 0)).toBe(false);
    expect(isOnScreen(rect, DEFAULT_VIEW, viewport)).toBe(true);
  });

  it("mounts everything before the viewport has been measured", () => {
    const children: Brick[] = [leaf("a", 0, 0), leaf("b", 50, 50)];
    expect(visibleIndices(children, DEFAULT_VIEW, { w: 0, h: 0 })).toEqual([0, 1]);
  });

  it("returns the indices actually worth mounting", () => {
    const children: Brick[] = [leaf("a", 0, 0), leaf("far", 40, 0), leaf("b", 1, 0)];
    expect(visibleIndices(children, DEFAULT_VIEW, viewport, 0)).toEqual([0, 2]);
  });
});
