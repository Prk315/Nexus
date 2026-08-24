import { describe, it, expect } from "vitest";
import { generateHTML, generateJSON } from "@tiptap/core";
import { buildNoteExtensions, noteSchema } from "../extensions/noteExtensions";
import { auditNoteRaw } from "./noteSchemaGuard";
import {
  parseSketch,
  serializeSketch,
  simplify,
  strokeHit,
  sketchBounds,
  strokeOutline,
  outlineToPath,
  EMPTY_SKETCH,
  SKETCH_MAX_CHARS,
  type SketchStroke,
} from "./sketch";
import { SKETCH_DEFAULT_HEIGHT } from "../extensions/SketchBlock";

const schema = noteSchema();
const exts = buildNoteExtensions();

const stroke = (pts: number[], over: Partial<SketchStroke> = {}): SketchStroke => ({
  t: "p",
  c: "#111827",
  w: 3,
  pts,
  ...over,
});

// A sketch arrives from a node attribute, which means it can be anything a
// paste, an older build or a hand-edited row left there. parseSketch must never
// throw: a throw inside a node view unmounts the editor, and losing the note is
// a far worse outcome than losing one drawing.
describe("parseSketch tolerates anything", () => {
  const junk = [null, undefined, "", "not json", "[]", "{}", 42, { strokes: "nope" }, { strokes: [null, 3] }];
  for (const v of junk) {
    it(`survives ${JSON.stringify(v) ?? "undefined"}`, () => {
      expect(() => parseSketch(v)).not.toThrow();
      expect(parseSketch(v).strokes).toEqual([]);
    });
  }

  it("truncates a stroke whose points aren't a whole number of triples", () => {
    // Keeping as much of the drawing as can be interpreted; the remainder
    // cannot be read as a point at all.
    const d = parseSketch({ strokes: [{ t: "p", c: "#000", w: 2, pts: [0, 0, 1, 5, 5, 1, 9, 9] }] });
    expect(d.strokes[0].pts).toEqual([0, 0, 1, 5, 5, 1]);
  });

  it("drops non-finite coordinates rather than rendering NaN paths", () => {
    const d = parseSketch({ strokes: [{ t: "p", c: "#000", w: 2, pts: [NaN, Infinity, 1] }] });
    expect(d.strokes[0].pts).toEqual([0, 0, 1]);
  });

  it("substitutes defaults for a missing colour or width", () => {
    const d = parseSketch({ strokes: [{ pts: [1, 2, 0.5] }] });
    expect(d.strokes[0].c).toBeTruthy();
    expect(d.strokes[0].w).toBeGreaterThan(0);
    expect(d.strokes[0].t).toBe("p");
  });

  it("round-trips a real sketch through serialize", () => {
    const data = { v: 1 as const, strokes: [stroke([1, 2, 0.5, 3, 4, 0.7], { t: "h", c: "#ff0" })] };
    expect(parseSketch(serializeSketch(data))).toEqual(data);
  });

  it("rounds on save without moving anything visibly", () => {
    const raw = { v: 1 as const, strokes: [stroke([1.23456, 2.98765, 0.123456])] };
    const back = parseSketch(serializeSketch(raw));
    expect(back.strokes[0].pts).toEqual([1.2, 3, 0.12]);
  });
});

describe("simplify", () => {
  it("collapses a straight line to its endpoints", () => {
    const pts: number[] = [];
    for (let i = 0; i <= 20; i++) pts.push(i * 5, 0, 0.5);
    expect(simplify(pts)).toEqual([0, 0, 0.5, 100, 0, 0.5]);
  });

  it("keeps a corner", () => {
    const pts = [0, 0, 0.5, 50, 0, 0.5, 50, 50, 0.5];
    expect(simplify(pts).length / 3).toBe(3);
  });

  it("preserves the pressure of every point it keeps", () => {
    const pts = [0, 0, 0.2, 50, 40, 0.9, 100, 0, 0.4];
    const out = simplify(pts);
    expect(out[2]).toBe(0.2);
    expect(out[out.length - 1]).toBe(0.4);
  });

  it("leaves a 1- or 2-point stroke alone", () => {
    expect(simplify([1, 2, 0.5])).toEqual([1, 2, 0.5]);
    expect(simplify([1, 2, 0.5, 3, 4, 0.5])).toEqual([1, 2, 0.5, 3, 4, 0.5]);
  });

  // A stylus held still emits repeated identical samples, which makes the
  // segment length zero. The perpendicular distance then has to degrade to a
  // point distance rather than divide by zero and yield NaN — a NaN would
  // compare false against epsilon and silently drop every interior point.
  it("does not produce NaN when points repeat exactly", () => {
    const pts = [10, 10, 0.5, 10, 10, 0.5, 10, 10, 0.5, 10, 10, 0.5];
    const out = simplify(pts);
    expect(out.every((n) => Number.isFinite(n))).toBe(true);
  });

  it("actually shrinks a realistic noisy stroke", () => {
    const pts: number[] = [];
    for (let i = 0; i < 400; i++) pts.push(i * 0.6, Math.sin(i / 30) * 40, 0.5);
    const out = simplify(pts);
    expect(out.length).toBeLessThan(pts.length / 4);
  });
});

describe("strokeHit", () => {
  const line = stroke([0, 0, 0.5, 100, 0, 0.5]);

  it("hits near an endpoint", () => expect(strokeHit(line, 3, 3, 10)).toBe(true));
  it("misses far away", () => expect(strokeHit(line, 50, 90, 10)).toBe(false));

  // The case that mattered, found by trying to rub out a straight line in the
  // browser and watching nothing happen. `simplify` stores a ruled line as its
  // two endpoints ON PURPOSE, so a point-wise hit test leaves the entire middle
  // of it unerasable — and in a diagram, most strokes are straight.
  it("hits the MIDDLE of a two-point straight stroke", () => {
    expect(strokeHit(line, 50, 0, 10)).toBe(true);
    expect(strokeHit(line, 50, 6, 10)).toBe(true);
    expect(strokeHit(line, 50, 14, 10)).toBe(false);
  });

  it("does not hit past the end of a segment", () => {
    // Beyond the endpoint the nearest point is the endpoint itself, not a
    // point on the infinite line — an unclamped projection would erase strokes
    // by pointing at empty space in line with them.
    expect(strokeHit(line, 130, 0, 10)).toBe(false);
    expect(strokeHit(line, 105, 0, 10)).toBe(true);
  });

  it("handles a single-point dot, which has no segment", () => {
    const dot = stroke([50, 50, 0.5]);
    expect(strokeHit(dot, 52, 52, 10)).toBe(true);
    expect(strokeHit(dot, 90, 90, 10)).toBe(false);
  });

  it("handles a degenerate zero-length segment", () => {
    const same = stroke([20, 20, 0.5, 20, 20, 0.5]);
    expect(strokeHit(same, 22, 20, 10)).toBe(true);
    expect(strokeHit(same, 60, 20, 10)).toBe(false);
  });
});

describe("sketchBounds", () => {
  it("is null for an empty sketch", () => {
    expect(sketchBounds(EMPTY_SKETCH)).toBeNull();
  });

  it("spans every stroke", () => {
    const b = sketchBounds({ v: 1, strokes: [stroke([10, 20, 0.5]), stroke([100, 5, 0.5])] });
    expect(b).toEqual({ x: 10, y: 5, w: 90, h: 15 });
  });
});

describe("rendering helpers", () => {
  it("produces a closed path for a stroke", () => {
    const d = outlineToPath(strokeOutline(stroke([0, 0, 0.5, 10, 10, 0.6, 20, 5, 0.4])));
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).not.toContain("NaN");
  });

  it("returns an empty path rather than throwing on an empty outline", () => {
    expect(outlineToPath([])).toBe("");
  });
});

// The node is a schema addition, so these are the cases that decide whether a
// sketch survives a copy-paste and whether the guard will let a note holding
// one be opened at all.
describe("the sketchBlock node", () => {
  const data = serializeSketch({ v: 1, strokes: [stroke([1, 2, 0.5, 30, 40, 0.8])] });
  const json = {
    type: "doc",
    content: [
      { type: "sketchBlock", attrs: { data, height: 400, background: "grid" } },
      { type: "paragraph", content: [{ type: "text", text: "after" }] },
    ],
  };

  it("round-trips through JSON, which is how notes are stored", () => {
    const back: any = schema.nodeFromJSON(json).toJSON();
    expect(back.content[0].attrs.data).toBe(data);
    expect(back.content[0].attrs.height).toBe(400);
    expect(back.content[0].attrs.background).toBe("grid");
  });

  // The one that matters for copy-paste. A renderHTML/parseHTML mismatch is
  // invisible to tsc and survives every manual click-through — the drawing just
  // quietly arrives blank in the note you pasted into.
  it("round-trips through HTML, carrying the strokes", () => {
    const html = generateHTML(json, exts);
    expect(html).toContain('data-type="sketch"');
    const back: any = generateJSON(html, exts);
    expect(back.content[0].type).toBe("sketchBlock");
    expect(parseSketch(back.content[0].attrs.data).strokes).toHaveLength(1);
    expect(back.content[0].attrs.height).toBe(400);
  });

  it("clamps a nonsense stored height instead of rendering a 40 000px block", () => {
    const html = generateHTML(json, exts).replace('data-height="400"', 'data-height="40000"');
    const back: any = generateJSON(html, exts);
    expect(back.content[0].attrs.height).toBeLessThanOrEqual(1400);
  });

  it("falls back to the default height for a non-numeric one", () => {
    const html = generateHTML(json, exts).replace('data-height="400"', 'data-height="tall"');
    const back: any = generateJSON(html, exts);
    expect(back.content[0].attrs.height).toBe(SKETCH_DEFAULT_HEIGHT);
  });

  it("passes the schema guard", () => {
    expect(auditNoteRaw(JSON.stringify(json), schema).ok).toBe(true);
  });

  // The counterpart, and the reason this feature needs deploying everywhere
  // before it is used: unlike the heading `collapsed` attribute and the doc
  // `width`, a NODE type an older client doesn't know does not degrade.
  it("is named by the guard when the schema lacks it", () => {
    const bare = noteSchema();
    const audit = auditNoteRaw(
      JSON.stringify({ type: "doc", content: [{ type: "notARealBlock" }] }),
      bare
    );
    expect(audit.ok).toBe(false);
    expect(audit.unknownNodes).toContain("notARealBlock");
  });
});

describe("the size cap", () => {
  it("is well under saveContent's 2 MB rejection", () => {
    // A sketch shares the note's save budget, so its ceiling has to leave room
    // for the prose and for more than one sketch.
    expect(SKETCH_MAX_CHARS).toBeLessThan(2_000_000 / 4);
  });

  it("a realistic dense sketch fits inside it", () => {
    // ~600 simplified strokes of 24 points — far more than anyone draws in a
    // note-sized box. If this ever fails the cap is too tight, not too loose.
    const strokes: SketchStroke[] = [];
    for (let i = 0; i < 600; i++) {
      const pts: number[] = [];
      for (let j = 0; j < 24; j++) pts.push(100 + j * 3.1, 50 + i * 0.7, 0.55);
      strokes.push(stroke(pts));
    }
    expect(serializeSketch({ v: 1, strokes }).length).toBeLessThan(SKETCH_MAX_CHARS);
  });
});
