// Pure geometry and serialization for the inline sketch block.
//
// React-free on purpose, like taskTree.ts and coverage.ts elsewhere in the
// ecosystem: everything here is a rule that has to be right, and a rule that
// has to be right belongs somewhere a test can reach without a DOM.

import { getStroke } from "perfect-freehand";

export type SketchTool = "pen" | "highlighter" | "eraser";

export interface SketchStroke {
  /** "pen" | "highlighter" — the eraser produces no stroke. */
  t: "p" | "h";
  /** CSS colour. */
  c: string;
  /** Nominal width in sketch-local px, before pressure. */
  w: number;
  /** Flat [x, y, pressure, …]. Flat because it is a third the JSON of
   *  `{x,y,p}` objects and this lives INSIDE the note document. */
  pts: number[];
}

export interface SketchData {
  v: 1;
  strokes: SketchStroke[];
}

export const EMPTY_SKETCH: SketchData = { v: 1, strokes: [] };

/**
 * The size ceiling for one sketch, in serialized characters.
 *
 * This exists because a sketch is stored in the note DOCUMENT, not in a row of
 * its own. `api.saveContent` hard-rejects above 2 MB — a limit that is there
 * because a 1.9 MB note once wedged the database for two hours — and it
 * rejects the WHOLE note, so an unbounded sketch does not degrade, it takes
 * the note's text down with it. Refusing one more stroke is a far better failure
 * than a note that silently stops saving.
 *
 * 400 kB is about 860 simplified strokes — a genuinely full page of
 * handwriting, well past what a diagram beside a paragraph ever needs — while
 * still leaving four fifths of the note's budget for its prose and for other
 * sketches. The first value tried here was 220 kB, which a test of 600 strokes
 * blew straight through: the number has to come from what a drawing actually
 * costs, not from what felt small.
 */
export const SKETCH_MAX_CHARS = 400_000;

/** Coordinate precision on commit. Live drawing keeps full precision. */
const COORD_DP = 1;
const PRESSURE_DP = 2;

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

export function serializeSketch(data: SketchData): string {
  return JSON.stringify({
    v: 1,
    strokes: data.strokes.map((s) => ({
      ...s,
      pts: s.pts.map((n, i) => round(n, i % 3 === 2 ? PRESSURE_DP : COORD_DP)),
    })),
  });
}

/**
 * Parse stored sketch data, tolerating everything.
 *
 * A sketch arrives from a node attribute, which means it can be anything a
 * paste, an older build or a hand-edited row put there. This never throws: a
 * sketch that fails to parse renders as an empty one, which loses a drawing,
 * where a throw inside a node view unmounts the editor and loses the note.
 */
export function parseSketch(raw: unknown): SketchData {
  if (!raw) return EMPTY_SKETCH;
  let obj: any = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return EMPTY_SKETCH;
    }
  }
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.strokes)) return EMPTY_SKETCH;

  const strokes: SketchStroke[] = [];
  for (const s of obj.strokes) {
    if (!s || !Array.isArray(s.pts)) continue;
    // A stroke whose point array isn't a whole number of triples is corrupt.
    // Truncating rather than dropping keeps as much of the drawing as is
    // meaningful, and the remainder cannot be interpreted at all.
    const n = Math.floor(s.pts.length / 3) * 3;
    if (n === 0) continue;
    const pts = s.pts.slice(0, n).map((v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0));
    strokes.push({
      t: s.t === "h" ? "h" : "p",
      c: typeof s.c === "string" && s.c ? s.c : "#111827",
      w: typeof s.w === "number" && s.w > 0 ? s.w : 2.4,
      pts,
    });
  }
  return { v: 1, strokes };
}

/**
 * Whole-stroke eraser: true when the stroke passes within `radius` of (px, py).
 *
 * Tests SEGMENTS, not stored points, and that distinction is the whole
 * function. Testing points is the obvious implementation and it is wrong here
 * precisely because `simplify` works: RDP exists to delete interior points from
 * straight runs, so a ruled line, an underline, an arrow shaft or a box edge
 * is stored as exactly TWO points. A point-wise eraser can only rub out its
 * two ends — the long middle is untouchable, and in a diagram that is most of
 * the ink. It looks like the eraser is broken, and it is.
 */
export function strokeHit(s: SketchStroke, px: number, py: number, radius: number): boolean {
  const n = s.pts.length / 3;
  if (n === 0) return false;
  const r2 = radius * radius;

  // A single-point stroke (a dot) has no segment, so it is its own case.
  if (n === 1) {
    const dx = s.pts[0] - px, dy = s.pts[1] - py;
    return dx * dx + dy * dy < r2;
  }

  for (let i = 0; i < n - 1; i++) {
    const ax = s.pts[i * 3], ay = s.pts[i * 3 + 1];
    const bx = s.pts[i * 3 + 3], by = s.pts[i * 3 + 4];
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy;
    // Clamped projection onto the segment: t outside [0,1] means the nearest
    // point is an endpoint, not somewhere on the infinite line.
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
    const dx = ax + t * vx - px;
    const dy = ay + t * vy - py;
    if (dx * dx + dy * dy < r2) return true;
  }
  return false;
}

/**
 * Ramer–Douglas–Peucker, preserving each kept point's pressure.
 *
 * Run once at commit, never during the gesture. A raw pen stroke arrives at
 * ~120 Hz with coalesced events on top, so an unsimplified signature is
 * thousands of points — and every one of them is bytes in the note document.
 */
export function simplify(pts: number[], epsilon = 0.7): number[] {
  const n = pts.length / 3;
  if (n < 3) return pts.slice();

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;
    const ax = pts[first * 3], ay = pts[first * 3 + 1];
    const bx = pts[last * 3], by = pts[last * 3 + 1];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);

    let worst = 0;
    let idx = -1;
    for (let i = first + 1; i < last; i++) {
      const x = pts[i * 3], y = pts[i * 3 + 1];
      // A zero-length segment degenerates the perpendicular distance to a
      // plain point distance — which is the correct answer, not a divide by
      // zero. Pens do emit repeated identical points when held still.
      const d = len === 0
        ? Math.hypot(x - ax, y - ay)
        : Math.abs(dy * x - dx * y + bx * ay - by * ax) / len;
      if (d > worst) { worst = d; idx = i; }
    }
    if (idx >= 0 && worst > epsilon) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }

  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    out.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
  }
  return out;
}

/** Bounding box of every stroke, or null when there is nothing drawn. */
export function sketchBounds(
  data: SketchData
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of data.strokes) {
    for (let i = 0; i < s.pts.length; i += 3) {
      const x = s.pts[i], y = s.pts[i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Outline polygon for one stroke, via perfect-freehand.
 *
 * `simulatePressure` is decided per stroke rather than globally: a mouse gives
 * every point the same fallback pressure, and asking perfect-freehand to
 * honour that produces a dead uniform ribbon. A stylus gives real variation
 * and must not have it synthesised over the top.
 */
export function strokeOutline(s: SketchStroke, last = true): number[][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i < s.pts.length; i += 3) {
    pts.push([s.pts[i], s.pts[i + 1], s.pts[i + 2]]);
  }
  const first = pts.length ? pts[0][2] : 0.5;
  const simulate = pts.every((p) => p[2] === first);
  const mul = s.t === "h" ? 3 : 1;
  return getStroke(pts, {
    size: s.w * mul * 2,
    thinning: s.t === "h" ? 0 : 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: simulate,
    last,
  }) as number[][];
}

/** perfect-freehand's canonical average-quadratic path, closed. */
export function outlineToPath(outline: number[][]): string {
  if (!outline.length) return "";
  const d: (string | number)[] = ["M", outline[0][0], outline[0][1], "Q"];
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    d.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  d.push("Z");
  return d.join(" ");
}
