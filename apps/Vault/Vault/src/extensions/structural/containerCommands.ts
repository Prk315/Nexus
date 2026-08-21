// Shared position maths and commands for the structural container family
// (callout, container, and — in later phases — toggle and columns).
//
// Everything here exists because `isolating: true` is load-bearing on those
// nodes and ProseMirror's default keymap gives up politely at an isolating
// boundary. "Gives up politely" means Backspace does *nothing*, which a user
// reads as the editor having frozen. Each command below replaces a silent
// no-op with a predictable one.

import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

export type Dispatch = ((tr: Transaction) => void) | undefined;

/** Depth of the nearest ancestor with one of these type names, or null. */
export function containerDepth($pos: ResolvedPos, names: readonly string[]): number | null {
  for (let d = $pos.depth; d > 0; d--) {
    if (names.includes($pos.node(d).type.name)) return d;
  }
  return null;
}

/** True when the node holds nothing but a single empty textblock. */
export function isEmptyContainer(node: PMNode): boolean {
  return node.childCount === 1 && node.firstChild!.isTextblock && node.firstChild!.content.size === 0;
}

/**
 * Replace the container with its own children.
 *
 * Chosen over ProseMirror's `lift`, which would *split* the container and
 * leave the user with two halves of a callout — technically a lift, but not
 * something anyone means by pressing Backspace at the top of one. Unwrapping
 * loses the container and keeps every word inside it, which is the only
 * outcome that's never surprising.
 */
export function unwrapContainerAt(state: EditorState, dispatch: Dispatch, depth: number): boolean {
  const $from = state.selection.$from;
  const node = $from.node(depth);
  const from = $from.before(depth);
  const to = $from.after(depth);
  if (!dispatch) return true;

  const tr = state.tr.replaceWith(from, to, node.content);
  // +1 lands inside the first lifted child rather than on the boundary.
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(from + 1, tr.doc.content.size))));
  dispatch(tr.scrollIntoView());
  return true;
}

/** Put a fresh paragraph immediately after the container and go there. */
export function escapeContainerAt(state: EditorState, dispatch: Dispatch, depth: number): boolean {
  const $from = state.selection.$from;
  const after = $from.after(depth);
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return false;
  if (!dispatch) return true;

  const tr = state.tr.insert(after, paragraph.create());
  tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
  dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Backspace at the very start of a container's first child.
 *
 * Empty container → remove it outright. Otherwise → unwrap, keeping the
 * content. Without this the default `joinBackward` refuses at the isolating
 * boundary and the key appears dead.
 */
export function backspaceAtContainerStart(names: readonly string[]) {
  return ({ state, dispatch }: { state: EditorState; dispatch: Dispatch }): boolean => {
    const { selection } = state;
    if (!selection.empty) return false;

    const $from = selection.$from;
    const depth = containerDepth($from, names);
    if (depth === null) return false;

    // Only at the very top of the container: caret at offset 0 of a textblock
    // that is itself the container's first child. Anywhere else, normal
    // Backspace is correct and must be left alone.
    if ($from.parentOffset !== 0) return false;
    if ($from.index(depth) !== 0) return false;
    // Guard against nesting: a deeper structure (a list inside the callout)
    // has its own Backspace behaviour and should get first refusal.
    if ($from.depth !== depth + 1) return false;

    const node = $from.node(depth);
    if (isEmptyContainer(node)) {
      if (!dispatch) return true;
      const from = $from.before(depth);
      const tr = state.tr.delete(from, $from.after(depth));
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size)), -1));
      dispatch(tr.scrollIntoView());
      return true;
    }

    return unwrapContainerAt(state, dispatch, depth);
  };
}

/**
 * Enter on an empty trailing paragraph inside a container — the "press Enter
 * twice to get out" gesture. Without it those empty paragraphs just accumulate
 * inside the container forever and there is no keyboard way out at all.
 */
export function enterAtContainerEnd(names: readonly string[]) {
  return ({ state, dispatch }: { state: EditorState; dispatch: Dispatch }): boolean => {
    const { selection } = state;
    if (!selection.empty) return false;

    const $from = selection.$from;
    const depth = containerDepth($from, names);
    if (depth === null) return false;
    if ($from.depth !== depth + 1) return false;

    const parent = $from.parent;
    if (!parent.isTextblock || parent.content.size !== 0) return false;

    const node = $from.node(depth);
    if ($from.index(depth) !== node.childCount - 1) return false;

    if (!dispatch) return true;

    // Sole child: the container is empty in every sense, so drop it rather
    // than leaving a decorative husk behind above the new paragraph.
    if (node.childCount === 1) {
      const from = $from.before(depth);
      const tr = state.tr.replaceWith(from, $from.after(depth), state.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1)));
      dispatch(tr.scrollIntoView());
      return true;
    }

    const tr = state.tr.delete($from.before(), $from.after());
    const after = tr.mapping.map($from.after(depth));
    tr.insert(after, state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * Unwrap the container the caret is in, from outside the keymap.
 *
 * Deliberately shares `unwrapContainerAt` with the Backspace handler rather
 * than calling Tiptap's `lift()`, which would split a multi-child container
 * around the caret. Two routes to "remove this box" that disagree about what
 * happens to its contents is worse than either one alone.
 */
export function unwrapNearestContainer(
  editor: { state: EditorState; view: { dispatch: (tr: Transaction) => void } },
  names: readonly string[]
): boolean {
  const depth = containerDepth(editor.state.selection.$from, names);
  if (depth === null) return false;
  return unwrapContainerAt(editor.state, (tr) => editor.view.dispatch(tr), depth);
}

/** Mod-Enter: leave the container from anywhere inside it. The ejector seat. */
export function escapeContainer(names: readonly string[]) {
  return ({ state, dispatch }: { state: EditorState; dispatch: Dispatch }): boolean => {
    const depth = containerDepth(state.selection.$from, names);
    if (depth === null) return false;
    return escapeContainerAt(state, dispatch, depth);
  };
}
