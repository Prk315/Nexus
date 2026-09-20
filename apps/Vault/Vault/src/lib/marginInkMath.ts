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

/** Does a dry layer rendered at content-offset `offK` still cover the
 *  viewport at offset `offN`, given `ov` css-px of overscan per side?
 *  Coverage fails exactly when the view has scrolled past the pre-rendered
 *  apron — the re-render trigger, quantised from every-frame to
 *  every-`ov`-pixels. */
export function overscanCovers(offK: number, offN: number, ov: number): boolean {
  return Math.abs(offN - offK) <= ov;
}

/** Axis-aligned bounds of a stored stroke, padded by its worst-case rendered
 *  width — the culling key that keeps a dry re-render proportional to the ink
 *  NEAR the viewport instead of the ink in the whole book. */
export function strokeBounds(pts: number[], maxWidth: number): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    if (pts[i] < minX) minX = pts[i];
    if (pts[i] > maxX) maxX = pts[i];
    if (pts[i + 1] < minY) minY = pts[i + 1];
    if (pts[i + 1] > maxY) maxY = pts[i + 1];
  }
  const pad = maxWidth / 2 + 1;
  return [minX - pad, minY - pad, maxX + pad, maxY + pad];
}
