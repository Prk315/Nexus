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

// Prompts often name the unknown ("For hvilken værdi af a …"), and answering
// "a=6" instead of "6" is a natural response, not a wrong one. Strip a single
// leading `<identifier> =` (incl. greek letters like λ) before parsing.
function stripAssignmentPrefix(raw: string): string {
  return raw.trim().replace(/^[a-zA-Zα-ωΑ-Ω][a-zA-Z0-9_]*\s*=\s*/, "");
}

export function checkNumeric(userInput: string, answer: DrillAnswer): boolean {
  if (typeof answer.value !== "number" && typeof answer.value !== "string") return false;
  return numbersEqual(stripAssignmentPrefix(userInput), answer.value);
}

export function checkVector(userInput: string, answer: DrillAnswer): boolean {
  if (!Array.isArray(answer.value)) return false;
  const target = answer.value as number[];
  const parts = splitComponents(stripAssignmentPrefix(userInput));
  if (parts.length !== target.length) return false;
  return parts.every((p, i) => numbersEqual(p, target[i]));
}

export function checkMatrix(userInput: string, answer: DrillAnswer): boolean {
  if (!Array.isArray(answer.value)) return false;
  const target = answer.value as number[][];
  const rows = splitRows(stripAssignmentPrefix(userInput));
  if (rows.length !== target.length) return false;
  return rows.every((row, i) => {
    const targetRow = target[i];
    const parts = splitComponents(row);
    if (!Array.isArray(targetRow) || parts.length !== targetRow.length) return false;
    return parts.every((p, j) => numbersEqual(p, targetRow[j]));
  });
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
 * `numeric` → `parseFraction` succeeds on the (assignment-prefix-stripped)
 * whole string. `vector`/`matrix` → every split-out component/cell parses;
 * a *shape* mismatch against the target (wrong component count, wrong row
 * count) is NOT a format error — `checkVector`/`checkMatrix` already grade
 * that as a wrong answer, which is correct, since the learner clearly
 * attempted the right kind of answer. Only unreadable tokens (non-numeric
 * junk) are format errors here. `choice`/`text`/`tiles` have no typed
 * parsing step, so they always parse.
 */
export function inputParses(answerType: AnswerType, userInput: string): boolean {
  switch (answerType) {
    case "numeric":
      return parseFraction(stripAssignmentPrefix(userInput)) !== null;
    case "vector": {
      const parts = splitComponents(stripAssignmentPrefix(userInput));
      if (parts.length === 0) return false;
      return parts.every((p) => parseFraction(p) !== null);
    }
    case "matrix": {
      const rows = splitRows(stripAssignmentPrefix(userInput));
      if (rows.length === 0) return false;
      return rows.every((row) => {
        const parts = splitComponents(row);
        if (parts.length === 0) return false;
        return parts.every((p) => parseFraction(p) !== null);
      });
    }
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
