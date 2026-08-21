import { describe, it, expect } from "vitest";
import { noteSchema } from "../extensions/noteExtensions";
import { buildOutline } from "./NoteOutline";

const schema = noteSchema();
const doc = (...content: any[]) => schema.nodeFromJSON({ type: "doc", content });
const h = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const para = (text = "body") => ({ type: "paragraph", content: [{ type: "text", text }] });

const texts = (items: any[]) => items.map((i) => i.text);
const indents = (items: any[]) => items.map((i) => i.indent);

describe("buildOutline", () => {
  it("lists headings in document order", () => {
    const items = buildOutline(doc(h(1, "One"), para(), h(2, "Two"), h(3, "Three")));
    expect(texts(items)).toEqual(["One", "Two", "Three"]);
  });

  it("skips headings with no text", () => {
    const items = buildOutline(doc(h(1, "Real"), { type: "heading", attrs: { level: 2 } }));
    expect(texts(items)).toEqual(["Real"]);
  });

  // The old outline read only editor.getJSON().content — the document's
  // TOP-LEVEL children — so every one of these would have been invisible.
  it("finds headings inside a callout", () => {
    const items = buildOutline(
      doc(h(1, "Top"), { type: "calloutBlock", attrs: { variant: "note" }, content: [h(2, "Inside a callout")] })
    );
    expect(texts(items)).toEqual(["Top", "Inside a callout"]);
  });

  it("finds headings inside a container", () => {
    const items = buildOutline(
      doc({ type: "containerBlock", attrs: { style: "card" }, content: [h(2, "Inside a container")] })
    );
    expect(texts(items)).toEqual(["Inside a container"]);
  });

  it("finds headings inside a toggle body, open or collapsed", () => {
    for (const open of [true, false]) {
      const items = buildOutline(
        doc({
          type: "toggleBlock",
          attrs: { open },
          content: [
            { type: "toggleSummary", content: [{ type: "text", text: "Summary" }] },
            { type: "toggleContent", content: [h(3, "Hidden heading")] },
          ],
        })
      );
      // A collapsed section's headings still belong in the outline — that is
      // how you navigate INTO one.
      expect(texts(items)).toEqual(["Hidden heading"]);
    }
  });

  it("finds headings inside columns, in visual order", () => {
    const items = buildOutline(
      doc({
        type: "columnBlock",
        content: [
          { type: "column", attrs: { width: null }, content: [h(2, "Left")] },
          { type: "column", attrs: { width: null }, content: [h(2, "Right")] },
        ],
      })
    );
    expect(texts(items)).toEqual(["Left", "Right"]);
  });

  it("finds deeply nested headings", () => {
    const items = buildOutline(
      doc({
        type: "columnBlock",
        content: [
          {
            type: "column",
            attrs: { width: null },
            content: [{ type: "calloutBlock", attrs: { variant: "info" }, content: [h(4, "Very nested")] }],
          },
          { type: "column", attrs: { width: null }, content: [para()] },
        ],
      })
    );
    expect(texts(items)).toEqual(["Very nested"]);
  });

  // Identity is the ProseMirror position, which is what makes duplicate
  // heading text work — the old outline matched by text and sent both
  // "Notes" entries to the first one.
  it("gives duplicate heading text distinct positions", () => {
    const items = buildOutline(doc(h(2, "Notes"), para(), h(2, "Notes")));
    expect(texts(items)).toEqual(["Notes", "Notes"]);
    expect(items[0].pos).not.toBe(items[1].pos);
  });

  it("reports positions that resolve back to the heading node", () => {
    const d = doc(h(1, "One"), para(), h(2, "Two"));
    for (const item of buildOutline(d)) {
      const node = d.nodeAt(item.pos);
      expect(node?.type.name).toBe("heading");
      expect(node?.textContent).toBe(item.text);
    }
  });
});

describe("outline indentation", () => {
  it("nests by the level sequence", () => {
    const items = buildOutline(doc(h(1, "A"), h(2, "B"), h(3, "C"), h(2, "D"), h(1, "E")));
    expect(indents(items)).toEqual([0, 1, 2, 1, 0]);
  });

  // Indenting by level NUMBER would leave a note that starts at H2 permanently
  // indented, which reads as though something is missing above it.
  it("does not indent a note that starts at H2", () => {
    const items = buildOutline(doc(h(2, "First"), h(3, "Second")));
    expect(indents(items)).toEqual([0, 1]);
  });

  it("does not leave a gap when a level is skipped", () => {
    const items = buildOutline(doc(h(1, "A"), h(4, "B")));
    expect(indents(items)).toEqual([0, 1]);
  });

  it("returns to the outer level after a deeper run", () => {
    const items = buildOutline(doc(h(1, "A"), h(3, "B"), h(3, "C"), h(1, "D")));
    expect(indents(items)).toEqual([0, 1, 1, 0]);
  });
});

describe("heading levels", () => {
  it("registers four levels, matching what the outline renders", () => {
    expect(schema.nodes.heading.spec.attrs?.level.default).toBe(1);
    // A level the schema rejects would silently drop to level 1 on parse.
    for (const level of [1, 2, 3, 4]) {
      const node = schema.nodes.heading.create({ level }, schema.text("x"));
      expect(node.attrs.level).toBe(level);
    }
  });
});
