// Collapsible toggle: a one-line summary with a body that folds away.
//
// Three nodes rather than one with a `summary` attribute. An attribute would
// lose marks, links and math in the title, and would turn every keystroke in
// the title into a setNodeMarkup of the whole block. The extra node types are
// cheaper than either.
//
// Deliberately NOT <details>/<summary>. The native disclosure behaviour and
// <summary>'s own focus/click semantics fight contenteditable — the browser
// wants to toggle on any click inside the summary, including one that was
// meant to place a caret. <details> is the right shape for an export path, not
// for the editing surface. Don't "fix" this later.

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { createContainerNode } from "./createContainerNode";
import { ToggleView } from "./ToggleView";
import {
  enterInToggleSummary,
  backspaceAtToggleContentStart,
  backspaceAtToggleSummaryStart,
} from "./toggleCommands";

export const ToggleBlock = createContainerNode({
  name: "toggleBlock",
  content: "toggleSummary toggleContent",
  dataType: "toggle",
  attrs: {
    open: {
      default: true,
      // The collapsed state is persisted rather than kept in React. Local
      // state is lost on every remount — tab switch, lazy-chunk reload, a
      // content-prop change from another pane — and re-expanding everything on
      // every tab switch is worse than having no toggle. It also can't be
      // addressed: keying by getPos() is invalidated by any edit above the
      // toggle, and keying by a generated id means persisting an id anyway.
      parseHTML: (el) => el.getAttribute("data-open") !== "false",
      renderHTML: (attrs) => ({ "data-open": attrs.open ? "true" : "false" }),
    },
  },
  className: (attrs) => `toggle-block ${attrs.open ? "is-open" : "is-collapsed"}`,
  keyboard: ({ editor }) => {
    const run =
      (cmd: (p: { state: any; dispatch: any }) => boolean) =>
      () =>
        cmd({ state: editor.state, dispatch: (tr: any) => editor.view.dispatch(tr) });
    return {
      Enter: run(enterInToggleSummary()),
      // Summary first: both guard on different parents, but the summary rule
      // is the more specific of the two.
      Backspace: () =>
        run(backspaceAtToggleSummaryStart())() || run(backspaceAtToggleContentStart())(),
    };
  },
  nodeView: () => ReactNodeViewRenderer(ToggleView),
});

// Neither part is in `group: "block"`. That is what makes them unplaceable
// anywhere except inside a toggleBlock, and makes toggleBlock unable to hold
// anything else — containment enforced by the schema rather than by a plugin
// policing it after the fact.

export const ToggleSummary = Node.create({
  name: "toggleSummary",
  content: "inline*",
  defining: true,
  selectable: false,
  parseHTML() {
    return [{ tag: 'div[data-type="toggle-summary"]', priority: 60 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "toggle-summary", class: "toggle-summary" }), 0];
  },
});

export const ToggleContent = Node.create({
  name: "toggleContent",
  content: "block+",
  defining: true,
  selectable: false,
  parseHTML() {
    return [{ tag: 'div[data-type="toggle-content"]', priority: 60 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "toggle-content", class: "toggle-content" }), 0];
  },
});
