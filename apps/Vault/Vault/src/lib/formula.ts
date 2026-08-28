// A tiny expression language for computed columns in a task block.
//
// ─── Why this is hand-written and not `new Function` ─────────────────────────
// ⚠️ A formula lives in the block's spec, which lives in the NOTE — and a note
// can be shared, co-edited, and pasted from somewhere else. `new Function(src)`
// would therefore be arbitrary code execution driven by a document another
// person can edit, in a tab holding a Supabase session. There is no `eval` or
// `new Function` anywhere in Vault today; this feature does not get to be the
// first.
//
// The parser below can only ever produce a number, a boolean, a string or null.
// It has no property access, no globals, no calls except the fixed list in
// `FUNCTIONS`, and identifiers resolve exclusively from the context object it
// is handed.
//
// ─── Parse once, evaluate per row ────────────────────────────────────────────
// `compile` returns a closure over an AST. A block can render 200 rows, and
// re-parsing per row would be 200 tokenisations of the same string — but more
// importantly, parsing once means a syntax error is known BEFORE any row is
// drawn, so the column can say "unknown field: estimat" instead of rendering
// two hundred blanks.

/** What a formula may refer to. Values only — never a function or an object. */
export type FormulaContext = Record<string, number | boolean | string | null>;

export type FormulaValue = number | boolean | string | null;

export interface CompiledFormula {
  ok: true;
  /** Never throws. A row that cannot be computed yields null, not an exception
   *  inside a render. */
  run(ctx: FormulaContext): FormulaValue;
}
export interface FormulaError {
  ok: false;
  error: string;
}

/** Source cap. The spec as a whole is capped at 8 kB and holds many of these. */
export const MAX_FORMULA_CHARS = 200;

/** Nesting cap, against `((((((…` — a stack overflow inside a render is a
 *  white screen, and the guard costs one integer. */
const MAX_DEPTH = 24;

/**
 * ⚠️ A Map, not an object literal — and a test caught the difference.
 *
 * With `FUNCTIONS` as a plain object, `FUNCTIONS["constructor"]` resolves up
 * the PROTOTYPE CHAIN to `Object.prototype.constructor`, which is truthy. So
 * `constructor(1)` sailed past the "unknown function" check and only fell over
 * later reading `.arity` off it. Every inherited member — `toString`,
 * `valueOf`, `hasOwnProperty` — was reachable as a function name the same way.
 *
 * A Map has no prototype chain to walk into. Same for the field lookup below.
 */
const FUNCTIONS = new Map<string, { arity: number; fn: (...a: number[]) => number }>([
  ["min", { arity: 2, fn: (a, b) => Math.min(a, b) }],
  ["max", { arity: 2, fn: (a, b) => Math.max(a, b) }],
  ["round", { arity: 1, fn: (a) => Math.round(a) }],
  ["floor", { arity: 1, fn: (a) => Math.floor(a) }],
  ["ceil", { arity: 1, fn: (a) => Math.ceil(a) }],
  ["abs", { arity: 1, fn: (a) => Math.abs(a) }],
]);

// ── Tokens ──────────────────────────────────────────────────────────────────

type Tok =
  | { k: "num"; v: number }
  | { k: "id"; v: string }
  | { k: "op"; v: string }
  | { k: "end" };

const OPS3 = ["==="];
const OPS2 = ["==", "!=", "<=", ">=", "&&", "||"];
const OPS1 = "+-*/%()<>?:,!".split("");

function tokenize(src: string): Tok[] | string {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n") { i++; continue; }

    if (c >= "0" && c <= "9") {
      let j = i;
      while (j < src.length && ((src[j] >= "0" && src[j] <= "9") || src[j] === ".")) j++;
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) return `not a number: ${src.slice(i, j)}`;
      out.push({ k: "num", v: n });
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ k: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }

    const three = src.slice(i, i + 3);
    if (OPS3.includes(three)) { out.push({ k: "op", v: "==" }); i += 3; continue; }
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) { out.push({ k: "op", v: two }); i += 2; continue; }
    if (OPS1.includes(c)) { out.push({ k: "op", v: c }); i++; continue; }

    return `unexpected character: ${c}`;
  }
  out.push({ k: "end" });
  return out;
}

// ── AST ─────────────────────────────────────────────────────────────────────

type Node =
  | { t: "num"; v: number }
  | { t: "ref"; name: string }
  | { t: "un"; op: string; a: Node }
  | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "cond"; c: Node; a: Node; b: Node }
  | { t: "call"; name: string; args: Node[] };

/**
 * Compile a formula against a KNOWN field list.
 *
 * `fields` is required rather than optional on purpose: resolving an unknown
 * identifier at run time would render every row blank with no explanation, and
 * a typo in a field name is by far the most likely mistake. Knowing the fields
 * up front turns it into one legible error next to the column.
 */
export function compile(src: string, fields: readonly string[]): CompiledFormula | FormulaError {
  const trimmed = src.trim();
  if (!trimmed) return { ok: false, error: "empty formula" };
  if (trimmed.length > MAX_FORMULA_CHARS) {
    return { ok: false, error: `too long (max ${MAX_FORMULA_CHARS} characters)` };
  }

  const toks = tokenize(trimmed);
  if (typeof toks === "string") return { ok: false, error: toks };

  const known = new Set(fields);
  let p = 0;
  let depth = 0;
  let failure: string | null = null;

  const peek = () => toks[p];
  const eat = (v: string): boolean => {
    const t = toks[p];
    if (t.k === "op" && t.v === v) { p++; return true; }
    return false;
  };
  const fail = (msg: string): Node => {
    if (!failure) failure = msg;
    return { t: "num", v: 0 };
  };

  function ternary(): Node {
    if (++depth > MAX_DEPTH) { depth--; return fail("expression nested too deeply"); }
    const c = or();
    if (eat("?")) {
      const a = ternary();
      if (!eat(":")) { depth--; return fail("expected ':' in a ? b : c"); }
      const b = ternary();
      depth--;
      return { t: "cond", c, a, b };
    }
    depth--;
    return c;
  }
  function or(): Node {
    let a = and();
    while (eat("||")) a = { t: "bin", op: "||", a, b: and() };
    return a;
  }
  function and(): Node {
    let a = cmp();
    while (eat("&&")) a = { t: "bin", op: "&&", a, b: cmp() };
    return a;
  }
  function cmp(): Node {
    const a = add();
    for (const op of ["==", "!=", "<=", ">=", "<", ">"]) {
      if (eat(op)) return { t: "bin", op, a, b: add() };
    }
    return a;
  }
  function add(): Node {
    let a = mul();
    for (;;) {
      if (eat("+")) a = { t: "bin", op: "+", a, b: mul() };
      else if (eat("-")) a = { t: "bin", op: "-", a, b: mul() };
      else return a;
    }
  }
  function mul(): Node {
    let a = unary();
    for (;;) {
      if (eat("*")) a = { t: "bin", op: "*", a, b: unary() };
      else if (eat("/")) a = { t: "bin", op: "/", a, b: unary() };
      else if (eat("%")) a = { t: "bin", op: "%", a, b: unary() };
      else return a;
    }
  }
  function unary(): Node {
    if (eat("-")) return { t: "un", op: "-", a: unary() };
    if (eat("!")) return { t: "un", op: "!", a: unary() };
    return primary();
  }
  function primary(): Node {
    const t = peek();
    if (t.k === "num") { p++; return { t: "num", v: t.v }; }
    if (t.k === "id") {
      p++;
      const name = t.v;
      if (eat("(")) {
        const spec = FUNCTIONS.get(name);
        // `if` is not in FUNCTIONS because it must not evaluate both branches.
        if (name !== "if" && !spec) return fail(`unknown function: ${name}`);
        const args: Node[] = [];
        if (!eat(")")) {
          for (;;) {
            args.push(ternary());
            if (eat(",")) continue;
            if (eat(")")) break;
            return fail(`expected ')' after ${name}(`);
          }
        }
        const arity = name === "if" ? 3 : spec!.arity;
        if (args.length !== arity) {
          return fail(`${name}() takes ${arity} argument${arity === 1 ? "" : "s"}`);
        }
        return { t: "call", name, args };
      }
      if (name === "true") return { t: "num", v: 1 };
      if (name === "false") return { t: "num", v: 0 };
      if (!known.has(name)) {
        return fail(`unknown field: ${name}`);
      }
      return { t: "ref", name };
    }
    if (eat("(")) {
      if (++depth > MAX_DEPTH) { depth--; return fail("expression nested too deeply"); }
      const inner = ternary();
      depth--;
      if (!eat(")")) return fail("expected ')'");
      return inner;
    }
    return fail("unexpected end of expression");
  }

  const ast = ternary();
  if (failure) return { ok: false, error: failure };
  if (peek().k !== "end") return { ok: false, error: "unexpected trailing input" };

  return { ok: true, run: (ctx) => evaluate(ast, ctx) };
}

// ── Evaluation ──────────────────────────────────────────────────────────────

/** Coerce to a number for arithmetic. Booleans count; anything else is null. */
function num(v: FormulaValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

function truthy(v: FormulaValue): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  return false;
}

function evaluate(n: Node, ctx: FormulaContext): FormulaValue {
  switch (n.t) {
    case "num":
      return n.v;
    case "ref": {
      // A field the row simply does not have is null, not an error: a task with
      // no estimate is a fact about that task, and one such row must not blank
      // the whole column.
      //
      // hasOwnProperty rather than a bare index, for the same reason FUNCTIONS
      // is a Map: `ctx["constructor"]` on a plain object walks the prototype
      // chain and hands back a function.
      if (!Object.prototype.hasOwnProperty.call(ctx, n.name)) return null;
      const v = ctx[n.name];
      return typeof v === "number" || typeof v === "boolean" || typeof v === "string" ? v : null;
    }
    case "un": {
      if (n.op === "!") return !truthy(evaluate(n.a, ctx));
      const a = num(evaluate(n.a, ctx));
      return a === null ? null : -a;
    }
    case "cond":
      return truthy(evaluate(n.c, ctx)) ? evaluate(n.a, ctx) : evaluate(n.b, ctx);
    case "call": {
      if (n.name === "if") {
        // Lazy, unlike the others: if(x, 10/x, 0) must not divide by zero on
        // the branch it does not take.
        return truthy(evaluate(n.args[0], ctx)) ? evaluate(n.args[1], ctx) : evaluate(n.args[2], ctx);
      }
      const spec = FUNCTIONS.get(n.name)!;
      const args = n.args.map((a) => num(evaluate(a, ctx)));
      if (args.some((a) => a === null)) return null;
      const out = spec.fn(...(args as number[]));
      return Number.isFinite(out) ? out : null;
    }
    case "bin": {
      if (n.op === "&&") return truthy(evaluate(n.a, ctx)) ? evaluate(n.b, ctx) : false;
      if (n.op === "||") return truthy(evaluate(n.a, ctx)) ? evaluate(n.a, ctx) : evaluate(n.b, ctx);

      const av = evaluate(n.a, ctx);
      const bv = evaluate(n.b, ctx);
      if (n.op === "==") return av === bv;
      if (n.op === "!=") return av !== bv;

      const a = num(av);
      const b = num(bv);
      if (a === null || b === null) return null;
      switch (n.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        // ⚠️ null, not Infinity. An Infinity here would propagate into a column
        // sum and turn the whole footer into "∞", losing every other row's
        // contribution to one empty estimate.
        case "/": return b === 0 ? null : a / b;
        case "%": return b === 0 ? null : a % b;
        case "<": return a < b;
        case "<=": return a <= b;
        case ">": return a > b;
        case ">=": return a >= b;
        default: return null;
      }
    }
  }
}
