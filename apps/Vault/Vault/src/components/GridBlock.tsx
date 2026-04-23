import { useRef } from "react";

export interface GridBlockData {
  id: string;
  type: "simple_grid";
  x: number; y: number; width: number; height: number;
  rows: number;
  cols: number;
  cells: string[][];
  brackets: boolean; // kept for data compat, always true visually
}

interface Props {
  block: GridBlockData;
  onPatch: (p: Partial<GridBlockData>) => void;
  onSelect?: () => void;
}

export function GridBlockContent({ block, onPatch, onSelect }: Props) {
  const { rows, cols, cells } = block;
  const refsMap = useRef<Map<string, HTMLInputElement>>(new Map());

  function focus(r: number, c: number) {
    refsMap.current.get(`${r},${c}`)?.focus();
  }

  function setCell(r: number, c: number, val: string) {
    const next = cells.map(row => [...row]);
    next[r][c] = val;
    onPatch({ cells: next });
  }

  function addRow(then?: () => void) {
    onPatch({ rows: rows + 1, cells: [...cells, Array(cols).fill("")] });
    if (then) setTimeout(then, 0);
  }
  function removeLastRow() {
    if (rows <= 1) return;
    onPatch({ rows: rows - 1, cells: cells.slice(0, -1) });
  }
  function addCol(then?: () => void) {
    onPatch({ cols: cols + 1, cells: cells.map(r => [...r, ""]) });
    if (then) setTimeout(then, 0);
  }
  function removeLastCol() {
    if (cols <= 1) return;
    onPatch({ cols: cols - 1, cells: cells.map(r => r.slice(0, -1)) });
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) {
    if (e.key === "Tab") {
      e.preventDefault();
      if (!e.shiftKey) {
        if (c < cols - 1) focus(r, c + 1);
        else if (r < rows - 1) focus(r + 1, 0);
        else addRow(() => focus(r + 1, 0));
      } else {
        if (c > 0) focus(r, c - 1);
        else if (r > 0) focus(r - 1, cols - 1);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (r < rows - 1) focus(r + 1, c);
      else addRow(() => focus(r + 1, c));
    } else if (e.key === "ArrowUp"   && r > 0)        { e.preventDefault(); focus(r - 1, c); }
    else if   (e.key === "ArrowDown" && r < rows - 1) { e.preventDefault(); focus(r + 1, c); }
    else if   (e.key === "ArrowLeft") {
      const el = refsMap.current.get(`${r},${c}`);
      if (el && el.selectionStart === 0 && c > 0) { e.preventDefault(); focus(r, c - 1); }
    } else if (e.key === "ArrowRight") {
      const el = refsMap.current.get(`${r},${c}`);
      if (el && el.selectionStart === el.value.length && c < cols - 1) { e.preventDefault(); focus(r, c + 1); }
    }
  }

  return (
    <div
      className="sg-root"
      onMouseDown={e => { e.stopPropagation(); onSelect?.(); }}
      onDoubleClick={e => e.stopPropagation()}
    >
      {/* Main row: bracket · grid · bracket · +col */}
      <div className="sg-row">
        <div className="sg-brk sg-brk-l" />

        <div className="sg-mid">
          <div
            className="sg-grid"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(44px, 1fr))` }}
          >
            {cells.map((row, ri) =>
              row.map((val, ci) => (
                <input
                  key={`${ri},${ci}`}
                  ref={el => { el ? refsMap.current.set(`${ri},${ci}`, el) : refsMap.current.delete(`${ri},${ci}`); }}
                  className={`sg-cell${ci < cols - 1 ? " sg-cell-divider" : ""}`}
                  value={val}
                  onChange={e => setCell(ri, ci, e.target.value)}
                  onKeyDown={e => onKey(e, ri, ci)}
                  onMouseDown={e => e.stopPropagation()}
                  onDoubleClick={e => e.stopPropagation()}
                />
              ))
            )}
          </div>

          {/* + row — appears on hover below the grid */}
          <button className="sg-add-row" onClick={() => addRow()} title="Add row">+</button>
        </div>

        <div className="sg-brk sg-brk-r" />

        {/* + col — appears on hover to the right */}
        <button className="sg-add-col" onClick={() => addCol()} title="Add column">+</button>
      </div>

      {/* Hover-only resize controls — bottom strip */}
      <div className="sg-hover-bar">
        <button className="sg-hbtn" onClick={removeLastRow} disabled={rows <= 1} title="Remove last row">−R</button>
        <button className="sg-hbtn" onClick={removeLastCol} disabled={cols <= 1} title="Remove last col">−C</button>
        <span className="sg-hdim">{rows}×{cols}</span>
      </div>
    </div>
  );
}
