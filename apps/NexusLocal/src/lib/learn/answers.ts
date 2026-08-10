/**
 * Pure answer-checking, per `answer_type`. No React imports — safe to unit
 * test standalone and to call from `Player.tsx`'s check step.
 *
 * Numeric/vector/matrix comparisons go through exact integer-fraction
 * arithmetic (`Frac`) rather than `parseFloat` + epsilon, so "1/3" compares
 * exactly equal to a drill answer of `0.3333...`-free rationals and whole
 * numbers, with no floating-point drift.
 *
 * ── Surprise vs. LEARN_PLAN.md, confirmed against a live sampled unit
 * (unit_id=2, `lr_unit_content`) ──
 * LEARN_PLAN.md's api.ts row describes `answer_type: "choice"` as
 * "choice (index)". The sampled content instead stores `answer.value` as the
 * *full text* of the correct choice, matched against `choices` — e.g.
 * `{"value": "Falsk"}` with `choices: ["Sandt", "Falsk"]`. `checkAnswer`
 * supports both shapes: a numeric `answer.value` is treated as an index into
 * `choices`; a string `answer.value` is compared as exact (trimmed) text —
 * which is what real content actually needs today.
 */

import type { AnswerType, DrillAnswer, Tile } from "./types";

// --- Exact rational arithmetic ----------------------------------------------

interface Frac {
  n: number;
  d: number;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

function reduceFrac(f: Frac): Frac {
  if (f.d === 0) return f;
  const sign = f.d < 0 ? -1 : 1;
  const g = gcd(f.n, f.d);
  return { n: (sign * f.n) / g, d: (sign * f.d) / g };
}

/** Parses an integer, a decimal ("-1.25"), or a fraction ("a/b") into an exact Frac. */
function parseFraction(raw: string): Frac | null {
  const s = raw.trim();
  if (s === "") return null;

  const fracMatch = s.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (fracMatch) {
    const n = parseInt(fracMatch[1], 10);
    const d = parseInt(fracMatch[2], 10);
    if (d === 0) return null;
    return reduceFrac({ n, d });
  }

  const decMatch = s.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (decMatch) {
    const sign = decMatch[1] === "-" ? -1 : 1;
    const intPart = decMatch[2];
    const fracPart = decMatch[3] ?? "";
    const d = Math.pow(10, fracPart.length);
    const n = sign * parseInt((intPart + fracPart).replace(/^0+(?=\d)/, "") || "0", 10);
    return reduceFrac({ n, d });
  }

  return null;
}

function fracFromNumber(x: number): Frac | null {
  return parseFraction(String(x));
}

function fracEqual(a: Frac, b: Frac): boolean {
  const ra = reduceFrac(a);
  const rb = reduceFrac(b);
  return ra.n === rb.n && ra.d === rb.d;
}

/** Whitespace-tolerant exact comparison of a raw user string against a numeric/string target. */
function numbersEqual(userRaw: string, target: number | string): boolean {
  const userFrac = parseFraction(userRaw);
  const targetFrac = typeof target === "number" ? fracFromNumber(target) : parseFraction(String(target));
  if (userFrac && targetFrac) return fracEqual(userFrac, targetFrac);
  // Fallback for anything that didn't parse as an exact rational (shouldn't
  // happen for authored numeric content, but keeps this from hard-failing).
  const uf = parseFloat(userRaw.trim());
  const tf = typeof target === "number" ? target : parseFloat(String(target));
  return !Number.isNaN(uf) && !Number.isNaN(tf) && Math.abs(uf - tf) < 1e-9;
}

function splitComponents(raw: string): string[] {
  return raw
    .trim()
    .split(/[,\s]+/)
    .filter((s) => s.length > 0);
}

function splitRows(raw: string): string[] {
  return raw
    .trim()
    .split(/[;\n]+/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

// --- Per-type checks ---------------------------------------------------------

// Learners naturally answer in equation form — "a=6", "A(B+C) = (5 1; 0 8)",
// or even the full verification "(5 1; 0 8) = (2 0; 1 5) + (3 1;-1 3)". The
// rule: split on '=', clean each segment, and every segment that PARSES as the
// expected shape must equal the target (at least one must parse). Segments
// that don't parse — symbol names, sums of matrices — are ignored, so writing
// out the confirmation the prompt asked for never costs a correct answer,
// while "wrong = right" still fails on the readable-but-wrong side.

/** Strip fully-enclosing matched parentheses, repeatedly: "(5 1; 0 8;)" → "5 1; 0 8;". */
function stripOuterParens(s: string): string {
  let t = s.trim();
  while (t.startsWith("(") && t.endsWith(")")) {
    let depth = 0;
    let enclosing = true;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "(") depth++;
      else if (t[i] === ")") {
        depth--;
        if (depth === 0 && i < t.length - 1) {
          enclosing = false;
          break;
        }
      }
    }
    if (!enclosing || depth !== 0) break;
    t = t.slice(1, -1).trim();
  }
  return t;
}

function equationSegments(raw: string): string[] {
  return raw
    .split("=")
    .map((s) => stripOuterParens(s.trim()))
    .filter((s) => s.length > 0);
}

function parseVectorSegment(seg: string): Frac[] | null {
  const parts = splitComponents(seg);
  if (parts.length === 0) return null;
  const fracs = parts.map(parseFraction);
  return fracs.every((f) => f !== null) ? (fracs as Frac[]) : null;
}

function parseMatrixSegment(seg: string): Frac[][] | null {
  const rows = splitRows(seg);
  if (rows.length === 0) return null;
  const parsed = rows.map(parseVectorSegment);
  return parsed.every((r) => r !== null) ? (parsed as Frac[][]) : null;
}

export function checkNumeric(userInput: string, answer: DrillAnswer): boolean {
  if (typeof answer.value !== "number" && typeof answer.value !== "string") return false;
  const target = answer.value;
  const candidates = equationSegments(userInput).filter((s) => parseFraction(s) !== null);
  if (candidates.length === 0) {
    // Fallback: no segment parsed as an exact rational — try the whole input
    // through the float-tolerant path so odd-but-honest inputs aren't bricked.
    return numbersEqual(userInput, target);
  }
  return candidates.every((s) => numbersEqual(s, target));
}

export function checkVector(userInput: string, answer: DrillAnswer): boolean {
  if (!Array.isArray(answer.value)) return false;
  const target = answer.value as number[];
  const candidates = equationSegments(userInput)
    .map(parseVectorSegment)
    .filter((v): v is Frac[] => v !== null);
  if (candidates.length === 0) return false;
  return candidates.every(
    (v) =>
      v.length === target.length &&
      v.every((f, i) => {
        const t = fracFromNumber(target[i]);
        return t !== null && fracEqual(f, t);
      })
  );
}

export function checkMatrix(userInput: string, answer: DrillAnswer): boolean {
  if (!Array.isArray(answer.value)) return false;
  const target = answer.value as number[][];
  const candidates = equationSegments(userInput)
    .map(parseMatrixSegment)
    .filter((m): m is Frac[][] => m !== null);
  if (candidates.length === 0) return false;
  return candidates.every(
    (m) =>
      m.length === target.length &&
      m.every((row, i) => {
        const targetRow = target[i];
        if (!Array.isArray(targetRow) || row.length !== targetRow.length) return false;
        return row.every((f, j) => {
          const t = fracFromNumber(targetRow[j]);
          return t !== null && fracEqual(f, t);
        });
      })
  );
}

/**
 * `userSelection` is the text of the choice the learner clicked (this is how
 * `Player.tsx`'s multiple-choice UI naturally produces a value). Handles both
 * observed answer shapes — see file header.
 */
export function checkChoice(userSelection: string, answer: DrillAnswer, choices?: string[]): boolean {
  if (typeof answer.value === "number") {
    if (!choices) return false;
    const idx = answer.value;
    return choices[idx] !== undefined && choices[idx].trim() === userSelection.trim();
  }
  if (typeof answer.value === "string") {
    return answer.value.trim() === userSelection.trim();
  }
  return false;
}

/**
 * `text` drills are self-graded — there is no machine-checkable form for a
 * free-prose justification. Returns `null` ("no automatic verdict") so
 * `Player.tsx` skips straight to showing `solution_md` and the grade buttons,
 * rather than showing a right/wrong indicator it can't actually compute.
 */
export function checkText(): null {
  return null;
}

/**
 * Dispatches on `answer_type`. Returns `true`/`false` for machine-checkable
 * types, `null` when the type is self-graded (`text`), the type is `tiles`
 * (checked separately below — its inputs aren't a single string), or
 * malformed/absent input makes checking impossible to do meaningfully.
 */
export function checkAnswer(
  answerType: AnswerType,
  userInput: string,
  answer: DrillAnswer | undefined,
  choices?: string[]
): boolean | null {
  if (!answer) return null;
  switch (answerType) {
    case "numeric":
      return checkNumeric(userInput, answer);
    case "vector":
      return checkVector(userInput, answer);
    case "matrix":
      return checkMatrix(userInput, answer);
    case "choice":
      return checkChoice(userInput, answer, choices);
    case "text":
      return checkText();
    default:
      return null;
  }
}

// --- Tile drills (schema v1.1) ----------------------------------------------

/**
 * A format check, not a grading check: "did this input parse into the shape
 * `answerType` expects at all" — independent of whether the parsed value is
 * *correct*. Exists because unparseable input (e.g. answering a numeric
 * prompt "a=6" after `stripAssignmentPrefix` mis-strips, or a stray letter)
 * must never be graded as a wrong answer — it's a format event, not a
 * knowledge event. `DrillCard.tsx` calls this before `checkAnswer` and
 * routes a `false` result to a neutral inline message instead of the
 * red "wrong" feedback, with no attempt logged.
 *
 * Parseable ⇔ at least ONE '='-separated segment of the input reads as the
 * expected shape (see `equationSegments` — this is what lets learners answer
 * in equation form, "A(B+C) = (5 1; 0 8)" or the full verification, without
 * penalty). A *shape* mismatch against the target (wrong component count,
 * wrong row count) is NOT a format error — `checkVector`/`checkMatrix`
 * already grade that as a wrong answer, which is correct, since the learner
 * clearly attempted the right kind of answer. Only inputs with no readable
 * segment at all are format errors here. `choice`/`text`/`tiles` have no
 * typed parsing step, so they always parse.
 */
export function inputParses(answerType: AnswerType, userInput: string): boolean {
  switch (answerType) {
    case "numeric":
      return equationSegments(userInput).some((s) => parseFraction(s) !== null);
    case "vector":
      return equationSegments(userInput).some((s) => parseVectorSegment(s) !== null);
    case "matrix":
      return equationSegments(userInput).some((s) => parseMatrixSegment(s) !== null);
    case "choice":
    case "text":
    case "tiles":
      return true;
    default:
      return true;
  }
}

/**
 * `mode: "select"` check. Passes iff the learner selected all-and-only the
 * tiles marked `correct: true` — partial credit is not a pass. Order and
 * `selectedIds` duplicates don't matter; compares as sets.
 */
export function checkTilesSelect(selectedIds: string[], tiles: Tile[]): boolean {
  const correctIds = new Set(tiles.filter((t) => t.correct === true).map((t) => t.id));
  const selected = new Set(selectedIds);
  if (selected.size !== correctIds.size) return false;
  for (const id of selected) {
    if (!correctIds.has(id)) return false;
  }
  return true;
}

/**
 * `mode: "build"` check. Passes iff the tapped sequence of tile ids matches
 * `answer.sequence` exactly, position for position — order matters, and an
 * incomplete or over-long sequence fails.
 */
export function checkTilesBuild(sequence: string[], answerSequence: string[]): boolean {
  if (sequence.length !== answerSequence.length) return false;
  return sequence.every((id, i) => id === answerSequence[i]);
}
