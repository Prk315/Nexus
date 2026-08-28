// The single source of truth for the note editor's extension list.
//
// It lives outside NoteEditor because the schema has to be buildable *before*
// an editor exists: lib/noteSchemaGuard.ts audits stored content against the
// schema to decide whether mounting an editor is safe at all. Two hand-kept
// copies of this list would defeat that entirely — the guard would validate
// against a schema the editor doesn't actually have.
//
// Keep this list and this list only. Anything that adds a node or a mark
// belongs here; anything that only adds behaviour (keymaps, suggestion
// plugins) can be passed in via `extra`.

import { Extension, getSchema, type Extensions } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Mathematics from "@tiptap/extension-mathematics";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { SheetFormulas } from "./sheetFormulas";
import { TaskList } from "@tiptap/extension-list/task-list";
import { TaskItem } from "@tiptap/extension-list/task-item";
import { CategoryHighlight } from "./CategoryHighlight";
import { Callout } from "./structural/Callout";
import { Container } from "./structural/Container";
import { ToggleBlock, ToggleSummary, ToggleContent } from "./structural/Toggle";
import { ColumnBlock, Column } from "./structural/Columns";
import { BlockHandle } from "./structural/BlockHandle";
import { NoteDocument } from "./noteDocument";
import { FoldableHeading } from "./headingFold";
import { SketchBlock } from "./SketchBlock";
import { PathfinderBlock } from "./PathfinderBlock";
import { NoteImage } from "./noteImage";
import { NoteCodeBlock } from "./noteCodeBlock";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle, Color, FontSize } from "@tiptap/extension-text-style";
import { KATEX_OPTS } from "../lib/katexShared";

export interface NoteExtensionOpts {
  /** Opens the math edit popover. Behaviour only — contributes no schema. */
  onMathClick?: (kind: "inline" | "block", node: any, pos: number) => void;
  /** Slash commands and any other pure-behaviour extension. */
  extra?: Extensions;
  placeholder?: string;
  /**
   * Collaboration + CollaborationCaret, supplied by the lazily-loaded collab
   * runtime (src/collab/collabRuntime.ts) for a shared note.
   *
   * Passing these ALSO turns StarterKit's undoRedo off, and the fusion is
   * deliberate: they are one decision, not two. Collaboration ships its own
   * Y.UndoManager — a shared undo stack is the only correct kind when two
   * people are typing, since a plain history would let you undo the other
   * person's sentence — and it warns at runtime if undoRedo is still
   * registered. Making them one option means no call site can turn on
   * collaboration and forget the other half.
   *
   * Schema-neutral, which is what lets noteSchemaGuard keep working:
   * Collaboration contributes ySyncPlugin/yUndoPlugin/filterInvalidContent,
   * CollaborationCaret contributes yCursorPlugin and an awareness listener, and
   * UndoRedo contributes a plugin — no nodes, no marks, in any of them. So
   * noteSchema() below, built with NO options, stays byte-identical to the
   * schema a collaborative editor actually runs. There is a test pinning that;
   * it is not a claim to take on trust.
   */
  collab?: Extensions;
}

export function buildNoteExtensions(opts: NoteExtensionOpts = {}): Extensions {
  const { onMathClick, extra = [], placeholder = "Write here… (type / for commands)", collab } = opts;

  return [
    NoteDocument,
    StarterKit.configure({
      // StarterKit v3 already ships Link (and Underline). The only thing wrong
      // with the default is `openOnClick: true`: inside an *editable* document
      // a click should place the caret, not navigate — and with
      // target="_blank" in a Tauri WebView that navigation is at best a
      // surprise and at worst leaves the app. The link popover offers an
      // explicit Open instead.
      link: { openOnClick: false },
      // Replaced by FoldableHeading, which adds the `collapsed` attribute.
      // Note it is configured *there*, not here: StarterKit's own heading is
      // off, so this key would configure nothing.
      heading: false,
      // Replaced by NoteDocument, which carries the per-note width attribute.
      document: false,
      // Replaced below by the lowlight version. Leaving StarterKit's plain
      // codeBlock registered too would be a duplicate node name.
      codeBlock: false,
      // Collaboration brings its own Y.UndoManager and its own Mod-z keymap at
      // priority 1000. Leaving this one registered gives two undo stacks
      // competing for the same shortcut — and the local one would happily undo
      // the other person's edits. Plugin-only on both sides, so the schema is
      // untouched either way.
      ...(collab ? { undoRedo: false as const } : {}),
    }),
    // Four levels, matching what the outline renders. `levels` IS a schema
    // option, so it must stay identical to whatever noteSchema() derives — see
    // the note on cachedSchema below.
    FoldableHeading.configure({ levels: [1, 2, 3, 4] }),
    NoteCodeBlock,
    // A small drawing surface. Strokes live in the document, not in a
    // vault_content row — see SketchBlock.ts for why, and for the size cap
    // that keeps a sketch from taking the note's text down with it.
    SketchBlock,
    // A live query onto PathFinder's tasks. ONE node type carrying a `view`
    // attribute, not three — see PathfinderBlock.ts for why the three blocks the
    // slash menu offers must not be three node types.
    PathfinderBlock,
    // Storage URLs only — see noteImage.ts for the incident this prevents.
    NoteImage,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    // TextStyle carries the mark; Color writes into it. BackgroundColor is
    // deliberately NOT registered — it would compete with the highlighter
    // categories, which mean something (they file vault_records rows).
    TextStyle,
    Color,
    // Inline size, in `em` rather than `px` — see INLINE_TEXT_SIZES. It rides
    // the same TextStyle mark as Color, so it is a mark ATTRIBUTE: a build
    // without it drops the attribute and renders the text at the normal size,
    // rather than failing. (Unlike a node type, which blanks the document.)
    FontSize,
    Placeholder.configure({ placeholder }),
    // Checkboxes. Note this is a SCHEMA addition — taskList/taskItem — so it
    // depends on the Phase 1 guard being deployed everywhere first; a client
    // without it blanks any note containing a to-do list.
    TaskList,
    TaskItem.configure({ nested: true }),
    Mathematics.configure({
      katexOptions: KATEX_OPTS,
      inlineOptions: {
        onClick: (node: any, pos: number) => onMathClick?.("inline", node, pos),
      },
      blockOptions: {
        onClick: (node: any, pos: number) => onMathClick?.("block", node, pos),
      },
    }),
    CategoryHighlight,
    // Structural family. All schema additions — see lib/noteSchemaGuard.ts for
    // why every one of these depends on the guard being deployed first.
    Callout,
    Container,
    ToggleBlock,
    ToggleSummary,
    ToggleContent,
    ColumnBlock,
    Column,
    // Behaviour only, no schema — but it lives with the family it serves.
    BlockHandle,
    Table.configure({ resizable: true }),
    // Spreadsheet formulas over any table. Decorations only — the formula
    // stays the document's content, so nothing here can be persisted or
    // undone away. Adds no node type, so it needs no deployment ordering.
    SheetFormulas,
    TableRow,
    TableHeader,
    TableCell,
    ...extra,
    // Last, so ySync's plugins sit outermost. Empty for every private note.
    ...(collab ?? []),
  ];
}

// Built once and cached. Every option above is either a callback or a
// behaviour flag (`resizable`, `placeholder`, `katexOptions`) — none of them
// add, remove or rename a node or mark — so a callback-free build is
// schema-identical to the one the live editor uses. That equivalence is what
// makes it safe to audit content against this schema before mounting.
//
// If you ever add an extension whose *options* change the schema (a `levels`
// list, a configurable node name), it must be configured identically here or
// the guard will disagree with the editor. Prefer hardcoding such options.
let cachedSchema: Schema | null = null;

export function noteSchema(): Schema {
  return (cachedSchema ??= getSchema(buildNoteExtensions()));
}

/** Test seam: forget the cached schema. Not used in app code. */
export function __resetNoteSchemaCache() {
  cachedSchema = null;
}

/**
 * A no-op extension, handy where `extra` wants a placeholder value.
 * Exported mainly so tests can prove `extra` contributes no schema.
 */
export const NoopNoteExtension = Extension.create({ name: "noopNoteExtension" });
