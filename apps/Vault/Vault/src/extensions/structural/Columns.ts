// Multi-column rows.
//
// The containment rule needs no plugin policing it: `columnBlock` is
// `column{2,}` and `column` is deliberately not in `group: "block"`, so a
// column is unplaceable anywhere else and a row can hold nothing else. `{2,}`
// also makes a one-column row structurally impossible — which is precisely why
// "delete a column" has to be a command that collapses the row rather than a
// plain node deletion.

import { Node, mergeAttributes } from "@tiptap/core";
import { createContainerNode } from "./createContainerNode";
import { columnResizePlugin } from "./columnResize";
import { tabBetweenColumns, shiftTabBetweenColumns } from "./columnCommands";

export const COLUMN = "column";
export const COLUMN_BLOCK = "columnBlock";

/** Grow value a column with no explicit width renders at. */
export const DEFAULT_COLUMN_GROW = 1;

export const ColumnBlock = createContainerNode({
  name: COLUMN_BLOCK,
  content: `${COLUMN}{2,}`,
  dataType: "columns",
  className: () => "columns-row",
  keyboard: ({ editor }) => {
    const run =
      (cmd: (p: { state: any; dispatch: any }) => boolean) =>
      () =>
        cmd({ state: editor.state, dispatch: (tr: any) => editor.view.dispatch(tr) });
    return {
      // Both return false outside a column, so StarterKit's list-keymap keeps
      // Tab for indenting list items — which is the binding people reach for
      // far more often than column navigation.
      Tab: run(tabBetweenColumns()),
      "Shift-Tab": run(shiftTabBetweenColumns()),
    };
  },
});

export const Column = Node.create({
  name: COLUMN,
  content: "block+",

  // Not `group: "block"` — see the header. This is the containment rule.
  isolating: true,
  defining: true,

  // Same reasoning as the rest of the family: the keymap must outrank
  // StarterKit's baseKeymap or its handlers are never consulted.
  priority: 1000,

  addAttributes() {
    return {
      width: {
        // A flex-grow value, not a pixel width. Pixels break the moment the
        // pane is split or the iPad is rotated; a grow value re-solves itself
        // at any container width and survives an HTML round trip inside the
        // style attribute with no JS.
        default: null as number | null,
        parseHTML: (el) => {
          const grow = parseFloat((el as HTMLElement).style.flexGrow || "");
          return Number.isFinite(grow) && grow > 0 ? grow : null;
        },
        renderHTML: (attrs) => ({
          style: `flex: ${attrs.width ?? DEFAULT_COLUMN_GROW} 1 0%`,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="column"]', priority: 60 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "column", class: "column" }), 0];
  },

  addProseMirrorPlugins() {
    // The drag gutters are widget decorations rather than a React node view on
    // the row. Decorations cost one DOM node per boundary; a node view would
    // cost a React tree per row and re-reconcile on every keystroke inside it.
    // Same shape prosemirror-tables uses for its own column resizing.
    return [columnResizePlugin()];
  },
});
