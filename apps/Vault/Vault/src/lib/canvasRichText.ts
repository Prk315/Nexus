// Turning a canvas text block into a Tiptap document, without breaking the
// clients that still read it as text.
//
// ── ⚠️ The format problem, which is the whole of this file ─────────────────
//
// A canvas text block's `content` is a markdown STRING, and a canvas is stored
// as one JSON blob in `vault_content`. Making `content` hold ProseMirror JSON
// would mean an older Mac or iPad build renders a wall of raw JSON in a
// textarea — and then saves it back, at which point the block is genuinely
// broken rather than merely misread.
//
// So the block gains two fields and `content` changes meaning rather than
// format:
//
//   rich     the ProseMirror document, as the same JSON string vault_content
//            holds for a note. Absent on a block that has never been converted.
//   md       the ORIGINAL markdown, written once at conversion and never
//            overwritten. This is what makes a partial markdown converter an
//            acceptable trade: nothing is lost, only reinterpreted.
//   content  now a PLAIN-TEXT PROJECTION of `rich`. Still a string, still
//            readable, still what an older build shows and what search and the
//            markdown preview see. Degraded, not corrupt.
//
// An unknown field on a JSON blob is carried or dropped, never fatal — unlike
// an unknown ProseMirror node type, which blanks a document. The asymmetry is
// the same one that made `shareId` an attribute rather than a node.

import { noteLines } from "./versionDiff";
import { mdToHtml } from "./mdToHtml";

/** The three fields the canvas block carries. Kept here so the rules and the
 *  shape live together. */
export interface RichTextFields {
  content: string;
  rich?: string;
  md?: string;
}

/**
 * What to hand a NoteEditor for this block.
 *
 * `parseNoteContent` already treats a non-JSON string as legacy HTML and lets
 * Tiptap's parser have it — which is why an unconverted block opens at all. But
 * plain markdown through an HTML parser is literal asterisks, so a block that
 * has never been converted is run through `mdToHtml` first.
 */
export function editorContent(b: RichTextFields): string {
  if (b.rich) return b.rich;
  if (!b.content.trim()) return "";
  return mdToHtml(b.content);
}

export function isConverted(b: RichTextFields): boolean {
  return typeof b.rich === "string" && b.rich !== "";
}

/**
 * The fields to write after an edit.
 *
 * ⚠️ `md` is only ever written when it is ABSENT. Overwriting it on the second
 * edit would defeat the point — the value of keeping the original is that it
 * predates the conversion, and one more keystroke would replace it with the
 * projection of the converted document.
 */
export function afterEdit(b: RichTextFields, rich: string): RichTextFields {
  return {
    rich,
    content: projectText(rich),
    md: b.md ?? (isConverted(b) ? undefined : b.content || undefined),
  };
}

/**
 * A plain-text projection of a stored document.
 *
 * Reuses `noteLines`, which the version-history diff already relies on, so a
 * block's projection and a note's diff agree about what a document says. A
 * second flattener would drift, and the failure would be silent: the canvas
 * would search differently from the history.
 */
export function projectText(rich: string): string {
  try {
    return noteLines(rich).join("\n");
  } catch {
    // Never throw out of a save path over a projection. An empty projection
    // costs an older client its preview; a throw costs the edit.
    return "";
  }
}
