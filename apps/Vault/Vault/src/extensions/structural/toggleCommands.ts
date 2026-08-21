// Toggle-specific keyboard behaviour.
//
// A toggle is the one container in the family with two distinct regions — a
// one-line summary and a body — so the generic container keymap isn't enough:
// its handlers only fire for a caret that is a *direct* child of the
// container, which is true in the summary and false everywhere in the body.
//
// Every command here returns false when it doesn't apply, so the shared
// handlers in createContainerNode still get their turn.

import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { containerDepth, type Dispatch } from "./containerCommands";

export const TOGGLE = "toggleBlock";
export const TOGGLE_SUMMARY = "toggleSummary";
export const TOGGLE_CONTENT = "toggleContent";

/** Position just past the last inline content of the toggle's summary. */
export function summaryEndPos(state: EditorState, togglePos: number): number | null {
  const toggle = state.doc.nodeAt(togglePos);
  const summary = toggle?.firstChild;
  if (!summary || summary.type.name !== TOGGLE_SUMMARY) return null;
  return togglePos + 1 + summary.content.size;
}

/** First position inside the toggle's body. */
export function contentStartPos(state: EditorState, togglePos: number): number | null {
  const toggle = state.doc.nodeAt(togglePos);
  const summary = toggle?.firstChild;
  if (!summary) return null;
  // +1 into the toggle, past the whole summary, +1 into toggleContent,
  // +1 into its first block.
  return togglePos + 1 + summary.nodeSize + 2;
}

/**
 * Enter inside the summary moves into the body.
 *
 * Without this the key is simply dead: `toggleSummary` is `inline*` and
 * `toggleBlock` is exactly `toggleSummary toggleContent`, so there is no split
 * ProseMirror is allowed to make and `splitBlock` fails silently.
 */
export function enterInToggleSummary() {
  return ({ state, dispatch }: { state: EditorState; dispatch: Dispatch }): boolean => {
    const $from = state.selection.$from;
    if ($from.parent.type.name !== TOGGLE_SUMMARY) return false;

    const depth = containerDepth($from, [TOGGLE]);
    if (depth === null) return false;
    const togglePos = $from.before(depth);
    const target = contentStartPos(state, togglePos);
    if (target === null) return false;
    if (!dispatch) return true;

    const tr = state.tr;
    // Opening on the way in: typing into a body you can't see is the single
    // most confusing thing this block could do.
    if (!state.doc.nodeAt(togglePos)?.attrs.open) {
      tr.setNodeAttribute(togglePos, "open", true);
    }
    tr.setSelection(TextSelection.near(tr.doc.resolve(target)));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * Backspace at the very start of the body's first block.
 *
 * Empty first block with siblings → remove it. Otherwise → move the caret up
 * to the end of the summary rather than deleting anything. Joining a body
 * paragraph into the summary would be a *type* change (block into `inline*`)
 * and silently drops any block-level structure it was carrying.
 */
export function backspaceAtToggleContentStart() {
  return ({ state, dispatch }: { state: EditorState; dispatch: Dispatch }): boolean => {
    const { selection } = state;
    if (!selection.empty) return false;

    const $from = selection.$from;
    if ($from.parentOffset !== 0) return false;

    const contentDepth = containerDepth($from, [TOGGLE_CONTENT]);
    if (contentDepth === null) return false;
    // Only the body's own direct children; a list inside it keeps its own keys.
    if ($from.depth !== contentDepth + 1) return false;
    if ($from.index(contentDepth) !== 0) return false;

    const toggleDepth = containerDepth($from, [TOGGLE]);
    if (toggleDepth === null) return false;

    const body = $from.node(contentDepth);
    const isEmptyFirst = $from.parent.isTextblock && $from.parent.content.size === 0;

    if (!dispatch) return true;

    if (isEmptyFirst && body.childCount > 1) {
      const tr = state.tr.delete($from.before(), $from.after());
      tr.setSelection(TextSelection.near(tr.doc.resolve($from.before())));
      dispatch(tr.scrollIntoView());
      return true;
    }

    const target = summaryEndPos(state, $from.before(toggleDepth));
    if (target === null) return false;
    const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(target), -1));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * Backspace at the start of the summary unwraps the whole toggle: the summary
 * becomes a paragraph and the body's blocks follow it as siblings.
 *
 * The generic container unwrap can't be reused — it would splice
 * `toggleSummary` and `toggleContent` into the document as-is, and neither is
 * in `group: "block"`, so the result wouldn't be a valid document.
 */
export function backspaceAtToggleSummaryStart() {
  return ({ state, dispatch }: { state: EditorState; dispatch: Dispatch }): boolean => {
    const { selection } = state;
    if (!selection.empty) return false;

    const $from = selection.$from;
    if ($from.parent.type.name !== TOGGLE_SUMMARY) return false;
    if ($from.parentOffset !== 0) return false;

    const depth = containerDepth($from, [TOGGLE]);
    if (depth === null) return false;
    if (!dispatch) return true;

    const toggle = $from.node(depth);
    const from = $from.before(depth);
    const to = $from.after(depth);
    const paragraph = state.schema.nodes.paragraph;

    const summary = toggle.child(0);
    const body = toggle.childCount > 1 ? toggle.child(1) : null;

    const replacement: any[] = [paragraph.create(null, summary.content)];
    body?.forEach((child) => replacement.push(child));

    const tr = state.tr.replaceWith(from, to, replacement);
    tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1)));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * Insert a toggle at the caret.
 *
 * When the caret sits in a paragraph that already has text, that text becomes
 * the summary — the overwhelmingly common gesture is "make this line a
 * toggle", and inserting an empty one below it instead means retyping the
 * title. An empty paragraph is replaced outright rather than left stranded
 * above the new block.
 */
export function insertToggle() {
  return ({ state, dispatch }: { state: EditorState; dispatch: Dispatch }): boolean => {
    const { schema } = state;
    const toggle = schema.nodes[TOGGLE];
    const summary = schema.nodes[TOGGLE_SUMMARY];
    const body = schema.nodes[TOGGLE_CONTENT];
    const paragraph = schema.nodes.paragraph;
    if (!toggle || !summary || !body || !paragraph) return false;

    const $from = state.selection.$from;
    const parent = $from.parent;
    const canAdopt =
      state.selection.empty && parent.type.name === "paragraph" && $from.depth >= 1;

    if (!dispatch) return true;

    const node = toggle.create({ open: true }, [
      summary.create(null, canAdopt ? parent.content : undefined),
      body.create(null, paragraph.create()),
    ]);

    const from = canAdopt ? $from.before() : state.selection.from;
    const to = canAdopt ? $from.after() : state.selection.to;

    const tr = state.tr.replaceWith(from, to, node);
    // Caret into the summary, at its end when text was adopted.
    const summaryStart = from + 2;
    const offset = canAdopt ? parent.content.size : 0;
    tr.setSelection(TextSelection.near(tr.doc.resolve(summaryStart + offset)));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * Flip a toggle's `open` attribute.
 *
 * `addToHistory: false` on purpose — Cmd-Z undoing a collapse instead of your
 * last edit is the classic complaint about disclosure widgets, and collapsing
 * isn't a change to the document's meaning.
 *
 * The selection rescue is not optional: the body stays in the DOM when
 * collapsed (a node view must always render its contentDOM or ProseMirror
 * desyncs), it's merely `display: none`. A caret left inside it vanishes while
 * still accepting keystrokes, which land invisibly.
 */
export function buildToggleTransaction(state: EditorState, togglePos: number, open: boolean): Transaction | null {
  const toggle = state.doc.nodeAt(togglePos);
  if (!toggle || toggle.type.name !== TOGGLE) return null;

  const tr = state.tr.setNodeAttribute(togglePos, "open", open);
  tr.setMeta("addToHistory", false);

  if (!open) {
    const summaryEnd = summaryEndPos(state, togglePos);
    const bodyStart = togglePos + 1 + toggle.child(0).nodeSize;
    const bodyEnd = togglePos + toggle.nodeSize;
    const { from } = state.selection;
    if (summaryEnd !== null && from >= bodyStart && from <= bodyEnd) {
      tr.setSelection(TextSelection.near(tr.doc.resolve(summaryEnd), -1));
    }
  }

  return tr;
}
