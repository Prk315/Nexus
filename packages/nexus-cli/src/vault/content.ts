// The stored shape of `vault_content.data` for a note, mirrored from
// apps/Vault/Vault/src/lib/noteSchemaGuard.ts (which cannot be imported here:
// it types against @tiptap/core, and pulling Tiptap into a CLI is exactly the
// dependency weight the note-schema path is kept away from).
//
// A note is one of:
//   - ""                              empty
//   - `{"__vault":1,"doc":<doc>}`      the envelope (what this CLI writes)
//   - `<doc>`                          a bare ProseMirror doc (what the app writes today)
//   - anything else                    legacy HTML / plain text

export interface JsonNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> } | string>;
  text?: string;
  [key: string]: unknown;
}

export type ContentShape =
  | { kind: "empty" }
  | { kind: "html"; html: string }
  | { kind: "json"; doc: JsonNode; enveloped: boolean };

export const NOTE_ENVELOPE_VERSION = 1;

export function parseNoteContent(raw: string | null | undefined): ContentShape {
  if (!raw) return { kind: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "html", html: raw };
  }
  if (parsed && typeof parsed === "object") {
    const p = parsed as Record<string, unknown>;
    if (typeof p.__vault === "number" && p.doc && typeof p.doc === "object") {
      return { kind: "json", doc: p.doc as JsonNode, enveloped: true };
    }
    return { kind: "json", doc: p as JsonNode, enveloped: false };
  }
  return { kind: "html", html: raw };
}

export function envelope(doc: JsonNode): string {
  return JSON.stringify({ __vault: NOTE_ENVELOPE_VERSION, doc });
}

/**
 * The only node and mark types this CLI is allowed to WRITE. An unknown type
 * makes Tiptap discard the whole document and the app's autosave then writes
 * that blank back (see noteSchemaGuard.ts), so this list is a hard fence: the
 * writer is checked against it before anything reaches the database.
 */
export const WRITABLE_NODE_TYPES = new Set([
  "doc", "paragraph", "heading", "bulletList", "orderedList", "listItem", "codeBlock", "text", "hardBreak",
]);
export const WRITABLE_MARK_TYPES = new Set(["bold", "italic", "code", "link"]);

/** Returns every type in `doc` outside the writable set, sorted and de-duplicated. */
export function auditWritable(doc: JsonNode): { nodes: string[]; marks: string[] } {
  const nodes = new Set<string>();
  const marks = new Set<string>();
  const visit = (n: JsonNode | undefined) => {
    if (!n || typeof n !== "object") return;
    if (typeof n.type === "string" && !WRITABLE_NODE_TYPES.has(n.type)) nodes.add(n.type);
    for (const m of n.marks ?? []) {
      const name = typeof m === "string" ? m : m?.type;
      if (typeof name === "string" && !WRITABLE_MARK_TYPES.has(name)) marks.add(name);
    }
    for (const c of n.content ?? []) visit(c);
  };
  visit(doc);
  return { nodes: [...nodes].sort(), marks: [...marks].sort() };
}
