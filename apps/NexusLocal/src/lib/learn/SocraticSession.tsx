/**
 * The Socratic dialogue overlay — LEARN_PLAN.md "Socratic dialogue nodes
 * (pinned, 2026-08-15 — pilot: units 2, 3, 9)". A fullscreen chat-style
 * session over one `lr_proof_content` row whose `content` is SCRIPT-shaped
 * (`SocraticScript`, `types.ts`), not `UnitContent`-shaped — this file never
 * touches `Player.tsx`'s layer/practice/test machinery, and `PathPanel.tsx`
 * routes `kind: "socratic"` side-nodes here instead of into `Player`.
 *
 * ── Flow, per question ────────────────────────────────────────────────────
 * A main question is posed (left bubble, lens chip) → the learner types a
 * free-text answer (right bubble) → resolved one of two ways:
 *
 *  - **Judged mode** (default): `api.judgeAnswer` calls the `socratic-judge`
 *    edge function. `solid` → grade 3, `target_md` revealed, next question.
 *    `partial` → an authored subquestion targeting the first facet the judge
 *    didn't credit (`facets_hit`). `off` + a matched `misconception` → that
 *    misconception's authored `probe_md`. `off` otherwise → `retry_md`. Every
 *    step past the first also shows the judge's one-line `coach_md`, subtly.
 *  - **Rubric mode** (fail-open — `judgeAnswer` returned `null`, ANY failure:
 *    no secret, network, 503, bad JSON): a tap-checklist of the question's
 *    `facets[]` replaces the judge call. All tapped → grade 3, same
 *    `target_md` reveal. Some tapped → the first UN-tapped facet's authored
 *    subquestion (same lookup the judged branch uses), or `retry_md` if none
 *    is authored for it. None tapped → `retry_md`. Misconception probes never
 *    fire in rubric mode — classifying "which wrong belief" needs the judge;
 *    there is no deterministic tap for it.
 *
 * `max_followups` caps the back-and-forth per question: once exceeded, the
 * question resolves at grade 2 (any facet was ever credited/tapped across the
 * exchange — "recovered") or grade 1 (never). Every resolution reveals
 * `target_md` in a quiet card, applies `memory.applyGrade` (weight 1.0) to
 * every one of the question's `concept_ids`, logs the attempt, and fires
 * one-hop blame propagation — the exact same grading primitives
 * `Player.tsx`'s `handleGrade` uses, just credited from a dialogue exchange
 * instead of a drill.
 *
 * Once the judge falls open for one exchange, the WHOLE REST OF THE SESSION
 * stays in rubric mode (`judgeMode` is sticky, never retried) — flapping
 * between the two per-question would be more confusing than reassuring.
 *
 * Fininishing the last question writes `lr_proof_progress = "completed"` via
 * the same `api.setProofProgress` PathPanel/Player already use for proof and
 * workshop side-nodes — never `lr_unit_progress`, matching every other
 * side-path's "concept credit already flowed through grading" doctrine.
 *
 * KLADDE → Godkend curation (draft → live) reuses `approveProofContent` /
 * `demoteProofContent` verbatim (same `lr_proof_content` table, addressed by
 * `(proof_id, version)` — those functions never look at `content`'s shape),
 * mirroring `Player.tsx`'s header control byte-for-byte.
 *
 * Frame/tokens follow DESIGN.md §7–9 exactly as `Player.tsx`/`ReviewSession.tsx`
 * do: soft-white paper overlay, `READING_COL`/`DOCK_SHELL`/`DOCK_STACK`/`CARD`
 * from `player/tokens.tsx`, the shared `PLAYER_STYLE` motion+KaTeX sheet, and
 * course-scoped lens chips via `useLensTokens()`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Grade,
  JudgeResult,
  Lens,
  LrMemoryState,
  LrSocraticContentRow,
  SocraticExchangeTurn,
  SocraticQuestion,
} from "./types";
import {
  applyBlamePropagation,
  approveProofContent,
  demoteProofContent,
  fetchMemoryStates,
  fetchSocraticContent,
  judgeAnswer,
  logAttempt,
  setProofProgress,
  upsertMemory,
} from "./api";
import { applyGrade, defaultMemoryState } from "./memory";
import { Markdown } from "./Markdown";
import { CARD, DOCK_SHELL, DOCK_STACK, FEEDBACK, PLAYER_STYLE, READING_COL, useLensTokens } from "./player/tokens";

type TurnKind = "prompt" | "answer" | "coach" | "target";

interface Turn {
  id: string;
  kind: TurnKind;
  text: string;
  /** Only ever set on a main question's opening prompt turn. */
  lens?: Lens | null;
}

/** `{prompt_md, answer}` pairs for the CURRENT question only — the judge's
 * "short exchange history" (LEARN_PLAN.md). Read off the transcript by id
 * prefix rather than kept as separate state. */
function questionHistory(turns: Turn[], questionId: string): SocraticExchangeTurn[] {
  const prefix = `${questionId}::`;
  const hist: SocraticExchangeTurn[] = [];
  let pendingPrompt: string | null = null;
  for (const t of turns) {
    if (!t.id.startsWith(prefix)) continue;
    if (t.kind === "prompt") pendingPrompt = t.text;
    else if (t.kind === "answer" && pendingPrompt !== null) {
      hist.push({ prompt_md: pendingPrompt, answer: t.text });
      pendingPrompt = null;
    }
  }
  return hist;
}

const GRADE_LABEL: Record<Grade, string> = {
  3: "solidt",
  2: "delvist",
  1: "prøv igen",
  0: "prøv igen",
};

function VerdictGlyph({ grade }: { grade: Grade | undefined }) {
  if (grade === undefined) {
    return <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-black/[0.04] text-[10px] text-[#6E6E78]/45">·</span>;
  }
  if (grade >= 3) {
    return (
      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${FEEDBACK.correct}`}>✓</span>
    );
  }
  if (grade === 2) {
    return (
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-indigo-50 text-[10px] font-semibold text-indigo-700 ring-1 ring-indigo-400/25">
        ~
      </span>
    );
  }
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-black/[0.04] text-[10px] text-[#6E6E78]/60">
      ↻
    </span>
  );
}

function PromptBubble({ text, lensChip }: { text: string; lensChip?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1 animate-[learn-step-in_.18s_ease-out]">
      {lensChip}
      <div className={`${CARD} max-w-[88%] rounded-bl-sm px-3 py-2.5 md:max-w-[85%] md:px-4 md:py-3`}>
        <Markdown className="text-[14px] leading-relaxed text-[#1A1A24]/85 md:text-[15px]">{text}</Markdown>
      </div>
    </div>
  );
}

function AnswerBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end animate-[learn-step-in_.18s_ease-out]">
      <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-indigo-50 px-3 py-2.5 ring-1 ring-indigo-400/20 md:max-w-[85%] md:px-4 md:py-3">
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#1A1A24]/90 md:text-[15px]">{text}</p>
      </div>
    </div>
  );
}

function CoachLine({ text }: { text: string }) {
  return (
    <div className="animate-[learn-step-in_.18s_ease-out] border-l-2 border-black/[0.08] py-0.5 pl-2.5">
      <Markdown className="text-[12px] italic leading-relaxed text-[#6E6E78]/80">{text}</Markdown>
    </div>
  );
}

function TargetCard({ text }: { text: string }) {
  return (
    <div className="animate-[learn-step-in_.18s_ease-out] rounded-xl bg-black/[0.02] p-3 ring-1 ring-black/[0.06] md:p-4">
      <div className="text-[10px] uppercase tracking-wide text-[#6E6E78]">Et solidt svar…</div>
      <Markdown className="mt-1.5 text-[13.5px] leading-relaxed text-[#1A1A24]/75 md:text-[14.5px]">{text}</Markdown>
    </div>
  );
}

export function SocraticSession({ proofId, onClose }: { proofId: number; onClose: () => void }) {
  const LENS = useLensTokens();

  const [row, setRow] = useState<LrSocraticContentRow | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [qIdx, setQIdx] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [busy, setBusy] = useState(false);
  // "unknown" until the first judge call resolves one way or the other; once
  // it falls to "rubric" it stays there for the rest of the session (see file
  // header). "ai" and "unknown" behave identically (judge is tried) — the
  // distinction only matters for the mode chip's label.
  const [judgeMode, setJudgeMode] = useState<"unknown" | "ai" | "rubric">("unknown");

  const [followups, setFollowups] = useState(0);
  const [facetsHit, setFacetsHit] = useState<Set<string>>(new Set());
  const [recovered, setRecovered] = useState(false);
  const [awaitingRubricTap, setAwaitingRubricTap] = useState(false);
  const [tappedFacets, setTappedFacets] = useState<Set<string>>(new Set());

  const [verdicts, setVerdicts] = useState<Array<{ questionId: string; grade: Grade }>>([]);
  const [finished, setFinished] = useState(false);
  // Seeded once from `fetchMemoryStates` (so `creditConcepts` revises real
  // existing alpha/beta rather than always starting from
  // `defaultMemoryState`), then only ever updated functionally — nothing
  // else in this file reads the value directly, just the setter.
  const [, setMemoryCache] = useState<Record<string, LrMemoryState>>({});

  const [approveUi, setApproveUi] = useState<"idle" | "confirming" | "busy" | "approved" | "done">("idle");
  const approveUndoTimerRef = useRef<number | null>(null);
  const startedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      if (approveUndoTimerRef.current !== null) window.clearTimeout(approveUndoTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    fetchSocraticContent(proofId)
      .then((r) => {
        if (alive) setRow(r);
      })
      .catch((e) => {
        if (!alive) return;
        setLoadError(String(e));
        setRow(null);
      });
    return () => {
      alive = false;
    };
  }, [proofId]);

  const script = row?.content ?? null;

  const allConceptIds = useMemo(() => {
    if (!script) return [];
    const ids = new Set<string>();
    script.questions.forEach((q) => q.concept_ids.forEach((c) => ids.add(c)));
    return Array.from(ids);
  }, [script]);

  useEffect(() => {
    if (allConceptIds.length === 0) return;
    let alive = true;
    fetchMemoryStates(allConceptIds)
      .then((states) => {
        if (alive) setMemoryCache(states);
      })
      .catch((e) => console.error("[learn] fetchMemoryStates failed", e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allConceptIds.join(",")]);

  function startQuestion(idx: number) {
    if (!script) return;
    const q = script.questions[idx];
    setQIdx(idx);
    setFollowups(0);
    setFacetsHit(new Set());
    setRecovered(false);
    setAwaitingRubricTap(false);
    setTappedFacets(new Set());
    setTurns((t) => [...t, { id: `${q.id}::prompt::0`, kind: "prompt", text: q.prompt_md, lens: q.lens }]);
  }

  useEffect(() => {
    if (!script || startedRef.current) return;
    startedRef.current = true;
    startQuestion(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns, awaitingRubricTap, finished]);

  function creditConcepts(q: SocraticQuestion, grade: Grade) {
    setMemoryCache((prev) => {
      const next = { ...prev };
      for (const conceptId of q.concept_ids) {
        const existing = prev[conceptId] ?? defaultMemoryState("default", conceptId);
        const updated = applyGrade(existing, grade, q.lens, new Date(), 1.0);
        next[conceptId] = updated;
        upsertMemory(updated).catch((e) => console.error("[learn] upsertMemory failed", e));
      }
      return next;
    });
    logAttempt({ itemRef: q.id, lens: q.lens, grade }).catch((e) => console.error("[learn] logAttempt failed", e));
    applyBlamePropagation(q.concept_ids, grade).catch((e) => console.error("[learn] blame propagation failed", e));
  }

  function finishQuestion(q: SocraticQuestion, grade: Grade, extraTurns: Turn[] = []) {
    creditConcepts(q, grade);
    setVerdicts((v) => [...v, { questionId: q.id, grade }]);
    setAwaitingRubricTap(false);
    setTurns((t) => [
      ...t,
      ...extraTurns,
      { id: `${q.id}::target::${t.length + extraTurns.length}`, kind: "target", text: q.target_md },
    ]);
  }

  /** Shared branch: given "which facets were credited this round" and
   * "was anything at all credited", pick the next authored prompt (a
   * subquestion for the first still-missing facet, else `retry_md`) — used
   * by both the judged "partial" branch and the rubric "some tapped" branch,
   * which the pinned charter says must be "the same deterministic branching". */
  function pickFollowupPrompt(q: SocraticQuestion, newFacets: Set<string>): string {
    const missing = q.facets.find((f) => !newFacets.has(f.id));
    const sub = missing ? q.subquestions.find((s) => s.targets_facet === missing.id) : undefined;
    return sub?.prompt_md ?? q.retry_md;
  }

  function handleJudged(q: SocraticQuestion, result: JudgeResult) {
    const newFacets = new Set(facetsHit);
    result.facets_hit.forEach((f) => newFacets.add(f));
    setFacetsHit(newFacets);

    const extra: Turn[] = [];
    if (result.coach_md.trim()) {
      extra.push({ id: `${q.id}::coach::${turns.length}`, kind: "coach", text: result.coach_md });
    }

    if (result.verdict === "solid") {
      finishQuestion(q, 3, extra);
      return;
    }

    const thisRoundHit = result.verdict === "partial";
    const everRecovered = recovered || thisRoundHit;
    if (thisRoundHit) setRecovered(true);

    const nextFollowups = followups + 1;
    if (nextFollowups > q.max_followups) {
      finishQuestion(q, everRecovered ? 2 : 1, extra);
      return;
    }
    setFollowups(nextFollowups);

    let promptText: string;
    if (result.verdict === "partial") {
      promptText = pickFollowupPrompt(q, newFacets);
    } else if (result.misconception) {
      const m = q.misconceptions.find((mm) => mm.id === result.misconception);
      promptText = m?.probe_md ?? q.retry_md;
    } else {
      promptText = q.retry_md;
    }
    extra.push({ id: `${q.id}::prompt::${turns.length + 1}`, kind: "prompt", text: promptText });
    setTurns((t) => [...t, ...extra]);
  }

  async function handleSubmit() {
    if (!script || busy || finished) return;
    const last = turns[turns.length - 1];
    if (!last || last.kind !== "prompt") return;
    const answer = inputValue.trim();
    if (!answer) return;

    const q = script.questions[qIdx];
    const history = questionHistory(turns, q.id);
    setBusy(true);
    setInputValue("");
    setTurns((t) => [...t, { id: `${q.id}::answer::${t.length}`, kind: "answer", text: answer }]);

    if (judgeMode !== "rubric") {
      const result = await judgeAnswer(q, answer, history);
      if (result) {
        if (judgeMode === "unknown") setJudgeMode("ai");
        handleJudged(q, result);
        setBusy(false);
        return;
      }
      // Fail-open: any failure — network, non-2xx, malformed/unrecognised
      // JSON — and api.judgeAnswer already collapsed it to null. Sticky for
      // the rest of the session.
      setJudgeMode("rubric");
    }
    setTappedFacets(new Set());
    setAwaitingRubricTap(true);
    setBusy(false);
  }

  function toggleFacet(id: string) {
    setTappedFacets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleRubricConfirm() {
    if (!script) return;
    const q = script.questions[qIdx];
    const newFacets = new Set(facetsHit);
    tappedFacets.forEach((f) => newFacets.add(f));
    setFacetsHit(newFacets);
    setAwaitingRubricTap(false);

    const allHit = q.facets.length === 0 || q.facets.every((f) => newFacets.has(f.id));
    const anyHitThisRound = tappedFacets.size > 0;

    if (allHit) {
      finishQuestion(q, 3);
      return;
    }

    const everRecovered = recovered || anyHitThisRound;
    if (anyHitThisRound) setRecovered(true);

    const nextFollowups = followups + 1;
    if (nextFollowups > q.max_followups) {
      finishQuestion(q, everRecovered ? 2 : 1);
      return;
    }
    setFollowups(nextFollowups);

    // Rubric mode never attempts misconception classification — no judge, no
    // classifier. "Some tapped" reuses the exact same subquestion lookup the
    // judged branch uses; "none tapped" always falls to retry_md.
    const promptText = anyHitThisRound ? pickFollowupPrompt(q, newFacets) : q.retry_md;
    setTurns((t) => [...t, { id: `${q.id}::prompt::${t.length}`, kind: "prompt", text: promptText }]);
  }

  async function finishSession() {
    try {
      await setProofProgress(proofId, "completed");
    } catch (e) {
      console.error("[learn] setProofProgress failed", e);
    }
    setFinished(true);
  }

  function handleContinue() {
    if (!script) return;
    if (qIdx + 1 < script.questions.length) startQuestion(qIdx + 1);
    else finishSession();
  }

  async function handleApprove() {
    if (!row) return;
    setApproveUi("busy");
    try {
      await approveProofContent(proofId, row.version);
      setApproveUi("approved");
      if (approveUndoTimerRef.current !== null) window.clearTimeout(approveUndoTimerRef.current);
      approveUndoTimerRef.current = window.setTimeout(() => setApproveUi("done"), 5000);
    } catch (e) {
      console.error("[learn] approveProofContent failed", e);
      setApproveUi("idle");
    }
  }

  async function handleDemote() {
    if (!row) return;
    if (approveUndoTimerRef.current !== null) {
      window.clearTimeout(approveUndoTimerRef.current);
      approveUndoTimerRef.current = null;
    }
    setApproveUi("busy");
    try {
      await demoteProofContent(proofId, row.version);
      setApproveUi("idle");
    } catch (e) {
      console.error("[learn] demoteProofContent failed", e);
      setApproveUi("approved");
    }
  }

  const last = turns[turns.length - 1];
  const awaitingAnswer = !finished && !awaitingRubricTap && last?.kind === "prompt";
  const showContinueDock = !finished && last?.kind === "target";
  const currentQuestion = script && !finished ? script.questions[qIdx] : null;
  const contentIsDraft = row?.status === "draft";
  const title = script?.title || `Socratic ${proofId}`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col animate-[learn-overlay_.22s_ease-out] bg-[#F6F5F1]/97 backdrop-blur-xl text-[#1A1A24]">
      <style>{PLAYER_STYLE}</style>

      <header className="shrink-0 border-b border-black/[0.08] px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-8">
        <div className={READING_COL}>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[#6E6E78] active:bg-black/[0.05]"
              aria-label="Close"
            >
              ✕
            </button>
            <span className="truncate text-[13px] font-medium text-[#1A1A24]/85">{title}</span>

            {judgeMode !== "unknown" && (
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.12em] ${
                  judgeMode === "ai"
                    ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-400/25"
                    : "bg-black/[0.05] text-[#6E6E78]"
                }`}
              >
                {judgeMode === "ai" ? "AI-DOMMER" : "SELVVURDERING"}
              </span>
            )}

            {contentIsDraft && approveUi === "idle" && (
              <>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.12em] ${FEEDBACK.draft}`}>
                  KLADDE
                </span>
                <button
                  type="button"
                  onClick={() => setApproveUi("confirming")}
                  className="shrink-0 rounded px-1 py-0.5 text-[10px] font-medium text-[#6E6E78] underline decoration-black/15 underline-offset-2 active:text-[#1A1A24]"
                >
                  Godkend
                </button>
              </>
            )}

            {contentIsDraft && approveUi === "confirming" && row && (
              <span className="inline-flex min-w-0 shrink-0 items-center gap-1.5 text-[10px] text-[#6E6E78]">
                <span className="whitespace-nowrap">Godkend v{row.version} → live?</span>
                <button
                  type="button"
                  onClick={handleApprove}
                  aria-label="Bekræft godkendelse"
                  className={`rounded px-1.5 py-0.5 font-semibold ${FEEDBACK.correct}`}
                >
                  ✓
                </button>
                <button
                  type="button"
                  onClick={() => setApproveUi("idle")}
                  aria-label="Annullér"
                  className="rounded px-1.5 py-0.5 text-[#6E6E78] active:text-[#1A1A24]"
                >
                  ✕
                </button>
              </span>
            )}

            {approveUi === "busy" && <span className="shrink-0 text-[10px] text-[#6E6E78]">Opdaterer…</span>}

            {approveUi === "approved" && (
              <span className="inline-flex shrink-0 items-center gap-1.5">
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.12em] ${FEEDBACK.correct}`}>
                  LIVE
                </span>
                <button
                  type="button"
                  onClick={handleDemote}
                  className="text-[10px] text-[#6E6E78] underline decoration-black/15 underline-offset-2 active:text-[#1A1A24]"
                >
                  Fortryd
                </button>
              </span>
            )}

            {script && !finished && (
              <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-[#6E6E78]">
                {qIdx + 1} / {script.questions.length}
              </span>
            )}
          </div>
        </div>
      </header>

      {row === undefined && (
        <main className="flex min-h-0 flex-1 items-center justify-center px-4">
          <p className="text-[13px] text-[#6E6E78]">Loading…</p>
        </main>
      )}

      {row === null && !loadError && (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
          <div className="flex max-w-[22rem] items-center gap-3 rounded-xl border border-dashed border-black/[0.12] bg-black/[0.02] p-4">
            <span className="grid h-8 w-8 shrink-0 animate-[learn-pulse_2.6s_ease-in-out_infinite] place-items-center rounded-full bg-black/[0.04] text-[#6E6E78]/45">
              ?
            </span>
            <div className="min-w-0">
              <p className="text-[13px] text-[#1A1A24]/70">Ikke klar endnu</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-[#6E6E78]/60">This dialogue has no content yet.</p>
            </div>
          </div>
        </main>
      )}

      {row === null && loadError && (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-[13px] text-[#1A1A24]/70">Could not load this dialogue.</p>
          <p className="text-[11px] text-[#6E6E78]/70">{loadError}</p>
        </main>
      )}

      {script && !finished && (
        <main ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-40 md:px-8 md:pt-8">
          <div className={`${READING_COL} flex flex-col gap-3 md:gap-4`}>
            {turns.map((t) => {
              if (t.kind === "prompt") {
                return (
                  <PromptBubble
                    key={t.id}
                    text={t.text}
                    lensChip={
                      t.lens ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide ${LENS[t.lens].chip}`}
                        >
                          <span className={`h-1 w-1 rounded-full ${LENS[t.lens].dot}`} />
                          {LENS[t.lens].label}
                        </span>
                      ) : null
                    }
                  />
                );
              }
              if (t.kind === "answer") return <AnswerBubble key={t.id} text={t.text} />;
              if (t.kind === "coach") return <CoachLine key={t.id} text={t.text} />;
              return <TargetCard key={t.id} text={t.text} />;
            })}

            {busy && (
              <div className="flex items-center gap-2 pl-1 text-[11px] text-[#6E6E78]/60">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-600" />
                Tænker…
              </div>
            )}

            {awaitingRubricTap && currentQuestion && (
              <div className={`${CARD} animate-[learn-step-in_.18s_ease-out] p-3 md:p-4`}>
                <div className="text-[10px] uppercase tracking-wide text-[#6E6E78]">Hvad fik du med i dit svar?</div>
                <div className="mt-2 flex flex-col gap-1.5">
                  {currentQuestion.facets.map((f) => {
                    const on = tappedFacets.has(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => toggleFacet(f.id)}
                        className={`flex min-h-[44px] items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                          on ? "bg-indigo-50 ring-1 ring-indigo-400/30" : "bg-black/[0.02] ring-1 ring-black/[0.06] active:bg-black/[0.04]"
                        }`}
                      >
                        <span
                          className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded text-[9px] ${
                            on ? "bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-white" : "ring-1 ring-black/15"
                          }`}
                        >
                          {on ? "✓" : ""}
                        </span>
                        <Markdown className="inline text-[13px] text-[#1A1A24]/80">{f.desc_md}</Markdown>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div>
        </main>
      )}

      {script && finished && (
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-40 pt-4 md:px-8 md:pt-8">
          <div className={READING_COL}>
            <div className="flex flex-col items-center gap-1 py-6 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-2xl text-white shadow-[0_0_20px_-6px_rgba(217,70,239,0.5)]">
                ✓
              </span>
              <p className="mt-3 bg-gradient-to-r from-indigo-600 to-fuchsia-600 bg-clip-text text-[11px] font-semibold tracking-[0.32em] text-transparent">
                DIALOG FÆRDIG
              </p>
              <p className="text-[13px] text-[#6E6E78]">{title}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              {script.questions.map((q, i) => {
                const v = verdicts.find((vv) => vv.questionId === q.id);
                return (
                  <div key={q.id} className={`flex items-center gap-2.5 ${CARD} px-3 py-2.5`}>
                    <VerdictGlyph grade={v?.grade} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#1A1A24]/80">Spørgsmål {i + 1}</span>
                    <span className="shrink-0 text-[10px] text-[#6E6E78]">{v ? GRADE_LABEL[v.grade] : ""}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      )}

      <footer className={DOCK_SHELL}>
        <div className={DOCK_STACK}>
          {awaitingRubricTap && (
            <button
              type="button"
              onClick={handleRubricConfirm}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
            >
              Bekræft
            </button>
          )}

          {awaitingAnswer && (
            <>
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                rows={2}
                placeholder="Skriv dit svar…"
                disabled={busy}
                className="w-full resize-none rounded-xl border border-black/15 bg-white px-3 py-3 text-[16px] text-[#1A1A24] placeholder:text-[#6E6E78]/60 outline-none transition-shadow focus:border-indigo-500/50 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={busy || !inputValue.trim()}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985] disabled:opacity-40"
              >
                {busy ? "…" : "Send"}
              </button>
            </>
          )}

          {showContinueDock && (
            <button
              type="button"
              onClick={handleContinue}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
            >
              {script && qIdx + 1 < script.questions.length ? "Næste spørgsmål →" : "Afslut →"}
            </button>
          )}

          {finished && (
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
            >
              Luk
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
