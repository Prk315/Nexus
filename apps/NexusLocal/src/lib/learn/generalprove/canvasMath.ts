/**
 * canvasMath.ts — pure, React-free geometry for the Generalprøve canvas
 * (`GeneralproveSession.tsx`). Same precedent as `timetracker/coverage.ts`:
 * everything here is unit-testable math with no DOM, no state, no fetches.
 *
 * The coordinate model, pinned because it is the classic bug in this pattern:
 *
 *   - `View.x`/`View.y` are SCREEN pixels (the transform layer's translate),
 *     `View.k` is scale. Panning therefore adds RAW client deltas to x/y —
 *     never divided by k.
 *   - Card positions are CANVAS coordinates (inside the scaled layer), so a
 *     card drag adds `clientDelta / k`.
 *   Mixing the two up makes dragging feel "slippery" at any zoom ≠ 1.
 */

export interface View {
  /** Screen-space translate, px. */
  x: number;
  y: number;
  /** Scale factor. */
  k: number;
}

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 2.5;
/** Card stock width in canvas units — Tailwind `w-60`. */
export const CARD_W = 240;
/** Default card height until the ResizeObserver has measured the real one. */
export const CARD_DEFAULT_H = 96;
/** Perpendicular bow of a user arrow's quadratic curve, as a fraction of the
 * chord length. */
export const CURVE_BOW = 0.18;

/** Screen point (relative to the surface's top-left) → canvas coordinates. */
export const toCanvas = (px: number, py: number, v: View) => ({
  x: (px - v.x) / v.k,
  y: (py - v.y) / v.k,
});

/** Key encoding for a prereq edge — NUL-separated so no concept id can
 * collide. Shared by `deriveAutoEdges` and the session's `pairs` set. */
export const edgeKey = (prereqId: string, conceptId: string) => `${prereqId}\u0000${conceptId}`;

export const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** Zoom about a screen-space anchor, keeping that point fixed. */
export function zoomAt(v: View, anchorX: number, anchorY: number, factor: number): View {
  const k = clampZoom(v.k * factor);
  const s = k / v.k;
  return { k, x: anchorX - (anchorX - v.x) * s, y: anchorY - (anchorY - v.y) * s };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Intersection of the centre→centre ray with `from`'s border, so arrows
 * touch card edges instead of burrowing to their centres. Degenerate case
 * (coincident centres) returns `from`'s centre.
 */
export function edgeAnchor(from: Rect, toward: Rect): { x: number; y: number } {
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  const dx = toward.x + toward.w / 2 - cx;
  const dy = toward.y + toward.h / 2 - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx !== 0 ? from.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? from.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/**
 * "M ax ay Q cx cy bx by" — control point = chord midpoint offset
 * perpendicular by `bow * |chord|`, which simplifies to `mid - d.y*bow /
 * mid + d.x*bow` (the |d| factors cancel).
 */
export function quadPath(a: { x: number; y: number }, b: { x: number; y: number }, bow: number = CURVE_BOW): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const cx = (a.x + b.x) / 2 - dy * bow;
  const cy = (a.y + b.y) / 2 + dx * bow;
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

/**
 * The automatic DAG edges among placed cards: for every ordered card pair
 * whose concepts form a `prereq → dependent` edge, unless the user has drawn
 * that exact claim themselves (the user's arrow wins the paint slot).
 * `pairs` is keyed `` `${prereqId}\u0000${conceptId}` `` — same encoding the
 * session builds from `fetchPrereqEdges`. O(n²) over placed cards
 * (realistically ≤ 40) — callers memoise.
 */
export function deriveAutoEdges(
  cards: Array<{ id: string; conceptId: string }>,
  arrows: Array<{ from: string; to: string }>,
  pairs: Set<string>
): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  for (const a of cards) {
    for (const b of cards) {
      if (a.id === b.id || a.conceptId === b.conceptId) continue;
      if (!pairs.has(edgeKey(a.conceptId, b.conceptId))) continue; // a is prereq of b
      if (arrows.some((u) => u.from === a.id && u.to === b.id)) continue; // user's claim wins
      out.push({ from: a.id, to: b.id });
    }
  }
  return out;
}
