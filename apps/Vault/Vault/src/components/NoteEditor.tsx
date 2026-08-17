import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Mathematics from "@tiptap/extension-mathematics";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { useEffect, useRef, useState } from "react";
import katex from "katex";
import { createSlashCommandsExtension, type SlashMenuState } from "../extensions/SlashCommands";
import { CategoryHighlight } from "../extensions/CategoryHighlight";
import { SlashCommandsList } from "./SlashCommandsList";
import { HighlighterCatEditor } from "./HighlighterCatEditor";
import { DatabaseInsertPicker } from "./DatabaseInsertPicker";
import * as api from "../lib/api";
import { DEFAULT_HIGHLIGHTERS, findAncestorOfKind, getDescendants } from "../nodeUtils";
import type { VaultGraph, HighlighterCategory, VaultRecord } from "../types";
import { KATEX_OPTS } from "../lib/katexShared";
import "katex/dist/katex.min.css";
import "katex/contrib/mhchem";

interface MathEditState { kind: "inline" | "block"; pos: number; latex: string }

// Small centered dialog for editing an inline/block math node's LaTeX with a
// live KaTeX preview. Mirrors ConfirmDialog's visual language (see App.css
// .math-edit-*) but isn't a destructive confirmation, so it gets its own
// button styling rather than reusing .confirm-btn-danger for Save.
function MathEditPopover({
  state, onChange, onSave, onDelete, onCancel,
}: {
  state: MathEditState;
  onChange: (latex: string) => void;
  onSave: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    if (!state.latex.trim()) { el.innerHTML = ""; el.classList.remove("math-edit-preview-error"); return; }
    try {
      katex.render(state.latex, el, { ...KATEX_OPTS, displayMode: state.kind === "block" });
      el.classList.remove("math-edit-preview-error");
    } catch (e: any) {
      el.textContent = e?.message ?? "Invalid LaTeX";
      el.classList.add("math-edit-preview-error");
    }
  }, [state.latex, state.kind]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
    }
    // Capture phase, same reasoning as ConfirmDialog: don't let a global
    // Escape binding close whatever is rendered behind this dialog too.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div className="math-edit-backdrop" onPointerDown={onCancel}>
      <div
        className="math-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={state.kind === "block" ? "Edit math block" : "Edit inline math"}
        onPointerDown={e => e.stopPropagation()}
      >
        <div className="math-edit-title">{state.kind === "block" ? "Math block" : "Inline math"}</div>
        <textarea
          ref={textareaRef}
          className="math-edit-input"
          value={state.latex}
          onChange={e => onChange(e.target.value)}
          spellCheck={false}
          rows={state.kind === "block" ? 4 : 2}
        />
        <div ref={previewRef} className="math-edit-preview" />
        <div className="math-edit-actions">
          <button className="math-edit-btn math-edit-btn-delete" onClick={onDelete} type="button">
            Delete
          </button>
          <div className="math-edit-actions-right">
            <button className="math-edit-btn math-edit-btn-cancel" onClick={onCancel} type="button">
              Cancel
            </button>
            <button className="math-edit-btn math-edit-btn-save" onClick={onSave} type="button">
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface Props {
  content: string;
  onChange: (content: string) => void;
  nodeId?: string;
  graph?: VaultGraph;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseContent(raw: string) {
  if (!raw) return "";
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function NoteEditor({ content, onChange, nodeId, graph }: Props) {
  const [, forceUpdate] = useState(0);
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
  const [mathEdit, setMathEdit] = useState<MathEditState | null>(null);
  const [nearRightEdge, setNearRightEdge] = useState(false);
  const [onPanel, setOnPanel] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Highlighter categories (this note's own set) + database insert picker.
  const [highlighters, setHighlighters] = useState<HighlighterCategory[]>([]);
  const [editingCats, setEditingCats] = useState(false);
  const [picker, setPicker] = useState<{ records: VaultRecord[]; dbName: string } | null>(null);
  const [pickerMsg, setPickerMsg] = useState<string | null>(null);

  const setMenuRef = useRef(setSlashMenu);
  setMenuRef.current = setSlashMenu;

  const keyHandlerRef = useRef<((event: KeyboardEvent) => boolean) | null>(null);
  // Stable indirection so the slash extension (created once) always calls the
  // latest DB-insert handler.
  const dbInsertRef = useRef<((props: { editor: any; range: any }) => void) | null>(null);

  const slashExtRef = useRef(
    createSlashCommandsExtension(
      (s) => setMenuRef.current(s),
      () => keyHandlerRef.current,
      (props) => dbInsertRef.current?.(props)
    )
  );

  // Tracks the last JSON string emitted via onChange so we can skip a
  // setContent call when the content prop is just echoing back our own edit.
  const lastEmittedRef = useRef<string>("");

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Write here… (type / for commands)" }),
      Mathematics.configure({
        katexOptions: KATEX_OPTS,
        inlineOptions: {
          onClick: (node, pos) => setMathEdit({ kind: "inline", pos, latex: node.attrs.latex }),
        },
        blockOptions: {
          onClick: (node, pos) => setMathEdit({ kind: "block", pos, latex: node.attrs.latex }),
        },
      }),
      CategoryHighlight,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      slashExtRef.current,
    ],
    content: parseContent(content),
    onUpdate: ({ editor }) => {
      const json = JSON.stringify(editor.getJSON());
      lastEmittedRef.current = json;
      onChange(json);
    },
    onTransaction: () => forceUpdate((n) => n + 1),
  });

  useEffect(() => {
    if (!editor) return;
    // Content came from this editor's own keystroke — no need to setContent.
    if (content === lastEmittedRef.current) return;
    lastEmittedRef.current = content;
    editor.commands.setContent(parseContent(content), { emitUpdate: false });
  }, [content]);

  // Load this note's highlighter categories; seed defaults on first use.
  useEffect(() => {
    if (!nodeId) return;
    let cancelled = false;
    (async () => {
      let sets = await api.readHighlighters(nodeId);
      if (sets.length === 0) {
        sets = DEFAULT_HIGHLIGHTERS;
        await api.saveHighlighters(nodeId, sets);
      }
      if (!cancelled) setHighlighters(sets);
    })();
    return () => { cancelled = true; };
  }, [nodeId]);

  function persistHighlighters(next: HighlighterCategory[]) {
    setHighlighters(next);
    if (nodeId) api.saveHighlighters(nodeId, next);
  }

  // Apply a highlighter to the current selection and record it into the database.
  function applyCategory(cat: HighlighterCategory) {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    editor.chain().focus().setHighlight({ color: cat.color, category: cat.name } as any).run();
    if (from === to) return; // nothing selected → only sets the mark for typing
    const text = editor.state.doc.textBetween(from, to, " ").replace(/\s+/g, " ").trim();
    if (text && nodeId) {
      api.insertRecord({
        source_node_id: nodeId,
        category: cat.name,
        color: cat.color,
        text,
        location: "",
      }).catch(() => { /* non-fatal: the visual highlight is already applied */ });
    }
  }

  // Open the ancestor Database node's records for insertion at the cursor.
  async function openDatabasePicker() {
    if (!nodeId || !graph) { setPickerMsg("This note is not inside a database."); return; }
    const dbId = findAncestorOfKind(graph, nodeId, "Database");
    if (!dbId) { setPickerMsg("No database node found above this note."); return; }
    const sources = getDescendants(graph, dbId);
    const records = await api.readRecordsForSources(sources);
    setPicker({ records, dbName: graph.nodes[dbId]?.name ?? "Database" });
  }

  function insertRecords(recs: VaultRecord[]) {
    if (editor && recs.length) {
      const html =
        "<ul>" +
        recs.map(r => `<li><strong>${escapeHtml(r.category)}:</strong> ${escapeHtml(r.text)}</li>`).join("") +
        "</ul>";
      editor.chain().focus().insertContent(html).run();
    }
    setPicker(null);
  }

  // Keep the slash-command "Insert from Database" wired to the latest handler.
  dbInsertRef.current = ({ editor: ed, range }) => {
    ed.chain().focus().deleteRange(range).run();
    openDatabasePicker();
  };

  // The extension's update/delete commands require doc.nodeAt(pos) to be
  // EXACTLY the math node — anything else silently returns false, which is
  // how a stale position turns Save into a no-op with no error anywhere.
  // Positions captured before an insert are guesses (a block insert in
  // particular does not land the node at selection.from), so never trust a
  // stored pos: re-resolve against the live document, falling back to the
  // nearest node of the right type if the exact position no longer holds it.
  function resolveMathPos(kind: "inline" | "block", pos: number): number | null {
    if (!editor) return null;
    const typeName = kind === "inline" ? "inlineMath" : "blockMath";
    const at = editor.state.doc.nodeAt(pos);
    if (at?.type.name === typeName) return pos;
    let found: number | null = null;
    let best = Infinity;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === typeName) {
        const d = Math.abs(p - pos);
        if (d < best) { best = d; found = p; }
      }
    });
    return found;
  }

  // Insert a placeholder math node at the cursor, then immediately open the
  // popover on it so the user types the real expression right away. The
  // popover's pos is resolved from the document AFTER the insert lands.
  function insertInlineMathAtCursor() {
    if (!editor) return;
    editor.chain().focus().insertInlineMath({ latex: "x" }).run();
    const pos = resolveMathPos("inline", editor.state.selection.from);
    if (pos !== null) setMathEdit({ kind: "inline", pos, latex: "x" });
  }

  function insertBlockMathAtCursor() {
    if (!editor) return;
    editor.chain().focus().insertBlockMath({ latex: "x" }).run();
    const pos = resolveMathPos("block", editor.state.selection.from);
    if (pos !== null) setMathEdit({ kind: "block", pos, latex: "x" });
  }

  function saveMathEdit() {
    if (!editor || !mathEdit) return;
    const pos = resolveMathPos(mathEdit.kind, mathEdit.pos);
    if (pos !== null) {
      if (mathEdit.kind === "inline") {
        editor.chain().focus().updateInlineMath({ latex: mathEdit.latex, pos }).run();
      } else {
        editor.chain().focus().updateBlockMath({ latex: mathEdit.latex, pos }).run();
      }
    }
    setMathEdit(null);
  }

  function deleteMathEdit() {
    if (!editor || !mathEdit) return;
    const pos = resolveMathPos(mathEdit.kind, mathEdit.pos);
    if (pos !== null) {
      if (mathEdit.kind === "inline") {
        editor.chain().focus().deleteInlineMath({ pos }).run();
      } else {
        editor.chain().focus().deleteBlockMath({ pos }).run();
      }
    }
    setMathEdit(null);
  }

  const btn = (active: boolean, onClick: () => void, label: string) => (
    <button className={`tt-btn${active ? " active" : ""}`} onClick={onClick} type="button">
      {label}
    </button>
  );

  if (!editor) return null;

  const headings: Array<{ level: number; text: string }> = [];
  (editor.getJSON().content ?? []).forEach((node: any) => {
    if (node.type === "heading") {
      const text = (node.content ?? []).map((n: any) => n.text ?? "").join("").trim();
      if (text) headings.push({ level: node.attrs?.level ?? 1, text });
    }
  });

  function scrollToHeading(text: string, level: number) {
    const pm = wrapperRef.current?.querySelector(".ProseMirror");
    if (!pm) return;
    const el = Array.from(pm.querySelectorAll(`h${level}`)).find(h => h.textContent?.trim() === text);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleWrapperMouseMove(e: React.MouseEvent) {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    setNearRightEdge(e.clientX > rect.right - 52);
  }

  const showOutline = (nearRightEdge || onPanel) && headings.length > 0;

  return (
    <div
      ref={wrapperRef}
      className="tiptap-wrapper"
      onMouseMove={handleWrapperMouseMove}
      onMouseLeave={() => setNearRightEdge(false)}
    >
      <div className="tiptap-toolbar">
        {btn(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "B")}
        {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "I")}
        {btn(editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), "S")}
        <div className="tt-sep" />
        {btn(editor.isActive("heading", { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), "H1")}
        {btn(editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), "H2")}
        {btn(editor.isActive("heading", { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), "H3")}
        <div className="tt-sep" />
        {btn(editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), "•")}
        {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), "1.")}
        {btn(editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), "❝")}
        {btn(editor.isActive("codeBlock"), () => editor.chain().focus().toggleCodeBlock().run(), "<>")}
        <div className="tt-sep" />
        {btn(editor.isActive("table"), () => {}, "⊞")}
        {!editor.isActive("table")
          ? <button className="tt-btn" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} type="button">+ Table</button>
          : <>
              <button className="tt-btn" onClick={() => editor.chain().focus().addRowAfter().run()} type="button" title="Add row below">+row</button>
              <button className="tt-btn" onClick={() => editor.chain().focus().deleteRow().run()} type="button" title="Delete row">−row</button>
              <button className="tt-btn" onClick={() => editor.chain().focus().addColumnAfter().run()} type="button" title="Add column right">+col</button>
              <button className="tt-btn" onClick={() => editor.chain().focus().deleteColumn().run()} type="button" title="Delete column">−col</button>
              <button className="tt-btn" onClick={() => editor.chain().focus().deleteTable().run()} type="button" title="Delete table">del⊞</button>
            </>
        }
        <div className="tt-sep" />
        <button className="tt-btn" onClick={insertInlineMathAtCursor} type="button" title="Inline math">√x</button>
        <button className="tt-btn" onClick={insertBlockMathAtCursor} type="button" title="Math block">∑</button>
        {btn(editor.isActive("highlight"), () => editor.chain().focus().unsetHighlight().run(), "🖊")}
        {nodeId && (
          <>
            {highlighters.map((cat) => (
              <button
                key={cat.name}
                className="tt-btn tt-hl-btn"
                onClick={() => applyCategory(cat)}
                type="button"
                title={`Highlight selection as ${cat.name}`}
              >
                <span className="tt-hl-swatch" style={{ background: cat.color }} />
                {cat.name}
              </button>
            ))}
            <button className="tt-btn" onClick={() => setEditingCats(v => !v)} type="button" title="Edit highlighters">✎</button>
            <div className="tt-sep" />
            <button className="tt-btn" onClick={openDatabasePicker} type="button" title="Insert records from the database above">◉ DB</button>
          </>
        )}
        <div className="tt-sep" />
        {btn(false, () => editor.chain().focus().undo().run(), "↩")}
        {btn(false, () => editor.chain().focus().redo().run(), "↪")}
      </div>
      {editingCats && (
        <HighlighterCatEditor
          cats={highlighters}
          onChange={persistHighlighters}
          onClose={() => setEditingCats(false)}
        />
      )}
      {picker && (
        <DatabaseInsertPicker
          records={picker.records}
          dbName={picker.dbName}
          onInsert={insertRecords}
          onClose={() => setPicker(null)}
        />
      )}
      {pickerMsg && (
        <div className="db-picker-toast" onClick={() => setPickerMsg(null)}>
          {pickerMsg}
        </div>
      )}
      <EditorContent editor={editor} className="tiptap-editor" />
      {slashMenu && (
        <SlashCommandsList
          {...slashMenu}
          keyHandlerRef={keyHandlerRef}
        />
      )}
      {mathEdit && (
        <MathEditPopover
          state={mathEdit}
          onChange={(latex) => setMathEdit(m => m && { ...m, latex })}
          onSave={saveMathEdit}
          onDelete={deleteMathEdit}
          onCancel={() => setMathEdit(null)}
        />
      )}

      {showOutline && (
        <div
          className="outline-panel"
          onMouseEnter={() => setOnPanel(true)}
          onMouseLeave={() => setOnPanel(false)}
        >
          {headings.map((h, i) => (
            <button
              key={i}
              className={`outline-item outline-h${h.level}`}
              onClick={() => scrollToHeading(h.text, h.level)}
            >
              {h.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
