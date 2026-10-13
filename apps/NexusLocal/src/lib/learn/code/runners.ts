/**
 * Execution for the code-practice exercises.
 *
 * Python runs in a Pyodide WORKER, on web AND desktop — one path, no Rust,
 * and the same security posture as Vault's code cells: user code never runs
 * same-origin with the Supabase session. The worker is created per RUN and
 * terminated after — a stuck loop costs the run, never the app, and state
 * never leaks between attempts (deliberate: an exercise must stand alone).
 *
 * C compiles and runs through the `run_c_exercise` Tauri command (cc on this
 * Mac). In a plain browser there is no C toolchain, so `canRunC()` gates the
 * UI toward read-and-reveal instead of a dead Run button.
 */

import { invoke } from "@tauri-apps/api/core";

// Pinned: loader and assets must agree on the version (same rule as Vault's
// kernel — a mismatch fails confusingly, not loudly).
const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";
const RUN_TIMEOUT_MS = 30_000;

export interface RunResult {
  ok: boolean;          // process-level: compiled and ran to completion
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const WORKER_SRC = `
importScripts("${PYODIDE_URL}");
let out = [];
let err = [];
self.onmessage = async (e) => {
  try {
    const py = await loadPyodide({
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    });
    await py.runPythonAsync(e.data.code);
    self.postMessage({ ok: true, stdout: out.join("\\n"), stderr: err.join("\\n") });
  } catch (ex) {
    self.postMessage({ ok: false, stdout: out.join("\\n"), stderr: err.join("\\n") + "\\n" + String(ex) });
  }
};
`;

export function runPython(code: string): Promise<RunResult> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      const blob = new Blob([WORKER_SRC], { type: "application/javascript" });
      worker = new Worker(URL.createObjectURL(blob));
    } catch (e) {
      resolve({ ok: false, stdout: "", stderr: `Kunne ikke starte Python-runtime: ${String(e)}`, timedOut: false });
      return;
    }
    const timer = window.setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, stdout: "", stderr: "Afbrudt: koden kørte i over 30 sekunder.", timedOut: true });
    }, RUN_TIMEOUT_MS);
    worker.onmessage = (e) => {
      window.clearTimeout(timer);
      worker.terminate();
      const d = e.data as { ok: boolean; stdout: string; stderr: string };
      resolve({ ok: d.ok, stdout: d.stdout ?? "", stderr: (d.stderr ?? "").trim(), timedOut: false });
    };
    worker.onerror = (e) => {
      window.clearTimeout(timer);
      worker.terminate();
      resolve({ ok: false, stdout: "", stderr: String(e.message ?? e), timedOut: false });
    };
    worker.postMessage({ code });
  });
}

export function canRunC(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function runC(code: string): Promise<RunResult> {
  try {
    const r = await invoke<{ compiled: boolean; stdout: string; stderr: string; timed_out: boolean }>(
      "run_c_exercise",
      { code },
    );
    return { ok: r.compiled && !r.timed_out, stdout: r.stdout, stderr: r.stderr, timedOut: r.timed_out };
  } catch (e) {
    return { ok: false, stdout: "", stderr: String(e), timedOut: false };
  }
}
