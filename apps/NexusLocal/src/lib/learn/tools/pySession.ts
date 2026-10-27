/**
 * Persistent Python-session til værktøjs-docken — samme sikkerhedsgrænse som
 * code/runners.ts (Pyodide i en WORKER, aldrig samme-origin med Supabase-
 * sessionen), men workeren LEVER mellem kørsler, så variabler overlever som i
 * en rigtig terminal. Stop terminerer workeren og nulstiller dermed hele
 * sessionen — det siger UI'et højt i stedet for at lade som om den kan
 * afbryde pænt (ingen SharedArrayBuffer uden COOP/COEP, samme grænse som
 * Vault-kernen).
 */

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";
const RUN_TIMEOUT_MS = 60_000;

export interface PyResult { out: string; err: string; timedOut: boolean }

const WORKER_SRC = `
importScripts("${PYODIDE_URL}");
const ready = loadPyodide();
self.onmessage = async (e) => {
  const { id, code } = e.data;
  const out = [];
  try {
    const py = await ready;
    py.setStdout({ batched: (s) => out.push(s) });
    py.setStderr({ batched: (s) => out.push(s) });
    await py.loadPackagesFromImports(code);
    let repr = "";
    try {
      const r = await py.runPythonAsync(code);
      if (r !== undefined && r !== null) { repr = String(r); if (r && r.destroy) try { r.destroy(); } catch {} }
    } catch (err) {
      self.postMessage({ id, out: out.join("\\n"), err: String(err) });
      return;
    }
    self.postMessage({ id, out: [out.join("\\n"), repr].filter(Boolean).join("\\n"), err: "" });
  } catch (err) {
    self.postMessage({ id, out: out.join("\\n"), err: String(err) });
  }
};`;

let worker: Worker | null = null;

function ensureWorker(): Worker {
  if (worker) return worker;
  const blob = new Blob([WORKER_SRC], { type: "application/javascript" });
  worker = new Worker(URL.createObjectURL(blob));
  return worker;
}

/** Kør et stykke kode i den vedvarende session. */
export function pyRun(code: string): Promise<PyResult> {
  return new Promise((resolve) => {
    let w: Worker;
    try { w = ensureWorker(); }
    catch (e) { resolve({ out: "", err: `Kunne ikke starte Python: ${String(e)}`, timedOut: false }); return; }
    const id = Math.random().toString(36).slice(2);
    const timer = window.setTimeout(() => {
      // En hængende kørsel tager sessionen med sig — det er prisen for at
      // kunne stoppe den overhovedet.
      pyReset();
      resolve({ out: "", err: "Afbrudt efter 60 s — sessionen er nulstillet (variabler er væk).", timedOut: true });
    }, RUN_TIMEOUT_MS);
    const onMsg = (e: MessageEvent) => {
      if (e.data?.id !== id) return;
      window.clearTimeout(timer);
      w.removeEventListener("message", onMsg);
      resolve({ out: e.data.out ?? "", err: (e.data.err ?? "").trim(), timedOut: false });
    };
    w.addEventListener("message", onMsg);
    w.postMessage({ id, code });
  });
}

/** Stop/nulstil: terminér workeren. Næste kørsel starter en frisk session. */
export function pyReset(): void {
  try { worker?.terminate(); } catch { /* allerede død */ }
  worker = null;
}
