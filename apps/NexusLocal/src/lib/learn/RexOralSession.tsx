/**
 * RexOralSession — mundtlig eksamenstræner for REX, gate-format:
 * spørgsmålet stilles, man svarer MUNDTLIGT (intet inputfelt — det er
 * pointen: eksamen er mundtlig, så træningen er at formulere svaret højt),
 * og to hints kan afsløres i fast rækkefølge før facit:
 *
 *   1. Hint 1 · formlen   — det matematiske udtryk set fra et analytisk
 *      standpunkt, det man kan bygge sit svar på (lr_item_render.intro_md).
 *   2. Hint 2 · teorien   — et teoretisk baggrundshint (context_md).
 *   3. Facit               — det fulde svar (solution_md), efterfulgt af
 *      selvgradering på DrillCards stige: Again/Hard/Good/Easy → grade 0–3.
 *
 * Graderingen logges fire-and-forget til `lr_attempt_log` (item_ref = slug,
 * lens null — gate-spørgsmål bærer ingen linse), samme optimistiske
 * mønster som ReviewSession: UI'et venter aldrig på netværket, en fejlet
 * log koster kun statistik. Hvor mange hints der blev brugt påvirker IKKE
 * graden — selvvurderingen er dommeren, hints er stilladset; men brugte
 * hints vises ved facit som en påmindelse om at veje dem ind.
 *
 * Samme skal som ChallengeSession/SprintSession: fuldskærmsoverlay på
 * #F6F5F1, player/tokens.tsx-litteraler, PLAYER_STYLE injiceret én gang.
 * Dansk chrome hele vejen — fladen er kursusordforråd (Generalprøve-
 * undtagelsen i DESIGN.md §Language rule).
 */

import { useEffect, useState } from "react";
import { logAttempt } from "./api";
import type { Grade } from "./types";
import { Markdown } from "./Markdown";
import { CARD, PLAYER_STYLE, READING_COL } from "./player/tokens";
import type { OralGateQuestion } from "./RexOralPanel";

// AI-bedømmelse af svaret bor i REX Censor-ARTIFACTET (sample-capability på
// Bastians egen Claude-subscription, samme mønster som Concept
// Module-lektionerne) — ALDRIG et API-kald herfra; reglen er personlig
// subscription gennem artifacts, aldrig ANTHROPIC_API_KEY. Her i appen
// skriver man sit svar NED FØR facit afsløres (commitment beats hindsight)
// og sammenligner selv.

const GRADES: Array<{ grade: Grade; label: string; cls: string }> = [
  { grade: 0, label: "Again", cls: "bg-red-50 text-red-700 ring-1 ring-red-500/25" },
  { grade: 1, label: "Hard", cls: "bg-black/[0.05] text-[#1A1A24]/80 ring-1 ring-black/10" },
  { grade: 2, label: "Good", cls: "bg-black/[0.05] text-[#1A1A24]/80 ring-1 ring-black/10" },
  { grade: 3, label: "Easy", cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500/25" },
];

export function RexOralSession({ questions, onClose }: {
  questions: OralGateQuestion[];
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  // 0 = kun spørgsmålet · 1 = +hint 1 · 2 = +hint 2 · 3 = +facit og gradebar.
  const [stage, setStage] = useState(0);
  const [graded, setGraded] = useState(0);
  // Skriftligt svar (valgfrit — mundtligt er stadig pointen). Nedskrevet FØR
  // facit, så sammenligningen er ærlig.
  const [answerText, setAnswerText] = useState("");

  const q = questions[idx];
  const done = idx >= questions.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // Mellemrum driver afsløringen — hænderne er optaget af at gestikulere.
      // Men ALDRIG mens der skrives i svarfeltet: dér er mellemrum bare et
      // mellemrum.
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT");
      if (e.key === " " && !done && stage < 3 && !typing) {
        e.preventDefault();
        setStage((s) => s + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, done, onClose]);

  function gradeAndAdvance(grade: Grade) {
    // Fire-and-forget — ReviewSessions handleGraded-mønster.
    void logAttempt({ itemRef: q.slug, lens: null, grade }).catch(() => {});
    setGraded((n) => n + 1);
    setStage(0);
    setAnswerText("");
    setIdx((i) => i + 1);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col animate-[learn-overlay_.22s_ease-out] overflow-y-auto bg-[#F6F5F1] text-[#1A1A24]">
      <style>{PLAYER_STYLE}</style>

      <header className={`${READING_COL} flex items-center gap-3 px-4 pb-2 pt-4 md:px-0`}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">REX · Mundtlig træning</div>
          <div className="text-xs text-black/50">
            {done ? `Færdig — ${graded} spørgsmål gennemgået` : `Spørgsmål ${idx + 1}/${questions.length}`}
          </div>
        </div>
        <button onClick={onClose}
          className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-medium text-[#1A1A24]/70">
          Luk
        </button>
      </header>

      {done ? (
        <main className={`${READING_COL} flex-1 px-4 pb-16 md:px-0`}>
          <div className={`${CARD} p-6 text-center`}>
            <div className="text-2xl font-bold">Runden er slut</div>
            <p className="mt-2 text-sm text-black/60">
              {graded} spørgsmål svaret højt og graderet. Svage spørgsmål kommer
              først igen næste gang — stigen husker.
            </p>
            <button onClick={onClose}
              className="mt-4 rounded-lg bg-[#1A1A24] px-4 py-2 text-sm font-semibold text-white">
              Tilbage til overblikket
            </button>
          </div>
        </main>
      ) : (
        <main className={`${READING_COL} flex-1 px-4 pb-16 md:px-0`}>
          <div className={`${CARD} p-4 md:p-6`} key={q.slug}>
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-medium text-black/60">{q.section}</span>
              <span className="text-[11px] text-black/40">{q.sourceRef}</span>
            </div>
            <Markdown className="text-[16px] font-medium">{q.prompt}</Markdown>
            <p className="mt-2 text-[12px] text-black/45">
              Svar højt, som til eksamen — og skriv gerne kernen af dit svar
              herunder FØR du afslører facit, så sammenligningen er ærlig.
              AI-censoren bor i Censor-artifactet (knappen på kortet udenfor).
            </p>

            {stage < 3 && (
              <div className="mt-3">
                <textarea
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  rows={3}
                  spellCheck={false}
                  placeholder="Dit svar i stikord eller fuld sætning"
                  className="w-full resize-none rounded-xl border border-black/10 bg-white p-3 text-[14px] outline-none focus:border-black/30"
                />
              </div>
            )}

            {stage >= 3 && answerText.trim() !== "" && (
              <div className="mt-3 rounded-xl border border-black/[0.06] bg-white p-3 animate-[learn-step-in_.18s_ease-out]">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-black/50">Dit svar — sammenlign med facit</div>
                <div className="whitespace-pre-wrap text-[13px] text-black/75">{answerText}</div>
              </div>
            )}

            {stage >= 1 && q.hint1 && (
              <div className="mt-4 rounded-xl border border-black/[0.06] bg-black/[0.03] p-3 animate-[learn-step-in_.18s_ease-out]">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-black/50">Hint 1 · formlen</div>
                <Markdown className="text-[14px]">{q.hint1}</Markdown>
              </div>
            )}
            {stage >= 2 && q.hint2 && (
              <div className="mt-3 rounded-xl border border-black/[0.06] bg-black/[0.03] p-3 animate-[learn-step-in_.18s_ease-out]">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-black/50">Hint 2 · teorien</div>
                <Markdown className="text-[14px]">{q.hint2}</Markdown>
              </div>
            )}
            {stage >= 3 && (
              <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-50/60 p-3 animate-[learn-step-in_.18s_ease-out]">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700/80">Facit</div>
                <Markdown className="text-[14px]">{q.answer}</Markdown>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {stage < 3 ? (
              <div className="flex gap-2">
                <button onClick={() => setStage((s) => s + 1)}
                  className="flex-1 rounded-lg bg-[#1A1A24] px-4 py-2.5 text-sm font-semibold text-white">
                  {stage === 0 ? "Vis hint 1 · formlen" : stage === 1 ? "Vis hint 2 · teorien" : "Vis facit"}
                </button>
                {stage < 2 && (
                  <button onClick={() => setStage(3)}
                    className="rounded-lg border border-black/15 px-4 py-2.5 text-sm font-medium text-[#1A1A24]/70">
                    Direkte til facit
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="text-center text-[12px] text-black/45">
                  {stage === 3 && (idx + 1 <= questions.length)
                    ? "Hvor godt sad det — FØR hints? Vej brugte hints ind."
                    : null}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {GRADES.map((g) => (
                    <button key={g.grade} onClick={() => gradeAndAdvance(g.grade)}
                      className={`rounded-lg px-2 py-2.5 text-sm font-semibold ${g.cls}`}>
                      {g.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
