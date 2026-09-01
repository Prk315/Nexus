import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import katex from "katex";
import { KATEX_OPTS } from "../lib/katexShared";
import {
  MATH_GROUPS, insertMathSymbol, getActiveMathField, type MathSymbol,
} from "../lib/mathToolbar";

/**
 * A second toolbar row, shown only while a math node is selected.
 *
 * It replaces the modal that editing used to open. The page stays exactly as
 * it was — you can see the sentence the equation belongs to while you write
 * it, which is the whole reason maths is in a document rather than a
 * calculator.
 *
 * ⚠️ Visibility is derived from the SELECTION, never from its own flag. The
 * node view uses the same signal to decide it is editable, so the row and the
 * field cannot get out of step — a separate `open` flag would let the row be
 * showing while no field exists, and its buttons would insert into nothing.
 */
export function MathToolbar({ editor }: { editor: Editor }) {
  const [, force] = useState(0);
  const [group, setGroup] = useState(MATH_GROUPS[0].id);

  // The row's existence depends on the selection, so it has to re-read on
  // every transaction. Cheap: two isActive calls.
  useEffect(() => {
    const bump = () => force((n) => n + 1);
    editor.on("transaction", bump);
    return () => { editor.off("transaction", bump); };
  }, [editor]);

  const inline = editor.isActive("inlineMath");
  const block = editor.isActive("blockMath");
  if (!inline && !block) return null;

  const items = MATH_GROUPS.find((g) => g.id === group)?.items ?? [];

  const remove = () => {
    // deleteSelection rather than the extension's delete commands: the node is
    // selected, so this is the ordinary document operation and lands in the
    // ordinary undo history like every other edit.
    editor.chain().focus().deleteSelection().run();
  };

  return (
    <div className="math-toolbar" role="toolbar" aria-label="Math">
      <span className="math-toolbar-kind">{block ? "Equation" : "Inline math"}</span>

      <div className="math-toolbar-groups">
        {MATH_GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`math-tb-group${group === g.id ? " is-on" : ""}`}
            aria-pressed={group === g.id}
            // ⚠️ The field must not lose focus, or MathLive has no caret to
            // insert at. Every button in this row prevents default on
            // mousedown for the same reason.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setGroup(g.id)}
          >{g.label}</button>
        ))}
      </div>

      <div className="math-toolbar-items">
        {items.map((it) => <SymbolButton key={it.latex + it.label} item={it} />)}
      </div>

      <div className="math-toolbar-tail">
        <button
          type="button"
          className="math-tb-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={remove}
          title="Delete this equation"
        >Delete</button>
        <button
          type="button"
          className="math-tb-btn"
          // Deliberately "Done", not "Save". Nothing is unsaved — the node has
          // been updated on every keystroke. This only drops the selection,
          // which is what returns the node to its rendered form.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const { to } = editor.state.selection;
            editor.chain().focus().setTextSelection(to).run();
          }}
          title="Finish editing"
        >Done</button>
      </div>
    </div>
  );
}

/** A palette button that shows what it inserts, drawn with the same KaTeX the
 *  document uses — a button labelled `\frac` tells you less than a fraction. */
function SymbolButton({ item }: { item: MathSymbol }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      katex.render(item.preview, el, { ...KATEX_OPTS, displayMode: false });
    } catch {
      // A palette entry with bad preview LaTeX must not take the row down;
      // fall back to the label, which is still usable.
      el.textContent = item.label;
    }
  }, [item.preview, item.label]);

  return (
    <button
      type="button"
      className="math-tb-sym"
      title={item.label}
      aria-label={item.label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        // Returns false when no field is focused. Nothing to report — the
        // button is only reachable while the row is visible, and the row is
        // only visible while a math node is selected.
        if (!insertMathSymbol(item.latex)) getActiveMathField()?.focus();
      }}
    ><span ref={ref} /></button>
  );
}
