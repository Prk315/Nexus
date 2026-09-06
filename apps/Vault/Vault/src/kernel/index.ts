// The one entry point both cell surfaces use.
//
// CanvasEditor's `code_cell` block and the note editor's `codeCell` node call
// exactly these functions, so the kernel model — sessions, restart, what counts
// as output — is defined once. Before this module the canvas owned the only
// implementation, and a second copy in the note editor would have drifted on
// the details that matter least visibly and hurt most: how a session is keyed,
// what a reset actually clears, whether outputs are capped.

import { capOutputs } from "./outputs";
import { runSql, resetSqlSession, hasSqlSession } from "./sql";
import { runPython, resetPythonSession, killPythonSession, hasPythonSession } from "./python";
import type { CellLanguage, OutputChunk, SessionId } from "./types";

export type { OutputChunk, CellLanguage, SessionId, SqlTableData } from "./types";
export { CELL_OUTPUT_MAX_CHARS, capOutputs, outputsSize } from "./outputs";
export { killPythonSession } from "./python";

/**
 * Run one cell.
 *
 * Always resolves — a syntax error, a Python exception and a dead worker are
 * all ordinary results that belong in the cell's output, not exceptions for a
 * React event handler to swallow. Output is capped here rather than at the call
 * sites so neither surface can forget (see outputs.ts for why that matters).
 */
export async function runCell(
  sessionId: SessionId,
  language: CellLanguage,
  code: string,
): Promise<OutputChunk[]> {
  try {
    const chunks = language === "sql" ? await runSql(sessionId, code) : await runPython(sessionId, code);
    return capOutputs(chunks);
  } catch (err: unknown) {
    return capOutputs([
      { type: "error", content: err instanceof Error ? err.message : String(err) },
    ]);
  }
}

/**
 * Restart the kernel: forget every variable in this session.
 *
 * Resets BOTH languages, because a session is a namespace from the user's point
 * of view and they do not think of it as two. A cell switched from Python to
 * SQL and back should not find its old tables waiting.
 */
export async function resetSession(sessionId: SessionId): Promise<void> {
  resetSqlSession(sessionId);
  await resetPythonSession(sessionId);
}

/** Whether anything has actually been started for this session yet. */
export function hasSession(sessionId: SessionId): boolean {
  return hasSqlSession(sessionId) || hasPythonSession(sessionId);
}

/** Tear a session down entirely, e.g. when its note closes. */
export function disposeSession(sessionId: SessionId): void {
  resetSqlSession(sessionId);
  killPythonSession(sessionId);
}
