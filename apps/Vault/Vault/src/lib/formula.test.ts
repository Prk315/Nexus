import { describe, it, expect } from "vitest";
import { compile, MAX_FORMULA_CHARS, type FormulaContext } from "./formula";

const FIELDS = ["estimate", "rollup", "done", "subtasks", "subtasksDone", "priority"];

/** Compile-and-run, asserting the formula was valid. */
function run(src: string, ctx: FormulaContext = {}) {
  const c = compile(src, FIELDS);
  if (!c.ok) throw new Error(`expected "${src}" to compile, got: ${c.error}`);
  return c.run(ctx);
}
/** The error, asserting the formula was NOT valid. */
function err(src: string): string {
  const c = compile(src, FIELDS);
  if (c.ok) throw new Error(`expected "${src}" to fail`);
  return c.error;
}

describe("arithmetic", () => {
  it("does the obvious things", () => {
    expect(run("1 + 2 * 3")).toBe(7);
    expect(run("(1 + 2) * 3")).toBe(9);
    expect(run("10 / 4")).toBe(2.5);
    expect(run("7 % 3")).toBe(1);
    expect(run("-3 + 1")).toBe(-2);
    expect(run("2.5 * 2")).toBe(5);
  });

  it("reads fields from the row", () => {
    expect(run("estimate / 60", { estimate: 90 })).toBe(1.5);
    expect(run("rollup - estimate", { rollup: 100, estimate: 40 })).toBe(60);
  });

  // ⚠️ null, not Infinity. Infinity propagates into a column sum and turns the
  // whole footer into "∞", losing every other row's contribution to one empty
  // estimate.
  it("yields null on division by zero rather than Infinity", () => {
    expect(run("1 / 0")).toBeNull();
    expect(run("estimate / subtasks", { estimate: 10, subtasks: 0 })).toBeNull();
    expect(run("5 % 0")).toBeNull();
  });

  // A task with no estimate is a fact about that task. One such row must not
  // blank the column for every other row.
  it("yields null for a field the row does not have", () => {
    expect(run("estimate + 1", {})).toBeNull();
    expect(run("estimate + 1", { estimate: null })).toBeNull();
  });
});

describe("booleans and comparison", () => {
  it("compares", () => {
    expect(run("estimate > 60", { estimate: 90 })).toBe(true);
    expect(run("estimate > 60", { estimate: 10 })).toBe(false);
    expect(run("estimate == 90", { estimate: 90 })).toBe(true);
  });

  it("treats a boolean field as 0/1 in arithmetic", () => {
    expect(run("done * 5", { done: true })).toBe(5);
    expect(run("done * 5", { done: false })).toBe(0);
  });

  it("short-circuits && and ||", () => {
    // The right side would be null; && must not evaluate it.
    expect(run("done && 1", { done: false })).toBe(false);
    expect(run("done || 7", { done: false })).toBe(7);
  });
});

describe("conditionals", () => {
  it("supports a ternary", () => {
    expect(run("done ? 1 : 0", { done: true })).toBe(1);
    expect(run("estimate > 60 ? 2 : 3", { estimate: 10 })).toBe(3);
  });

  // if() is lazy on purpose, unlike min/max/round: if(x, 10/x, 0) must not
  // divide by zero on the branch it does not take.
  it("if() does not evaluate the branch it does not take", () => {
    expect(run("if(subtasks, 10 / subtasks, 0)", { subtasks: 0 })).toBe(0);
    expect(run("if(subtasks, 10 / subtasks, 0)", { subtasks: 5 })).toBe(2);
  });
});

describe("functions", () => {
  it("computes the fixed set", () => {
    expect(run("min(3, 5)")).toBe(3);
    expect(run("max(3, 5)")).toBe(5);
    expect(run("round(2.6)")).toBe(3);
    expect(run("floor(2.6)")).toBe(2);
    expect(run("ceil(2.1)")).toBe(3);
    expect(run("abs(0 - 4)")).toBe(4);
  });

  it("propagates null rather than computing on a missing field", () => {
    expect(run("round(estimate / 60)", {})).toBeNull();
  });

  it("checks arity", () => {
    expect(err("round(1, 2)")).toMatch(/takes 1 argument/);
    expect(err("min(1)")).toMatch(/takes 2 arguments/);
  });
});

// ─── The part that matters most ─────────────────────────────────────────────
// A formula lives in the block spec, which lives in a note, which can be shared
// and co-edited. There is no `eval` and no `new Function` in Vault, and this
// feature does not get to be the first — so the language must have no way to
// reach anything outside its context object.
describe("the language cannot reach outside itself", () => {
  it("rejects every function it does not define", () => {
    expect(err("fetch(1)")).toMatch(/unknown function/);
    expect(err("alert(1)")).toMatch(/unknown function/);
    expect(err("constructor(1)")).toMatch(/unknown function/);
    expect(err("require(1)")).toMatch(/unknown function/);
  });

  it("rejects identifiers that are not declared fields", () => {
    expect(err("window")).toMatch(/unknown field: window/);
    expect(err("globalThis")).toMatch(/unknown field/);
    expect(err("process")).toMatch(/unknown field/);
    // The most likely REAL mistake, and the reason fields are known at compile
    // time: a typo must be one legible error, not two hundred blank cells.
    expect(err("estimat / 60")).toBe("unknown field: estimat");
  });

  // Deliberately no string literals: nothing in a task block needs one, and a
  // quote character is one more thing a parser can get wrong on shared content.
  it("has no string literals", () => {
    expect(err("priority == 'high'")).toMatch(/unexpected character: '/);
  });

  it("has no property access at all", () => {
    expect(err("estimate.toString")).toMatch(/unexpected character: \./);
    expect(err("a[0]")).toMatch(/unexpected character/);
  });

  it("cannot be made to reach a prototype", () => {
    expect(err("__proto__")).toMatch(/unknown field/);
    // And a context whose keys look dangerous still only yields plain values.
    const c = compile("estimate", FIELDS);
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.run({ estimate: 5, __proto__: 9 } as never)).toBe(5);
  });
});

describe("guards", () => {
  it("refuses an over-long source", () => {
    expect(err("1+".repeat(MAX_FORMULA_CHARS) + "1")).toMatch(/too long/);
  });

  // A stack overflow inside a render is a white screen; the guard costs one
  // integer.
  it("refuses pathological nesting instead of blowing the stack", () => {
    expect(err("(".repeat(60) + "1" + ")".repeat(60))).toMatch(/too deeply|too long/);
  });

  it("reports a syntax error rather than guessing", () => {
    expect(err("")).toMatch(/empty/);
    expect(err("1 +")).toMatch(/unexpected end/);
    expect(err("(1")).toMatch(/expected '\)'/);
    expect(err("1 2")).toMatch(/trailing/);
    expect(err("done ? 1")).toMatch(/expected ':'/);
  });

  it("never throws at run time, whatever the row holds", () => {
    const c = compile("estimate / rollup + done", FIELDS);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    for (const ctx of [{}, { estimate: 0, rollup: 0 }, { estimate: NaN }, { done: "yes" }] as FormulaContext[]) {
      expect(() => c.run(ctx)).not.toThrow();
    }
  });

  it("treats a non-finite stored value as missing", () => {
    expect(run("estimate + 1", { estimate: Infinity })).toBeNull();
    expect(run("estimate + 1", { estimate: NaN })).toBeNull();
  });
});
