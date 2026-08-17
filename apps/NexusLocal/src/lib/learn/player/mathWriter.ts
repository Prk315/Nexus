/**
 * mathWriter — the lenient text → LaTeX transform behind the Arbejdsrum
 * "Kladde" (rendered by `player/Workspace.tsx`, one KaTeX line per scratch
 * line). LEARN_PLAN.md § "Arbejdsrum — exercise workspace + math writer".
 *
 * Zero imports, pure and total: same input → same output, no globals, no
 * Date, no randomness. `toLatex` NEVER throws — every failure path lands in
 * `textFallback(src)`, so the worst case is the learner seeing their own
 * line as upright text, never a red KaTeX error inside a drill.
 *
 * The input grammar is the SAME grammar `answers.ts` already parses
 * (matrices "(1 2; 3 4)" / "1 2; 3 4" / "1 2\n3 4", vectors "1, -2, 3" and
 * "1 -2 3", fractions "2/3", "=" chains), extended leniently — sqrt(x),
 * x^2, a_ij, greek names, ×/*, Danish prose wrapped in \text{}. The LaTeX
 * exists only for the eye: callers copy the RAW line into answer inputs,
 * never the transformed output.
 *
 * Documented, deliberate consequences of the vector/matrix detection:
 *  - "(1 2 3)" renders as a COLUMN vector, not a 1×3 matrix — it is what
 *    answers.ts `splitComponents` reads it as. The escape hatch is a
 *    trailing semicolon: "(1 2 3;)" → one-row pmatrix.
 *  - "1 -2" becomes a 2-vector, not "one minus two" — again matching
 *    `checkVector`. Spaced "1 - 2" stays subtraction ("-" alone fails ATOM).
 *  - Operator-name recognition requires a following "(": "rank A" keeps
 *    "rank" as a plain identifier ("col"/"im" are too common as variables).
 *  - After an escaped "%", the next bare word is wrapped in \text{} —
 *    "100% korrekt" reads as prose after a percentage (pinned in the case
 *    corpus), so "korrekt" must not render as italic juxtaposed variables.
 */

// ── Rule-zero landing pads ───────────────────────────────────────────────────

/** Escaped *content* only, no `\text{}` wrapper. Exported for tests. */
export function escapeTextContent(src: string): string {
  let out = "";
  for (const c of src) {
    switch (c) {
      case "\\":
        out += "\\textbackslash{}";
        break;
      case "{":
        out += "\\{";
        break;
      case "}":
        out += "\\}";
        break;
      case "$":
        out += "\\$";
        break;
      case "&":
        out += "\\&";
        break;
      case "%":
        out += "\\%";
        break;
      case "#":
        out += "\\#";
        break;
      case "_":
        out += "\\_";
        break;
      case "^":
        out += "\\textasciicircum{}";
        break;
      case "~":
        out += "\\textasciitilde{}";
        break;
      default:
        out += c;
    }
  }
  return out;
}

/**
 * Escapes arbitrary text and wraps it in `\text{…}`. The rule-zero landing
 * pad; exported so Workspace.tsx can use it for its own catch-all and so
 * the self-test can assert on it.
 */
export function textFallback(src: string): string {
  return "\\text{" + escapeTextContent(src) + "}";
}

// ── Token tables ─────────────────────────────────────────────────────────────

const GREEK = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta",
  "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "pi",
  "varpi", "rho", "varrho", "sigma", "varsigma", "tau", "upsilon", "phi",
  "varphi", "chi", "psi", "omega",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi",
  "Psi", "Omega",
]);

/** Built-in KaTeX operators — emitted as `\name\left(…\right)`. */
const KATEX_OPS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan",
  "sinh", "cosh", "tanh", "log", "ln", "exp", "det", "dim", "deg", "gcd",
  "ker", "min", "max",
]);

/** Not built into KaTeX — emitted as `\operatorname{name}\left(…\right)`. */
const OPERATORNAME = new Set([
  "rank", "col", "row", "null", "span", "tr", "im", "adj", "proj", "nullity",
  "trace",
]);

const SPECIAL_FN = new Set(["sqrt", "abs", "norm"]);

/** Whole-run symbol words. A Map so runs like "constructor" can't collide. */
const SYMBOLS = new Map<string, string>([
  ["inf", "\\infty"],
  ["infty", "\\infty"],
  ["pm", "\\pm"],
  ["mp", "\\mp"],
  ["sum", "\\sum"],
  ["prod", "\\prod"],
  ["int", "\\int"],
  ["in", "\\in"],
  ["notin", "\\notin"],
  ["subset", "\\subset"],
  ["subseteq", "\\subseteq"],
  ["cup", "\\cup"],
  ["cap", "\\cap"],
  ["emptyset", "\\emptyset"],
  ["forall", "\\forall"],
  ["exists", "\\exists"],
  ["iff", "\\iff"],
  ["cdot", "\\cdot"],
  ["times", "\\times"],
]);

/** Relation operators, longest first (R1). */
const RELATIONS: ReadonlyArray<readonly [string, string]> = [
  ["<->", "\\leftrightarrow"],
  ["<=>", "\\iff"],
  ["=>", "\\Rightarrow"],
  ["->", "\\to"],
  ["<=", "\\le"],
  [">=", "\\ge"],
  ["!=", "\\ne"],
  ["~=", "\\approx"],
  ["=", "="],
  ["<", "<"],
  [">", ">"],
];

/** Vector-cell atoms (R3). */
const NUM_ATOM = /^[+-]?(?:\d+(?:\.\d+)?|\d+\s*\/\s*\d+)$/;
const ATOM =
  /^[+-]?(?:\d+(?:\.\d+)?(?:\/\d+)?|[A-Za-z](?:_[A-Za-z0-9]+)?(?:\^[A-Za-z0-9+-]+)?)$/;

/** Every ASCII char the scanner knows how to handle (R4.10's allowed set). */
const ALLOWED_PLAIN = /[A-Za-z0-9\s+\-*/^_(){}\[\],;.=<>|!:'\\%#$&]/;

/** Rule-10 characters: outside the allowed set, minus the handled ×/·. */
function isProseChar(ch: string): boolean {
  if (ch === "×" || ch === "·") return false;
  return !ALLOWED_PLAIN.test(ch);
}

// ── Small utilities ──────────────────────────────────────────────────────────

/** Index of the `closeCh` matching the `openCh` at `openIdx`, or throws. */
function matchDelim(s: string, openIdx: number, openCh: string, closeCh: string): number {
  let depth = 1;
  for (let i = openIdx + 1; i < s.length; i++) {
    const c = s[i];
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("mathWriter: unbalanced " + openCh);
}

/**
 * Strip fully-enclosing matched parentheses, repeatedly — same algorithm as
 * `answers.ts:stripOuterParens`: "(5 1; 0 8)" → "5 1; 0 8".
 */
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

/** True when `pred` matches any character at bracket depth 0. */
function hasDepth0(s: string, pred: (ch: string) => boolean): boolean {
  let depth = 0;
  for (const c of s) {
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && pred(c)) return true;
  }
  return false;
}

/** Split on separator characters at bracket depth 0 (runs → empty pieces, callers filter). */
function splitDepth0(s: string, isSep: (ch: string) => boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      cur += c;
    } else if (c === ")" || c === "]" || c === "}") {
      depth--;
      cur += c;
    } else if (depth === 0 && isSep(c)) {
      parts.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  parts.push(cur);
  return parts;
}

const isRowSep = (ch: string): boolean => ch === ";" || ch === "\n";
const isCellSep = (ch: string): boolean => ch === "," || /\s/.test(ch);

/** Mirrors `answers.ts:splitComponents` — split on `[,\s]+`, empties dropped. */
function splitCells(s: string): string[] {
  return splitDepth0(s, isCellSep).filter((p) => p.length > 0);
}

const PM_OPEN = "\\begin{pmatrix}";
const PM_CLOSE = "\\end{pmatrix}";

/** True when `t` is exactly one pmatrix (never wrap those in `\left(…\right)`). */
function isLonePmatrix(t: string): boolean {
  return (
    t.startsWith(PM_OPEN) &&
    t.endsWith(PM_CLOSE) &&
    t.indexOf(PM_CLOSE) === t.length - PM_CLOSE.length
  );
}

function isFunctionName(run: string): boolean {
  return SPECIAL_FN.has(run) || KATEX_OPS.has(run) || OPERATORNAME.has(run);
}

function buildCall(name: string, innerTex: string): string {
  if (name === "sqrt") return "\\sqrt{" + innerTex + "}";
  if (name === "abs") return "\\left|" + innerTex + "\\right|";
  if (name === "norm") return "\\left\\|" + innerTex + "\\right\\|";
  const arg = isLonePmatrix(innerTex) ? innerTex : "\\left(" + innerTex + "\\right)";
  if (KATEX_OPS.has(name)) return "\\" + name + arg;
  return "\\operatorname{" + name + "}" + arg;
}

function scanNumber(s: string, start: number): { text: string; end: number } {
  let j = start;
  while (j < s.length && /[0-9]/.test(s[j])) j++;
  if (j < s.length && s[j] === "." && j + 1 < s.length && /[0-9]/.test(s[j + 1])) {
    j++;
    while (j < s.length && /[0-9]/.test(s[j])) j++;
  }
  return { text: s.slice(start, j), end: j };
}

// ── The pipeline: splitRelations → transformSegment → transformExpression ────

/** R1 — split on relation operators at depth 0; `=` chains are kept. */
function splitRelations(src: string): string {
  const parts: string[] = [];
  const ops: string[] = [];
  let depth = 0;
  let segStart = 0;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      depth--;
      i++;
      continue;
    }
    if (depth === 0) {
      let matched = false;
      for (const [tok, tex] of RELATIONS) {
        if (src.startsWith(tok, i)) {
          parts.push(src.slice(segStart, i));
          ops.push(tex);
          i += tok.length;
          segStart = i;
          matched = true;
          break;
        }
      }
      if (matched) continue;
    }
    i++;
  }
  parts.push(src.slice(segStart));
  let out = transformSegment(parts[0]);
  for (let k = 0; k < ops.length; k++) {
    out += " " + ops[k] + " " + transformSegment(parts[k + 1]);
  }
  return out;
}

/** R2/R3 — matrix literal, vector literal, else expression. */
function transformSegment(seg: string): string {
  const t = seg.trim();
  if (t === "") return "";

  // Detection ONLY runs on the paren-stripped text; expression fallthrough
  // runs on the ORIGINAL segment, parens included.
  const stripped = stripOuterParens(t);

  // R2 — matrix: a ';' or newline at depth 0.
  if (hasDepth0(stripped, isRowSep)) {
    const rows = splitDepth0(stripped, isRowSep)
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    if (rows.length > 0) {
      const body = rows
        .map((row) => splitCells(row).map((cell) => transformExpression(cell)).join(" & "))
        .join("\\\\");
      return PM_OPEN + body + PM_CLOSE;
    }
  }

  // R3 — vector: every cell an atom, plus a comma OR all-numeric cells.
  const cells = splitCells(stripped);
  if (
    cells.length >= 2 &&
    cells.every((cell) => ATOM.test(cell)) &&
    (hasDepth0(stripped, (ch) => ch === ",") || cells.every((cell) => NUM_ATOM.test(cell)))
  ) {
    return PM_OPEN + cells.map((cell) => transformExpression(cell)).join("\\\\") + PM_CLOSE;
  }

  return transformExpression(t);
}

/** One emitted piece of output. `op` = usable as a `\frac` operand; `inner` = strippable `(…)` content. */
interface Chunk {
  text: string;
  op: boolean;
  ws: boolean;
  inner: string | null;
}

/** Script operand after `^`/`_` (R4.5). Returns the braced text or null (drop the script char). */
function parseScriptOperand(s: string, k: number): { text: string; end: number } | null {
  const n = s.length;
  if (k >= n) return null;
  const c = s[k];
  if (c === "{") {
    const close = matchDelim(s, k, "{", "}");
    return { text: "{" + transformExpression(s.slice(k + 1, close)) + "}", end: close + 1 };
  }
  if (c === "(") {
    const close = matchDelim(s, k, "(", ")");
    return { text: "{" + transformExpression(s.slice(k + 1, close)) + "}", end: close + 1 };
  }
  if (c === "\\") {
    let j = k + 1;
    while (j < n && /[A-Za-z]/.test(s[j])) j++;
    if (j > k + 1) return { text: "{" + s.slice(k, j) + "}", end: j };
    return null;
  }
  let j = k;
  if (c === "+" || c === "-") j++;
  const runStart = j;
  while (j < n && /[A-Za-z0-9]/.test(s[j])) j++;
  if (j === runStart) return null;
  return { text: "{" + s.slice(k, j) + "}", end: j };
}

/** Attach any `^`/`_` scripts that follow position `from` onto `text`. */
function attachScripts(s: string, from: number, text: string): { text: string; end: number } {
  const n = s.length;
  let j = from;
  while (j < n && (s[j] === "^" || s[j] === "_")) {
    const sc = s[j];
    let k = j + 1;
    while (k < n && /\s/.test(s[k])) k++;
    const opnd = parseScriptOperand(s, k);
    if (opnd === null) break;
    text += sc + opnd.text;
    j = opnd.end;
  }
  return { text, end: j };
}

/** The right-hand side of a `/` → `\frac` conversion (R4.6): a simple operand or null. */
function parseRightOperand(s: string, k: number): { text: string; end: number } | null {
  const n = s.length;
  if (k >= n) return null;
  const c = s[k];

  // number literal (optionally signed)
  if (/[0-9]/.test(c) || ((c === "+" || c === "-") && k + 1 < n && /[0-9]/.test(s[k + 1]))) {
    const numStart = c === "+" || c === "-" ? k + 1 : k;
    const num = scanNumber(s, numStart);
    return attachScriptsResult(s, num.end, s.slice(k, num.end));
  }

  // balanced (…) group — outer delimiters stripped in the frac
  if (c === "(") {
    const close = matchDelim(s, k, "(", ")");
    const inner = transformSegment(s.slice(k + 1, close));
    if (inner === "") return null;
    const end = close + 1;
    if (end < n && (s[end] === "^" || s[end] === "_")) {
      // a script glues to the group — keep the delimiters, don't strip
      const grouped = isLonePmatrix(inner) ? inner : "\\left(" + inner + "\\right)";
      return attachScriptsResult(s, end, grouped);
    }
    return { text: inner, end };
  }

  // identifier / function call / greek
  if (/[A-Za-z]/.test(c)) {
    let j = k;
    while (j < n && /[A-Za-z]/.test(s[j])) j++;
    const run = s.slice(k, j);
    if (j < n && isProseChar(s[j])) return null; // don't split a prose word
    if (j < n && s[j] === "(" && isFunctionName(run)) {
      const close = matchDelim(s, j, "(", ")");
      const call = buildCall(run, transformSegment(s.slice(j + 1, close)));
      return attachScriptsResult(s, close + 1, call);
    }
    if (SYMBOLS.has(run)) return null;
    const base = GREEK.has(run) ? "\\" + run : run;
    return attachScriptsResult(s, j, base);
  }

  return null;
}

function attachScriptsResult(s: string, from: number, text: string): { text: string; end: number } {
  const r = attachScripts(s, from, text);
  return { text: r.text, end: r.end };
}

/** R4 — the expression scanner. */
function transformExpression(s: string): string {
  const chunks: Chunk[] = [];
  const push = (text: string, op: boolean, inner: string | null = null): void => {
    chunks.push({ text, op, ws: false, inner });
  };
  const pushWs = (text: string): void => {
    chunks.push({ text, op: false, ws: true, inner: null });
  };
  const lastSolid = (): number => {
    let j = chunks.length - 1;
    while (j >= 0 && chunks[j].ws) j--;
    return j;
  };
  const popWsTail = (): void => {
    while (chunks.length > 0 && chunks[chunks.length - 1].ws) chunks.pop();
  };

  const n = s.length;
  let i = 0;
  let afterPercent = false;

  while (i < n) {
    const c = s[i];

    // whitespace passes through verbatim (R0) — and keeps the % flag alive
    if (/\s/.test(c)) {
      let j = i;
      while (j < n && /\s/.test(s[j])) j++;
      pushWs(s.slice(i, j));
      i = j;
      continue;
    }

    const wantText = afterPercent;
    afterPercent = false;

    // R4.1 — user-typed control sequences pass through untouched
    if (c === "\\") {
      let j = i + 1;
      while (j < n && /[A-Za-z]/.test(s[j])) j++;
      if (j > i + 1) {
        push(s.slice(i, j), false);
        i = j;
        continue;
      }
      if (i + 1 < n) {
        push(s.slice(i, i + 2), false);
        i += 2;
        continue;
      }
      throw new Error("mathWriter: trailing backslash");
    }

    // R4.2 — (…) group; a lone pmatrix carries its own delimiters
    if (c === "(") {
      const close = matchDelim(s, i, "(", ")");
      const res = transformSegment(s.slice(i + 1, close));
      if (isLonePmatrix(res)) push(res, true, null);
      else push("\\left(" + res + "\\right)", true, res);
      i = close + 1;
      continue;
    }
    // R4.3 — […] group; {…} copied verbatim (LaTeX grouping)
    if (c === "[") {
      const close = matchDelim(s, i, "[", "]");
      const res = transformSegment(s.slice(i + 1, close));
      if (isLonePmatrix(res)) push(res, true, null);
      else push("\\left[" + res + "\\right]", true, null);
      i = close + 1;
      continue;
    }
    if (c === ")" || c === "]") throw new Error("mathWriter: unmatched closer");
    if (c === "{" || c === "}") {
      push(c, false);
      i++;
      continue;
    }

    // R4.5 — scripts; a bare ^/_ with nothing grabbable is dropped entirely
    if (c === "^" || c === "_") {
      let k = i + 1;
      while (k < n && /\s/.test(s[k])) k++;
      const opnd = parseScriptOperand(s, k);
      if (opnd === null) {
        i = k;
        continue;
      }
      popWsTail();
      const j0 = chunks.length - 1;
      if (j0 >= 0 && chunks[j0].op) {
        chunks[j0].text += c + opnd.text;
        chunks[j0].inner = null; // scripted groups can no longer be frac-stripped
      } else {
        push(c + opnd.text, false);
      }
      i = opnd.end;
      continue;
    }

    // R4.6 — fraction, when both sides are simple operands
    if (c === "/") {
      const j0 = lastSolid();
      if (j0 >= 0 && chunks[j0].op) {
        let k = i + 1;
        while (k < n && /\s/.test(s[k])) k++;
        const right = parseRightOperand(s, k);
        if (right !== null) {
          const left = chunks[j0].inner ?? chunks[j0].text;
          chunks.length = j0; // consumes the operand and the whitespace left of '/'
          push("\\frac{" + left + "}{" + right.text + "}", true, null);
          i = right.end;
          continue;
        }
      }
      push("/", false);
      i++;
      continue;
    }

    // R4.7 — ± ∓ (before the single-char rules); trailing space so a
    // following letter can't fuse into \pmb / \mpx
    if ((c === "+" && s[i + 1] === "-") || (c === "-" && s[i + 1] === "+")) {
      push(c === "+" ? "\\pm " : "\\mp ", false);
      i += 2;
      continue;
    }

    // unary sign absorbed into a number literal (start / after an operator),
    // so "-1/2" fracs as \frac{-1}{2} — the form answers.ts reads
    if ((c === "+" || c === "-") && i + 1 < n && /[0-9]/.test(s[i + 1])) {
      const j0 = lastSolid();
      if (j0 < 0 || !chunks[j0].op) {
        const num = scanNumber(s, i + 1);
        push(c + num.text, true);
        i = num.end;
        continue;
      }
    }

    // R4.8 — products; surrounding input spaces are consumed on the left
    if (c === "*" || c === "·") {
      popWsTail();
      push("\\cdot ", false);
      i++;
      continue;
    }
    if (c === "×") {
      popWsTail();
      push("\\times ", false);
      i++;
      continue;
    }

    // R4.9 — hostile characters (a bare % comments out the rest of the line)
    if (c === "%") {
      push("\\%", false);
      afterPercent = true;
      i++;
      continue;
    }
    if (c === "#" || c === "$" || c === "&") {
      push("\\" + c, false);
      i++;
      continue;
    }

    // numbers, identifiers, and R4.10 prose words
    if (/[A-Za-z0-9]/.test(c) || isProseChar(c)) {
      // pre-scan the whole word: any rule-10 char in it → \text{word}
      let j = i;
      let prose = false;
      while (j < n && (/[A-Za-z0-9]/.test(s[j]) || isProseChar(s[j]))) {
        if (isProseChar(s[j])) prose = true;
        j++;
      }
      if (prose) {
        push("\\text{" + escapeTextContent(s.slice(i, j)) + "}", false);
        i = j;
        continue;
      }
      if (/[0-9]/.test(c)) {
        const num = scanNumber(s, i);
        push(num.text, true);
        i = num.end;
        continue;
      }
      // identifier run — matching is on the WHOLE run ("null(" is the
      // function null, never the greek \nu; "pivot" never becomes \pi vot)
      let k = i;
      while (k < n && /[A-Za-z]/.test(s[k])) k++;
      const run = s.slice(i, k);
      if (k < n && s[k] === "(" && isFunctionName(run)) {
        const close = matchDelim(s, k, "(", ")");
        push(buildCall(run, transformSegment(s.slice(k + 1, close))), true, null);
        i = close + 1;
        continue;
      }
      if (GREEK.has(run)) {
        push("\\" + run, true);
        i = k;
        continue;
      }
      const sym = SYMBOLS.get(run);
      if (sym !== undefined) {
        push(sym, false);
        i = k;
        continue;
      }
      if (wantText) {
        push("\\text{" + escapeTextContent(run) + "}", false);
        i = k;
        continue;
      }
      push(run, true); // R4.4d — unknown identifiers keep KaTeX's default italic
      i = k;
      continue;
    }

    // everything else in the allowed set: verbatim
    push(c, false);
    i++;
  }

  return chunks.map((ch) => ch.text).join("");
}

// ── R5 — final structural validation ─────────────────────────────────────────

function isStructurallyValid(t: string): boolean {
  let depth = 0;
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    if (c === "\\") {
      if (i === t.length - 1) return false; // trailing lone backslash
      i += 2;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth < 0) return false;
    }
    i++;
  }
  if (depth !== 0) return false;
  const begins = t.split("\\begin{").length - 1;
  const ends = t.split("\\end{").length - 1;
  return begins === ends;
}

// ── Public surface ───────────────────────────────────────────────────────────

/**
 * Lenient text → LaTeX. Total: never throws, never returns null/undefined.
 * `""` in → `""` out (callers skip rendering blank lines).
 */
export function toLatex(src: string): string {
  try {
    if (typeof src !== "string" || src.length === 0) return "";
    const out = splitRelations(src);
    return isStructurallyValid(out) ? out : textFallback(src);
  } catch {
    return textFallback(String(src));
  }
}

// ── Self-test corpus (the only test harness this app has) ────────────────────

/** Fixed corpus of input → expected-LaTeX pairs. Whitespace-insensitive. */
export const MATH_WRITER_CASES: ReadonlyArray<{ input: string; expected: string }> = [
  { input: "1/2", expected: "\\frac{1}{2}" },
  { input: "2/3 + 1/6", expected: "\\frac{2}{3} + \\frac{1}{6}" },
  { input: "x^2 + 1", expected: "x^{2} + 1" },
  { input: "A^-1", expected: "A^{-1}" },
  { input: "A^T", expected: "A^{T}" },
  { input: "a_ij", expected: "a_{ij}" },
  { input: "x_1 + x_2 = 3", expected: "x_{1} + x_{2} = 3" },
  { input: "sqrt(2)", expected: "\\sqrt{2}" },
  { input: "sqrt(x^2 + y^2)", expected: "\\sqrt{x^{2} + y^{2}}" },
  { input: "2*x", expected: "2\\cdot x" },
  { input: "lambda = 3", expected: "\\lambda = 3" },
  { input: "alpha*v + beta*w", expected: "\\alpha\\cdot v + \\beta\\cdot w" },
  { input: "(1 2; 3 4)", expected: "\\begin{pmatrix}1 & 2\\\\3 & 4\\end{pmatrix}" },
  { input: "1 2; 3 4", expected: "\\begin{pmatrix}1 & 2\\\\3 & 4\\end{pmatrix}" },
  { input: "1, -2, 3", expected: "\\begin{pmatrix}1\\\\-2\\\\3\\end{pmatrix}" },
  { input: "1 -2 3", expected: "\\begin{pmatrix}1\\\\-2\\\\3\\end{pmatrix}" },
  { input: "(1 2 3;)", expected: "\\begin{pmatrix}1 & 2 & 3\\end{pmatrix}" },
  { input: "2 x", expected: "2 x" },
  { input: "det(A) = 0", expected: "\\det\\left(A\\right) = 0" },
  { input: "rank(A) = 2", expected: "\\operatorname{rank}\\left(A\\right) = 2" },
  {
    input: "A(B+C) = (5 1; 0 8)",
    expected: "A\\left(B+C\\right) = \\begin{pmatrix}5 & 1\\\\0 & 8\\end{pmatrix}",
  },
  {
    input: "(5 1; 0 8) = (2 0; 1 5) + (3 1;-1 3)",
    expected:
      "\\begin{pmatrix}5 & 1\\\\0 & 8\\end{pmatrix} = \\begin{pmatrix}2 & 0\\\\1 & 5\\end{pmatrix} + \\begin{pmatrix}3 & 1\\\\-1 & 3\\end{pmatrix}",
  },
  {
    input: "1/2 * (1 0; 0 1)",
    expected: "\\frac{1}{2}\\cdot \\begin{pmatrix}1 & 0\\\\0 & 1\\end{pmatrix}",
  },
  {
    input: "x = (-b +- sqrt(b^2-4ac))/(2a)",
    expected: "x = \\frac{-b \\pm \\sqrt{b^{2}-4ac}}{2a}",
  },
  {
    input: "A^-1 = 1/det(A) * adj(A)",
    expected:
      "A^{-1} = \\frac{1}{\\det\\left(A\\right)}\\cdot \\operatorname{adj}\\left(A\\right)",
  },
  { input: "a = 6", expected: "a = 6" },
  { input: "-1.25", expected: "-1.25" },
  { input: "100% korrekt", expected: "100\\% \\text{korrekt}" },
  { input: "Så er A invertibel", expected: "\\text{Så} er A invertibel" },
  { input: "\\frac{1}{2}", expected: "\\frac{1}{2}" },
  { input: "x^{2}", expected: "x^{2}" },
  { input: "((((", expected: "\\text{((((}" },
  { input: "", expected: "" },
  { input: "v <= 3", expected: "v \\le 3" },
  // Bare-word operator names are out of scope: "rank" without "(" is a
  // plain identifier (rule 4d) — pinned deliberately.
  { input: "rank A -> 2", expected: "rank A \\to 2" },
];

/**
 * Runs MATH_WRITER_CASES through toLatex and returns only the failures.
 * Whitespace-insensitive on both sides. `[]` when everything passes.
 */
export function selfTest(): Array<{ input: string; expected: string; got: string }> {
  const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
  const failures: Array<{ input: string; expected: string; got: string }> = [];
  for (const { input, expected } of MATH_WRITER_CASES) {
    const got = toLatex(input);
    if (norm(got) !== norm(expected)) failures.push({ input, expected, got });
  }
  return failures;
}
