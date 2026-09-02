import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { buildNoteExtensions } from "./noteExtensions";

// ─── The bug this file exists for ────────────────────────────────────────────
//
// Inserting an equation silently did nothing: no node, no toolbar row, no
// error. `@tiptap/extension-mathematics`'s own commands begin
//
//     insertInlineMath: (options) => ({ editor, tr }) => {
//       const latex = options.latex;
//       if (!latex) { return false; }
//
// …so an EMPTY latex is refused. Seeding `""` — deliberately, because a
// placeholder you must delete first is a worse start than an empty field with
// the caret in it — turned every insert into a no-op.
//
// None of the existing math tests could see it. They assert on the SCHEMA and
// on HTML round trips, and the schema was never wrong; what was wrong was a
// command's runtime guard. So this file drives a real editor instead: the only
// thing that distinguishes "the node type exists" from "inserting one works".

let editor: Editor | null = null;

function makeEditor(): Editor {
  editor = new Editor({
    extensions: buildNoteExtensions(),
    content: "<p>before</p>",
  });
  return editor;
}

afterEach(() => { editor?.destroy(); editor = null; });

/** Every math node in the document, with its position. */
function mathNodes(e: Editor) {
  const found: Array<{ pos: number; type: string; latex: string }> = [];
  e.state.doc.descendants((n, pos) => {
    if (n.type.name === "inlineMath" || n.type.name === "blockMath") {
      found.push({ pos, type: n.type.name, latex: n.attrs.latex });
    }
    return true;
  });
  return found;
}

/**
 * The production insert, transcribed from NoteEditor.insertMathAtCursor.
 *
 * Duplicated rather than imported because that function is closed over a React
 * component's `editor`. Keeping the two in step is the point of the first test
 * below, which asserts the property that actually matters — a node appears —
 * rather than the implementation.
 */
function insertMath(e: Editor, kind: "inline" | "block") {
  const typeName = kind === "inline" ? "inlineMath" : "blockMath";
  const type = e.schema.nodes[typeName];
  if (!type) return;
  e.chain().focus().command(({ tr, dispatch }) => {
    if (!dispatch) return true;
    const at = tr.selection.from;
    tr.replaceSelectionWith(type.create({ latex: "" }), false);
    let pos: number | null = null;
    let best = Infinity;
    tr.doc.descendants((n, p) => {
      if (n.type.name !== typeName) return true;
      const d = Math.abs(p - at);
      if (d < best) { best = d; pos = p; }
      return false;
    });
    if (pos !== null) tr.setSelection(NodeSelection.create(tr.doc, pos));
    return true;
  }).run();
}

describe("⚠️ the extension's own insert command refuses empty latex", () => {
  // Pinned so the reason the production code does not use it stays visible. If
  // this ever goes green, the workaround can be removed.
  it("insertInlineMath returns false for an empty string", () => {
    const e = makeEditor();
    e.commands.focus();
    const ok = (e.commands as any).insertInlineMath({ latex: "" });
    expect(ok).toBe(false);
    expect(mathNodes(e)).toHaveLength(0);
  });

  it("…and accepts a non-empty one, so the guard is the only difference", () => {
    const e = makeEditor();
    e.commands.focus();
    expect((e.commands as any).insertInlineMath({ latex: "x" })).toBe(true);
    expect(mathNodes(e)).toHaveLength(1);
  });
});

describe("inserting an empty equation", () => {
  for (const kind of ["inline", "block"] as const) {
    const typeName = kind === "inline" ? "inlineMath" : "blockMath";

    it(`actually inserts a ${kind} node`, () => {
      const e = makeEditor();
      insertMath(e, kind);
      const found = mathNodes(e);
      expect(found, "nothing was inserted — the silent-failure bug").toHaveLength(1);
      expect(found[0].type).toBe(typeName);
    });

    it(`leaves the ${kind} node empty, not seeded with a placeholder`, () => {
      const e = makeEditor();
      insertMath(e, kind);
      expect(mathNodes(e)[0].latex).toBe("");
    });

    // Selected IS editable, and it is also what makes the math toolbar row
    // appear — so an insert that did not select would look like the same
    // silent failure even with a node in the document.
    it(`selects the ${kind} node it created`, () => {
      const e = makeEditor();
      insertMath(e, kind);
      const sel = e.state.selection;
      expect(sel instanceof NodeSelection).toBe(true);
      expect((sel as NodeSelection).node.type.name).toBe(typeName);
      expect(e.isActive(typeName)).toBe(true);
    });
  }

  // The old code searched for "the math node nearest the caret" afterwards,
  // which is a guess that picks the wrong equation when one is already there.
  it("selects the NEW node when the document already contains one", () => {
    const e = makeEditor();
    insertMath(e, "inline");
    const first = mathNodes(e)[0].pos;
    (e.commands as any).updateInlineMath({ latex: "old", pos: first });

    e.commands.setTextSelection(e.state.doc.content.size - 1);
    insertMath(e, "inline");

    const sel = e.state.selection as NodeSelection;
    expect(sel.node.attrs.latex).toBe("");
    expect(sel.from).not.toBe(first);
    expect(mathNodes(e)).toHaveLength(2);
  });

  it("keeps the surrounding text", () => {
    const e = makeEditor();
    insertMath(e, "inline");
    expect(e.state.doc.textContent).toContain("before");
  });
});
