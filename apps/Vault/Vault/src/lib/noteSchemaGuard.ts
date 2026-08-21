// Guards a note's stored content against the editor's schema BEFORE an editor
// is mounted on it.
//
// Why this is not optional, and why Tiptap's own flag is not enough:
//
// When ProseMirror hits an unknown node type at any depth,
// `schema.nodeFromJSON` throws `RangeError: Unknown node type: X`. Tiptap's
// `createNodeFromContent` catches that and returns
// `createNodeFromContent("", schema, options)` — an EMPTY DOCUMENT
// (@tiptap/core, createNodeFromContent). It does not drop the offending node;
// it discards the whole note. `onUpdate` then fires on the first keystroke and
// EditorPane's 400ms autosave writes that blank over the real content.
// `vault_content` keeps no history, so the note is simply gone.
//
// That is not hypothetical. Vault's clients — Vercel web, the Tauri Mac app,
// and the iPad build (refreshed only by re-running `npm run ios:vault`) —
// update independently. From the moment one note contains one block type that
// one client doesn't know, the race is live.
//
// `enableContentCheck: true` alone does NOT cover this. `contentError` is only
// emitted from `Editor.createDoc()`; `editor.commands.setContent()` passes
// `errorOnInvalidContent` straight through to `createDocument` and does not
// catch, so turning the flag on without this pre-flight converts the silent
// blanking into a synchronous throw inside a React effect. We want neither:
// audit first, and never mount an editor on content it cannot represent.

import type { JSONContent } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";

// ── Reading ──────────────────────────────────────────────────────────────────

export type ContentShape =
  | { kind: "empty" }
  /** Legacy/imported content that isn't JSON. Tiptap parses it as HTML. */
  | { kind: "html"; html: string }
  | { kind: "json"; json: JSONContent };

/** Bumped only when the *envelope* changes, never for schema additions. */
export const NOTE_ENVELOPE_VERSION = 1;

interface NoteEnvelope {
  __vault: number;
  doc: JSONContent;
}

function isEnvelope(v: any): v is NoteEnvelope {
  return v && typeof v === "object" && typeof v.__vault === "number" && v.doc && typeof v.doc === "object";
}

/**
 * Accepts a bare ProseMirror doc (what we write today) OR a
 * `{__vault, doc}` envelope (what we may write later).
 *
 * Shipping the reader now and the writer later is the whole point: a version
 * marker cannot help clients that predate it, so the only way to ever gain one
 * is to teach every client to read it at least one release before anything
 * starts writing it. Do not flip the writer until this build is everywhere.
 */
export function parseNoteContent(raw: string): ContentShape {
  if (!raw) return { kind: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON — legacy HTML/plaintext. Tiptap's parser handles it, and an
    // HTML parse can't produce an unknown node type: unrecognised tags are
    // dropped by the DOM parser rather than throwing.
    return { kind: "html", html: raw };
  }
  if (isEnvelope(parsed)) return { kind: "json", json: parsed.doc };
  if (parsed && typeof parsed === "object") return { kind: "json", json: parsed as JSONContent };
  // A bare JSON scalar ("5", "null", a quoted string). Treat as text, not doc.
  return { kind: "html", html: raw };
}

// ── Auditing ─────────────────────────────────────────────────────────────────

export interface SchemaAudit {
  ok: boolean;
  /** Sorted, de-duplicated. These names are shown to the user verbatim. */
  unknownNodes: string[];
  unknownMarks: string[];
}

const OK: SchemaAudit = { ok: true, unknownNodes: [], unknownMarks: [] };

/**
 * Walks the document and reports every node/mark type the schema doesn't know.
 *
 * Deliberately our own walk rather than a `try { schema.nodeFromJSON } catch`:
 * ProseMirror throws on the FIRST unknown type, but the banner needs to name
 * all of them, and this can never throw into React the way nodeFromJSON can.
 *
 * Structural validity (is this node allowed *here*?) is not checked — that is
 * what the editor's `enableContentCheck` is for. This answers only the
 * question that causes data loss: does every type in this document exist?
 */
export function auditNoteContent(shape: ContentShape, schema: Schema): SchemaAudit {
  if (shape.kind !== "json") return OK;

  const unknownNodes = new Set<string>();
  const unknownMarks = new Set<string>();

  const visit = (node: JSONContent | null | undefined) => {
    if (!node || typeof node !== "object") return;

    if (typeof node.type === "string") {
      // "text" is schema-implicit and always present; "doc" is the top node,
      // which may be named something else in a custom schema.
      const known =
        node.type === "text" ||
        node.type === schema.topNodeType.name ||
        Object.prototype.hasOwnProperty.call(schema.nodes, node.type);
      if (!known) unknownNodes.add(node.type);
    }

    for (const mark of node.marks ?? []) {
      const name = typeof mark === "string" ? mark : mark?.type;
      if (typeof name === "string" && !Object.prototype.hasOwnProperty.call(schema.marks, name)) {
        unknownMarks.add(name);
      }
    }

    // Recurse regardless of whether this node was known — a known wrapper can
    // contain unknown children, and we want every name, not the first.
    for (const child of node.content ?? []) visit(child);
  };

  visit(shape.json);

  return {
    ok: unknownNodes.size === 0 && unknownMarks.size === 0,
    unknownNodes: [...unknownNodes].sort(),
    unknownMarks: [...unknownMarks].sort(),
  };
}

/** Convenience for the common `parse → audit` pair. */
export function auditNoteRaw(raw: string, schema: Schema): SchemaAudit {
  return auditNoteContent(parseNoteContent(raw), schema);
}

/** Human-readable list for the banner: `toggleBlock, columnBlock and column`. */
export function describeUnknown(audit: SchemaAudit): string {
  const all = [...audit.unknownNodes, ...audit.unknownMarks];
  if (all.length === 0) return "";
  if (all.length === 1) return all[0];
  return `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
}
