/**
 * Infinite exercises — LEARN_PLAN.md's pinned "Infinite exercises" section.
 * A shuffle-practice mode over the ported exam/book item bank (`lr_item`
 * `format='written'`, slug `la-%`, joined to a non-null
 * `lr_written_item.solution` — `api.fetchExercisePool`), separate from the
 * unit path. Fullscreen overlay, same frame/backdrop/dock language as
 * `Player.tsx`/`ReviewSession.tsx` (DESIGN.md §7/§8's `player/tokens.tsx`
 * literals), but flat: one item at a time, no stepper — prompt → "Vis
 * løsning" → feedback bar → next.
 *
 * Own file, own contract: `{ onClose: () => void }`. `InfinitePanel.tsx`
 * only renders this behind a boolean flag and does not reach into its state,
 * same relationship `ReviewPanel.tsx` has to `ReviewSession.tsx`.
 *
 * ── Shuffle ──────────────────────────────────────────────────────────────
 * One full pass ("cycle") through the pool is built at session start and on
 * every subsequent exhaustion (`buildCycle`): bucket the pool by
 * `attemptCount` ascending, Fisher–Yates shuffle *within* each bucket,
 * concatenate buckets least-attempted-first. Consuming the queue
 * sequentially means no item repeats until every item in that cycle has
 * been shown once — LEARN_PLAN.md: "prefers least-attempted, then random".
 * Grading (not skipping) an item bumps its effective attempt count for the
 * *next* cycle's bucketing (`bumpedCounts`), so a long session naturally
 * spreads across the whole pool rather than favouring whatever was
 * least-attempted at load time forever.
 *
 * ── Memory coupling ──────────────────────────────────────────────────────
 * Grading an item (difficulty + understood both set) fires three
 * independent, fire-and-forget writes on "Næste →" — matching
 * `ReviewSession.tsx`'s `handleGraded` optimistic-advance pattern, not
 * `Player.tsx`'s awaited writes:
 *   1. `api.submitItemFeedback` — the append-only `lr_item_feedback` row.
 *   2. `api.logAttempt({ itemRef: slug, lens: null, grade })` — `lens: null`
 *      because past-exam items carry no `tre-perspektiver` tag;
 *      `memory.applyGrade`'s `lens` parameter accepts `null` for exactly
 *      this (it no-ops `lens_counts` rather than requiring a fake lens).
 *   3. `applyWeightedGrade` — `memory.applyGrade` against every concept in
 *      the item's `lr_qmatrix`, weight-scaled by `normalizeConceptWeights`
 *      so one item can never out-credit a whole unit's worth of drill
 *      practice (weights capped to sum ≤ `MAX_CONCEPT_WEIGHT_SUM`).
 * Grade map (LEARN_PLAN.md, pinned): not understood → 0; understood at
 * svær/mellem/let → 1/2/3 — the same ordinal ladder `DrillCard`'s
 * Again/Hard/Good/Easy grade bar uses, so `svær` (hardest) lands on grade 1
 * ("Hard") and `let` (easiest) on grade 3 ("Easy").
 *
 * Either flag (`exercise_broken` / `solution_broken`) adds the item to this
 * session's local `excludedIds` set immediately — LEARN_PLAN.md: "excludes
 * the item from future shuffles for this user". That local set is what
 * keeps a flagged item from resurfacing on the *next* cycle within this same
 * session; the server-side exclusion (via `api.fetchExercisePool`'s
 * feedback join) is what makes it durable across future sessions.
 *
 * "Spring over" (skip) never touches feedback, attempt log or memory state —
 * it only advances the queue, per LEARN_PLAN.md: "records nothing".
 */

import { useEffect, useState } from "react";
import type { Grade } from "./types";
import {
  fetchExercisePool,
  fetchItemConcepts,
  fetchItemSolution,
  fetchMemoryStates,
  logAttempt,
  submitItemFeedback,
  upsertMemory,
  type ExercisePoolItem,
  type ItemConcept,
} from "./api";
import { applyGrade, defaultMemoryState } from "./memory";
import { Markdown } from "./Markdown";
import { CARD, DOCK_SHELL, DOCK_STACK, MAIN_SHELL, PLAYER_STYLE, READING_COL } from "./player/tokens";

/** One item's grading credit is capped so it can never out-weigh a whole
 * unit's worth of drill practice — LEARN_PLAN.md's "weighted by q-matrix
 * weight ... spreading practice credit" read together with this feature's
 * explicit normalization cap. Real q-matrix weights are raw per-concept
 * counts (sampled: 1.0 each, up to 4 concepts on one item — i.e. an
 * unnormalized sum of 4), so scaling down is the common case, not the
 * exception. */
const MAX_CONCEPT_WEIGHT_SUM = 1.5;

/** Scales weights down (never up) so their sum never exceeds the cap.
 * Non-positive/missing weights are dropped rather than treated as zero-credit
 * no-ops, so a malformed q-matrix row can't silently zero out the whole set's
 * scale factor. */
function normalizeConceptWeights(concepts: ItemConcept[]): ItemConcept[] {
  const positive = concepts.filter((c) => typeof c.weight === "number" && c.weight > 0);
  const sum = positive.reduce((s, c) => s + c.weight, 0);
  if (sum <= 0) return [];
  if (sum <= MAX_CONCEPT_WEIGHT_SUM) return positive;
  const scale = MAX_CONCEPT_WEIGHT_SUM / sum;
  return positive.map((c) => ({ ...c, weight: c.weight * scale }));
}

/** Fisher–Yates on a copy — never mutates its input. */
function shuffle<T>(items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Fewest-attempts bucket first, random within bucket — see file header. */
function buildCycle(items: ExercisePoolItem[]): ExercisePoolItem[] {
  const buckets = new Map<number, ExercisePoolItem[]>();
  for (const item of items) {
    const list = buckets.get(item.attemptCount) ?? [];
    list.push(item);
    buckets.set(item.attemptCount, list);
  }
  const counts = Array.from(buckets.keys()).sort((a, b) => a - b);
  return counts.flatMap((c) => shuffle(buckets.get(c)!));
}

interface ItemState {
  solution: string | null | undefined; // undefined = not fetched yet
  revealed: boolean;
  difficulty: 1 | 2 | 3 | null;
  understood: boolean | null;
  exerciseBroken: boolean;
  solutionBroken: boolean;
  note: string;
}

const BLANK_ITEM_STATE: ItemState = {
  solution: undefined,
  revealed: false,
  difficulty: null,
  understood: null,
  exerciseBroken: false,
  solutionBroken: false,
  note: "",
};

const DIFFICULTY_OPTIONS: Array<{ value: 1 | 2 | 3; label: string }> = [
  { value: 1, label: "Let" },
  { value: 2, label: "Mellem" },
  { value: 3, label: "Svær" },
];

export function ExerciseSession({ onClose }: { onClose: () => void }) {
  // undefined = loading, null = the pool fetch failed outright.
  const [pool, setPool] = useState<ExercisePoolItem[] | null | undefined>(undefined);
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set());
  const [bumpedCounts, setBumpedCounts] = useState<Record<number, number>>({});
  const [queue, setQueue] = useState<ExercisePoolItem[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [itemsCompleted, setItemsCompleted] = useState(0);
  const [itemState, setItemState] = useState<ItemState>(BLANK_ITEM_STATE);

  useEffect(() => {
    let alive = true;
    fetchExercisePool()
      .then((items) => {
        if (alive) setPool(items);
      })
      .catch((e) => {
        console.error("[learn] fetchExercisePool failed", e);
        if (alive) setPool(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const current = queueIndex < queue.length ? queue[queueIndex] : null;

  // Build (or rebuild) the shuffle order whenever the current one runs out —
  // covers both the initial load (queue starts empty) and every later cycle.
  useEffect(() => {
    if (!pool) return;
    if (queueIndex < queue.length) return;
    const available = pool
      .filter((p) => !excludedIds.has(p.item_id))
      .map((p) => ({ ...p, attemptCount: p.attemptCount + (bumpedCounts[p.item_id] ?? 0) }));
    if (available.length === 0) return; // renders the "no exercises left" state below
    setQueue(buildCycle(available));
    setQueueIndex(0);
    // bumpedCounts intentionally excluded: it only needs to be read at the
    // moment a *new* cycle is built, not on every increment mid-cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, excludedIds, queueIndex, queue.length]);

  // Fresh per-item state whenever the current item changes.
  useEffect(() => {
    setItemState(BLANK_ITEM_STATE);
  }, [current?.item_id]);

  const poolExhausted =
    pool !== undefined && pool !== null && pool.filter((p) => !excludedIds.has(p.item_id)).length === 0;
  const buildingQueue = !!pool && pool.length > 0 && !poolExhausted && !current;

  async function handleReveal() {
    if (!current) return;
    setItemState((s) => ({ ...s, revealed: true }));
    try {
      const solution = await fetchItemSolution(current.item_id);
      setItemState((s) => (s.solution === undefined ? { ...s, solution } : s));
    } catch (e) {
      console.error("[learn] fetchItemSolution failed", e);
      setItemState((s) => (s.solution === undefined ? { ...s, solution: null } : s));
    }
  }

  async function applyWeightedGrade(itemId: number, grade: Grade) {
    try {
      const concepts = await fetchItemConcepts(itemId);
      const normalized = normalizeConceptWeights(concepts);
      if (normalized.length === 0) return;
      const conceptIds = normalized.map((c) => c.concept_id);
      const states = await fetchMemoryStates(conceptIds);
      const now = new Date();
      await Promise.all(
        normalized.map((c) => {
          const existing = states[c.concept_id] ?? defaultMemoryState("default", c.concept_id);
          const updated = applyGrade(existing, grade, null, now, c.weight);
          return upsertMemory(updated);
        })
      );
    } catch (e) {
      console.error("[learn] applyWeightedGrade failed", e);
    }
  }

  function advance(itemId: number, graded: boolean) {
    if (graded) {
      setBumpedCounts((prev) => ({ ...prev, [itemId]: (prev[itemId] ?? 0) + 1 }));
      setItemsCompleted((n) => n + 1);
    }
    setQueueIndex((i) => i + 1);
  }

  function handleNext() {
    if (!current || itemState.difficulty === null || itemState.understood === null) return;
    const { difficulty, understood, exerciseBroken, solutionBroken, note } = itemState;
    const grade: Grade = !understood ? 0 : difficulty === 3 ? 1 : difficulty === 2 ? 2 : 3;

    submitItemFeedback({
      itemId: current.item_id,
      difficulty,
      understood,
      exerciseBroken,
      solutionBroken,
      note: note.trim() ? note.trim() : null,
    }).catch((e) => console.error("[learn] submitItemFeedback failed", e));

    logAttempt({ itemRef: current.slug, lens: null, grade }).catch((e) =>
      console.error("[learn] logAttempt failed", e)
    );

    applyWeightedGrade(current.item_id, grade);

    if (exerciseBroken || solutionBroken) {
      const itemId = current.item_id;
      setExcludedIds((prev) => {
        const next = new Set(prev);
        next.add(itemId);
        return next;
      });
    }

    advance(current.item_id, true);
  }

  function handleSkip() {
    if (!current) return;
    advance(current.item_id, false);
  }

  const canNext = itemState.difficulty !== null && itemState.understood !== null;
  const flagNoteVisible = itemState.exerciseBroken || itemState.solutionBroken;

  return (
    <div className="fixed inset-0 z-50 flex flex-col animate-[learn-overlay_.22s_ease-out] bg-[#F6F5F1]/97 backdrop-blur-xl text-[#1A1A24]">
      <style>{PLAYER_STYLE}</style>

      <header className="shrink-0 border-b border-black/[0.08] px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-8">
        <div className={READING_COL}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[#6E6E78] active:bg-black/[0.05]"
              aria-label="Close"
            >
              ✕
            </button>
            <span className="truncate text-[13px] font-medium text-[#1A1A24]/85">
              ∞ · opgave {itemsCompleted + 1}
            </span>
            {queue.length > 0 && (
              <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-[#6E6E78]">
                {Math.min(queueIndex + 1, queue.length)} / {queue.length}
              </span>
            )}
          </div>
          {queue.length > 0 && (
            <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-black/[0.07]">
              <span
                className="block h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 transition-[width] duration-500 ease-out"
                style={{ width: `${(queueIndex / queue.length) * 100}%` }}
              />
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
          <p className="text-[13px] text-[#1A1A24]/70">Couldn't load the exercise pool.</p>
          <p className="max-w-[240px] text-[11px] leading-relaxed text-[#6E6E78]/80">
            Check the connection and reopen Infinite exercises.
          </p>
        </main>
      )}

      {buildingQueue && (
        <main className="flex min-h-0 flex-1 items-center justify-center px-4">
          <p className="text-[13px] text-[#6E6E78]">Loading…</p>
        </main>
      )}

      {poolExhausted && (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-black/[0.04] text-lg text-[#6E6E78]">
            ∞
          </span>
          <p className="text-[13px] text-[#1A1A24]/70">No exercises left</p>
          <p className="max-w-[260px] text-[11px] leading-relaxed text-[#6E6E78]/80">
            Every item in the pool is either flagged or already offered this session.
            {itemsCompleted > 0 ? ` ${itemsCompleted} solved.` : ""}
          </p>
        </main>
      )}

      {current && !poolExhausted && (
        <>
          <main className={`${MAIN_SHELL} pb-72`}>
            <div className={READING_COL}>
              <div
                key={current.item_id}
                className={`relative mt-2 animate-[learn-step-in_.18s_ease-out] overflow-hidden ${CARD} p-3 md:mt-3 md:p-8`}
              >
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6E6E78]/70">
                  ∞ EXERCISE
                </span>
                <p className="mt-1 text-[11px] text-[#6E6E78]/70">
                  {[current.title, current.year, current.source_ref].filter(Boolean).join(" · ")}
                </p>

                <Markdown className="mt-2 text-[15px] leading-relaxed text-[#1A1A24]/85 md:mt-4 md:text-[16.5px]">
                  {current.prompt}
                </Markdown>

                {!itemState.revealed && (
                  <p className="mt-3 text-[11px] italic text-[#6E6E78]/70 md:mt-5">
                    Work it out on paper, then reveal the solution below.
                  </p>
                )}

                {itemState.revealed && (
                  <div className="relative mt-3 overflow-hidden rounded-xl border border-black/[0.06] bg-white p-3 pl-4 md:mt-6 md:rounded-2xl md:p-7 md:pl-9">
                    <div className="absolute inset-y-0 left-0 w-[2px] bg-gradient-to-b from-indigo-500 to-fuchsia-600" />
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6E6E78]/70">
                      SOLUTION
                    </p>
                    {itemState.solution === undefined && (
                      <p className="mt-1.5 text-[13px] text-[#6E6E78]/70">Loading…</p>
                    )}
                    {itemState.solution === null && (
                      <p className="mt-1.5 text-[13px] text-[#6E6E78]/70">No solution text on record.</p>
                    )}
                    {itemState.solution && (
                      <Markdown className="mt-1.5 text-[14px] leading-relaxed text-[#1A1A24]/80 md:mt-3 md:text-[16px]">
                        {itemState.solution}
                      </Markdown>
                    )}
                  </div>
                )}
              </div>
            </div>
          </main>

          <footer className={DOCK_SHELL}>
            <div className={DOCK_STACK}>
              {!itemState.revealed ? (
                <>
                  <div className="flex items-center gap-3 text-[12px]">
                    <button
                      type="button"
                      onClick={handleSkip}
                      className="ml-auto min-h-[32px] text-[#6E6E78] underline decoration-black/15 underline-offset-4 active:text-[#1A1A24]/70"
                    >
                      Spring over
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleReveal}
                    className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
                  >
                    Vis løsning
                  </button>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-1.5">
                    {DIFFICULTY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setItemState((s) => ({ ...s, difficulty: opt.value }))}
                        className={`min-h-[40px] rounded-xl text-[12px] font-medium transition-colors ${
                          itemState.difficulty === opt.value
                            ? "bg-black/[0.06] text-[#1A1A24]/90 ring-1 ring-black/20"
                            : "bg-white text-[#1A1A24]/70 ring-1 ring-black/10 active:bg-black/[0.04]"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setItemState((s) => ({ ...s, understood: true }))}
                      className={`min-h-[40px] rounded-xl text-[12px] font-medium transition-colors ${
                        itemState.understood === true
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500/30"
                          : "bg-white text-[#1A1A24]/70 ring-1 ring-black/10 active:bg-black/[0.04]"
                      }`}
                    >
                      Forstod det
                    </button>
                    <button
                      type="button"
                      onClick={() => setItemState((s) => ({ ...s, understood: false }))}
                      className={`min-h-[40px] rounded-xl text-[12px] font-medium transition-colors ${
                        itemState.understood === false
                          ? "bg-black/[0.06] text-[#1A1A24]/90 ring-1 ring-black/20"
                          : "bg-white text-[#1A1A24]/70 ring-1 ring-black/10 active:bg-black/[0.04]"
                      }`}
                    >
                      Forstod det ikke
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setItemState((s) => ({ ...s, exerciseBroken: !s.exerciseBroken }))}
                      className={`min-h-[32px] rounded-lg px-2.5 text-[11px] font-medium ring-1 transition-colors ${
                        itemState.exerciseBroken
                          ? "bg-amber-50 text-amber-700 ring-amber-500/30"
                          : "bg-transparent text-[#6E6E78] ring-black/10 active:bg-black/[0.04]"
                      }`}
                    >
                      Opgaven er i stykker
                    </button>
                    <button
                      type="button"
                      onClick={() => setItemState((s) => ({ ...s, solutionBroken: !s.solutionBroken }))}
                      className={`min-h-[32px] rounded-lg px-2.5 text-[11px] font-medium ring-1 transition-colors ${
                        itemState.solutionBroken
                          ? "bg-amber-50 text-amber-700 ring-amber-500/30"
                          : "bg-transparent text-[#6E6E78] ring-black/10 active:bg-black/[0.04]"
                      }`}
                    >
                      Løsningen er uklar
                    </button>
                  </div>

                  {flagNoteVisible && (
                    <textarea
                      rows={2}
                      value={itemState.note}
                      onChange={(e) => setItemState((s) => ({ ...s, note: e.target.value }))}
                      placeholder="Valgfri note til den flaggede opgave…"
                      className="w-full animate-[learn-step-in_.18s_ease-out] rounded-xl border border-black/15 bg-white px-3 py-2 text-[13px] text-[#1A1A24] outline-none transition-shadow placeholder:text-[#6E6E78]/60 focus:border-indigo-500/50 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]"
                    />
                  )}

                  <div className="flex items-center gap-3 text-[12px]">
                    <button
                      type="button"
                      onClick={handleSkip}
                      className="ml-auto min-h-[32px] text-[#6E6E78] underline decoration-black/15 underline-offset-4 active:text-[#1A1A24]/70"
                    >
                      Spring over
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleNext}
                    disabled={!canNext}
                    className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985] disabled:opacity-40"
                  >
                    Næste →
                  </button>
                </>
              )}
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
