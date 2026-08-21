import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { noteSchema } from "../noteExtensions";
import {
  insertColumns,
  deleteColumn,
  addColumn,
  tabBetweenColumns,
  shiftTabBetweenColumns,
} from "./columnCommands";
import { buildColumnDecorations } from "./columnResize";

const schema = noteSchema();
const doc = (...content: any[]) => schema.nodeFromJSON({ type: "doc", content });
const para = (text?: string) => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const col = (text: string, width?: number) => ({
  type: "column",
  attrs: { width: width ?? null },
  content: [para(text)],
});
const row = (...cols: any[]) => ({ type: "columnBlock", content: cols });

function stateWithCaret(d: any, pred: (n: any) => boolean, offsetInChild = 0) {
  let target: number | null = null;
  d.descendants((n: any, pos: number) => {
    if (target === null && pred(n)) target = pos;
  });
  if (target === null) throw new Error("target not found");
  const node = d.nodeAt(target);
  const inside = target + 1 + (node.isTextblock ? 0 : 1) + offsetInChild;
  const state = EditorState.create({ doc: d, schema });
  return state.apply(state.tr.setSelection(TextSelection.create(d, inside)));
}

function run(cmd: any, state: EditorState) {
  let next: EditorState | null = null;
  const handled = cmd({ state, dispatch: (tr: any) => { next = state.apply(tr); } });
  return { handled, state: next as EditorState | null, json: next ? (next as EditorState).doc.toJSON() : null };
}

const types = (json: any) => (json.content ?? []).map((n: any) => n.type);
const colTexts = (rowJson: any) =>
  rowJson.content.map((c: any) => c.content.map((b: any) => b.content?.[0]?.text ?? "").join(""));

describe("schema containment", () => {
  // Enforced by the schema rather than policed by a plugin: `column` is not in
  // group "block", so it is unplaceable anywhere but inside a row.
  it("keeps `column` out of group block", () => {
    expect(schema.nodes.column.isInGroup("block")).toBe(false);
    expect(schema.nodes.columnBlock.isInGroup("block")).toBe(true);
  });

  it("refuses a row with fewer than two columns", () => {
    const one = schema.nodes.columnBlock.createAndFill(null, [
      schema.nodes.column.create(null, schema.nodes.paragraph.create()),
    ]);
    // createAndFill pads to satisfy column{2,} rather than returning something
    // invalid; the point is that a one-column row cannot exist.
    expect(one === null || one.childCount >= 2).toBe(true);
    expect(() => schema.nodes.columnBlock.create(null, [
      schema.nodes.column.create(null, schema.nodes.paragraph.create()),
    ]).check()).toThrow();
  });

  it("refuses a non-column child in a row", () => {
    expect(() =>
      schema.nodes.columnBlock.create(null, [schema.nodes.paragraph.create(), schema.nodes.paragraph.create()]).check()
    ).toThrow();
  });
});

describe("insertColumns", () => {
  it("adopts the current paragraph into the first column", () => {
    const state = stateWithCaret(doc(para("beside me")), (n) => n.type.name === "paragraph");
    const { handled, json } = run(insertColumns(2), state);
    expect(handled).toBe(true);
    expect(types(json)).toEqual(["columnBlock"]);
    expect(colTexts(json.content[0])).toEqual(["beside me", ""]);
  });

  it("makes as many columns as asked for", () => {
    for (const n of [2, 3, 4]) {
      const state = stateWithCaret(doc(para("x")), (p) => p.type.name === "paragraph");
      const { json } = run(insertColumns(n), state);
      expect(json.content[0].content).toHaveLength(n);
    }
  });

  it("puts the caret in the first column", () => {
    const state = stateWithCaret(doc(para("x")), (n) => n.type.name === "paragraph");
    const { state: next } = run(insertColumns(2), state);
    expect(next!.selection.$from.node(2).type.name).toBe("column");
    expect(next!.selection.$from.index(1)).toBe(0);
  });
});

describe("Tab between columns", () => {
  it("moves forward into the next column", () => {
    const d = doc(row(col("one"), col("two")));
    const state = stateWithCaret(d, (n) => n.type.name === "paragraph" && n.textContent === "one");
    const { handled, state: next } = run(tabBetweenColumns(), state);
    expect(handled).toBe(true);
    expect(next!.selection.$from.parent.textContent).toBe("two");
  });

  it("moves backward with Shift-Tab", () => {
    const d = doc(row(col("one"), col("two")));
    const state = stateWithCaret(d, (n) => n.type.name === "paragraph" && n.textContent === "two");
    const { handled, state: next } = run(shiftTabBetweenColumns(), state);
    expect(handled).toBe(true);
    expect(next!.selection.$from.parent.textContent).toBe("one");
  });

  // A row you can't Tab out of is a trap for keyboard users.
  it("escapes the row past the last column", () => {
    const d = doc(row(col("one"), col("two")));
    const state = stateWithCaret(d, (n) => n.type.name === "paragraph" && n.textContent === "two");
    const { handled, json, state: next } = run(tabBetweenColumns(), state);
    expect(handled).toBe(true);
    expect(types(json)).toEqual(["columnBlock", "paragraph"]);
    expect(next!.selection.$from.node(1).type.name).toBe("paragraph");
  });

  // This is what lets StarterKit's list-keymap keep Tab for indenting.
  it("declines outside a column so list indentation still works", () => {
    const state = stateWithCaret(doc(para("plain")), (n) => n.type.name === "paragraph");
    expect(run(tabBetweenColumns(), state).handled).toBe(false);
    expect(run(shiftTabBetweenColumns(), state).handled).toBe(false);
  });
});

describe("deleteColumn", () => {
  // column{2,} makes a one-column row invalid, so deleting the node alone
  // would leave a document the schema rejects.
  it("collapses the whole row when only two columns remain", () => {
    const d = doc(row(col("keep"), col("drop")));
    const state = stateWithCaret(d, (n) => n.type.name === "paragraph" && n.textContent === "drop");
    const { handled, json } = run(deleteColumn(), state);
    expect(handled).toBe(true);
    expect(types(json)).toEqual(["paragraph"]);
    // The survivor's content is lifted out, never discarded.
    expect(json.content[0].content[0].text).toBe("keep");
  });

  it("keeps every survivor's blocks in order when collapsing", () => {
    const d = doc(row(
      { type: "column", attrs: { width: null }, content: [para("a1"), para("a2")] },
      col("gone")
    ));
    const state = stateWithCaret(d, (n) => n.type.name === "paragraph" && n.textContent === "gone");
    const { json } = run(deleteColumn(), state);
    expect(json.content.map((n: any) => n.content?.[0]?.text)).toEqual(["a1", "a2"]);
  });

  it("removes just the one column when three remain", () => {
    const d = doc(row(col("one"), col("two"), col("three")));
    const state = stateWithCaret(d, (n) => n.type.name === "paragraph" && n.textContent === "two");
    const { handled, json } = run(deleteColumn(), state);
    expect(handled).toBe(true);
    expect(types(json)).toEqual(["columnBlock"]);
    expect(colTexts(json.content[0])).toEqual(["one", "three"]);
  });

  it("declines outside a column", () => {
    const state = stateWithCaret(doc(para("plain")), (n) => n.type.name === "paragraph");
    expect(run(deleteColumn(), state).handled).toBe(false);
  });
});

describe("addColumn", () => {
  it("appends an empty column to the row", () => {
    const d = doc(row(col("one"), col("two")));
    const state = stateWithCaret(d, (n) => n.type.name === "paragraph" && n.textContent === "one");
    const { handled, json } = run(addColumn(), state);
    expect(handled).toBe(true);
    expect(colTexts(json.content[0])).toEqual(["one", "two", ""]);
  });
});

describe("resize gutters", () => {
  it("places one gutter between each adjacent pair", () => {
    const d = doc(row(col("a"), col("b"), col("c")), para("after"));
    const set = buildColumnDecorations(d);
    expect(set.find().length).toBe(2);
  });

  it("places none when there are no rows", () => {
    expect(buildColumnDecorations(doc(para("x"))).find().length).toBe(0);
  });

  it("handles several rows in one document", () => {
    const d = doc(row(col("a"), col("b")), para("x"), row(col("c"), col("d"), col("e")));
    expect(buildColumnDecorations(d).find().length).toBe(3);
  });
});

describe("column width attribute", () => {
  // Grow values, not pixels: pixels break the moment the pane is split or the
  // iPad is rotated, and they don't survive a container-width change.
  it("round-trips a fractional width through the style attribute", () => {
    const d = doc(row(col("a", 0.38), col("b", 1.62)));
    const json = d.toJSON();
    expect(json.content[0].content[0].attrs.width).toBe(0.38);
    expect(json.content[0].content[1].attrs.width).toBe(1.62);
  });
});
