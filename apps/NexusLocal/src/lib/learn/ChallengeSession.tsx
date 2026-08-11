/**
 * Lynudfordring — the timed challenge (LEARN_PLAN.md "Lynudfordring — timed
 * challenge", pinned 2026-08-10; scoped chapter-checkpoint pilot added
 * 2026-08-10). A 15-minute, 3-round arcade session: fullscreen overlay, same
 * frame/backdrop/dock language as `Player.tsx`/`ExerciseSession.tsx`
 * (`player/tokens.tsx`'s literals) but its own lean drill card
 * (`ChallengeDrillCard` below) — deliberately NOT `DrillCard.tsx`, which
 * carries hints/solution-reveal/grade-buttons this fast-path never shows
 * mid-round (LEARN_PLAN.md: "No hints/solutions during rounds"). `TileDrill`
 * is reused directly for `answer_type: "tiles"`, same as `DrillCard` does.
 *
 * ── Scope ────────────────────────────────────────────────────────────────
 * Two entry points share this component:
 *  - Unscoped (`chapter` prop omitted) — `ChallengePanel.tsx`'s Learn-page
 *    card, pool = the whole unlocked course.
 *  - Chapter-scoped (`chapter="LA 2"` etc.) — a checkpoint node on
 *    `PathPanel`'s spine, pool = that whole chapter regardless of lock
 *    status. `api.fetchChallengePool({ chapter })` /
 *    `api.fetchChallengeBest(chapter ?? null)` / `submitChallengeRun({...,
 *    scope: chapter ?? null })` carry the scope through; see their doc
 *    comments in api.ts for the pool/best-run semantics.
 *
 * ── Round → screen flow ──────────────────────────────────────────────────
 * preround(R1) -> playing(R1) -> breather -> preround(R2) -> playing(R2) ->
 * breather -> preround(R3) -> playing(R3) -> end — but ONLY over
 * `activeRounds`, the subset of the three round types that actually have
 * ≥1 drill after scoping. A round type with zero drills (R2 "Byg & saml" is
 * empty for a chapter with no tiles-archetype content yet, see
 * `TileDrill.tsx`'s own fixture note) is dropped entirely, not merely
 * skipped mid-flow — round numbering ("Runde N/M") reflects `M =
 * activeRounds.length`, never a hardcoded 3, and the breather/end screens
 * never render for a round that didn't happen. If every round type is empty
 * (only possible for a very thin, very early chapter), a dedicated empty
 * state renders instead of an unplayable preround screen — see the
 * `activeRounds.length === 0` branch below.
 *
 * ── Round sizing when the pool is thin (LEARN_PLAN.md, pinned 2026-08-11) ──
 * `fetchChallengePool` widens a chapter-scoped pool BACKWARDS only (earlier
 * chapters, never later ones) — so a pool can legitimately stay under
 * `CHALLENGE_MIN_POOL` (e.g. a checkpoint at the very first chapter, nothing
 * earlier to borrow from). Rather than ever reaching forward, the session
 * shrinks instead: each round's queue is capped at
 * `min(MAX_DRILLS_PER_ROUND, max(3, floor(totalPoolSize / 3)))` instead of
 * the usual flat 10, so three rounds still divide up whatever the pool has.
 *
 * ── Timing ───────────────────────────────────────────────────────────────
 * Every countdown (round timer, breather) is a `setInterval` tick that
 * recomputes `remaining = duration - (Date.now() - startedAt)` — never a
 * decrementing counter. A sideloaded WebView's `setInterval` drifts under
 * backgrounding; measuring against a fixed start timestamp is immune to that
 * (CLAUDE.md's "single setInterval driven by Date-of-start deltas" rule).
 * Pause is not supported — closing the overlay before the end screen forfeits
 * the run behind a confirm (`requestClose`).
 *
 * ── Scoring (LEARN_PLAN.md, pinned) ──────────────────────────────────────
 * `scoreDrill`: base = 100 × difficulty; + a speed bonus up to 50 points by
 * the drill's remaining fraction of a 30s-per-drill par; × a streak
 * multiplier (+10% per consecutive correct *before* this one, capped at
 * ×2). Wrong (or an unresolved/skip) = 0 points, computed by the caller
 * simply not invoking `scoreDrill` rather than the function branching on
 * correctness itself.
 *
 * ── Memory coupling — HALF-WEIGHT (LEARN_PLAN.md, pinned) ────────────────
 * Every answered (not skipped) drill fires `logAttempt` + `memory.applyGrade`
 * at `CHALLENGE_WEIGHT = 0.5`, correct -> grade 2, wrong -> grade 1 (never 0
 * — "a timed miss is weak evidence"). Both are fire-and-forget
 * (`.catch(console.error)`, never awaited) so a slow network never stalls the
 * timer — the one hard rule this file cannot violate.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CHALLENGE_MIN_POOL,
  fetchChallengeBest,
  fetchChallengePool,
  fetchMemoryStates,
  logAttempt,
  submitChallengeRun,
  upsertMemory,
  type ChallengePool,
  type ChallengePoolDrill,
} from "./api";
import { applyGrade, defaultMemoryState } from "./memory";
import { checkAnswer, checkTilesBuild, checkTilesSelect, inputParses } from "./answers";
import type { ChallengeRoundSummary, Drill, DrillAnswer, Grade, Lens, LrChallengeRun } from "./types";
import { Markdown } from "./Markdown";
import { useCourse } from "./CourseContext";
import { TileDrill } from "./player/TileDrill";
import {
  ANSWER_COL,
  CARD,
  DOCK_SHELL,
  DOCK_STACK,
  FEEDBACK,
  MAIN_SHELL,
  PLAYER_STYLE,
  READING_COL,
  useLensTokens,
  useSolidBar,
} from "./player/tokens";

// ── Round definitions (LEARN_PLAN.md, pinned) ────────────────────────────
const ROUND_DEFS: Array<{ round: 1 | 2 | 3; label: string; description: string; poolKey: "r1" | "r2" | "r3" }> = [
  {
    round: 1,
    label: "Hurtige svar",
    description: "Tal, vektorer, matricer og hurtige beregningsvalg. Skriv svaret og tjek det.",
    poolKey: "r1",
  },
  {
    round: 2,
    label: "Byg & saml",
    description: "Tap-opgaver — vælg de rigtige udtryk, eller byg dem i rækkefølge.",
    poolKey: "r2",
  },
  {
    round: 3,
    label: "Dom",
    description: "Sandt/falsk og konceptuelle valg — brug din dømmekraft, ikke udregningen.",
    poolKey: "r3",
  },
];

const ROUND_DURATION_SECS = 5 * 60;
const BREATHER_SECS = 15;
const MAX_DRILLS_PER_ROUND = 10;
const CHALLENGE_WEIGHT = 0.5;
const PAR_SECONDS = 30;
const MAX_SPEED_BONUS = 50;
const STREAK_BONUS_PER = 0.1;
const STREAK_MULTIPLIER_CAP = 2;

type PhaseKind = "preround" | "playing" | "breather" | "end";

interface RoundResult {
  correct: number;
  total: number;
  score: number;
}

interface ChallengeReviewEntry {
  drill: Drill;
  round: 1 | 2 | 3;
  correct: boolean;
  skipped: boolean;
  given: string;
  correctText: string;
}

/** Fisher–Yates on a copy — never mutates its input. Local to this file, same
 * pattern `ExerciseSession.tsx` uses for its own shuffle. */
function shuffle<T>(items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function mmss(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function timerColorClass(remaining: number): string {
  if (remaining < 15) return "text-red-600";
  if (remaining < 60) return "text-amber-600";
  return "text-[#1A1A24]/85";
}

/** base + speed bonus, scaled by the streak multiplier — the caller decides
 * whether to invoke this at all (wrong/skip = 0, per LEARN_PLAN.md). */
function scoreDrill(difficulty: number, elapsedSecs: number, streakBefore: number): number {
  const base = 100 * Math.min(Math.max(difficulty, 1), 3);
  const remainingFraction = Math.min(1, Math.max(0, (PAR_SECONDS - elapsedSecs) / PAR_SECONDS));
  const speedBonus = MAX_SPEED_BONUS * remainingFraction;
  const multiplier = Math.min(STREAK_MULTIPLIER_CAP, 1 + streakBefore * STREAK_BONUS_PER);
  return Math.round((base + speedBonus) * multiplier);
}

function formatTarget(answer: DrillAnswer | undefined): string {
  if (!answer) return "";
  if (Array.isArray(answer.value)) {
    if (Array.isArray(answer.value[0])) return (answer.value as number[][]).map((row) => row.join(" ")).join("; ");
    return (answer.value as number[]).join(", ");
  }
  if (typeof answer.value === "number" || typeof answer.value === "string") return String(answer.value);
  return "";
}

/** The correct-answer text shown in the end-screen review — never during the
 * round itself (LEARN_PLAN.md: "No hints/solutions during rounds"). */
function correctAnswerText(entry: ChallengePoolDrill): string {
  const drill = entry.drill;
  switch (drill.answer_type) {
    case "numeric":
    case "vector":
    case "matrix":
      return formatTarget(drill.answer);
    case "choice": {
      const v = drill.answer?.value;
      if (typeof v === "number") return drill.choices?.[v] ?? "";
      if (typeof v === "string") return v;
      return "";
    }
    case "tiles": {
      const byId = new Map((drill.tiles ?? []).map((t) => [t.id, t.md]));
      if (drill.mode === "build") return (drill.answer?.sequence ?? []).map((id) => byId.get(id) ?? id).join(" → ");
      return (drill.tiles ?? []).filter((t) => t.correct).map((t) => t.md).join(", ");
    }
    default:
      return "";
  }
}

async function applyChallengeMemory(conceptIds: string[], lens: Lens, grade: Grade): Promise<void> {
  if (conceptIds.length === 0) return;
  const states = await fetchMemoryStates(conceptIds);
  const now = new Date();
  await Promise.all(
    conceptIds.map((id) => {
      const existing = states[id] ?? defaultMemoryState("default", id);
      const updated = applyGrade(existing, grade, lens, now, CHALLENGE_WEIGHT);
      return upsertMemory(updated);
    })
  );
}

/** Fire-and-forget grading side effects — must never be awaited by the
 * caller, per this file's header comment. */
function gradeDrill(entry: ChallengePoolDrill, correct: boolean) {
  const grade: Grade = correct ? 2 : 1; // never 0 — a timed miss is weak evidence
  logAttempt({ itemRef: entry.drill.id, lens: entry.drill.lens, grade }).catch((e) =>
    console.error("[learn] challenge logAttempt failed", e)
  );
  applyChallengeMemory(entry.conceptIds, entry.drill.lens, grade).catch((e) =>
    console.error("[learn] challenge applyGrade failed", e)
  );
}

const FORMAT_ERROR_MESSAGE: Record<"numeric" | "vector" | "matrix", string> = {
  numeric: "Kunne ikke læses som et tal — skriv fx 6, -2 eller 2/3",
  vector: "Kunne ikke læses som en vektor — skriv komponenterne adskilt med komma, fx 1, -2, 3",
  matrix: "Kunne ikke læses som en matrix — adskil rækker med semikolon, fx 1 2; 3 4",
};

export function ChallengeSession({ chapter, onClose }: { chapter?: string; onClose: () => void }) {
  const { course } = useCourse();
  // LA keeps its pre-multi-course scope format exactly (`chapter ?? null`) so
  // existing `lr_challenge_run` rows still match on `fetchChallengeBest` —
  // DESIGN.md's "verify no LA surface changes" bar applies to stored data
  // too, not just pixels. A non-LA course prefixes its own key so runs never
  // collide with (or get outscored by) LA's under the same `chapter` label —
  // LEARN_PLAN.md's "Challenge/review/exercise pools stay course-scoped".
  const scope = course.key === "la" ? (chapter ?? null) : `${course.key}:${chapter ?? "all"}`;

  // undefined = loading, null = the pool/best fetch failed outright.
  const [pool, setPool] = useState<ChallengePool | null | undefined>(undefined);
  const [best, setBest] = useState<LrChallengeRun | null>(null);
  const [queues, setQueues] = useState<ChallengePoolDrill[][]>([]);

  const [phaseKind, setPhaseKind] = useState<PhaseKind>("preround");
  const [roundIndex, setRoundIndex] = useState(0);
  const [drillIndex, setDrillIndex] = useState(0);
  const [roundStartAt, setRoundStartAt] = useState<number | null>(null);
  const [breatherStartAt, setBreatherStartAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());

  const [totalScore, setTotalScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [roundResults, setRoundResults] = useState<RoundResult[]>(
    ROUND_DEFS.map(() => ({ correct: 0, total: 0, score: 0 }))
  );
  const [reviewLog, setReviewLog] = useState<ChallengeReviewEntry[]>([]);

  const endingRef = useRef(false);
  const submittedRef = useRef(false);
  const drillStartAtRef = useRef(Date.now());
  const sessionStartAtRef = useRef(Date.now());

  useEffect(() => {
    let alive = true;
    Promise.all([fetchChallengePool({ courseId: course.courseId, chapter }), fetchChallengeBest(scope).catch(() => null)])
      .then(([p, b]) => {
        if (!alive) return;
        setPool(p);
        setBest(b);
        // Shrink instead of forward-widening (see file header): a thin,
        // backwards-only-widened pool gets proportionally smaller round
        // queues rather than a flat 10, so all three round types still get a
        // fair share of whatever is available.
        const totalPoolSize = p.r1.length + p.r2.length + p.r3.length;
        const perRoundCap =
          totalPoolSize < CHALLENGE_MIN_POOL
            ? Math.max(3, Math.min(MAX_DRILLS_PER_ROUND, Math.floor(totalPoolSize / 3)))
            : MAX_DRILLS_PER_ROUND;
        setQueues([
          shuffle(p.r1).slice(0, perRoundCap),
          shuffle(p.r2).slice(0, perRoundCap),
          shuffle(p.r3).slice(0, perRoundCap),
        ]);
      })
      .catch((e) => {
        console.error("[learn] fetchChallengePool failed", e);
        if (alive) setPool(null);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick while a countdown is live. Recomputed from Date-of-start deltas
  // below — this interval only forces a re-render, it is never the clock.
  useEffect(() => {
    if (phaseKind !== "playing" && phaseKind !== "breather") return;
    const id = window.setInterval(() => setNowTick(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [phaseKind]);

  useEffect(() => {
    drillStartAtRef.current = Date.now();
  }, [phaseKind, roundIndex, drillIndex]);

  // Only the round types that survived scoping with ≥1 drill — a round type
  // scoped to zero drills (e.g. no tiles content yet) never enters the flow
  // at all, rather than being started-then-immediately-skipped. Recomputed
  // whenever `queues` changes (i.e. once, on pool load).
  const activeRounds = useMemo(
    () => ROUND_DEFS.map((def, i) => ({ def, queue: queues[i] ?? [] })).filter((r) => r.queue.length > 0),
    [queues]
  );

  const currentQueue = activeRounds[roundIndex]?.queue ?? [];
  const currentEntry = phaseKind === "playing" && drillIndex < currentQueue.length ? currentQueue[drillIndex] : null;

  const remainingRoundSecs =
    phaseKind === "playing" && roundStartAt !== null
      ? Math.max(0, ROUND_DURATION_SECS - Math.floor((nowTick - roundStartAt) / 1000))
      : ROUND_DURATION_SECS;

  const remainingBreatherSecs =
    phaseKind === "breather" && breatherStartAt !== null
      ? Math.max(0, BREATHER_SECS - Math.floor((nowTick - breatherStartAt) / 1000))
      : BREATHER_SECS;

  function endRound() {
    const isLast = roundIndex >= activeRounds.length - 1;
    if (isLast) {
      setPhaseKind("end");
    } else {
      setBreatherStartAt(Date.now());
      setPhaseKind("breather");
    }
  }

  function advanceFromBreather() {
    if (roundIndex + 1 < activeRounds.length) {
      setRoundIndex((r) => r + 1);
      setPhaseKind("preround");
    } else {
      setPhaseKind("end");
    }
  }

  function startRound() {
    endingRef.current = false;
    setDrillIndex(0);
    setRoundStartAt(Date.now());
    setPhaseKind("playing");
  }

  // Round timer hit 0:00.
  useEffect(() => {
    if (phaseKind !== "playing" || remainingRoundSecs > 0 || endingRef.current) return;
    endingRef.current = true;
    endRound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseKind, remainingRoundSecs]);

  // Queue exhausted before the timer ran out.
  useEffect(() => {
    if (phaseKind !== "playing" || drillIndex < currentQueue.length || endingRef.current) return;
    endingRef.current = true;
    endRound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseKind, drillIndex, currentQueue.length]);

  // Breather countdown ran out — auto-advance (still skippable manually).
  useEffect(() => {
    if (phaseKind !== "breather" || remainingBreatherSecs > 0) return;
    advanceFromBreather();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseKind, remainingBreatherSecs]);

  const totalCorrectAll = roundResults.reduce((n, r) => n + r.correct, 0);
  const totalAttemptedAll = roundResults.reduce((n, r) => n + r.total, 0);

  // Submit exactly once, when the end screen is reached.
  useEffect(() => {
    if (phaseKind !== "end" || submittedRef.current) return;
    submittedRef.current = true;
    const durationSecs = Math.round((Date.now() - sessionStartAtRef.current) / 1000);
    submitChallengeRun({
      score: totalScore,
      correct: totalCorrectAll,
      total: totalAttemptedAll,
      bestStreak,
      durationSecs,
      // Over `activeRounds`, not the fixed `ROUND_DEFS` — a round type that
      // never entered the flow (zero drills after scoping) has no place in
      // the persisted run summary either.
      rounds: activeRounds.map(({ def }, i): ChallengeRoundSummary => ({
        round: def.round,
        label: def.label,
        score: roundResults[i].score,
        correct: roundResults[i].correct,
        total: roundResults[i].total,
      })),
      scope,
    }).catch((e) => console.error("[learn] submitChallengeRun failed", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseKind]);

  function handleResolved(entry: ChallengePoolDrill, correct: boolean, given: string) {
    const elapsedSecs = (Date.now() - drillStartAtRef.current) / 1000;
    const difficulty = entry.drill.difficulty ?? 1;
    const points = correct ? scoreDrill(difficulty, elapsedSecs, streak) : 0;

    setTotalScore((s) => s + points);
    setStreak((prev) => {
      const next = correct ? prev + 1 : 0;
      setBestStreak((b) => Math.max(b, next));
      return next;
    });
    setRoundResults((prev) => {
      const next = prev.slice();
      const r = next[roundIndex];
      next[roundIndex] = { correct: r.correct + (correct ? 1 : 0), total: r.total + 1, score: r.score + points };
      return next;
    });
    setReviewLog((prev) => [
      ...prev,
      { drill: entry.drill, round: entry.round, correct, skipped: false, given, correctText: correctAnswerText(entry) },
    ]);

    gradeDrill(entry, correct);

    // Let the flash render (the card owns its own checked/result state and
    // stays mounted showing it) before the next drill remounts.
    window.setTimeout(() => setDrillIndex((i) => i + 1), 650);
  }

  function handleSkip(entry: ChallengePoolDrill) {
    setStreak(0);
    setRoundResults((prev) => {
      const next = prev.slice();
      const r = next[roundIndex];
      next[roundIndex] = { ...r, total: r.total + 1 };
      return next;
    });
    setReviewLog((prev) => [
      ...prev,
      { drill: entry.drill, round: entry.round, correct: false, skipped: true, given: "", correctText: correctAnswerText(entry) },
    ]);
    setDrillIndex((i) => i + 1);
  }

  function requestClose() {
    if (phaseKind !== "end") {
      const ok = window.confirm("Forlad Lynudfordring? Din runde bliver ikke gemt.");
      if (!ok) return;
    }
    onClose();
  }

  const newRecord = phaseKind === "end" && (best === null || totalScore > best.score);
  const activeRoundDef = activeRounds[Math.min(roundIndex, Math.max(activeRounds.length - 1, 0))]?.def ?? ROUND_DEFS[0];

  return (
    <div className="fixed inset-0 z-50 flex flex-col animate-[learn-overlay_.22s_ease-out] bg-[#F6F5F1]/97 backdrop-blur-xl text-[#1A1A24]">
      <style>{PLAYER_STYLE}</style>

      <header className="shrink-0 border-b border-black/[0.08] px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-8">
        <div className={READING_COL}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[#6E6E78] active:bg-black/[0.05]"
            >
              ✕
            </button>
            <span className="truncate text-[13px] font-medium text-[#1A1A24]/85">
              ⚡ Lynudfordring{chapter ? ` · ${chapter}` : ""} — {activeRoundDef.label}
            </span>
            {phaseKind === "playing" && (
              <span className={`ml-auto font-mono text-[20px] font-semibold tabular-nums ${timerColorClass(remainingRoundSecs)}`}>
                {mmss(remainingRoundSecs)}
              </span>
            )}
          </div>
          {phaseKind === "playing" && currentQueue.length > 0 && (
            <div className="mt-2 flex items-center justify-between text-[11px] text-[#6E6E78]">
              <span>
                Runde {roundIndex + 1}/{activeRounds.length} · Opgave {Math.min(drillIndex + 1, currentQueue.length)}/{currentQueue.length}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono tabular-nums text-[#1A1A24]/80">{totalScore} pt</span>
                {streak > 1 && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                    🔥{streak}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      </header>

      {pool === undefined && (
        <main className="flex min-h-0 flex-1 items-center justify-center px-4">
          <p className="text-[13px] text-[#6E6E78]">Loading…</p>
        </main>
      )}

      {pool === null && (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-[13px] text-[#1A1A24]/70">Couldn't load the challenge pool.</p>
          <p className="max-w-[240px] text-[11px] leading-relaxed text-[#6E6E78]/80">
            Check the connection and reopen Lynudfordring.
          </p>
        </main>
      )}

      {/* No round type survived scoping with ≥1 drill — a genuinely thin
          chapter (e.g. the very first one, nothing earlier to widen into).
          Renders instead of a preround screen whose Start button could never
          be pressed (LEARN_PLAN.md: "skip that round entirely ... no empty
          round screens"). */}
      {pool && activeRounds.length === 0 && (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <h2 className="text-xl font-semibold text-[#1A1A24]">Ingen opgaver tilgængelige endnu</h2>
          <p className="max-w-[280px] text-[13px] leading-relaxed text-[#6E6E78]">
            {chapter
              ? `Der er ikke nok korte opgaver i ${chapter} (eller de foregående kapitler) til en lynudfordring endnu.`
              : "Der er ikke nok korte opgaver i det ulåste område til en lynudfordring endnu."}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 rounded-xl bg-black/[0.05] px-6 py-3 text-[14px] font-medium text-[#1A1A24]/80 active:bg-black/[0.08]"
          >
            Luk
          </button>
        </main>
      )}

      {pool && activeRounds.length > 0 && phaseKind === "preround" && (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[#6E6E78]">
            Runde {roundIndex + 1} / {activeRounds.length}
          </span>
          <h2 className="text-2xl font-semibold text-[#1A1A24] md:text-3xl">{activeRoundDef.label}</h2>
          <p className="max-w-[300px] text-[13px] leading-relaxed text-[#6E6E78]">{activeRoundDef.description}</p>
          <p className="text-[11px] text-[#6E6E78]/70">Op til {currentQueue.length} opgaver · 5:00</p>
          {roundIndex === 0 && pool.widened && (
            <p className="max-w-[280px] text-[10px] text-[#6E6E78]/60">
              {chapter
                ? `Puljen inkluderer tidligere kapitler (for få opgaver i ${chapter} alene).`
                : "Puljen inkluderer alle enheder med indhold (under 24 opgaver i det ulåste område)."}
            </p>
          )}
          <button
            type="button"
            onClick={startRound}
            disabled={currentQueue.length === 0}
            className="mt-2 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-6 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985] disabled:opacity-40"
          >
            Start runde →
          </button>
        </main>
      )}

      {pool && phaseKind === "playing" && currentEntry && (
        <ChallengeDrillCard
          key={currentEntry.drill.id}
          entry={currentEntry}
          indexLabel={`Runde ${roundIndex + 1} · Opgave ${drillIndex + 1}/${currentQueue.length}`}
          onResolved={(correct, given) => handleResolved(currentEntry, correct, given)}
          onSkip={() => handleSkip(currentEntry)}
        />
      )}

      {pool && phaseKind === "breather" && (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[#6E6E78]">Runde {roundIndex + 1} færdig</span>
          <div className="font-mono text-3xl font-semibold text-[#1A1A24]/90">{roundResults[roundIndex].score} pt</div>
          <div className="text-[12px] text-[#6E6E78]">
            {roundResults[roundIndex].correct}/{roundResults[roundIndex].total} korrekte
          </div>
          <div className="mt-1 font-mono text-[13px] tabular-nums text-[#6E6E78]/70">{remainingBreatherSecs}s</div>
          <button
            type="button"
            onClick={advanceFromBreather}
            className="mt-2 min-h-[40px] rounded-lg bg-black/[0.05] px-4 py-2 text-[13px] text-[#1A1A24]/70 active:bg-black/[0.08]"
          >
            Fortsæt →
          </button>
        </main>
      )}

      {pool && phaseKind === "end" && (
        <>
          <main className={`${MAIN_SHELL} pb-40`}>
            <div className={READING_COL}>
              <div className="mt-4 flex flex-col items-center text-center md:mt-8">
                {newRecord && (
                  <span className="mb-2 inline-flex animate-[learn-chip-rise_.35s_ease-out] items-center gap-1 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-3 py-1 text-[11px] font-semibold tracking-[0.14em] text-white">
                    ✦ NY REKORD
                  </span>
                )}
                <div className="bg-gradient-to-r from-indigo-600 to-fuchsia-600 bg-clip-text font-mono text-5xl font-semibold tabular-nums text-transparent md:text-6xl">
                  {totalScore}
                </div>
                <div className="mt-1 text-[11px] uppercase tracking-wide text-[#6E6E78]">
                  {newRecord ? "point · ny personlig rekord" : best ? `point · rekord: ${best.score}` : "point · første forsøg"}
                </div>

                <div className="mt-5 flex items-center gap-8">
                  <div>
                    <div className="font-mono text-xl font-semibold text-[#1A1A24]/90">
                      {totalCorrectAll}/{totalAttemptedAll}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-[#6E6E78]">korrekte</div>
                  </div>
                  <div>
                    <div className="font-mono text-xl font-semibold text-[#1A1A24]/90">{bestStreak}</div>
                    <div className="text-[10px] uppercase tracking-wide text-[#6E6E78]">bedste stribe</div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-2 md:mt-8">
                {/* Over `activeRounds`, not the fixed `ROUND_DEFS` — a round
                    type that never entered the flow has no row here (no
                    empty "0/0" round summary). */}
                {activeRounds.map(({ def }, i) => (
                  <div
                    key={def.round}
                    className="flex items-center justify-between rounded-xl border border-black/[0.06] bg-white px-3 py-2.5 shadow-[0_1px_8px_rgba(0,0,0,0.05)]"
                  >
                    <span className="text-[13px] text-[#1A1A24]/80">{def.label}</span>
                    <span className="font-mono text-[13px] text-[#1A1A24]/70">
                      {roundResults[i].correct}/{roundResults[i].total} · {roundResults[i].score} pt
                    </span>
                  </div>
                ))}
              </div>

              {reviewLog.length > 0 && (
                <div className="mt-6 md:mt-8">
                  <h3 className="text-[11px] uppercase tracking-[0.14em] text-[#6E6E78]">Gennemgang</h3>
                  <div className="mt-2 flex flex-col gap-2">
                    {reviewLog.map((entry, i) => (
                      <ReviewRow key={i} entry={entry} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </main>

          <footer className={DOCK_SHELL}>
            <div className={DOCK_STACK}>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
              >
                Færdig
              </button>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}

/**
 * One drill, full attention, no hints/solution/grade-bar — Lynudfordring's
 * fast path. Check -> instant flash (border pulse via the `checked`/`result`
 * ring) -> the parent advances after a short delay so the flash stays
 * visible. Deliberately not `DrillCard.tsx` (see file header).
 */
function ChallengeDrillCard({
  entry,
  indexLabel,
  onResolved,
  onSkip,
}: {
  entry: ChallengePoolDrill;
  indexLabel: string;
  onResolved: (correct: boolean, given: string) => void;
  onSkip: () => void;
}) {
  const drill = entry.drill;
  const [input, setInput] = useState("");
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [tileSelection, setTileSelection] = useState<string[]>([]);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [result, setResult] = useState<boolean | null>(null);
  const LENS = useLensTokens();
  const SOLID_BAR = useSolidBar();

  function tilesGivenText(): string {
    const byId = new Map((drill.tiles ?? []).map((t) => [t.id, t.md]));
    const sep = drill.mode === "build" ? " → " : ", ";
    return tileSelection.map((id) => byId.get(id) ?? id).join(sep);
  }

  function handleCheck() {
    if (checked) return;
    if (drill.answer_type === "tiles") {
      const r =
        drill.mode === "build"
          ? checkTilesBuild(tileSelection, drill.answer?.sequence ?? [])
          : checkTilesSelect(tileSelection, drill.tiles ?? []);
      setChecked(true);
      setResult(r);
      onResolved(r, tilesGivenText());
      return;
    }
    if (drill.answer_type !== "choice" && !inputParses(drill.answer_type, input)) {
      const key = drill.answer_type as "numeric" | "vector" | "matrix";
      setFormatError(FORMAT_ERROR_MESSAGE[key]);
      return;
    }
    const userValue = drill.answer_type === "choice" ? selectedChoice ?? "" : input.trim();
    const r = checkAnswer(drill.answer_type, userValue, drill.answer, drill.choices) === true;
    setChecked(true);
    setResult(r);
    onResolved(r, userValue);
  }

  const difficulty = Math.min(Math.max(drill.difficulty ?? 1, 1), 2);
  const canCheck =
    drill.answer_type === "choice"
      ? selectedChoice !== null
      : drill.answer_type === "tiles"
        ? tileSelection.length > 0
        : input.trim().length > 0;

  return (
    <>
      <main className={`${MAIN_SHELL} pb-40`}>
        <div className={READING_COL}>
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-[#6E6E78]">
            <span>{indexLabel}</span>
          </div>

          <div
            className={`relative mt-2 overflow-hidden ${CARD} p-3 transition-shadow duration-150 md:mt-3 md:p-8 ${
              checked ? (result ? "ring-2 ring-emerald-400/70" : "ring-2 ring-red-400/70") : ""
            }`}
          >
            <div className={`absolute inset-x-0 top-0 h-[2px] ${SOLID_BAR[drill.lens]}`} />

            <div className="flex items-center justify-between gap-3">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide ${LENS[drill.lens].chip}`}>
                <span className={`h-1 w-1 rounded-full ${LENS[drill.lens].dot}`} />
                {LENS[drill.lens].label}
              </span>
              <span className="flex gap-0.5">
                {[0, 1].map((i) => (
                  <span key={i} className={`h-1.5 w-1.5 rounded-full ${i < difficulty ? "bg-[#1A1A24]/55" : "bg-black/15"}`} />
                ))}
              </span>
            </div>

            <Markdown className="mt-3 text-[15px] leading-relaxed text-[#1A1A24]/85 md:mt-5 md:text-[16.5px]">
              {drill.prompt_md}
            </Markdown>

            <div className={`mt-3 md:mt-6 ${ANSWER_COL}`}>
              {drill.answer_type === "numeric" && (
                <input
                  inputMode="decimal"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setFormatError(null);
                  }}
                  placeholder="fx 6 eller 2/3"
                  disabled={checked}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-3 font-mono text-[16px] text-[#1A1A24] outline-none transition-shadow placeholder:text-[#6E6E78]/60 focus:border-indigo-500/50 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]"
                />
              )}
              {drill.answer_type === "vector" && (
                <input
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setFormatError(null);
                  }}
                  placeholder="fx 1, -2, 3"
                  disabled={checked}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-3 font-mono text-[16px] text-[#1A1A24] outline-none transition-shadow placeholder:text-[#6E6E78]/60 focus:border-indigo-500/50 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]"
                />
              )}
              {drill.answer_type === "matrix" && (
                <textarea
                  rows={3}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setFormatError(null);
                  }}
                  placeholder="fx 1 2; 3 4"
                  disabled={checked}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-3 font-mono text-[16px] text-[#1A1A24] outline-none transition-shadow placeholder:text-[#6E6E78]/60 focus:border-indigo-500/50 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]"
                />
              )}
              {drill.answer_type === "choice" && drill.choices && (
                <div className={drill.choices.length === 2 ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2"}>
                  {drill.choices.map((choice) => {
                    const isSelected = selectedChoice === choice;
                    let stateClass = "border-black/10 bg-white text-[#1A1A24]/80 active:bg-black/[0.04]";
                    if (checked) {
                      const isCorrectChoice = checkAnswer("choice", choice, drill.answer, drill.choices) === true;
                      if (isCorrectChoice) stateClass = "border-emerald-500/40 bg-emerald-50 text-[#1A1A24]/90";
                      else if (isSelected) stateClass = "border-red-500/40 bg-red-50 text-[#1A1A24]/90";
                      else stateClass = "border-black/[0.06] bg-transparent text-[#6E6E78]/55";
                    } else if (isSelected) {
                      stateClass = "border-black/25 bg-black/[0.04] text-[#1A1A24]/90";
                    }
                    return (
                      <button
                        key={choice}
                        type="button"
                        disabled={checked}
                        onClick={() => setSelectedChoice(choice)}
                        className={`min-h-[44px] w-full rounded-xl border px-3 py-3 text-left text-[14px] transition-colors ${stateClass}`}
                      >
                        <Markdown className="inline">{choice}</Markdown>
                      </button>
                    );
                  })}
                </div>
              )}
              {drill.answer_type === "tiles" && (
                <TileDrill
                  tiles={drill.tiles ?? []}
                  mode={drill.mode ?? "select"}
                  answerSequence={drill.answer?.sequence}
                  selection={tileSelection}
                  onSelectionChange={setTileSelection}
                  checked={checked}
                  disabled={checked}
                />
              )}
            </div>

            {formatError && (
              <div className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] ${FEEDBACK.format}`}>
                <span className="text-[15px]">⚠</span>
                <span>{formatError}</span>
              </div>
            )}

            {checked && result !== null && (
              <div
                className={`mt-3 flex animate-[learn-step-in_.18s_ease-out] items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] ${
                  result ? FEEDBACK.correct : FEEDBACK.wrong
                }`}
              >
                <span className="text-[15px]">{result ? "✓" : "✕"}</span>
                <span>{result ? "Correct" : "Not quite"}</span>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className={DOCK_SHELL}>
        <div className={DOCK_STACK}>
          <div className="flex items-center">
            <button
              type="button"
              onClick={onSkip}
              disabled={checked}
              className="min-h-[32px] text-[12px] text-[#6E6E78] underline decoration-black/15 underline-offset-4 active:text-[#1A1A24]/70 disabled:opacity-30"
            >
              Spring over
            </button>
          </div>
          <button
            type="button"
            onClick={handleCheck}
            disabled={!canCheck || checked}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985] disabled:opacity-40"
          >
            Check
          </button>
        </div>
      </footer>
    </>
  );
}

/** One reviewed drill on the end screen — ✓/✗ glyph, given vs. correct
 * answer, an expandable `solution_md` (only shown here, never mid-round). */
function ReviewRow({ entry }: { entry: ChallengeReviewEntry }) {
  const [open, setOpen] = useState(false);
  const icon = entry.skipped ? "–" : entry.correct ? "✓" : "✕";
  const iconClass = entry.skipped
    ? "text-[#6E6E78]/60 bg-black/[0.04]"
    : entry.correct
      ? "text-emerald-700 bg-emerald-50"
      : "text-red-700 bg-red-50";
  return (
    <div className="rounded-xl border border-black/[0.06] bg-white p-3 shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-2.5 text-left">
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold ${iconClass}`}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <Markdown className="inline text-[13px] leading-snug text-[#1A1A24]/80">{entry.drill.prompt_md}</Markdown>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#6E6E78]">
            {!entry.skipped && (
              <span>
                Dit svar: <span className="text-[#1A1A24]/70">{entry.given || "–"}</span>
              </span>
            )}
            <span>
              Korrekt: <span className="text-[#1A1A24]/70">{entry.correctText || "–"}</span>
            </span>
          </div>
        </span>
        <span className={`mt-0.5 shrink-0 text-[#6E6E78]/50 transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          {entry.drill.solution_md ? (
            <div className="mt-2.5 border-t border-black/[0.06] pt-2.5">
              <Markdown className="text-[12.5px] leading-relaxed text-[#1A1A24]/75">{entry.drill.solution_md}</Markdown>
            </div>
          ) : (
            <p className="mt-2.5 border-t border-black/[0.06] pt-2.5 text-[11px] text-[#6E6E78]/60">
              Ingen løsning tilgængelig.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
