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
import { CategoryHighlight } from "./CategoryHighlight";
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
    StarterKit,
    Placeholder.configure({ placeholder }),
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
