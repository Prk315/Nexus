import { useState } from "react";

// ── Public types ──────────────────────────────────────────────────────────────
export interface MatrixStep {
  id: string;
  op: string;
  cells: string[][];
}

export interface MatrixBlockData {
  id: string;
  type: "matrix";
  x: number; y: number; width: number; height: number;
  rows: number;
  cols: number;
  augmented: boolean;
  cells: string[][];
  steps: MatrixStep[];
}

// ── Fraction arithmetic (exact, no floating-point drift) ──────────────────────
type Frac = [number, number]; // [numerator, denominator], always reduced, den > 0

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = b; b = a % b; a = t; }
  return a || 1;
}

function fr(n: number, d: number): Frac {
  if (!isFinite(n) || !isFinite(d) || d === 0) return [0, 1];
  if (n === 0) return [0, 1];
  const sign = d < 0 ? -1 : 1;
  const g = gcd(Math.abs(n), Math.abs(d));
  return [sign * (n / g), sign * (d / g)];
}

function fparse(s: string): Frac {
  s = (s ?? "").trim();
  if (!s) return [0, 1];
  const neg = s.startsWith("-");
  const abs = neg ? s.slice(1) : s;
  const sign = neg ? -1 : 1;
  if (abs.includes("/")) {
    const [ns, ds] = abs.split("/");
    return fr(sign * (parseInt(ns, 10) || 0), parseInt(ds, 10) || 1);
  }
  const v = parseFloat(abs);
  if (isNaN(v)) return [0, 1];
  const str = v.toString();
  const dot = str.indexOf(".");
  if (dot === -1) return fr(sign * Math.round(v), 1);
  const dec = str.length - dot - 1;
  return fr(sign * Math.round(v * 10 ** dec), 10 ** dec);
}

function fstr(f: Frac): string {
  return f[1] === 1 ? String(f[0]) : `${f[0]}/${f[1]}`;
}

const F1: Frac = [1, 1];
const fadd = (a: Frac, b: Frac): Frac => fr(a[0]*b[1] + b[0]*a[1], a[1]*b[1]);
const fmul = (a: Frac, b: Frac): Frac => fr(a[0]*b[0], a[1]*b[1]);
const fdiv = (a: Frac, b: Frac): Frac => fr(a[0]*b[1], a[1]*b[0]);
const fneg = (a: Frac): Frac          => [-a[0], a[1]];
const fzero = (f: Frac) => f[0] === 0;
const fone  = (f: Frac) => f[0] !== 0 && f[0] === f[1];

// ── Matrix row operations (immutable) ─────────────────────────────────────────
type Mat = Frac[][];

function mSwap(m: Mat, i: number, j: number): Mat {
  m = m.map(r => [...r]);
  [m[i], m[j]] = [m[j], m[i]];
  return m;
}
function mScale(m: Mat, i: number, k: Frac): Mat {
  m = m.map(r => [...r]);
  m[i] = m[i].map(v => fmul(v, k));
  return m;
}
function mAdd(m: Mat, target: number, k: Frac, src: number): Mat {
  m = m.map(r => [...r]);
  m[target] = m[target].map((v, c) => fadd(v, fmul(k, m[src][c])));
  return m;
}

function cells2mat(cells: string[][]): Mat { return cells.map(r => r.map(fparse)); }
function mat2cells(m: Mat): string[][] { return m.map(r => r.map(fstr)); }

function elimOp(target: number, k: Frac, src: number): string {
  const ks = fstr(k);
  if (ks === "1")  return `R${target+1} → R${target+1} + R${src+1}`;
  if (ks === "-1") return `R${target+1} → R${target+1} − R${src+1}`;
  if (k[0] < 0)   return `R${target+1} → R${target+1} − ${fstr(fneg(k))}·R${src+1}`;
  return             `R${target+1} → R${target+1} + ${ks}·R${src+1}`;
}

// ── Gaussian elimination ──────────────────────────────────────────────────────
function computeREF(cells: string[][], rows: number, cols: number, augmented: boolean): MatrixStep[] {
  let m = cells2mat(cells);
  const steps: MatrixStep[] = [];
  const dataCols = augmented ? cols - 1 : cols;

  function push(op: string) {
    steps.push({ id: crypto.randomUUID(), op, cells: mat2cells(m) });
  }

  let pr = 0;
  for (let col = 0; col < dataCols && pr < rows; col++) {
    let found = -1;
    for (let r = pr; r < rows; r++) { if (!fzero(m[r][col])) { found = r; break; } }
    if (found === -1) continue;

    if (found !== pr) { m = mSwap(m, pr, found); push(`R${pr+1} ↔ R${found+1}`); }

    for (let r = pr + 1; r < rows; r++) {
      if (fzero(m[r][col])) continue;
      const k = fneg(fdiv(m[r][col], m[pr][col]));
      m = mAdd(m, r, k, pr);
      push(elimOp(r, k, pr));
    }
    pr++;
  }
  return steps;
}

function computeRREF(cells: string[][], rows: number, cols: number, augmented: boolean): MatrixStep[] {
  let m = cells2mat(cells);
  const steps: MatrixStep[] = [];
  const dataCols = augmented ? cols - 1 : cols;

  function push(op: string) {
    steps.push({ id: crypto.randomUUID(), op, cells: mat2cells(m) });
  }

  let pr = 0;
  const pivotCols: number[] = [];

  // Forward pass (REF)
  for (let col = 0; col < dataCols && pr < rows; col++) {
    let found = -1;
    for (let r = pr; r < rows; r++) { if (!fzero(m[r][col])) { found = r; break; } }
    if (found === -1) continue;

    if (found !== pr) { m = mSwap(m, pr, found); push(`R${pr+1} ↔ R${found+1}`); }

    for (let r = pr + 1; r < rows; r++) {
      if (fzero(m[r][col])) continue;
      const k = fneg(fdiv(m[r][col], m[pr][col]));
      m = mAdd(m, r, k, pr);
      push(elimOp(r, k, pr));
    }
    pivotCols.push(col);
    pr++;
  }

  // Back pass: scale pivots to 1, then eliminate upward
  for (let pi = pivotCols.length - 1; pi >= 0; pi--) {
    const col = pivotCols[pi];
    const row = pi;
    const pivot = m[row][col];

    if (!fzero(pivot) && !fone(pivot)) {
      const k = fdiv(F1, pivot);
      m = mScale(m, row, k);
      push(`R${row+1} → (${fstr(k)})·R${row+1}`);
    }

    for (let r = 0; r < row; r++) {
      if (fzero(m[r][col])) continue;
      const k = fneg(m[r][col]);
      m = mAdd(m, r, k, row);
      push(elimOp(r, k, row));
    }
  }
  return steps;
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  block: MatrixBlockData;
  onPatch: (p: Partial<MatrixBlockData>) => void;
  onSelect?: () => void;
}

type OpType = "swap" | "scale" | "add";

export function MatrixBlockContent({ block, onPatch, onSelect }: Props) {
  const [opType, setOpType]     = useState<OpType>("add");
  const [r1, setR1]             = useState(1);
  const [r2, setR2]             = useState(2);
  const [scalar, setScalar]     = useState("-1");
  const [stepsOpen, setStepsOpen] = useState(false);
  const [activeStep, setActiveStep] = useState<number | null>(null);

  const { rows, cols, cells, augmented, steps } = block;

  function setCell(r: number, c: number, val: string) {
    const next = cells.map(row => [...row]);
    next[r][c] = val;
    onPatch({ cells: next });
  }

  function addRow()    { onPatch({ rows: rows + 1, cells: [...cells, Array(cols).fill("0")] }); }
  function removeRow() { if (rows > 1) onPatch({ rows: rows - 1, cells: cells.slice(0, -1) }); }
  function addCol()    { onPatch({ cols: cols + 1, cells: cells.map(r => [...r, "0"]) }); }
  function removeCol() { if (cols > 1) onPatch({ cols: cols - 1, cells: cells.map(r => r.slice(0, -1)) }); }

  function applyOp() {
    const ri = Math.min(Math.max(r1, 1), rows) - 1;
    const rj = Math.min(Math.max(r2, 1), rows) - 1;
    let m = cells2mat(cells);
    let op = "";

    if (opType === "swap") {
      if (ri === rj) return;
      m = mSwap(m, ri, rj);
      op = `R${ri+1} ↔ R${rj+1}`;
    } else if (opType === "scale") {
      const k = fparse(scalar);
      if (fzero(k)) return;
      m = mScale(m, ri, k);
      op = `R${ri+1} → (${fstr(k)})·R${ri+1}`;
    } else {
      if (ri === rj) return;
      const k = fparse(scalar);
      m = mAdd(m, ri, k, rj);
      op = elimOp(ri, k, rj);
    }

    const newCells = mat2cells(m);
    onPatch({ cells: newCells, steps: [...steps, { id: crypto.randomUUID(), op, cells: newCells }] });
    setActiveStep(null);
  }

  function doREF() {
    const s = computeREF(cells, rows, cols, augmented);
    if (!s.length) return;
    onPatch({ cells: s[s.length - 1].cells, steps: [...steps, ...s] });
    setStepsOpen(true);
    setActiveStep(null);
  }

  function doRREF() {
    const s = computeRREF(cells, rows, cols, augmented);
    if (!s.length) return;
    onPatch({ cells: s[s.length - 1].cells, steps: [...steps, ...s] });
    setStepsOpen(true);
    setActiveStep(null);
  }

  const displayCells = activeStep !== null ? (steps[activeStep]?.cells ?? cells) : cells;
  const rowNums = Array.from({ length: rows }, (_, i) => i + 1);
  const safeR1 = Math.min(r1, rows);
  const safeR2 = Math.min(r2, rows);

  return (
    <div
      className="mx-root"
      onMouseDown={e => { e.stopPropagation(); onSelect?.(); }}
      onDoubleClick={e => e.stopPropagation()}
    >
      {/* Toolbar */}
      <div className="mx-toolbar">
        <button className="mx-dim-btn" onClick={addRow} title="Add row">+R</button>
        <button className="mx-dim-btn" onClick={removeRow} disabled={rows <= 1} title="Remove row">−R</button>
        <button className="mx-dim-btn" onClick={addCol} title="Add column">+C</button>
        <button className="mx-dim-btn" onClick={removeCol} disabled={cols <= 1} title="Remove column">−C</button>
        <label className="mx-aug-label" title="Augmented matrix (separator before last column)">
          <input
            type="checkbox"
            checked={augmented}
            onChange={e => onPatch({ augmented: e.target.checked })}
            onMouseDown={e => e.stopPropagation()}
          />
          Aug
        </label>
        <div style={{ flex: 1 }} />
        <button className="mx-action-btn" onClick={doREF}>REF</button>
        <button className="mx-action-btn" onClick={doRREF}>RREF</button>
      </div>

      {/* Matrix grid */}
      <div className="mx-matrix-area">
        <div className="mx-bracket-l" />
        <div className="mx-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(44px, 60px))` }}>
          {displayCells.map((row, ri) =>
            row.map((cell, ci) => (
              <div key={`${ri}-${ci}`} className={`mx-cell-wrap${augmented && ci === cols - 1 ? " mx-aug-sep" : ""}`}>
                {activeStep !== null
                  ? <div className="mx-cell-ro">{cell}</div>
                  : <input
                      className="mx-cell"
                      value={cell}
                      onChange={e => setCell(ri, ci, e.target.value)}
                      onMouseDown={e => e.stopPropagation()}
                      onDoubleClick={e => e.stopPropagation()}
                    />
                }
              </div>
            ))
          )}
        </div>
        <div className="mx-bracket-r" />
      </div>

      {/* Row operations */}
      {activeStep === null && (
        <div className="mx-ops-row">
          <select className="mx-select" value={opType} onChange={e => setOpType(e.target.value as OpType)} onMouseDown={e => e.stopPropagation()}>
            <option value="swap">Swap</option>
            <option value="scale">Scale</option>
            <option value="add">Add</option>
          </select>

          <span className="mx-op-lbl">R</span>
          <select className="mx-select mx-select-sm" value={safeR1} onChange={e => setR1(+e.target.value)} onMouseDown={e => e.stopPropagation()}>
            {rowNums.map(n => <option key={n}>{n}</option>)}
          </select>

          {opType === "swap" && (
            <><span className="mx-op-lbl">↔ R</span>
            <select className="mx-select mx-select-sm" value={safeR2} onChange={e => setR2(+e.target.value)} onMouseDown={e => e.stopPropagation()}>
              {rowNums.map(n => <option key={n}>{n}</option>)}
            </select></>
          )}
          {opType === "scale" && (
            <><span className="mx-op-lbl">→</span>
            <input className="mx-scalar" value={scalar} onChange={e => setScalar(e.target.value)} onMouseDown={e => e.stopPropagation()} placeholder="k" />
            <span className="mx-op-lbl">· R{safeR1}</span></>
          )}
          {opType === "add" && (
            <><span className="mx-op-lbl">→ R{safeR1} +</span>
            <input className="mx-scalar" value={scalar} onChange={e => setScalar(e.target.value)} onMouseDown={e => e.stopPropagation()} placeholder="k" />
            <span className="mx-op-lbl">· R</span>
            <select className="mx-select mx-select-sm" value={safeR2} onChange={e => setR2(+e.target.value)} onMouseDown={e => e.stopPropagation()}>
              {rowNums.map(n => <option key={n}>{n}</option>)}
            </select></>
          )}

          <button className="mx-apply-btn" onClick={applyOp}>Apply</button>
        </div>
      )}
      {activeStep !== null && (
        <div className="mx-ops-row mx-ops-preview-hint">
          Previewing step {activeStep + 1}
          <button className="mx-back-btn" onClick={() => setActiveStep(null)}>← Back to current</button>
        </div>
      )}

      {/* Step history */}
      <div className="mx-steps">
        <div className="mx-steps-hdr" onClick={() => setStepsOpen(v => !v)}>
          <span className="mx-steps-toggle">{stepsOpen ? "▾" : "▸"}</span>
          <span className="mx-steps-title">Steps ({steps.length})</span>
          {steps.length > 0 && (
            <button className="mx-clear-btn" onClick={e => { e.stopPropagation(); onPatch({ steps: [] }); setActiveStep(null); }}>
              Clear
            </button>
          )}
        </div>
        {stepsOpen && (
          <div className="mx-steps-body">
            {steps.length === 0
              ? <div className="mx-steps-empty">No steps yet — apply a row op or click REF / RREF</div>
              : steps.map((s, i) => (
                <div
                  key={s.id}
                  className={`mx-step${activeStep === i ? " mx-step-active" : ""}`}
                  onClick={() => setActiveStep(activeStep === i ? null : i)}
                  title="Click to preview matrix at this step"
                >
                  <span className="mx-step-n">{i + 1}.</span>
                  <span className="mx-step-op">{s.op}</span>
                </div>
              ))
            }
          </div>
        )}
      </div>
    </div>
  );
}
