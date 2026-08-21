import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { noteSchema } from "../noteExtensions";
import {
  insertToggle,
  enterInToggleSummary,
  backspaceAtToggleSummaryStart,
  backspaceAtToggleContentStart,
  buildToggleTransaction,
  summaryEndPos,
} from "./toggleCommands";

const schema = noteSchema();
const doc = (...content: any[]) => schema.nodeFromJSON({ type: "doc", content });
const para = (text?: string) => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const toggle = (summary: string, body: any[] = [para("body")], open = true) => ({
  type: "toggleBlock",
  attrs: { open },
  content: [
    { type: "toggleSummary", ...(summary ? { content: [{ type: "text", text: summary }] } : {}) },
    { type: "toggleContent", content: body },
  ],
});

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

describe("insertToggle", () => {
  // "Make this line a toggle" is the overwhelmingly common gesture; inserting
  // an empty toggle below instead means retyping the title you just wrote.
  it("adopts the current paragraph's text as the summary", () => {
    const state = stateWithCaret(doc(para("My section")), (n) => n.type.name === "paragraph");
    const { handled, json } = run(insertToggle(), state);
    expect(handled).toBe(true);
    expect(types(json)).toEqual(["toggleBlock"]);
    const t = json.content[0];
    expect(t.content[0].type).toBe("toggleSummary");
    expect(t.content[0].content[0].text).toBe("My section");
    expect(t.content[1].type).toBe("toggleContent");
    // The adopted paragraph is consumed, not left stranded above.
    expect(json.content).toHaveLength(1);
  });

  it("puts the caret at the end of the adopted summary", () => {
    const state = stateWithCaret(doc(para("Title")), (n) => n.type.name === "paragraph");
    const { state: next } = run(insertToggle(), state);
    const $f = next!.selection.$from;
    expect($f.parent.type.name).toBe("toggleSummary");
    expect($f.parentOffset).toBe("Title".length);
  });

  it("gives the body an empty paragraph to type into", () => {
    const state = stateWithCaret(doc(para("x")), (n) => n.type.name === "paragraph");
    const { json } = run(insertToggle(), state);
    const body = json.content[0].content[1];
    expect(body.content).toHaveLength(1);
    expect(body.content[0].type).toBe("paragraph");
  });
});

describe("Enter inside the summary", () => {
  // toggleSummary is `inline*` and toggleBlock is exactly
  // `toggleSummary toggleContent`, so there is no split ProseMirror is allowed
  // to make — without this handler the key is simply dead.
  it("moves the caret into the body", () => {
    const state = stateWithCaret(doc(toggle("Summary")), (n) => n.type.name === "toggleSummary");
    const { handled, state: next } = run(enterInToggleSummary(), state);
    expect(handled).toBe(true);
    expect(next!.selection.$from.parent.type.name).toBe("paragraph");
    expect(next!.selection.$from.node(2).type.name).toBe("toggleContent");
  });

  it("opens a collapsed toggle on the way in", () => {
    // Typing into a body you cannot see is the worst thing this block could do.
    const state = stateWithCaret(doc(toggle("Summary", [para("body")], false)), (n) => n.type.name === "toggleSummary");
    const { json } = run(enterInToggleSummary(), state);
    expect(json.content[0].attrs.open).toBe(true);
  });

  it("declines outside a summary", () => {
    const state = stateWithCaret(doc(para("plain")), (n) => n.type.name === "paragraph");
    expect(run(enterInToggleSummary(), state).handled).toBe(false);
  });
});

describe("Backspace at the summary start", () => {
  const cmd = backspaceAtToggleSummaryStart();

  it("unwraps the whole toggle, summary first then the body's blocks", () => {
    const state = stateWithCaret(
      doc(toggle("Title", [para("one"), para("two")])),
      (n) => n.type.name === "toggleSummary"
    );
    const { handled, json } = run(cmd, state);
    expect(handled).toBe(true);
    // The generic container unwrap can't be reused here: it would splice
    // toggleSummary/toggleContent into the doc as-is, and neither is a block.
    expect(types(json)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(json.content[0].content[0].text).toBe("Title");
    expect(json.content[1].content[0].text).toBe("one");
    expect(json.content[2].content[0].text).toBe("two");
  });

  it("declines mid-summary so Backspace still deletes a character", () => {
    const state = stateWithCaret(doc(toggle("Title")), (n) => n.type.name === "toggleSummary", 3);
    expect(run(cmd, state).handled).toBe(false);
  });
});

describe("Backspace at the body start", () => {
  const cmd = backspaceAtToggleContentStart();

  it("moves the caret up to the summary rather than merging blocks into it", () => {
    // Joining a body paragraph into an `inline*` summary is a type change that
    // silently drops any block structure it carried.
    const d = doc(toggle("Title", [para("body")]));
    const state = stateWithCaret(d, (n) => n.type.name === "paragraph" && n.textContent === "body");
    const { handled, state: next, json } = run(cmd, state);
    expect(handled).toBe(true);
    expect(json).not.toBeNull();
    expect(next!.selection.$from.parent.type.name).toBe("toggleSummary");
    // Nothing was deleted.
    expect(next!.doc.toJSON().content[0].content[1].content).toHaveLength(1);
  });

  it("removes an empty first block when the body has more", () => {
    const d = doc(toggle("Title", [para(), para("kept")]));
    const state = stateWithCaret(d, (n) => n.type.name === "paragraph" && n.content.size === 0);
    const { handled, json } = run(cmd, state);
    expect(handled).toBe(true);
    const body = json.content[0].content[1];
    expect(body.content).toHaveLength(1);
    expect(body.content[0].content[0].text).toBe("kept");
  });

  it("declines for a block that isn't the body's first child", () => {
    const d = doc(toggle("Title", [para("one"), para("two")]));
    const state = stateWithCaret(d, (n) => n.type.name === "paragraph" && n.textContent === "two");
    expect(run(cmd, state).handled).toBe(false);
  });
});

describe("buildToggleTransaction", () => {
  it("flips open and stays out of the undo history", () => {
    // Cmd-Z undoing a collapse instead of your last edit is the classic
    // complaint about disclosure widgets.
    const d = doc(toggle("Title"));
    const state = EditorState.create({ doc: d, schema });
    const tr = buildToggleTransaction(state, 0, false)!;
    expect(tr.getMeta("addToHistory")).toBe(false);
    expect(state.apply(tr).doc.toJSON().content[0].attrs.open).toBe(false);
  });

  // The body stays in the DOM when collapsed — a node view must keep its
  // contentDOM alive — so a caret left inside it vanishes while still
  // accepting keystrokes, which then land invisibly.
  it("rescues a caret that was inside the body being collapsed", () => {
    const d = doc(toggle("Title", [para("hidden")]));
    const state = stateWithCaret(d, (n) => n.type.name === "paragraph" && n.textContent === "hidden");
    const tr = buildToggleTransaction(state, 0, false)!;
    const next = state.apply(tr);
    expect(next.selection.$from.parent.type.name).toBe("toggleSummary");
    expect(next.selection.from).toBe(summaryEndPos(state, 0));
  });

  it("leaves a caret outside the toggle alone", () => {
    const d = doc(toggle("Title"), para("after"));
    const state = stateWithCaret(d, (n) => n.type.name === "paragraph" && n.textContent === "after");
    const before = state.selection.from;
    const next = state.apply(buildToggleTransaction(state, 0, false)!);
    expect(next.selection.from).toBe(before);
  });

  it("does not rescue when expanding", () => {
    const d = doc(toggle("Title", [para("body")], false));
    const state = stateWithCaret(d, (n) => n.type.name === "toggleSummary", 2);
    const before = state.selection.from;
    const next = state.apply(buildToggleTransaction(state, 0, true)!);
    expect(next.selection.from).toBe(before);
  });

  it("refuses a position that isn't a toggle", () => {
    const state = EditorState.create({ doc: doc(para("plain")), schema });
    expect(buildToggleTransaction(state, 0, false)).toBeNull();
  });
});
