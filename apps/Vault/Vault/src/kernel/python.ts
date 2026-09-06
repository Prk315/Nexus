// The page-side half of the Python kernel: one worker per session.
//
// Everything heavy lives behind `new Worker(...)`, so a note with no Python
// cell never downloads Pyodide and never pays for it. The worker itself is the
// security boundary — see pyodide.worker.ts for why that is the load-bearing
// design decision and not an optimisation.

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../lib/platform";
import type { OutputChunk, SessionId } from "./types";

// ─── Two Pythons, chosen by where the app is running ─────────────────────────
// The Tauri desktop build has a real system interpreter behind `run_python`
// (src-tauri/src/lib.rs), which can import anything installed on the machine.
// The web build has no such thing, and until now a Python cell there simply
// said "Python is not available on this device" — which is most of why code
// cells were a desktop-only feature.
//
// So the runtime dispatches rather than replacing: desktop keeps the real
// interpreter and every package on the machine, and the web and iPad get
// Pyodide. Both surfaces (canvas blocks and note cells) go through here, so
// neither has to know which one it got.
//
// ⚠️ Sessions are NOT shared between the two. They cannot be — one is a process
// on the machine, the other is a WASM heap in a worker — so a note opened on
// the desktop app and on the web has two namespaces. That is invisible in
// practice because the same client only ever has one of them.

async function runPythonTauri(sessionId: SessionId, code: string): Promise<OutputChunk[]> {
  // camelCase key, per the ecosystem rule: snake_case works on macOS and
  // hard-fails on iOS with `invalid args`.
  const result = await invoke<{ chunks: OutputChunk[] }>("run_python", { sessionId, code });
  return result.chunks ?? [];
}

interface Pending {
  resolve: (chunks: OutputChunk[]) => void;
  reject: (e: Error) => void;
}

interface Session {
  worker: Worker;
  pending: Map<number, Pending>;
  nextId: number;
}

const sessions = new Map<SessionId, Session>();

function spawn(sessionId: SessionId): Session {
  // `type: "module"` + the URL form is what lets Vite bundle the worker and its
  // imports properly in the production build; a plain string path would resolve
  // against the deployed asset directory and 404.
  const worker = new Worker(new URL("./pyodide.worker.ts", import.meta.url), {
    type: "module",
    name: `vault-python-${sessionId}`,
  });
  const session: Session = { worker, pending: new Map(), nextId: 1 };

  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; chunks?: OutputChunk[]; error?: string }>) => {
    const { id, ok, chunks, error } = e.data;
    const p = session.pending.get(id);
    if (!p) return;
    session.pending.delete(id);
    if (ok) p.resolve(chunks ?? []);
    else p.reject(new Error(error ?? "python worker failed"));
  };

  // A worker that dies (OOM, a WASM abort) must not leave callers hanging
  // forever on a promise that can never settle.
  worker.onerror = (e) => {
    const err = new Error(e.message || "the Python worker stopped unexpectedly");
    for (const p of session.pending.values()) p.reject(err);
    session.pending.clear();
  };

  sessions.set(sessionId, session);
  return session;
}

function get(sessionId: SessionId): Session {
  return sessions.get(sessionId) ?? spawn(sessionId);
}

export function hasPythonSession(sessionId: SessionId): boolean {
  // On desktop the session lives in the Rust side, which exposes no way to ask.
  // Reporting true is the safer answer: it only ever gates "is there anything
  // to restart", and offering a restart that turns out to be a no-op is
  // harmless, while hiding one that was needed is not.
  return isTauri() || sessions.has(sessionId);
}

export function runPython(sessionId: SessionId, code: string): Promise<OutputChunk[]> {
  if (isTauri()) return runPythonTauri(sessionId, code);
  const session = get(sessionId);
  const id = session.nextId++;
  return new Promise<OutputChunk[]>((resolve, reject) => {
    session.pending.set(id, { resolve, reject });
    session.worker.postMessage({ id, kind: "run", code });
  });
}

/** Clear the namespace, keeping the loaded interpreter. */
export async function resetPythonSession(sessionId: SessionId): Promise<void> {
  if (isTauri()) {
    await invoke("reset_python_session", { sessionId });
    return;
  }
  const session = sessions.get(sessionId);
  if (!session) return;
  const id = session.nextId++;
  await new Promise<void>((resolve) => {
    session.pending.set(id, { resolve: () => resolve(), reject: () => resolve() });
    session.worker.postMessage({ id, kind: "reset" });
  });
}

/**
 * The only way out of a runaway cell.
 *
 * Pyodide can only be interrupted via a SharedArrayBuffer, which requires
 * cross-origin isolation headers this app does not serve, so there is no
 * cooperative cancel to offer. Killing the worker is honest and immediate; the
 * cost is that the session's variables go with it, and callers are expected to
 * say so rather than quietly restarting.
 */
export function killPythonSession(sessionId: SessionId): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  const err = new Error("Python was stopped — the kernel's variables were cleared.");
  for (const p of session.pending.values()) p.reject(err);
  session.pending.clear();
  session.worker.terminate();
  sessions.delete(sessionId);
}
