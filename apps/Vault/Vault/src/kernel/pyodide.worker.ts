// Python, in a Web Worker, via Pyodide (CPython compiled to WASM).
//
// ─── Why a worker, and not simply because it is faster ───────────────────────
// The worker is the SECURITY BOUNDARY, and it is what makes runnable cells
// admissible in this app at all. `lib/formula.ts` sets the house rule:
//
//   "A formula lives in the block's spec, which lives in the NOTE — and a note
//    can be shared, co-edited, and pasted from somewhere else. `new Function`
//    would therefore be arbitrary code execution driven by a document another
//    person can edit, in a tab holding a Supabase session."
//
// A code cell is exactly that document-driven execution, so it has to answer
// the same objection. A worker does: it has its own global scope, no DOM, no
// `window`, no access to the page's `localStorage` — which is where
// supabase-js persists the session — and no reference to the app's Supabase
// client. Code someone else typed into your shared note can compute, and can
// print; it cannot read your credentials or act as you.
//
// That boundary is why the cell offers Python and SQL and NOT JavaScript. A JS
// cell would run same-origin against the page, and no amount of care around it
// would restore the property above.
//
// ─── What this deliberately does not have ────────────────────────────────────
// No interrupt. Pyodide can only be interrupted through a SharedArrayBuffer,
// which needs cross-origin isolation headers (COOP/COEP) that Vercel does not
// serve by default and that would break other embeds. So an infinite loop is
// escaped by TERMINATING the worker, which necessarily discards the session's
// variables. The client says so plainly rather than pretending to interrupt.

import { loadPyodide, type PyodideInterface } from "pyodide";
import type { OutputChunk } from "./types";

// Pyodide's JS loader fetches its own WASM, stdlib zip and packages from
// `indexURL` at runtime. It is pinned to the exact version of the npm package
// in package.json — a mismatch between loader and assets fails in confusing
// ways, so the two move together or not at all.
//
// The CDN is used rather than self-hosting because the full distribution is
// tens of megabytes, and unlike the pdf.js assets (a few hundred kB, copied
// into public/) that is not something to carry in the repo or a Vercel deploy.
// The cost is honest and worth stating: a cell cannot run offline, so the iPad
// PWA needs a connection the first time Python is used.
const PYODIDE_VERSION = "0.28.3";
const INDEX_URL =
  (import.meta.env.VITE_PYODIDE_URL as string | undefined) ??
  `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

type Request =
  | { id: number; kind: "run"; code: string }
  | { id: number; kind: "reset" };

type Response =
  | { id: number; ok: true; chunks: OutputChunk[] }
  | { id: number; ok: false; error: string };

let pyodide: PyodideInterface | null = null;
let loading: Promise<PyodideInterface> | null = null;

/** Collected during a single run; drained into chunks afterwards. */
let stdout: string[] = [];
let stderr: string[] = [];

async function getPyodide(): Promise<PyodideInterface> {
  if (pyodide) return pyodide;
  if (!loading) {
    loading = loadPyodide({ indexURL: INDEX_URL }).then((py) => {
      // `batched` gives us whole lines rather than a callback per character,
      // which matters when a loop prints ten thousand times.
      py.setStdout({ batched: (s: string) => stdout.push(s) });
      py.setStderr({ batched: (s: string) => stderr.push(s) });
      pyodide = py;
      return py;
    });
  }
  return loading;
}

/**
 * Pull any matplotlib figures off the pyplot stack as base64 PNGs.
 *
 * Cells are expected to end with `plt.show()` out of habit, but the default
 * backend has no window to show anything in. Rather than patch `show`, the
 * figures are collected AFTER the code has run and then closed — which catches
 * both `plt.show()` and the equally common case of a cell that just builds a
 * figure and ends.
 *
 * Guarded on matplotlib already being imported: touching `pyplot` here would
 * otherwise import and initialise it for every cell that never asked for it.
 */
async function drainFigures(py: PyodideInterface): Promise<OutputChunk[]> {
  const collected = await py.runPythonAsync(`
import sys as _sys
_imgs = []
if "matplotlib.pyplot" in _sys.modules:
    import base64 as _b64, io as _io
    _plt = _sys.modules["matplotlib.pyplot"]
    for _num in _plt.get_fignums():
        _fig = _plt.figure(_num)
        _buf = _io.BytesIO()
        try:
            _fig.savefig(_buf, format="png", bbox_inches="tight")
            _imgs.append(_b64.b64encode(_buf.getvalue()).decode("ascii"))
        except Exception:
            pass
    _plt.close("all")
_imgs
`);
  try {
    const list = collected?.toJs?.({ create_proxies: false }) ?? [];
    return (list as string[]).map((b64) => ({ type: "image" as const, content: b64 }));
  } finally {
    collected?.destroy?.();
  }
}

async function run(code: string): Promise<OutputChunk[]> {
  const py = await getPyodide();
  stdout = [];
  stderr = [];
  const chunks: OutputChunk[] = [];

  try {
    // Makes `import numpy` work without the user installing anything: Pyodide
    // scans the source and fetches the wheels it recognises.
    await py.loadPackagesFromImports(code);

    const result = await py.runPythonAsync(code);

    if (stdout.length) chunks.push({ type: "text", content: stdout.join("\n") });
    if (stderr.length) chunks.push({ type: "text", content: stderr.join("\n") });

    chunks.push(...(await drainFigures(py)));

    // A bare expression on the last line echoes its repr, the way a notebook
    // does. `undefined` means the cell ended in a statement, which shows
    // nothing rather than "None".
    if (result !== undefined && result !== null) {
      const repr = typeof result === "object" && "toString" in result ? String(result) : String(result);
      if (repr !== "None" && repr.length > 0) chunks.push({ type: "text", content: repr });
    }
    (result as { destroy?: () => void } | null)?.destroy?.();
  } catch (err: unknown) {
    if (stdout.length) chunks.push({ type: "text", content: stdout.join("\n") });
    // A Python exception is a normal result for an editor cell — it renders as
    // red text, exactly like a SQL syntax error, rather than propagating.
    chunks.push({
      type: "error",
      content: err instanceof Error ? err.message : String(err),
    });
  }

  return chunks;
}

/**
 * Clear the namespace without reloading the interpreter.
 *
 * Reloading Pyodide would mean re-fetching tens of megabytes to forget a
 * variable. Deleting the user's globals is the same observable outcome for a
 * fraction of the cost; names beginning with `_` are Pyodide's own and are
 * left alone.
 */
async function reset(): Promise<void> {
  if (!pyodide) return;
  await pyodide.runPythonAsync(`
for _n in [n for n in list(globals()) if not n.startswith("_")]:
    del globals()[_n]
`);
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const msg = e.data;
  try {
    if (msg.kind === "run") {
      const chunks = await run(msg.code);
      (self as unknown as Worker).postMessage({ id: msg.id, ok: true, chunks } satisfies Response);
    } else {
      await reset();
      (self as unknown as Worker).postMessage({ id: msg.id, ok: true, chunks: [] } satisfies Response);
    }
  } catch (err: unknown) {
    (self as unknown as Worker).postMessage({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies Response);
  }
};
