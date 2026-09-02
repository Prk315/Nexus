// Sizing and spacing a block by dragging it.
//
// Pure, so the arithmetic is testable without a pointer. The component half is
// `components/ResizeGrip.tsx`, which owns the one rule that matters at runtime:
// write to the DOM while the pointer moves, dispatch ONE transaction on
// release.
//
// ── ⚠️ Width is a PERCENTAGE, height is pixels, and that asymmetry is
//    deliberate ──────────────────────────────────────────────────────────────
//
// A note opens at 720 px on a laptop, full-bleed on a wide screen, and again on
// an iPad. A stored pixel WIDTH is wrong the moment the column changes — the
// same reason `metaPct` is a percentage, note width is a keyword and column
// widths are weights rather than pixels.
//
// Height has no such relationship: a 300 px sketch is 300 px tall wherever it
// is opened, and expressing it as a percentage of a column would make a
// drawing's aspect ratio depend on the window. So width scales with the
// container and height does not.
//
// ── ⚠️ Spacing is a STEP, not a free pixel value ───────────────────────────
//
// A free padding lets you set 0 and 400 px, and both are broken states you can
// reach by twitching. A short scale keeps every block in a note recognisably
// the same family, and makes "a bit more room" a decision rather than a
// measurement. It is also one small integer in the document instead of an
// arbitrary float.

export const MIN_WIDTH_PCT = 15;
export const MAX_WIDTH_PCT = 100;

export const MIN_HEIGHT_PX = 60;
export const MAX_HEIGHT_PX = 2000;

/** Bounded, and 0 means "the block's own default" so an unset attribute and a
 *  deliberately tight block are distinguishable. */
export const SPACING_STEPS = [0, 1, 2, 3, 4, 5, 6] as const;
export type SpacingStep = (typeof SPACING_STEPS)[number];

/** What one step is worth, in px. Small enough that a drag feels continuous,
 *  large enough that two adjacent notes never differ by an invisible amount. */
export const SPACING_UNIT = 6;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * A dragged width, as a percentage of the container.
 *
 * Rounded to whole percent: a stored `43.7184%` is noise that makes every
 * document diff longer and reads no differently from 44.
 */
export function widthPct(px: number, containerPx: number): number {
  if (!(containerPx > 0)) return MAX_WIDTH_PCT;
  return clamp(Math.round((px / containerPx) * 100), MIN_WIDTH_PCT, MAX_WIDTH_PCT);
}

export function clampHeight(px: number): number {
  return clamp(Math.round(px), MIN_HEIGHT_PX, MAX_HEIGHT_PX);
}

/**
 * The spacing step a dragged distance lands on.
 *
 * ⚠️ Rounds to NEAREST rather than truncating. Truncation means the first
 * SPACING_UNIT pixels of every drag do nothing, which reads as the handle
 * being stuck before it suddenly jumps.
 */
export function spacingStep(px: number): SpacingStep {
  const n = clamp(Math.round(px / SPACING_UNIT), 0, SPACING_STEPS.length - 1);
  return SPACING_STEPS[n];
}

export function spacingPx(step: number): number {
  return clamp(Math.round(step), 0, SPACING_STEPS.length - 1) * SPACING_UNIT;
}

/**
 * Coerce a stored attribute back into range.
 *
 * ⚠️ Returns null for absent, NOT a default. An unset width must stay unset in
 * the document: writing a default on read would mean simply opening a note
 * rewrote every block that had never been sized, and — because an autosave
 * follows — persisted it. Absent is not a value, the same rule the aggregates
 * and the stored columns follow.
 *
 * ⚠️ And an EMPTY STRING is absent, not zero.
 *
 * `Number("")` is `0`, which is finite — so a blank attribute sailed through
 * and clamped to the minimum. That is not hypothetical: an HTML round trip
 * renders an unset attribute as `width=""`, so every never-sized block would
 * have come back 15% wide the first time a note was pasted. Absent is not
 * zero, in the one place the language quietly disagrees.
 */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function readWidthPct(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : clamp(Math.round(n), MIN_WIDTH_PCT, MAX_WIDTH_PCT);
}

export function readHeightPx(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : clampHeight(n);
}

export function readSpacing(v: unknown): SpacingStep | null {
  const n = num(v);
  return n === null ? null : spacingStep(n * SPACING_UNIT);
}

/**
 * Where a corner drag has got to, from its start.
 *
 * Both axes at once — that is what "by the corner" means, and handling them
 * separately is what makes a corner grip feel like it is fighting you.
 */
export interface DragOrigin {
  startX: number;
  startY: number;
  startWidthPx: number;
  startHeightPx: number;
  containerPx: number;
}

export interface DragResult {
  widthPct: number;
  heightPx: number;
}

/**
 * ⚠️ `lockAspect` scales height FROM THE WIDTH RATIO, ignoring the vertical
 * movement entirely.
 *
 * Averaging the two axes, or taking whichever moved more, both feel like the
 * handle is disobeying: the pointer is a single point and the user is aiming
 * it at a corner, so the corner must follow the pointer on the axis they can
 * see themselves controlling. Width is that axis, because the block's left
 * edge is fixed and its right edge is under the hand.
 */
export function cornerDrag(
  o: DragOrigin,
  x: number,
  y: number,
  lockAspect = false,
): DragResult {
  const w = widthPct(o.startWidthPx + (x - o.startX), o.containerPx);

  if (lockAspect && o.startWidthPx > 0) {
    const startPct = widthPct(o.startWidthPx, o.containerPx);
    const ratio = startPct > 0 ? w / startPct : 1;
    return { widthPct: w, heightPx: clampHeight(o.startHeightPx * ratio) };
  }

  return { widthPct: w, heightPx: clampHeight(o.startHeightPx + (y - o.startY)) };
}
