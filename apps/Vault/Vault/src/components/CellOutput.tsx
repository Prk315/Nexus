// Rendering a cell's results. Shared by the note editor and the canvas, so a
// query result looks the same wherever the cell lives.

import type { OutputChunk, SqlTableData } from "../kernel/types";

export function SqlResultTable({ content }: { content: string }) {
  let data: SqlTableData[];
  try {
    data = JSON.parse(content);
  } catch {
    // Outputs round-trip through the document, so malformed JSON here means
    // hand-edited or truncated content — show something rather than throwing
    // inside a NodeView, which would take the whole editor down.
    return <pre className="code-cell-error-text">Unreadable result</pre>;
  }
  // A statement that returns no rows (CREATE TABLE, INSERT) yields an empty
  // array. Saying "✓ OK" is the difference between "it worked" and "nothing
  // happened", which otherwise look identical.
  if (data.length === 0) return <pre className="code-cell-sql-ok">✓ OK</pre>;
  return (
    <>
      {data.map((res, ri) => (
        <div key={ri} className="sql-result-set">
          <div className="sql-table-scroll">
            <table className="sql-result-table">
              <thead>
                <tr>{res.columns.map((c, ci) => <th key={ci}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {res.rows.map((row, rowIdx) => (
                  <tr key={rowIdx}>
                    {row.map((v, ci) => (
                      <td key={ci}>{v === null ? <span className="sql-null">NULL</span> : v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className="sql-row-count">
            {res.rowCount} row{res.rowCount !== 1 ? "s" : ""}
          </span>
        </div>
      ))}
    </>
  );
}

export function CellOutput({ chunks }: { chunks: OutputChunk[] }) {
  if (chunks.length === 0) return null;
  return (
    <div className="code-cell-output" data-drag-ignore="true">
      {chunks.map((chunk, i) =>
        chunk.type === "table" ? (
          <SqlResultTable key={i} content={chunk.content} />
        ) : chunk.type === "image" ? (
          <img
            key={i}
            src={`data:image/png;base64,${chunk.content}`}
            alt="cell output"
            className="code-cell-img"
          />
        ) : chunk.type === "html" ? (
          // `sandbox="allow-scripts"` WITHOUT allow-same-origin, which is the
          // combination that matters: the frame gets a unique opaque origin, so
          // scripts in it cannot reach this page's DOM, cookies or the Supabase
          // session in localStorage. Adding allow-same-origin alongside
          // allow-scripts would let the frame remove its own sandbox, which is
          // the documented footgun.
          <iframe
            key={i}
            srcDoc={chunk.content}
            sandbox="allow-scripts"
            className="code-cell-html-frame"
            title="cell output"
          />
        ) : (
          <pre key={i} className={chunk.type === "error" ? "code-cell-error-text" : ""}>
            {chunk.content}
          </pre>
        )
      )}
    </div>
  );
}
