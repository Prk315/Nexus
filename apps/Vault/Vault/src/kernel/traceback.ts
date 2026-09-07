// Making a Pyodide error look like a Python error.
//
// ─── What Pyodide actually hands you ─────────────────────────────────────────
// A `PythonError` from `runPythonAsync` carries the FULL interpreter traceback,
// and the top of it is Pyodide's own machinery:
//
//   Traceback (most recent call last):
//     File "/lib/python313.zip/_pyodide/_base.py", line 597, in eval_code_async
//       await CodeRunner(
//       ...<9 lines>...
//       .run_async(globals, locals)
//     File "/lib/python313.zip/_pyodide/_base.py", line 411, in run_async
//       coroutine = eval(self.code, globals, locals)
//     File "<exec>", line 1, in <module>
//   ZeroDivisionError: division by zero
//
// The one line the user needs is the LAST one. Everything above it, up to their
// own `<exec>` frame, is a detail of how the cell was invoked — and it is
// several hundred characters, so it also crowds out the real message once the
// output cap truncates from the head.
//
// This is exactly the kind of thing that unit tests do not catch and running the
// thing does: every error in the first real Pyodide run rendered as a wall of
// `_pyodide/_base.py`.

/** Frames belonging to Pyodide's own invocation machinery, not the user's code. */
const INTERNAL = /^\s+File "\/lib\/python[\d.]*\.zip\/_pyodide\//;
const TRACEBACK_HEADER = /^Traceback \(most recent call last\):\s*$/;

/**
 * Reduce a Python traceback to the user's own frames plus the error line.
 *
 * Deliberately conservative: anything it does not recognise is returned intact.
 * A mangled error message is worse than a verbose one, because the verbose one
 * at least still contains the answer.
 */
export function cleanTraceback(message: string): string {
  const lines = message.split("\n");
  const header = lines.findIndex((l) => TRACEBACK_HEADER.test(l));
  if (header === -1) return message.trim();

  // Where the user's own code starts. Pyodide labels the cell `<exec>`.
  const userFrame = lines.findIndex((l) => l.includes('File "<exec>"'));

  const kept: string[] = [];
  const start = userFrame === -1 ? lines.length : userFrame;
  for (let i = start; i < lines.length; i++) {
    if (INTERNAL.test(lines[i])) continue;
    kept.push(lines[i]);
  }

  // No user frame at all (a syntax error is raised before the code runs, so
  // there is nothing of theirs on the stack). The final non-empty line is the
  // error, and it is all that matters.
  if (userFrame === -1) {
    const tail = lines.filter((l) => l.trim().length > 0);
    const last = tail[tail.length - 1] ?? message;
    // A SyntaxError's caret line and the offending source sit just above it and
    // are genuinely useful, so keep a short tail rather than only the last line.
    const from = Math.max(0, tail.length - 4);
    const context = tail.slice(from, tail.length - 1).filter((l) => !INTERNAL.test(l) && !TRACEBACK_HEADER.test(l));
    return [...context, last].join("\n").trim() || message.trim();
  }

  const out = ["Traceback (most recent call last):", ...kept].join("\n").trim();
  return out || message.trim();
}

/**
 * Pyodide's package loader writes progress to stdout ("Loading numpy",
 * "Didn't find package numpy-2.2.5-…whl locally, attempting to load from
 * https://cdn.jsdelivr.net/…"). That is build noise, not the cell's output, and
 * it appears the first time anyone imports anything.
 *
 * Kept as a filter as well as resetting the buffers around the load, because
 * `loadPackagesFromImports` is not the only thing that can trigger a fetch — an
 * `import` inside a function body loads lazily, mid-run.
 */
// Anchored and deliberately narrow. The first version was `/^Loading \S/`,
// which also swallowed a user's own `print("Loading complete for my dataset")`
// — a filter that eats real output is worse than the noise it removes. Pyodide
// logs a bare comma-separated package list and nothing else, so requiring that
// exact shape keeps prose out of the match.
const LOADER_NOISE = [
  /^Loading [A-Za-z0-9_.-]+(, [A-Za-z0-9_.-]+)*$/,
  /^Didn't find package \S+ locally, attempting to load from https?:\/\//,
  /^[A-Za-z0-9_.-]+ already loaded from default channel$/,
  /^Package \S+ loaded from https?:\/\//,
];

/**
 * matplotlib warns that the AGG canvas "is non-interactive, and thus cannot be
 * shown" on `plt.show()`. In a notebook that warning is actively misleading —
 * the figure IS shown, as a PNG, immediately below.
 */
const MISLEADING = [/FigureCanvasAgg is non-interactive, and thus cannot be shown/];

export function stripNoise(lines: string[]): string[] {
  return lines.filter(
    (l) => !LOADER_NOISE.some((re) => re.test(l.trim())) && !MISLEADING.some((re) => re.test(l))
  );
}
