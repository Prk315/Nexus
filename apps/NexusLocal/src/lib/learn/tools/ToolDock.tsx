/**
 * Universel værktøjs-dock — Calc + Python, til rådighed OVERALT i Learn:
 * også oven på ReviewSession-overlayet (z-50) og i paths/unit-player, derfor
 * z-[70]. Pills nederst til HØJRE, clear af MathKeyboardBar (fuld bredde i
 * bunden, z-[90], kun touch når et felt har fokus — docken lukkes typisk
 * mens man taster, så de to kolliderer sjældent; panelet løfter sig over
 * pills og skygger aldrig for baren).
 *
 * Calc er artefaktets parser portet 1:1 (calcCore.js — ingen eval; parseren
 * er sikkerheden). Python er en PERSISTENT Pyodide-worker (pySession.ts):
 * variabler overlever mellem kørsler; Stop nulstiller hele sessionen.
 * Åben/lukket + fane huskes i localStorage som ren per-enheds-convenience.
 */

import { useEffect, useRef, useState } from "react";
// @ts-expect-error — bevidst utypet 1:1-port af artefaktets parser
import { calcRun } from "./calcCore.js";
import { pyRun, pyReset } from "./pySession";

type Tab = "calc" | "py";

function readState(): { open: boolean; tab: Tab } {
  try {
    const raw = localStorage.getItem("nl-tooldock");
    if (raw) return JSON.parse(raw);
  } catch { /* convenience */ }
  return { open: false, tab: "calc" };
}

export function ToolDock() {
  const [{ open, tab }, setState] = useState(readState);
  const [calcSrc, setCalcSrc] = useState<string>(() => {
    try { return localStorage.getItem("nl-tooldock-calc") ?? ""; } catch { return ""; }
  });
  const [pyIn, setPyIn] = useState("");
  const [pyLog, setPyLog] = useState<Array<{ kind: "in" | "out" | "err"; text: string }>>([]);
  const [pyBusy, setPyBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const set = (next: Partial<{ open: boolean; tab: Tab }>) =>
    setState((prev) => {
      const s = { ...prev, ...next };
      try { localStorage.setItem("nl-tooldock", JSON.stringify(s)); } catch { /* ok */ }
      return s;
    });

  useEffect(() => {
    try { localStorage.setItem("nl-tooldock-calc", calcSrc); } catch { /* ok */ }
  }, [calcSrc]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [pyLog]);

  async function runPy() {
    const code = pyIn.trim();
    if (!code || pyBusy) return;
    setPyBusy(true);
    setPyLog((l) => [...l, { kind: "in", text: code }]);
    setPyIn("");
    const r = await pyRun(code);
    setPyLog((l) => [
      ...l,
      ...(r.out ? [{ kind: "out" as const, text: r.out }] : []),
      ...(r.err ? [{ kind: "err" as const, text: r.err }] : []),
    ]);
    setPyBusy(false);
  }

  const pill = "rounded-full px-3 py-1.5 text-xs font-semibold shadow-[0_1px_6px_rgba(0,0,0,0.12)]";

  return (
    <>
      {/* pills — altid synlige, nederst til højre */}
      <div className="fixed bottom-3 right-3 z-[70] flex gap-1.5">
        {(["calc", "py"] as const).map((t) => (
          <button key={t}
            className={`${pill} ${open && tab === t ? "bg-[#1A1A24] text-white" : "bg-white/95 text-[#1A1A24]/70 backdrop-blur"}`}
            onClick={() => set(open && tab === t ? { open: false } : { open: true, tab: t })}>
            {t === "calc" ? "Calc" : "Py"}
          </button>
        ))}
      </div>

      {open && (
        <div className="fixed inset-x-0 bottom-0 z-[70] h-[42vh] border-t border-black/10 bg-[#F6F5F1]/98 pb-12 backdrop-blur">
          {tab === "calc" ? (
            <div className="grid h-full grid-cols-2 gap-2 p-3">
              <textarea
                value={calcSrc}
                onChange={(e) => setCalcSrc(e.target.value)}
                spellCheck={false}
                placeholder={"én linje pr. udtryk · a = 5 · f(x) = x^2 · [[1,2],[3,4]] · solve(A,b) · sum([…])"}
                className="h-full resize-none rounded-xl border border-black/10 bg-white p-3 font-mono text-[13px] outline-none"
              />
              <div
                className="h-full overflow-y-auto rounded-xl bg-black/[0.04] p-3 font-mono text-[13px] leading-relaxed [&_.err]:text-rose-700"
                dangerouslySetInnerHTML={{ __html: calcRun(calcSrc) }}
              />
            </div>
          ) : (
            <div className="flex h-full flex-col gap-2 p-3">
              <div ref={logRef} className="flex-1 overflow-y-auto rounded-xl bg-black/[0.04] p-3 font-mono text-[13px] leading-relaxed">
                {pyLog.length === 0 && (
                  <div className="text-black/40">Persistent Python-session (numpy m.fl. hentes ved import). Stop nulstiller alle variabler.</div>
                )}
                {pyLog.map((e, i) => (
                  <div key={i} className={e.kind === "err" ? "text-rose-700" : e.kind === "in" ? "text-black/50" : ""}>
                    {e.kind === "in" ? "» " : ""}{e.text}
                  </div>
                ))}
                {pyBusy && <div className="text-black/40">kører…</div>}
              </div>
              <div className="flex gap-2">
                <textarea
                  value={pyIn}
                  onChange={(e) => setPyIn(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.shiftKey)) { e.preventDefault(); runPy(); } }}
                  spellCheck={false}
                  rows={2}
                  placeholder="Python — ⇧⏎ kører"
                  className="flex-1 resize-none rounded-xl border border-black/10 bg-white p-2.5 font-mono text-[13px] outline-none"
                />
                <div className="flex flex-col gap-1.5">
                  <button onClick={runPy} disabled={pyBusy}
                    className="rounded-lg bg-[#1A1A24] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Kør</button>
                  <button onClick={() => { pyReset(); setPyBusy(false); setPyLog((l) => [...l, { kind: "err", text: "— session nulstillet —" }]); }}
                    className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-medium text-[#1A1A24]/70">Stop</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
