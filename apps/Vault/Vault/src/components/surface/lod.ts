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

import { CELL_H, CELL_W, GAP, type Brick, type Pos } from "./model";
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

/** A brick's rectangle in its grid's own content space (px at zoom 1). */
export function cellRect(pos: Pos, cellW = CELL_W, cellH = CELL_H, gap = GAP): Rect {
  return {
    x: pos.x * (cellW + gap),
    y: pos.y * (cellH + gap),
    w: pos.w * cellW + (pos.w - 1) * gap,
    h: pos.h * cellH + (pos.h - 1) * gap,
  };
}

/** Content extent of a grid with `cols`×`rows` cells, in px at zoom 1. */
export function gridExtent(cols: number, rows: number, cellW = CELL_W, cellH = CELL_H, gap = GAP): Rect {
  return { x: 0, y: 0, w: cols * cellW + (cols - 1) * gap, h: rows * cellH + (rows - 1) * gap };
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
