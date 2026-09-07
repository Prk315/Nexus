// The shared vocabulary for runnable code cells.
//
// Two surfaces render cells — CanvasEditor's `code_cell` block and the note
// editor's `codeCell` node — and before this module they would have been two
// implementations of the same idea, drifting. These types are deliberately the
// ones CanvasEditor already used, unchanged, so adopting the shared runtime
// there is a swap rather than a migration.

/**
 * One piece of a cell's result.
 *
 * `content` is always a string, never a structured value, because outputs are
 * persisted INSIDE the note document (see extensions/CodeCellBlock.ts) and a
 * ProseMirror attribute round-trips through JSON and HTML. A `table` chunk
 * therefore carries JSON-encoded `SqlTableData[]`, and an `image` chunk carries
 * base64 PNG bytes with no data-URI prefix.
 */
export interface OutputChunk {
  type: "text" | "image" | "error" | "html" | "table";
  content: string;
}

export type CellLanguage = "python" | "sql";

/** One SQL result set. JSON-encoded into a `table` chunk's `content`. */
export interface SqlTableData {
  columns: string[];
  rows: (string | null)[][];
  rowCount: number;
}

/**
 * A kernel session id.
 *
 * Cells sharing a session share a namespace — that is the whole point of a
 * notebook, and the reason `x = 1` in one cell is visible in the next. In a
 * note the session is the note; on a canvas it is the canvas. Restarting is
 * how you get a clean namespace back.
 */
export type SessionId = string;

export interface RunResult {
  chunks: OutputChunk[];
}
