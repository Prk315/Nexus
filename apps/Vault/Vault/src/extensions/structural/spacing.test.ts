import { describe, it, expect } from "vitest";
import { generateHTML, generateJSON } from "@tiptap/core";
import { buildNoteExtensions, noteSchema } from "../noteExtensions";
import { auditNoteRaw } from "../../lib/noteSchemaGuard";
import { SPACING_UNIT } from "../../lib/blockSize";

const schema = noteSchema();
const exts = buildNoteExtensions();

const para = (t = "x") => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const doc = (...c: any[]) => ({ type: "doc", content: c });
const container = (attrs: Record<string, any>) =>
  ({ type: "containerBlock", attrs: { style: "card", color: null, ...attrs }, content: [para("body")] });

const roundTrip = (json: any) => generateJSON(generateHTML(json, exts), exts) as any;

describe("spacing survives the clipboard", () => {
  // A renderHTML/parseHTML mismatch is invisible to tsc and survives every
  // click-through — it shows up as spacing quietly reverting on paste.
  it("round-trips both steps on every spaced container type", () => {
    for (const type of ["containerBlock", "calloutBlock", "toggleBlock"]) {
      const node =
        type === "containerBlock" ? container({ pad: 3, gap: 2 }) :
        type === "calloutBlock"
          ? { type, attrs: { variant: "note", color: null, pad: 3, gap: 2 }, content: [para()] }
          : {
              type, attrs: { open: true, pad: 3, gap: 2 },
              content: [
                { type: "toggleSummary", content: [{ type: "text", text: "s" }] },
                { type: "toggleContent", content: [para()] },
              ],
            };
      const back = roundTrip(doc(node));
      expect(back.content[0].attrs.pad, type).toBe(3);
      expect(back.content[0].attrs.gap, type).toBe(2);
    }
  });

  it("keeps spacing alongside the block's own attributes", () => {
    const back = roundTrip(doc(container({ pad: 4, color: "amber", shareId: "abc123" })));
    expect(back.content[0].attrs.pad).toBe(4);
    expect(back.content[0].attrs.color).toBe("amber");
    expect(back.content[0].attrs.shareId).toBe("abc123");
  });
});

describe("⚠️ unset stays unset", () => {
  // Writing a default on read would mean simply OPENING a note rewrote every
  // container that had never been adjusted — and an autosave follows, so it
  // would persist. Absent is not a value.
  it("emits no attribute at all when spacing was never set", () => {
    const html = generateHTML(doc(container({})), exts);
    expect(html).not.toContain("data-pad");
    expect(html).not.toContain("data-gap");
    expect(roundTrip(doc(container({}))).content[0].attrs.pad).toBeNull();
  });

  // ⚠️ Zero is a CHOICE ("no spacing at all"); null is "never set", which
  // follows the stylesheet. Collapsing them loses the difference, and the
  // double-click reset would have nowhere to go.
  it("distinguishes a deliberate zero from never-set", () => {
    const zero = roundTrip(doc(container({ pad: 0 })));
    expect(zero.content[0].attrs.pad).toBe(0);
    expect(generateHTML(doc(container({ pad: 0 })), exts)).toContain('data-pad="0"');
  });

  it("resolves a set step into an inline style, from the one scale", () => {
    // Whitespace-insensitive on purpose: the DOM serialiser normalises
    // `padding-block:12px` to `padding-block: 12px`, so asserting the exact
    // string tests the serialiser rather than the scale.
    const css = generateHTML(doc(container({ pad: 2, gap: 1 })), exts).replace(/\s+/g, "");
    expect(css).toContain(`padding-block:${2 * SPACING_UNIT}px`);
    expect(css).toContain(`margin-block:${1 * SPACING_UNIT}px`);
  });
});

describe("an older client is not harmed", () => {
  // Attributes, not node types: ProseMirror drops an unknown attribute and
  // BLANKS a document on an unknown node type. A note using spacing therefore
  // opens on a build that predates it, at the stylesheet's own padding.
  it("parses as an ordinary container when the attributes are unknown", () => {
    const html = generateHTML(doc(container({ pad: 5, gap: 3 })), exts);
    const stripped = JSON.parse(
      JSON.stringify(generateJSON(html, exts)),
      (k, v) => (k === "pad" || k === "gap" ? undefined : v),
    );
    expect(() => schema.nodeFromJSON(stripped).check()).not.toThrow();
    expect(JSON.stringify(stripped)).toContain("body");
  });

  it("the schema guard still accepts a spaced note", () => {
    expect(auditNoteRaw(JSON.stringify(doc(container({ pad: 6 }))), schema).ok).toBe(true);
  });

  it("clamps a hand-edited value out of range rather than rendering it", () => {
    const back = roundTrip(doc(container({ pad: 99 })));
    expect(back.content[0].attrs.pad).toBeLessThanOrEqual(6);
  });
});

describe("the sketch's width", () => {
  const sketch = (attrs: Record<string, any>) => ({
    type: "sketchBlock",
    attrs: { data: '{"v":1,"strokes":[]}', height: 400, background: "blank", ...attrs },
  });

  it("round-trips a percentage", () => {
    expect(roundTrip(doc(sketch({ width: 60 }))).content[0].attrs.width).toBe(60);
  });

  // ⚠️ null is "follow the column", 100 is "deliberately full width". Same
  // picture, different document — and the double-click reset has to be able to
  // reach the first.
  it("keeps never-sized distinct from deliberately full width", () => {
    expect(generateHTML(doc(sketch({})), exts)).not.toContain("data-width");
    expect(roundTrip(doc(sketch({}))).content[0].attrs.width).toBeNull();
    expect(roundTrip(doc(sketch({ width: 100 }))).content[0].attrs.width).toBe(100);
  });

  it("clamps a hand-edited width instead of rendering an unusable sketch", () => {
    expect(roundTrip(doc(sketch({ width: 2 }))).content[0].attrs.width).toBe(15);
    expect(roundTrip(doc(sketch({ width: 900 }))).content[0].attrs.width).toBe(100);
  });

  it("opens on a build that predates the attribute", () => {
    const html = generateHTML(doc(sketch({ width: 45 })), exts);
    const stripped = JSON.parse(JSON.stringify(generateJSON(html, exts)),
      (k, v) => (k === "width" ? undefined : v));
    expect(() => schema.nodeFromJSON(stripped).check()).not.toThrow();
  });
});
