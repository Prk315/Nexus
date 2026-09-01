import { useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import katex from "katex";
import { KATEX_OPTS } from "../lib/katexShared";
import { MathField } from "../components/MathField";
import {
  setActiveMathField, clearActiveMathField, type MathFieldHandle,
} from "../lib/mathToolbar";

// Editing maths in place, instead of in a dialog over the page.
//
// ── Why the dialog had to go ───────────────────────────────────────────────
//
// It covered the document. Maths is written *about* something — the sentence
// above it, the equation before it — and a modal hides exactly that. It also
// gave the note a Save and a Cancel button, which nothing else in Vault has:
// every other edit is simply the document, undoable with Cmd-Z. Two different
// mental models for one editor.
//
// ── The state model: SELECTED means editable ───────────────────────────────
//
// There is no separate "editing" flag. A math node is editable exactly while it
// is selected, which is what clicking it does. That means the toolbar row can
// derive its own visibility from the selection too, and there is no third state
// to get out of step — a flag would let "the row is open" and "this node is
// editable" disagree, and the row would be operating on nothing.
//
// ⚠️ Writes go straight to the node as you type. There is nothing to save, so
// there is no unsaved state to lose, and undo is the document's own history
// rather than a Cancel button that only knows about one dialog.

export function MathNodeView(props: NodeViewProps) {
  const { node, updateAttributes, selected, editor, getPos } = props;
  const isBlock = node.type.name === "blockMath";
  const latex: string = node.attrs.latex ?? "";

  // `selected` is the whole state model — see the header.
  const editing = selected && editor.isEditable;

  return (
    <NodeViewWrapper
      as={isBlock ? "div" : "span"}
      className={`nx-math nx-math-${isBlock ? "block" : "inline"}${editing ? " is-editing" : ""}`}
      // Clicking anywhere on the node selects it, which is what turns it
      // editable. Without this an inline formula is a small target that the
      // browser would rather put a text caret beside.
      onMouseDown={(e: React.MouseEvent) => {
        if (!editor.isEditable || editing) return;
        e.preventDefault();
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos == null) return;
        editor.chain().focus().setNodeSelection(pos).run();
      }}
    >
      {editing ? (
        <EditableMath
          latex={latex}
          block={isBlock}
          onChange={(v) => updateAttributes({ latex: v })}
        />
      ) : (
        <RenderedMath latex={latex} block={isBlock} />
      )}
    </NodeViewWrapper>
  );
}

/** KaTeX output, and a legible error rather than a blank where a formula was. */
function RenderedMath({ latex, block }: { latex: string; block: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!latex.trim()) {
      // An empty formula still needs a target to click, or it becomes
      // unselectable and therefore uneditable and undeletable.
      el.textContent = block ? "Empty equation" : "…";
      el.classList.add("nx-math-empty");
      return;
    }
    el.classList.remove("nx-math-empty");
    try {
      katex.render(latex, el, { ...KATEX_OPTS, displayMode: block });
      el.classList.remove("nx-math-error");
    } catch (e: any) {
      // The SOURCE, not just the message: an error that hides what you wrote
      // leaves you nothing to correct.
      el.textContent = latex;
      el.title = e?.message ?? "Invalid LaTeX";
      el.classList.add("nx-math-error");
    }
  }, [latex, block]);

  return <span ref={ref} className="nx-math-render" />;
}

/**
 * The live field.
 *
 * ⚠️ Registered with the toolbar by IDENTITY and cleared the same way — see
 * `clearActiveMathField`. Two math nodes hand over on focus, and an
 * unconditional clear on blur would wipe the field that had just taken over.
 */
function EditableMath({
  latex, block, onChange,
}: {
  latex: string;
  block: boolean;
  onChange: (v: string) => void;
}) {
  const handleRef = useRef<MathFieldHandle | null>(null);
  const [raw, setRaw] = useState<string | null>(null);

  useEffect(() => () => {
    if (handleRef.current) clearActiveMathField(handleRef.current);
  }, []);

  if (raw !== null) {
    // LaTeX mode: the source, edited as text. Kept in local state while
    // focused for the same reason a table cell is — the node re-renders on
    // every keystroke otherwise and the caret jumps to the end.
    return (
      <textarea
        className={`nx-math-source${block ? " is-block" : ""}`}
        value={raw}
        autoFocus
        spellCheck={false}
        rows={block ? 3 : 1}
        onChange={(e) => { setRaw(e.target.value); onChange(e.target.value); }}
        onBlur={() => setRaw(null)}
        // The editor is behind this; an un-stopped key reaches it and types
        // into the note.
        onKeyDown={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <MathField
      value={latex}
      onChange={onChange}
      autoFocus
      className={`nx-math-field${block ? " is-block" : ""}`}
      onFieldReady={(f) => {
        handleRef.current = f as MathFieldHandle;
        setActiveMathField(f as MathFieldHandle);
      }}
      onFocusChange={(focused, f) => {
        if (focused) setActiveMathField(f as MathFieldHandle);
        else clearActiveMathField(f as MathFieldHandle);
      }}
    />
  );
}
