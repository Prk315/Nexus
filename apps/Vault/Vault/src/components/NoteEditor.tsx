import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Mathematics from "@tiptap/extension-mathematics";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { useEffect, useRef, useState } from "react";
import { createSlashCommandsExtension, type SlashMenuState } from "../extensions/SlashCommands";
import { SlashCommandsList } from "./SlashCommandsList";
import "katex/dist/katex.min.css";

interface Props {
  content: string;
  onChange: (content: string) => void;
}

function parseContent(raw: string) {
  if (!raw) return "";
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function NoteEditor({ content, onChange }: Props) {
  const [, forceUpdate] = useState(0);
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
  const [nearRightEdge, setNearRightEdge] = useState(false);
  const [onPanel, setOnPanel] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const setMenuRef = useRef(setSlashMenu);
  setMenuRef.current = setSlashMenu;

  const keyHandlerRef = useRef<((event: KeyboardEvent) => boolean) | null>(null);

  const slashExtRef = useRef(
    createSlashCommandsExtension(
      (s) => setMenuRef.current(s),
      () => keyHandlerRef.current
    )
  );

  // Tracks the last JSON string emitted via onChange so we can skip a
  // setContent call when the content prop is just echoing back our own edit.
  const lastEmittedRef = useRef<string>("");

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Write here… (type / for commands)" }),
      Mathematics,
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
        {btn(false, () => editor.chain().focus().undo().run(), "↩")}
        {btn(false, () => editor.chain().focus().redo().run(), "↪")}
      </div>
      <EditorContent editor={editor} className="tiptap-editor" />
      {slashMenu && (
        <SlashCommandsList
          {...slashMenu}
          keyHandlerRef={keyHandlerRef}
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
