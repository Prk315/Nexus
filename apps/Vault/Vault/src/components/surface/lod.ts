// Rule 3: level of detail.
//
// Two independent decisions, both pure, both cheap enough to run on every
// render of every grid:
//
//   detailFor(effectiveZoom)  — WHAT a leaf draws. Below the threshold a leaf
//                               is a card (name, renderer, size) built from its
//                               saved state, never from its live viewer.
//   visibleIndices(...)       — WHETHER a child is in the DOM at all. Off-screen
//                               bricks unmount.
//
// The second is the one that matters for a surface that will eventually hold a
// PDF reader and two canvases: a viewer that is merely hidden still holds its
// worker, its pdfjs document and its listeners. The threshold is crude on
// purpose — the wiring is the thing being built, and a better curve is a tuning
// change to one constant rather than a change to any caller.

import {
  CELL_H,
  CELL_W,
  contentBounds,
  MAX_ZOOM,
  MIN_ZOOM,
  type Brick,
  type GridNode,
  type Pos,
} from "./model";
// Type-only, so it is erased and focus.ts → lod.ts stays a one-way runtime edge.
import type { View } from "./focus";

export type Detail = "full" | "card";

/**
 * Below this effective scale a leaf is not worth rendering for real: at 0.5 a
 * 320px cell is 160px wide, which is a thumbnail, and a note editor drawn into
 * it is unreadable AND expensive.
 */
export const CARD_BELOW = 0.55;

export function detailFor(effectiveZoom: number): Detail {
  return effectiveZoom < CARD_BELOW ? "card" : "full";
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A brick's rectangle in its grid's own content space (px at zoom 1).
 *
 * Exact multiples of the cell, in both position and size, because there is no
 * gap — see the geometry note in model.ts. That is what lets a brick fill whole
 * cells with nothing left over, and what makes the cell lines drawn under a
 * brick line up with its edges.
 */
export function cellRect(pos: Pos, cellW = CELL_W, cellH = CELL_H): Rect {
  return {
    x: pos.x * cellW,
    y: pos.y * cellH,
    w: pos.w * cellW,
    h: pos.h * cellH,
  };
}

/** Content extent of a grid with `cols`×`rows` cells, in px at zoom 1. */
export function gridExtent(cols: number, rows: number, cellW = CELL_W, cellH = CELL_H): Rect {
  return { x: 0, y: 0, w: cols * cellW, h: rows * cellH };
}

/**
 * Is `rect` (content space) inside the viewport once `view` is applied?
 *
 * The transform is `translate(view.x, view.y) scale(view.zoom)` with origin at
 * the top-left, so a content point p lands at `p * zoom + view.{x,y}`.
 *
 * `margin` is in SCREEN px: a band around the viewport that stays mounted, so
 * a brick is not torn down and rebuilt while you nudge the surface back and
 * forth across its edge.
 */
export function isOnScreen(
  rect: Rect,
  view: View,
  viewport: { w: number; h: number },
  margin = 256
): boolean {
  const left = rect.x * view.zoom + view.x;
  const top = rect.y * view.zoom + view.y;
  const right = left + rect.w * view.zoom;
  const bottom = top + rect.h * view.zoom;
  return (
    right >= -margin &&
    bottom >= -margin &&
    left <= viewport.w + margin &&
    top <= viewport.h + margin
  );
}

/**
 * Indices of the children worth mounting.
 *
 * A viewport of zero area means "not measured yet" — the ResizeObserver has not
 * fired on the first paint. Culling everything then would mount nothing on the
 * first frame and flash the whole surface in on the second, so an unmeasured
 * viewport keeps everything.
 */
export function visibleIndices(
  children: Brick[],
  view: View,
  viewport: { w: number; h: number },
  margin = 256
): number[] {
  if (viewport.w <= 0 || viewport.h <= 0) return children.map((_, i) => i);
  const out: number[] = [];
  children.forEach((c, i) => {
    if (isOnScreen(cellRect(c.pos), view, viewport, margin)) out.push(i);
  });
  return out;
}

/** Human-readable size for a placeholder card: "2 × 1 cells". */
export function describeSize(pos: Pos): string {
  return `${pos.w} × ${pos.h} cells`;
}

// ── Pan bounds ───────────────────────────────────────────────────────────────
//
// You cannot pan past the outermost bricks, plus one cell of breathing room.
//
// The limit is the CONTENT's bounding box, not the grid's `cols`×`rows` extent:
// a grid that grew to 8 rows because a brick was added and then moved back is
// still only as big as what is in it, and panning across four empty rows to
// find nothing is exactly the wasted space this rule exists to remove.

export const PAN_MARGIN_CELLS = 1;

/** Bounding box of a grid's bricks, in px at zoom 1. Null when it has none. */
export function contentRect(grid: GridNode, cellW = CELL_W, cellH = CELL_H): Rect | null {
  const cells = contentBounds(grid);
  return cells ? cellRect(cells, cellW, cellH) : null;
}

/**
 * `contentRect` expanded by one cell on every side — the pan limit.
 *
 * The margin is what stops the outermost brick sitting flush against the window
 * edge with nothing to grab, and it is one CELL rather than a pixel count so it
 * means the same thing at every zoom.
 */
export function panBounds(grid: GridNode, cellW = CELL_W, cellH = CELL_H): Rect | null {
  const r = contentRect(grid, cellW, cellH);
  if (!r) return null;
  const mx = PAN_MARGIN_CELLS * cellW;
  const my = PAN_MARGIN_CELLS * cellH;
  return { x: r.x - mx, y: r.y - my, w: r.w + 2 * mx, h: r.h + 2 * my };
}

// `-b0 * zoom` is -0 whenever the bounds start at the origin, which is the
// common case. -0 compares equal to 0 under ===, so nothing breaks — but it
// serialises as "-0" and reads as a bug in every debug print, so it is
// normalised once here rather than explained at each call site.
const noNegZero = (n: number) => (n === 0 ? 0 : n);

function clampAxis(v: number, b0: number, bSize: number, viewportSize: number, zoom: number): number {
  const span = bSize * zoom;
  // Content narrower than the viewport: there is nothing to scroll, so centre it
  // rather than letting it sit against an edge. A range clamp here would invert
  // (lo > hi) and pick whichever bound was written first, which is arbitrary.
  if (span <= viewportSize) return noNegZero((viewportSize - span) / 2 - b0 * zoom);
  const hi = -b0 * zoom; // content's leading edge at the viewport's leading edge
  const lo = viewportSize - (b0 + bSize) * zoom; // trailing edge at trailing edge
  return noNegZero(Math.min(hi, Math.max(lo, v)));
}

/**
 * Hold a view inside its pan bounds.
 *
 * Applied to pan AND to zoom: zooming out enlarges the viewport in content
 * terms, so a view that was legal at 100% can be far outside the bounds at 30%,
 * and clamping only on pan would let the wheel walk around that.
 *
 * An unmeasured viewport (0×0, before the ResizeObserver fires) returns the
 * view untouched — clamping against a zero-sized window would centre everything
 * on the first frame and then jump.
 */
export function clampView(
  view: View,
  bounds: Rect | null,
  viewport: { w: number; h: number }
): View {
  if (!bounds || viewport.w <= 0 || viewport.h <= 0) return view;
  const x = clampAxis(view.x, bounds.x, bounds.w, viewport.w, view.zoom);
  const y = clampAxis(view.y, bounds.y, bounds.h, viewport.h, view.zoom);
  if (x === view.x && y === view.y) return view;
  return { ...view, x, y };
}

/**
 * Zoom-to-fit: the scale at which `bounds` just fits, centred.
 *
 * Capped at 1 by default — fitting a single small brick would otherwise open
 * the surface at 3× and read as broken rather than as helpful.
 */
export function fitView(
  bounds: Rect | null,
  viewport: { w: number; h: number },
  maxZoom = 1
): View {
  if (!bounds || bounds.w <= 0 || bounds.h <= 0 || viewport.w <= 0 || viewport.h <= 0) {
    return { x: 0, y: 0, zoom: 1 };
  }
  const raw = Math.min(maxZoom, viewport.w / bounds.w, viewport.h / bounds.h);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, raw));
  return {
    zoom,
    x: (viewport.w - bounds.w * zoom) / 2 - bounds.x * zoom,
    y: (viewport.h - bounds.h * zoom) / 2 - bounds.y * zoom,
  };
}
