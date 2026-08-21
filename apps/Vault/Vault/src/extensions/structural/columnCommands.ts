// Column insertion, navigation and deletion.

import { TextSelection, type EditorState } from "@tiptap/pm/state";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { containerDepth, type Dispatch } from "./containerCommands";

export const COLUMN = "column";
export const COLUMN_BLOCK = "columnBlock";

/** Depth of the enclosing `column`, or null. */
export function columnDepth($pos: any): number | null {
  return containerDepth($pos, [COLUMN]);
}

/**
 * Build a row of `count` empty columns, optionally seeding the first.
 *
 * `seed` must be BLOCK content — a column is `block+`. Passing a paragraph's
 * inline content here (which is what the toggle's `inline*` summary wants)
 * produces a column ProseMirror silently declines to fill, and the adopted
 * text vanishes.
 */
export function makeRow(state: EditorState, count: number, seed?: PMNode | Fragment | null) {
  const { schema } = state;
  const row = schema.nodes[COLUMN_BLOCK];
  const col = schema.nodes[COLUMN];
  const paragraph = schema.nodes.paragraph;
  if (!row || !col || !paragraph) return null;

  const columns = [];
  for (let i = 0; i < count; i++) {
    const content = i === 0 && seed ? seed : paragraph.create();
    columns.push(col.create(null, content as any));
  }
  return row.create(null, columns);
}

/**
 * Insert a row of columns at the caret.
 *
 * A non-empty paragraph becomes the first column's content — same reasoning as
 * the toggle: "put this beside something" is the actual gesture, and dropping
 * an empty row underneath means moving the text by hand.
 */
export function insertColumns(count = 2) {
  return ({ state, dispatch }: { state: EditorState; dispatch: Dispatch }): boolean => {
    const $from = state.selection.$from;
    const parent = $from.parent;
    const canAdopt =
      state.selection.empty && parent.type.name === "paragraph" && parent.content.size > 0;

    // The paragraph NODE, not its content — a column holds blocks.
    const node = makeRow(state, count, canAdopt ? parent : null);
    if (!node) return false;
    if (!dispatch) return true;

    const from = canAdopt ? $from.before() : state.selection.from;
    const to = canAdopt ? $from.after() : state.selection.to;

    const tr = state.tr.replaceWith(from, to, node);
    // Caret into the first column's first block: +1 row, +1 column, +1 block.
    tr.setSelection(TextSelection.near(tr.doc.resolve(from + 3)));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Move the caret into the sibling column in `dir`, or out of the row. */
function moveColumn(dir: 1 | -1) {
  return ({ state, dispatch }: { state: EditorState; dispatch: Dispatch }): boolean => {
    const $from = state.selection.$from;
    const depth = columnDepth($from);
    // Returning false here is what lets StarterKit's list-keymap keep Tab for
    // indenting list items everywhere outside a column.
    if (depth === null) return false;

    const rowDepth = depth - 1;
    const row = $from.node(rowDepth);
    const index = $from.index(rowDepth);
    const next = index + dir;

    if (!dispatch) return true;

    // Past the last column, Tab leaves the row entirely rather than doing
    // nothing — a row you can't Tab out of is a trap for keyboard users.
    if (next < 0 || next >= row.childCount) {
      const target = dir === 1 ? $from.after(rowDepth) : $from.before(rowDepth);
      const paragraph = state.schema.nodes.paragraph;
      const tr = state.tr;
      if (dir === 1) {
        tr.insert(target, paragraph.create());
        tr.setSelection(TextSelection.near(tr.doc.resolve(target + 1)));
      } else {
        tr.setSelection(TextSelection.near(tr.doc.resolve(target), -1));
      }
      dispatch(tr.scrollIntoView());
      return true;
    }

    const $row = state.doc.resolve($from.before(rowDepth) + 1);
    let pos = $from.before(rowDepth) + 1;
    for (let i = 0; i < next; i++) pos += row.child(i).nodeSize;
    void $row;

    const tr = state.tr.setSelection(
      TextSelection.near(state.doc.resolve(pos + 1), dir === 1 ? 1 : -1)
    );
    dispatch(tr.scrollIntoView());
    return true;
  };
}

export const tabBetweenColumns = () => moveColumn(1);
export const shiftTabBetweenColumns = () => moveColumn(-1);

/**
 * Remove the column the caret is in.
 *
 * `column{2,}` makes a one-column row invalid, so at two columns the whole row
 * has to collapse — deleting the node alone would leave a document the schema
 * rejects. The survivors' content is lifted out in order, never discarded.
 */
export function deleteColumn() {
  return ({ state, dispatch }: { state: EditorState; dispatch: Dispatch }): boolean => {
    const $from = state.selection.$from;
    const depth = columnDepth($from);
    if (depth === null) return false;

    const rowDepth = depth - 1;
    const row = $from.node(rowDepth);
    const index = $from.index(rowDepth);
    const rowFrom = $from.before(rowDepth);
    const rowTo = $from.after(rowDepth);

    if (!dispatch) return true;

    if (row.childCount <= 2) {
      // Collapse the row: every remaining column's blocks become siblings.
      const kept: PMNode[] = [];
      row.forEach((col, _off, i) => {
        if (i === index) return;
        col.forEach((child) => kept.push(child));
      });
      const replacement = kept.length ? kept : [state.schema.nodes.paragraph.create()];
      const tr = state.tr.replaceWith(rowFrom, rowTo, replacement);
      tr.setSelection(TextSelection.near(tr.doc.resolve(rowFrom + 1)));
      dispatch(tr.scrollIntoView());
      return true;
    }

    const colFrom = $from.before(depth);
    const colTo = $from.after(depth);
    const tr = state.tr.delete(colFrom, colTo);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(colFrom + 1, tr.doc.content.size))));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Append an empty column to the row the caret is in. */
export function addColumn() {
  return ({ state, dispatch }: { state: EditorState; dispatch: Dispatch }): boolean => {
    const $from = state.selection.$from;
    const depth = columnDepth($from);
    if (depth === null) return false;
    const rowDepth = depth - 1;
    const col = state.schema.nodes[COLUMN];
    const paragraph = state.schema.nodes.paragraph;
    if (!col || !paragraph) return false;
    if (!dispatch) return true;

    const at = $from.after(rowDepth) - 1;
    const tr = state.tr.insert(at, col.create(null, paragraph.create()));
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 2)));
    dispatch(tr.scrollIntoView());
    return true;
  };
}
