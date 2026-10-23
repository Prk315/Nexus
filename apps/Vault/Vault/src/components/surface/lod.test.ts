import { describe, it, expect } from "vitest";
import {
  CARD_BELOW,
  cellRect,
  clampView,
  contentRect,
  describeSize,
  detailFor,
  fitView,
  gridExtent,
  isOnScreen,
  panBounds,
  PAN_MARGIN_CELLS,
  visibleIndices,
} from "./lod";
import { CELL_H, CELL_W, type Brick, type GridNode, type LeafNode } from "./model";
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
  it("is an exact multiple of the cell, in position and in size", () => {
    for (const pos of [
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 1, y: 0, w: 1, h: 1 },
      { x: 3, y: 2, w: 2, h: 4 },
    ]) {
      const r = cellRect(pos);
      expect(r.x % CELL_W).toBe(0);
      expect(r.y % CELL_H).toBe(0);
      expect(r.w % CELL_W).toBe(0);
      expect(r.h % CELL_H).toBe(0);
      expect(r.w / CELL_W).toBe(pos.w);
      expect(r.h / CELL_H).toBe(pos.h);
    }
  });

  it("tiles with no gap, so adjacent bricks share an edge", () => {
    const a = cellRect({ x: 0, y: 0, w: 2, h: 1 });
    const b = cellRect({ x: 2, y: 0, w: 1, h: 1 });
    expect(a.x + a.w).toBe(b.x); // no dead pixels between them
    const top = cellRect({ x: 0, y: 0, w: 1, h: 1 });
    const below = cellRect({ x: 0, y: 1, w: 1, h: 1 });
    expect(top.y + top.h).toBe(below.y);
  });

  it("measures a grid's content extent", () => {
    expect(gridExtent(2, 1)).toEqual({ x: 0, y: 0, w: 2 * CELL_W, h: CELL_H });
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

// ── Pan bounds ───────────────────────────────────────────────────────────────

function grid(children: Brick[], cols = 10, rows = 10): GridNode {
  return {
    kind: "grid", id: "g", pos: { x: 0, y: 0, w: cols, h: rows },
    viewport: "pan-zoom", cols, rows, children,
  };
}

describe("pan bounds", () => {
  it("measures the CONTENT, not the grid's declared extent", () => {
    // A 10×10 grid holding one brick in the top-left is 1×1 of content: panning
    // across nine empty columns to find nothing is the wasted space.
    const g = grid([leaf("a", 0, 0)], 10, 10);
    expect(contentRect(g)).toEqual({ x: 0, y: 0, w: CELL_W, h: CELL_H });
  });

  it("is null for an empty grid — no content is not content of zero size", () => {
    expect(contentRect(grid([]))).toBeNull();
    expect(panBounds(grid([]))).toBeNull();
  });

  it("spans the outermost bricks plus one cell on every side", () => {
    const g = grid([leaf("a", 1, 1), leaf("b", 3, 2, 2, 1)]);
    expect(contentRect(g)).toEqual({
      x: CELL_W, y: CELL_H, w: 4 * CELL_W, h: 2 * CELL_H,
    });
    expect(panBounds(g)).toEqual({
      x: 0, y: 0, w: 6 * CELL_W, h: 4 * CELL_H,
    });
    expect(PAN_MARGIN_CELLS).toBe(1);
  });
});

describe("clamping the view to the pan bounds", () => {
  const bounds = { x: 0, y: 0, w: 2000, h: 1500 };
  const viewport = { w: 800, h: 600 };

  it("refuses to pan past the leading edge", () => {
    // +500 would put the content's left edge 500px into the window.
    expect(clampView({ x: 500, y: 0, zoom: 1 }, bounds, viewport).x).toBe(0);
    expect(clampView({ x: 0, y: 900, zoom: 1 }, bounds, viewport).y).toBe(0);
  });

  it("refuses to pan past the trailing edge", () => {
    // The furthest left is the one that puts the right edge at the window's right.
    const v = clampView({ x: -9999, y: -9999, zoom: 1 }, bounds, viewport);
    expect(v.x).toBe(viewport.w - bounds.w); // -1200
    expect(v.y).toBe(viewport.h - bounds.h); // -900
  });

  it("leaves a view already inside the bounds untouched, by identity", () => {
    const v = { x: -100, y: -100, zoom: 1 };
    expect(clampView(v, bounds, viewport)).toBe(v);
  });

  it("centres content narrower than the viewport instead of pinning it", () => {
    const small = { x: 0, y: 0, w: 200, h: 100 };
    const v = clampView({ x: -500, y: -500, zoom: 1 }, small, viewport);
    expect(v.x).toBe((800 - 200) / 2);
    expect(v.y).toBe((600 - 100) / 2);
  });

  it("scales the limit with zoom — the bound is in content units", () => {
    const out = clampView({ x: -9999, y: 0, zoom: 0.5 }, bounds, viewport);
    expect(out.x).toBe(viewport.w - bounds.w * 0.5); // -200, not -1200
    // Zoomed far enough out the content is narrower than the window, so it centres.
    const tiny = clampView({ x: -9999, y: 0, zoom: 0.2 }, bounds, viewport);
    expect(tiny.x).toBe((800 - 2000 * 0.2) / 2);
  });

  it("does nothing before the viewport has been measured", () => {
    const v = { x: -9999, y: -9999, zoom: 1 };
    expect(clampView(v, bounds, { w: 0, h: 0 })).toBe(v);
    expect(clampView(v, null, viewport)).toBe(v);
  });
});

describe("zoom to fit", () => {
  const viewport = { w: 800, h: 600 };

  it("picks the scale at which the content just fits, and centres it", () => {
    const bounds = { x: 0, y: 0, w: 1600, h: 600 };
    const v = fitView(bounds, viewport);
    expect(v.zoom).toBe(0.5); // width binds: 800/1600
    expect(v.x).toBe(0);
    expect(v.y).toBe((600 - 600 * 0.5) / 2);
  });

  it("never zooms IN past 1 — a single small brick must not open at 3×", () => {
    expect(fitView({ x: 0, y: 0, w: 100, h: 100 }, viewport).zoom).toBe(1);
  });

  it("offsets by the content's origin, so a surface starting at cell 4 still centres", () => {
    const bounds = { x: 400, y: 200, w: 800, h: 600 };
    const v = fitView(bounds, viewport);
    expect(v.zoom).toBe(1);
    expect(v.x).toBe(-400);
    expect(v.y).toBe(-200);
  });

  it("falls back to the identity view when there is nothing to fit", () => {
    expect(fitView(null, viewport)).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(fitView({ x: 0, y: 0, w: 0, h: 0 }, viewport)).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(fitView({ x: 0, y: 0, w: 800, h: 600 }, { w: 0, h: 0 })).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it("leaves the result inside its own pan bounds", () => {
    const g = grid([leaf("a", 0, 0, 4, 3)]);
    const fitted = fitView(contentRect(g), viewport);
    expect(clampView(fitted, panBounds(g), viewport)).toEqual(fitted);
  });
});
