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

import { useEffect, useRef, useState } from "react";
import { judgeAnswer, logAttempt } from "./api";
import type { Grade, JudgeResult, SocraticQuestion } from "./types";
import { Markdown } from "./Markdown";
import { CARD, FEEDBACK, PLAYER_STYLE, READING_COL } from "./player/tokens";
import type { OralGateQuestion } from "./RexOralPanel";

/** Dommer-chrome pr. verdict — samme betydninger som SocraticSession:
 * solid = svaret dækker, partial = noget mangler, off = ved siden af. */
const VERDICT_CHROME: Record<JudgeResult["verdict"], { label: string; cls: string }> = {
  solid: { label: "Rigtigt", cls: FEEDBACK.correct },
  partial: { label: "Delvist", cls: FEEDBACK.draft },
  off: { label: "Ved siden af", cls: FEEDBACK.wrong },
};

/** Gate-spørgsmålet omformet til dommerens kontrakt: facit + hints ER
 * rubrikken (target_md); facetter/misforståelser er ikke authored for
 * gate-banken, så dommeren arbejder fri-tekst mod facit. */
function asJudgeQuestion(q: OralGateQuestion): SocraticQuestion {
  const target = [q.answer, q.hint1 && `Formlen: ${q.hint1}`, q.hint2 && `Teori: ${q.hint2}`]
    .filter(Boolean)
    .join("\n\n");
  return {
    id: q.slug,
    concept_ids: [],
    lens: null,
    prompt_md: q.prompt,
    target_md: target,
    facets: [],
    misconceptions: [],
    subquestions: [],
    retry_md: "",
    max_followups: 0,
  };
}

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
  // Skriftligt svar (valgfrit — mundtligt er stadig pointen) + dommerens dom.
  const [answerText, setAnswerText] = useState("");
  const [judging, setJudging] = useState(false);
  // undefined = ikke bedømt · null = dommer utilgængelig (fail-open) · ellers dommen.
  const [judgement, setJudgement] = useState<JudgeResult | null | undefined>(undefined);
  const judgeSeq = useRef(0);

  const q = questions[idx];
  const done = idx >= questions.length;

  /** Send svaret til socratic-judge (samme agent som lessons-gaten): dommen
   * siger IKKE kun rigtigt/forkert men HVORFOR (coach_md), målt mod facit +
   * hints som rubrik. Fail-open: utilgængelig dommer viser en stille note og
   * afslører facit, så flowet aldrig blokerer. Afslører facit (stage 3) i
   * samme ombæring — selvgraderingen er stadig den der tæller. */
  async function judge() {
    const text = answerText.trim();
    if (!text || judging) return;
    setJudging(true);
    const seq = ++judgeSeq.current;
    const res = await judgeAnswer(asJudgeQuestion(q), text, []);
    // Et sent svar må aldrig lande på det NÆSTE spørgsmål (samme regel som
    // Vaults "alt async bærer sit node id").
    if (seq !== judgeSeq.current) return;
    setJudgement(res);
    setJudging(false);
    setStage(3);
  }

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
    setJudgement(undefined);
    setJudging(false);
    judgeSeq.current += 1;
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
              herunder, så bedømmer censor-agenten det. Afslør først hints når
              du er kørt fast.
            </p>

            {stage < 3 && (
              <div className="mt-3">
                <textarea
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.shiftKey)) { e.preventDefault(); void judge(); } }}
                  rows={3}
                  spellCheck={false}
                  placeholder="Dit svar i stikord eller fuld sætning — ⇧⏎ bedømmer"
                  className="w-full resize-none rounded-xl border border-black/10 bg-white p-3 text-[14px] outline-none focus:border-black/30"
                />
              </div>
            )}

            {judgement !== undefined && stage >= 3 && (
              judgement === null ? (
                <div className="mt-3 rounded-xl bg-black/[0.03] p-3 text-[12px] text-black/50 animate-[learn-step-in_.18s_ease-out]">
                  Censor-agenten er ikke tilgængelig lige nu — sammenlign selv med facit nedenfor.
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-black/[0.06] bg-white p-3 animate-[learn-step-in_.18s_ease-out]">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${VERDICT_CHROME[judgement.verdict].cls}`}>
                      {VERDICT_CHROME[judgement.verdict].label}
                    </span>
                    <span className="text-[11px] uppercase tracking-wide text-black/40">Censor-agentens dom</span>
                  </div>
                  {judgement.coach_md && <Markdown className="text-[13px] text-black/75">{judgement.coach_md}</Markdown>}
                </div>
              )
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
                {answerText.trim() !== "" && (
                  <button onClick={() => void judge()} disabled={judging}
                    className="flex-1 rounded-lg bg-[#1A1A24] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                    {judging ? "Censor læser…" : "Bedøm mit svar"}
                  </button>
                )}
                <button onClick={() => setStage((s) => s + 1)}
                  className={`${answerText.trim() === "" ? "flex-1 bg-[#1A1A24] text-white" : "border border-black/15 text-[#1A1A24]/70"} rounded-lg px-4 py-2.5 text-sm font-semibold`}>
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
