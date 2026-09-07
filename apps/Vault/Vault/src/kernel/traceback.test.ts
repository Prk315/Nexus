import { describe, it, expect } from "vitest";
import { cleanTraceback, stripNoise } from "./traceback";

// Every fixture below is REAL output, captured from Pyodide 0.28.3 running the
// corresponding cell. Both of these bugs survived the unit tests and the type
// checker and were only found by executing Python for the first time.

const ZERO_DIV = `Traceback (most recent call last):
  File "/lib/python313.zip/_pyodide/_base.py", line 597, in eval_code_async
    await CodeRunner(
    ...<9 lines>...
    .run_async(globals, locals)
  File "/lib/python313.zip/_pyodide/_base.py", line 411, in run_async
    coroutine = eval(self.code, globals, locals)
  File "<exec>", line 1, in <module>
ZeroDivisionError: division by zero`;

const SYNTAX = `Traceback (most recent call last):
  File "/lib/python313.zip/_pyodide/_base.py", line 597, in eval_code_async
    await CodeRunner(
          ~~~~~~~~~~^
  File "<exec>", line 1
    def broken(
              ^
SyntaxError: '(' was never closed`;

describe("cleanTraceback", () => {
  it("keeps the error line and drops Pyodide's own frames", () => {
    const out = cleanTraceback(ZERO_DIV);
    expect(out).toContain("ZeroDivisionError: division by zero");
    expect(out).not.toContain("_pyodide/_base.py");
    expect(out).toContain('File "<exec>"');
  });

  // The point of the whole module. Raw, the user's error is ~400 characters
  // down a wall of interpreter internals — and since the output cap truncates
  // from the head, the internals are the part that survives.
  it("is dramatically shorter than the raw message", () => {
    expect(cleanTraceback(ZERO_DIV).length).toBeLessThan(ZERO_DIV.length / 2);
  });

  it("keeps a SyntaxError's source line and caret", () => {
    const out = cleanTraceback(SYNTAX);
    expect(out).toContain("SyntaxError: '(' was never closed");
    expect(out).toContain("def broken(");
    expect(out).not.toContain("_pyodide/_base.py");
  });

  it("keeps a user's own multi-frame stack", () => {
    const nested = `Traceback (most recent call last):
  File "/lib/python313.zip/_pyodide/_base.py", line 411, in run_async
    coroutine = eval(self.code, globals, locals)
  File "<exec>", line 5, in <module>
  File "<exec>", line 2, in outer
  File "<exec>", line 3, in inner
ValueError: bad`;
    const out = cleanTraceback(nested);
    expect(out).toContain("in outer");
    expect(out).toContain("in inner");
    expect(out).toContain("ValueError: bad");
  });

  // Conservative by design: a mangled message is worse than a verbose one,
  // because the verbose one still contains the answer.
  it("returns anything it does not recognise unchanged", () => {
    expect(cleanTraceback("RuntimeError: something odd")).toBe("RuntimeError: something odd");
    expect(cleanTraceback("")).toBe("");
  });
});

describe("stripNoise", () => {
  // Pyodide narrates package installation to stdout. It is not the cell's
  // output, and it appears the first time anyone imports anything — which is
  // most first runs.
  it("drops the package loader's chatter", () => {
    const lines = [
      "Loading numpy",
      "Didn't find package numpy-2.2.5-cp313-cp313-pyodide_2025_0_wasm32.whl locally, attempting to load from https://cdn.jsdelivr.net/pyodide/v0.28.3/full/",
      "Package numpy-2.2.5-cp313-cp313-pyodide_2025_0_wasm32.whl loaded from https://cdn.jsdelivr.net/pyodide/v0.28.3/full/",
      "numpy already loaded from default channel",
      "10",
    ];
    expect(stripNoise(lines)).toEqual(["10"]);
  });

  // The warning is actively misleading: the figure IS shown, as a PNG, directly
  // below the cell.
  it("drops matplotlib's non-interactive-canvas warning", () => {
    const lines = ["<exec>:6: UserWarning: FigureCanvasAgg is non-interactive, and thus cannot be shown"];
    expect(stripNoise(lines)).toEqual([]);
  });

  it("keeps output that merely mentions loading", () => {
    // The filters are anchored, so a user's own print survives.
    expect(stripNoise(["Loading complete for my dataset", "done"])).toEqual([
      "Loading complete for my dataset",
      "done",
    ]);
  });

  it("keeps ordinary output untouched", () => {
    expect(stripNoise(["hello", "", "42"])).toEqual(["hello", "", "42"]);
  });
});
