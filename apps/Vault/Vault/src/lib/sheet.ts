// Spreadsheet formulas in a note's table.
//
// ── Reusing the evaluator, not writing a second one ────────────────────────
//
// A cell starting with `=` is a formula, evaluated by `lib/formula.ts` — the
// same hand-written parser the task blocks use, with no `eval` and no
// `new Function`. That matters more here than there: a table lives in a note,
// and a note can be shared, co-edited and pasted from elsewhere, so a formula
// is a string another person can put in your document.
//
// Cell references and ranges are handled by REWRITING the source before it
// reaches that parser, rather than by teaching it about grids:
//
//   sum(A1:A3)  →  (A1 + A3)      … with A2 empty
//   avg(B1:B4)  →  ((B1+B2+B4)/3)
//   min(A1:A3)  →  min(min(A1,A2),A3)
//
// So the evaluator stays a pure expression language with a fixed function list,
// and the grid stays out of it. The alternative — a range token and variadic
// functions in the parser — would put spreadsheet semantics inside the module
// that the task blocks also depend on, for no gain there.
//
// ⚠️ An empty cell is dropped from an aggregate, never counted as zero. Same
// rule as `aggregate`, `coerceField` and `meterFraction`: absent is not zero.
// `sum(A1:A9)` over three filled cells is the sum of three, and an aggregate
// over an entirely empty range is null rather than 0 — 0 would claim the
// question was answered.

import { compile, type FormulaValue } from "./formula";

/** A1-style address. Columns are letters, rows are 1-based. */
export interface Ref { col: number; row: number }

export const MAX_SHEET_CELLS = 4000;
/** A formula chain deeper than this is pathological even without a cycle. */
export const MAX_DEPTH = 64;

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function colName(col: number): string {
  let n = col, out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export function refName(r: Ref): string {
  return `${colName(r.col)}${r.row + 1}`;
}

export function parseRef(s: string): Ref | null {
  const m = /^([A-Z]+)([0-9]+)$/.exec(s);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = Number(m[2]);
  if (row < 1) return null;
  return { col: col - 1, row: row - 1 };
}

/** Every address in a rectangle, in reading order. Inclusive both ends, and
 *  order-insensitive: `A3:A1` is the same range as `A1:A3`. */
export function expandRange(a: Ref, b: Ref): Ref[] {
  const out: Ref[] = [];
  for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row++) {
    for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col++) {
      out.push({ col, row });
    }
  }
  return out;
}

/** The raw text of every cell, by address. Empty cells are simply absent. */
export type Grid = Map<string, string>;

/**
 * A table as the formula layer sees it.
 *
 * The DIMENSIONS matter as much as the cells. A reference to an empty cell
 * inside the table must be `null`, not "unknown field: B5" — an empty cell is
 * a normal thing to point at, and reporting it as an error would make half of
 * every sheet under construction red. Only a reference outside the table is a
 * mistake worth naming.
 */
export interface Sheet {
  cells: Grid;
  rows: number;
  cols: number;
}

export function isFormula(raw: string): boolean {
  return raw.trimStart().startsWith("=");
}

/** Aggregates understood in a range. Deliberately the same words the task
 *  blocks use for their footers, so one vocabulary covers both. */
const AGGREGATES = new Set(["sum", "avg", "count", "min", "max"]);

const RANGE_RE = /\b([a-z]+)\s*\(\s*([A-Z]+[0-9]+)\s*:\s*([A-Z]+[0-9]+)\s*\)/g;

/**
 * Rewrite every `fn(A1:B2)` into an expression over individual cells.
 *
 * Returns null when a range is malformed or its aggregate is unknown — never a
 * partially rewritten string, which would reach the parser as a syntax error
 * and report the wrong problem.
 */
export function expandRanges(src: string, filled: (ref: string) => boolean): string | null {
  let bad = false;
  const out = src.replace(RANGE_RE, (_m, fn: string, from: string, to: string) => {
    const a = parseRef(from), b = parseRef(to);
    if (!a || !b || !AGGREGATES.has(fn)) { bad = true; return ""; }

    const cells = expandRange(a, b).map(refName).filter(filled);
    if (fn === "count") return String(cells.length);
    // ⚠️ An aggregate over an entirely empty range is null, not 0 — 0 would
    // claim the question was answered. `nullv` is a value the parser accepts
    // and the evaluator returns null for.
    if (cells.length === 0) return "nullv";
    if (fn === "sum") return `(${cells.join(" + ")})`;
    if (fn === "avg") return `((${cells.join(" + ")}) / ${cells.length})`;
    // min/max are binary in the evaluator, so fold them.
    return cells.reduce((acc, c) => (acc ? `${fn}(${acc}, ${c})` : c));
  });
  return bad ? null : out;
}

/**
 * Every name a sheet formula may read: every address INSIDE the table, filled
 * or not, plus the `nullv` sentinel `expandRanges` emits for an empty
 * aggregate.
 *
 * Bounded by the table rather than open-ended so that `=Z99` in a 3×3 table is
 * still a legible error rather than a silent null.
 */
export function sheetNames(sheet: Sheet): string[] {
  const out: string[] = ["nullv"];
  for (let row = 0; row < sheet.rows; row++) {
    for (let col = 0; col < sheet.cols; col++) out.push(refName({ col, row }));
  }
  return out;
}

export interface CellResult {
  value: FormulaValue;
  /** Set when the cell could not be computed. The raw text stays visible. */
  error: string | null;
}

/**
 * Evaluate every formula cell.
 *
 * ⚠️ Cycle detection is the load-bearing part, not a nicety. `A1 = B1` and
 * `B1 = A1` is one keystroke away from existing in any real sheet, and without
 * a guard it is unbounded recursion inside a ProseMirror plugin — which in this
 * app means a blank white page, not an error message. Cells in a cycle report
 * "circular reference" and everything else in the sheet still computes.
 */
export function evaluateSheet(sheet: Sheet): Map<string, CellResult> {
  const grid = sheet.cells;
  const out = new Map<string, CellResult>();
  const state = new Map<string, "busy" | "done">();
  const names = sheetNames(sheet);

  const computeOne = (raw: string, depth: number): CellResult => {
    const src = expandRanges(raw.trimStart().slice(1), (r) => grid.has(r));
    if (src === null) return { value: null, error: "bad range" };

    const prog = compile(src, names);
    if (!prog.ok) return { value: null, error: prog.error };

    // Only the cells this expression actually names are resolved, so an
    // unrelated cycle elsewhere in the sheet cannot poison this one.
    //
    // ⚠️ Matched on word boundaries, not `includes`: "A1" is a substring of
    // "A12", so a substring test would resolve A1 for a formula that only
    // mentions A12 — extra work, and a cycle reported through a cell the user
    // never referenced.
    const ctx: Record<string, FormulaValue> = { nullv: null };
    for (const name of referenced(src, names)) {
      ctx[name] = resolve(name, depth + 1);
    }
    return { value: prog.run(ctx as never), error: null };
  };

  const literal = (raw: string): FormulaValue => {
    const n = Number(raw.trim());
    return raw.trim() !== "" && Number.isFinite(n) ? n : null;
  };

  /**
   * One cell's value, computing it first if it is a formula.
   *
   * ⚠️ A CycleError PROPAGATES rather than being swallowed into a null.
   *
   * Swallowing it flagged only one cell of the pair: `A1 = B1` / `B1 = A1`
   * resolved A1, hit B1, detected the cycle there, recorded it on B1 and handed
   * A1 a null — so A1 rendered a bare dash with nothing to explain it, and the
   * user was told half the truth about a symmetric problem. Every cell on the
   * path now reports it, which is also what a spreadsheet does.
   */
  const resolve = (ref: string, depth: number): FormulaValue => {
    const raw = grid.get(ref);
    if (raw === undefined) return null;
    if (!isFormula(raw)) return literal(raw);

    const done = out.get(ref);
    if (done) {
      if (done.error === CYCLE) throw new CycleError();
      return done.error ? null : done.value;
    }

    if (state.get(ref) === "busy" || depth > MAX_DEPTH) throw new CycleError();
    state.set(ref, "busy");

    try {
      const result = computeOne(raw, depth);
      out.set(ref, result);
      return result.error ? null : result.value;
    } catch (e) {
      if (!(e instanceof CycleError)) {
        out.set(ref, { value: null, error: "error" });
        return null;
      }
      out.set(ref, { value: null, error: CYCLE });
      throw e;
    } finally {
      state.set(ref, "done");
    }
  };

  let budget = MAX_SHEET_CELLS;
  for (const [ref, raw] of grid) {
    if (budget-- <= 0) break;
    if (!isFormula(raw) || out.has(ref)) continue;
    // `resolve` has already recorded the failure on every cell involved; this
    // only stops the throw escaping into the plugin that called us.
    try { resolve(ref, 0); } catch { /* recorded */ }
  }
  return out;
}

const CYCLE = "circular reference";

class CycleError extends Error {}

/** The declared names an expression actually mentions, on word boundaries. */
function referenced(src: string, names: readonly string[]): string[] {
  const found = new Set(src.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? []);
  return names.filter((n) => n !== "nullv" && found.has(n));
}

/** How a computed value reads in a cell. Shared with the task blocks' rule:
 *  a number, `yes`/`no` for a boolean, and an em dash for null. */
export function fmtCell(v: FormulaValue): string {
  if (v === null) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v !== "number") return v;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}
