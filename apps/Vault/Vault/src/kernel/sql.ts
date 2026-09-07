// SQLite-in-the-browser, via sql.js (SQLite compiled to WASM).
//
// Lifted verbatim in behaviour from CanvasEditor, which has run cells this way
// since before the note editor had them. One in-memory database per session id,
// surviving re-renders and accumulating schema and data until an explicit
// reset — the same session model Python uses, so switching a cell's language
// changes what executes but not how state behaves.
//
// Unlike Python this needs no worker: sql.js cannot reach the page's globals,
// it has no I/O, and a query is bounded work over data the user themselves put
// in. It has been running on the canvas surface for a long time.

import initSqlJs from "sql.js";
import type { SqlJsStatic, Database } from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { OutputChunk, SessionId, SqlTableData } from "./types";

let _sqlJs: SqlJsStatic | null = null;
const _sessions = new Map<SessionId, Database>();

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!_sqlJs) _sqlJs = await initSqlJs({ locateFile: () => sqlWasmUrl });
  return _sqlJs;
}

async function getDb(sessionId: SessionId): Promise<Database> {
  if (!_sessions.has(sessionId)) {
    const SQL = await getSqlJs();
    _sessions.set(sessionId, new SQL.Database());
  }
  return _sessions.get(sessionId)!;
}

export function resetSqlSession(sessionId: SessionId): void {
  _sessions.get(sessionId)?.close();
  _sessions.delete(sessionId);
}

export function hasSqlSession(sessionId: SessionId): boolean {
  return _sessions.has(sessionId);
}

export async function runSql(sessionId: SessionId, sql: string): Promise<OutputChunk[]> {
  try {
    const db = await getDb(sessionId);
    const results = db.exec(sql);
    const data: SqlTableData[] = results.map(({ columns, values }) => ({
      columns,
      rows: values.map((row) => row.map((v) => (v == null ? null : String(v)))),
      rowCount: values.length,
    }));
    return [{ type: "table", content: JSON.stringify(data) }];
  } catch (err: unknown) {
    // A syntax error is a normal outcome of an editor cell, not an exception to
    // propagate — it renders as red text in the cell like any other result.
    return [{ type: "error", content: err instanceof Error ? err.message : String(err) }];
  }
}
