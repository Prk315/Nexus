// Geometry for the draggable / resizable side surfaces: the Workspace and Team
// panes, the main sidebar, and the floating quick-tool panel.
//
// Pure and React-free so the clamping rules are tested rather than eyeballed —
// a pane that can be dragged to 0 px, or a floating panel dragged off-screen,
// is a layout the user cannot get back out of without clearing storage.

export function clampWidth(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/**
 * Width of a pane being dragged by its inner edge.
 *
 * Read from the pointer's distance to the pane's OUTER edge (fixed during the
 * drag), never from accumulated deltas — accumulating drifts whenever a move
 * event is coalesced or the clamp bites, and the handle slowly desyncs from the
 * cursor. Same reasoning as the Dashboard's day-calendar rail.
 */
export function paneWidthFromPointer(
  side: "left" | "right", outerEdgeX: number, pointerX: number, min: number, max: number,
): number {
  return clampWidth(side === "left" ? pointerX - outerEdgeX : outerEdgeX - pointerX, min, max);
}

/** A stored width, or the default when storage is empty, corrupt or out of range. */
export function parseStoredWidth(raw: string | null, min: number, max: number, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

export interface FloatRect { x: number; y: number; w: number; h: number }

/**
 * Keeps a floating panel reachable inside the viewport.
 *
 * Only the HEADER has to stay on screen for the panel to be recoverable (it is
 * the drag handle), but clamping the whole box is simpler to reason about and
 * avoids a panel whose body hangs off the bottom edge. When the panel is
 * larger than the viewport it pins to the top-left margin rather than going
 * negative — a negative position would put the header out of reach.
 */
export function clampFloatRect(r: FloatRect, viewW: number, viewH: number, margin = 8): FloatRect {
  const w = Math.min(r.w, Math.max(0, viewW - margin * 2));
  const h = Math.min(r.h, Math.max(0, viewH - margin * 2));
  const x = Math.max(margin, Math.min(r.x, viewW - margin - w));
  const y = Math.max(margin, Math.min(r.y, viewH - margin - h));
  return { x: Math.round(x), y: Math.round(y), w, h };
}

/** Parses a stored `{x,y}` position, or null when absent or corrupt. */
export function parseStoredPos(raw: string | null): { x: number; y: number } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) return { x: v.x, y: v.y };
  } catch { /* corrupt → default placement */ }
  return null;
}
