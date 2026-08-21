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
import { TaskList } from "@tiptap/extension-list/task-list";
import { TaskItem } from "@tiptap/extension-list/task-item";
import { CategoryHighlight } from "./CategoryHighlight";
import { Callout } from "./structural/Callout";
import { Container } from "./structural/Container";
import { ToggleBlock, ToggleSummary, ToggleContent } from "./structural/Toggle";
import { ColumnBlock, Column } from "./structural/Columns";
import { BlockHandle } from "./structural/BlockHandle";
import { NoteImage } from "./noteImage";
import { NoteCodeBlock } from "./noteCodeBlock";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import { KATEX_OPTS } from "../lib/katexShared";

export interface NoteExtensionOpts {
  /** Opens the math edit popover. Behaviour only — contributes no schema. */
  onMathClick?: (kind: "inline" | "block", node: any, pos: number) => void;
  /** Slash commands and any other pure-behaviour extension. */
  extra?: Extensions;
  placeholder?: string;
}

export function buildNoteExtensions(opts: NoteExtensionOpts = {}): Extensions {
  const { onMathClick, extra = [], placeholder = "Write here… (type / for commands)" } = opts;

  return [
    StarterKit.configure({
      // StarterKit v3 already ships Link (and Underline). The only thing wrong
      // with the default is `openOnClick: true`: inside an *editable* document
      // a click should place the caret, not navigate — and with
      // target="_blank" in a Tauri WebView that navigation is at best a
      // surprise and at worst leaves the app. The link popover offers an
      // explicit Open instead.
      link: { openOnClick: false },
      // Four levels, matching what the outline renders. This IS a schema
      // option, so it must stay identical to whatever noteSchema() derives —
      // see the note on cachedSchema below.
      heading: { levels: [1, 2, 3, 4] },
      // Replaced below by the lowlight version. Leaving StarterKit's plain
      // codeBlock registered too would be a duplicate node name.
      codeBlock: false,
    }),
    NoteCodeBlock,
    // Storage URLs only — see noteImage.ts for the incident this prevents.
    NoteImage,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    // TextStyle carries the mark; Color writes into it. BackgroundColor is
    // deliberately NOT registered — it would compete with the highlighter
    // categories, which mean something (they file vault_records rows).
    TextStyle,
    Color,
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
    TableRow,
    TableHeader,
    TableCell,
    ...extra,
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
