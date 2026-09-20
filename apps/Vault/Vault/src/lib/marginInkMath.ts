// Pure input-and-geometry helpers for the margin ink layer. React-free on
// purpose (the taskTree.ts convention): everything here is testable without a
// canvas, and the component keeps only wiring.

/** Coalesced samples of a pointer event, with the empty-array trap handled.
 *
 * ⚠️ `getCoalescedEvents()` legitimately returns `[]` for untrusted events —
 * and `?? [e]` does NOT cover that case, because an empty array is not
 * nullish. The margin layer shipped with exactly that bug: a move whose
 * coalesced list came back empty contributed no points at all, which reads
 * as dropped ink on fast strokes. CanvasEditor's ink path guards length
 * explicitly; this is that guard, shared. */
export function coalescedOf(e: PointerEvent): PointerEvent[] {
  const c = e.getCoalescedEvents?.();
  return c && c.length ? c : [e];
}

/** Pen pressure with a stable fallback: a mouse (and some first pen samples)
 *  report 0, which would render an invisible stroke — 0.5 is the neutral
 *  width the pressure curve treats as "no information". */
export function pressureOf(e: { pressure: number }): number {
  return e.pressure > 0 ? e.pressure : 0.5;
}

/** One step of exponential smoothing. The Pencil samples pressure at 240 Hz
 *  with visible quantisation steps; drawing raw values gives a stroke whose
 *  width staircases. α = 0.35 follows the input fast enough for deliberate
 *  presses and slow enough to melt the steps. */
export const PRESSURE_EMA_ALPHA = 0.35;
export function emaNext(prev: number, x: number, alpha = PRESSURE_EMA_ALPHA): number {
  return prev + alpha * (x - prev);
}

/** Per-segment stroke widths for a variable-width pen line.
 *
 * ⚠️ The reason this exists: canvas 2D applies ONE lineWidth per stroke()
 * call — assigning `ctx.lineWidth` while building a path does nothing until
 * the stroke, and then only the last value applies. The old renderer did
 * exactly that, so every pen stroke rendered uniform-width and pressure was
 * cosmetically dead. Variable width requires one stroke() per segment, and
 * these are the widths for them.
 *
 * `pts` is the stored flat [x, y, p, ...] array; returns one width per
 * interior point (segment i spans midpoint(i-1,i) → midpoint(i,i+1)). */
export function segmentWidths(pts: number[], base: number, widthMul = 1): number[] {
  const n = pts.length / 3;
  const out: number[] = [];
  for (let i = 1; i < n; i++) {
    const avgP = (pts[(i - 1) * 3 + 2] + pts[i * 3 + 2]) / 2;
    out.push(Math.max(base * widthMul * (0.5 + avgP), 0.5));
  }
  return out;
}
