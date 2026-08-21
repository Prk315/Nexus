import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { noteSchema } from "../noteExtensions";
import { Callout } from "./Callout";
import { Container } from "./Container";
import {
  backspaceAtContainerStart,
  enterAtContainerEnd,
  escapeContainer,
  containerDepth,
  isEmptyContainer,
} from "./containerCommands";

const schema = noteSchema();
const NAMES = ["calloutBlock", "containerBlock"] as const;

const doc = (...content: any[]) => schema.nodeFromJSON({ type: "doc", content });
const para = (text?: string) => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const callout = (variant: string, ...content: any[]) => ({
  type: "calloutBlock",
  attrs: { variant },
  content: content.length ? content : [para()],
});

/** Build a state with the caret inside the first node matching `pred`. */
function stateWithCaret(d: any, pred: (n: any) => boolean, offsetInChild = 0) {
  let target: number | null = null;
  d.descendants((n: any, pos: number) => {
    if (target === null && pred(n)) target = pos;
  });
  if (target === null) throw new Error("target node not found");
  const node = d.nodeAt(target);
  const inside = target + 1 + (node.isTextblock ? 0 : 1) + offsetInChild;
  const state = EditorState.create({ doc: d, schema });
  return state.apply(state.tr.setSelection(TextSelection.create(d, inside)));
}

/** Run a command; returns the resulting doc as JSON, or null if it declined. */
function run(cmd: any, state: EditorState) {
  let next: EditorState | null = null;
  const handled = cmd({ state, dispatch: (tr: any) => { next = state.apply(tr); } });
  return { handled, json: next ? (next as EditorState).doc.toJSON() : null };
}

const types = (json: any) => (json.content ?? []).map((n: any) => n.type);
const texts = (json: any) =>
  (json.content ?? []).map((n: any) => {
    const walk = (x: any): string =>
      x.text ?? (x.content ?? []).map(walk).join("");
    return walk(n);
  });

describe("containerDepth / isEmptyContainer", () => {
  it("finds the nearest matching ancestor", () => {
    const state = stateWithCaret(doc(callout("note", para("hi"))), (n) => n.type.name === "calloutBlock");
    expect(containerDepth(state.selection.$from, NAMES)).toBe(1);
  });

  it("returns null outside the family", () => {
    const state = stateWithCaret(doc(para("plain")), (n) => n.type.name === "paragraph");
    expect(containerDepth(state.selection.$from, NAMES)).toBeNull();
  });

  it("treats a single empty textblock as empty, and anything else as not", () => {
    const empty = schema.nodeFromJSON(callout("note", para()));
    const full = schema.nodeFromJSON(callout("note", para("x")));
    const two = schema.nodeFromJSON(callout("note", para(), para()));
    expect(isEmptyContainer(empty)).toBe(true);
    expect(isEmptyContainer(full)).toBe(false);
    expect(isEmptyContainer(two)).toBe(false);
  });
});

describe("Backspace at container start", () => {
  const cmd = backspaceAtContainerStart(NAMES);

  // The behaviour this replaces: with `isolating`, the default joinBackward
  // declines and the key appears dead. Unwrapping is chosen over lifting
  // because lifting SPLITS the callout and leaves two halves.
  it("unwraps a non-empty callout, keeping every child as a sibling", () => {
    const state = stateWithCaret(
      doc(para("before"), callout("note", para("one"), para("two"))),
      (n) => n.type.name === "calloutBlock"
    );
    const { handled, json } = run(cmd, state);
    expect(handled).toBe(true);
    expect(types(json)).toEqual(["paragraph", "paragraph", "paragraph"]);
    // Crucially NOT merged into the preceding paragraph.
    expect(texts(json)).toEqual(["before", "one", "two"]);
  });

  it("deletes an empty container outright", () => {
    const state = stateWithCaret(
      doc(para("before"), callout("note")),
      (n) => n.type.name === "calloutBlock"
    );
    const { handled, json } = run(cmd, state);
    expect(handled).toBe(true);
    expect(types(json)).toEqual(["paragraph"]);
    expect(texts(json)).toEqual(["before"]);
  });

  it("declines anywhere but the very start of the first child", () => {
    // Caret mid-text: normal Backspace must still delete a character.
    const midText = stateWithCaret(doc(callout("note", para("abc"))), (n) => n.type.name === "calloutBlock", 2);
    expect(run(cmd, midText).handled).toBe(false);

    // Caret at the start of the SECOND child: not the container boundary.
    const secondChild = stateWithCaret(
      doc(callout("note", para("one"), para("two"))),
      (n) => n.type.name === "paragraph" && n.textContent === "two"
    );
    expect(run(cmd, secondChild).handled).toBe(false);
  });

  it("declines outside the family entirely", () => {
    const state = stateWithCaret(doc(para("plain")), (n) => n.type.name === "paragraph");
    expect(run(cmd, state).handled).toBe(false);
  });

  it("declines when the caret is nested deeper, so lists keep their own Backspace", () => {
    const state = stateWithCaret(
      doc(callout("note", { type: "bulletList", content: [{ type: "listItem", content: [para("item")] }] })),
      (n) => n.type.name === "paragraph" && n.textContent === "item"
    );
    expect(run(cmd, state).handled).toBe(false);
  });

  it("works for containers as well as callouts", () => {
    const state = stateWithCaret(
      doc({ type: "containerBlock", attrs: { style: "card" }, content: [para("grouped")] }),
      (n) => n.type.name === "containerBlock"
    );
    const { handled, json } = run(cmd, state);
    expect(handled).toBe(true);
    expect(types(json)).toEqual(["paragraph"]);
    expect(texts(json)).toEqual(["grouped"]);
  });
});

describe("Enter on an empty trailing paragraph", () => {
  const cmd = enterAtContainerEnd(NAMES);

  it("removes the empty paragraph and lands outside the container", () => {
    const state = stateWithCaret(
      doc(callout("note", para("body"), para())),
      (n) => n.type.name === "paragraph" && n.content.size === 0
    );
    const { handled, json } = run(cmd, state);
    expect(handled).toBe(true);
    expect(types(json)).toEqual(["calloutBlock", "paragraph"]);
    // The container keeps its real content and loses only the empty husk.
    expect(json.content[0].content).toHaveLength(1);
    expect(texts(json)).toEqual(["body", ""]);
  });

  it("drops the container entirely when the empty paragraph was its only child", () => {
    const state = stateWithCaret(doc(para("before"), callout("note")), (n) => n.type.name === "calloutBlock");
    const { handled, json } = run(cmd, state);
    expect(handled).toBe(true);
    expect(types(json)).toEqual(["paragraph", "paragraph"]);
  });

  it("declines when the paragraph has text — Enter must still split it", () => {
    const state = stateWithCaret(doc(callout("note", para("body"))), (n) => n.type.name === "calloutBlock");
    expect(run(cmd, state).handled).toBe(false);
  });

  it("declines when the empty paragraph is not the last child", () => {
    const state = stateWithCaret(
      doc(callout("note", para(), para("after"))),
      (n) => n.type.name === "paragraph" && n.content.size === 0
    );
    expect(run(cmd, state).handled).toBe(false);
  });
});

describe("Mod-Enter escape", () => {
  const cmd = escapeContainer(NAMES);

  it("adds a paragraph after the container from anywhere inside it", () => {
    const state = stateWithCaret(doc(callout("note", para("body"))), (n) => n.type.name === "calloutBlock", 2);
    const { handled, json } = run(cmd, state);
    expect(handled).toBe(true);
    expect(types(json)).toEqual(["calloutBlock", "paragraph"]);
    // The container is untouched — this is an exit, not an edit.
    expect(texts(json)).toEqual(["body", ""]);
  });

  it("declines outside the family", () => {
    const state = stateWithCaret(doc(para("plain")), (n) => n.type.name === "paragraph");
    expect(run(cmd, state).handled).toBe(false);
  });
});

// The commands above were all correct on the first attempt and still did
// nothing, because Tiptap sorts extensions by priority descending and collects
// keymap plugins in that order — at the default 100, StarterKit's baseKeymap
// saw Backspace first, joinBackward returned true, and these never ran. The
// visible symptom was a callout's text being absorbed into the paragraph above
// it. Logic tests alone would not have caught it.
describe("keymap priority", () => {
  it("puts the container family above StarterKit's default", () => {
    for (const ext of [Callout, Container]) {
      expect((ext.config as any).priority, `${ext.name} must outrank the base keymap`).toBeGreaterThan(100);
    }
  });
});
