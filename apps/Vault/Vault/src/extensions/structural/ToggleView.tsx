// The family's only React node view.
//
// It exists for exactly one reason: the disclosure triangle is a control, not
// content — it must be clickable, non-editable, and outside the flow that
// ProseMirror manages. Callout and Container need nothing of the sort and are
// deliberately plain renderHTML.

import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { buildToggleTransaction } from "./toggleCommands";

export function ToggleView({ node, editor, getPos }: NodeViewProps) {
  const open = node.attrs.open !== false;

  function toggle(e: React.MouseEvent | React.KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return;
    const tr = buildToggleTransaction(editor.state, pos, !open);
    if (tr) editor.view.dispatch(tr);
  }

  return (
    <NodeViewWrapper
      className={`toggle-block ${open ? "is-open" : "is-collapsed"}`}
      data-type="toggle"
      data-open={open ? "true" : "false"}
    >
      {/* contentEditable={false} keeps the caret from ever landing on the
          triangle, and stops Backspace from half-deleting it. */}
      <button
        type="button"
        className="toggle-caret"
        contentEditable={false}
        onMouseDown={(e) => e.preventDefault()} // don't steal the selection
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? "Collapse" : "Expand"}
        title={open ? "Collapse" : "Expand"}
      >
        <span className="toggle-caret-glyph" aria-hidden="true">▶</span>
      </button>

      {/*
        ONE NodeViewContent for BOTH children. A node view can only have a
        single contentDOM, so the summary and the body are rendered together
        and the collapse is a class on the wrapper that hides the body in CSS.

        Never render this conditionally. ProseMirror requires contentDOM to
        exist for the node view's entire life — dropping it while collapsed
        desyncs the view and silently swallows edits.
      */}
      <NodeViewContent className="toggle-body" />
    </NodeViewWrapper>
  );
}
