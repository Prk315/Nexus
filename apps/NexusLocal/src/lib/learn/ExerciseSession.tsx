/**
 * Infinite exercises — LEARN_PLAN.md's pinned "Infinite exercises" section,
 * rebuilt on top of `lr_item_render` (migration
 * `20260810190000_learn_item_render.sql`). A shuffle-practice mode over the
 * ported exam/book item bank (`lr_item` `format='written'`, slug `la-%`,
 * joined to a non-null `lr_written_item.solution` — `api.fetchExercisePool`),
 * separate from the unit path. Fullscreen overlay, same frame/backdrop/dock
 * language as `Player.tsx`/`ReviewSession.tsx` (DESIGN.md §7/§8's
 * `player/tokens.tsx` literals).
 *
 * ── One screen per problem, not per item ────────────────────────────────
 * `api.fetchExercisePool` already groups the raw item rows into
 * `ProblemGroup[]` via `lr_item_render.group_key` (fallback rows — no
 * enrichment yet — group as their own singleton). This file shuffles over
 * *groups*: one screen shows the shared source header, the group's
 * `intro_md` (recessed treatment, `TheoryCards.tsx`'s lens-note card
 * material — DESIGN.md §8.5), then one white card per sub-part with its own
 * independent "Vis løsning" reveal and compact feedback bar, and finally the
 * group's `context_md` as a quiet ↳-note aside. "Næste problem →" advances
 * the whole group once every part has been graded or skipped.
 *
 * ── Shuffle ──────────────────────────────────────────────────────────────
 * One full pass ("cycle") through the pool is built at session start and on
 * every subsequent exhaustion (`buildCycle`): bucket the pool by
 * `attemptCount` ascending (a group's `attemptCount` is the *min* across its
 * parts — LEARN_PLAN.md's "least-attempted" read at the problem level),
 * Fisher–Yates shuffle *within* each bucket, concatenate buckets
 * least-attempted-first. Consuming the queue sequentially means no group
 * repeats until every group in that cycle has been shown once. Grading (not
 * skipping) at least one part of a group bumps that group's effective
 * attempt count for the *next* cycle's bucketing (`bumpedCounts`, keyed by
 * `group_key`), so a long session naturally spreads across the whole pool
 * rather than favouring whatever was least-attempted at load time forever.
 *
 * ── Memory coupling ──────────────────────────────────────────────────────
 * Saving one part's feedback (difficulty + understood both set) fires three
 * independent, fire-and-forget writes on "Gem" — matching
 * `ReviewSession.tsx`'s `handleGraded` optimistic-advance pattern, not
 * `Player.tsx`'s awaited writes, and identical per-part to the pre-grouping
 * flow:
 *   1. `api.submitItemFeedback` — the append-only `lr_item_feedback` row.
 *   2. `api.logAttempt({ itemRef: slug, lens: null, grade })` — `lens: null`
 *      because past-exam items carry no `tre-perspektiver` tag.
 *   3. `applyWeightedGrade` — `memory.applyGrade` against every concept in
 *      that item's `lr_qmatrix`, weight-scaled by `normalizeConceptWeights`
 *      so one part can never out-credit a whole unit's worth of drill
 *      practice (weights capped to sum ≤ `MAX_CONCEPT_WEIGHT_SUM`).
 * Grade map (LEARN_PLAN.md, pinned): not understood → 0; understood at
 * svær/mellem/let → 1/2/3 — the same ordinal ladder `DrillCard`'s
 * Again/Hard/Good/Easy grade bar uses, so `svær` (hardest) lands on grade 1
 * ("Hard") and `let` (easiest) on grade 3 ("Easy").
 *
 * Either flag (`exercise_broken` / `solution_broken`) on a part adds *that
 * item* to this session's local `excludedIds` set immediately —
 * LEARN_PLAN.md: "excludes the item from future shuffles for this user".
 * A group with some (not all) parts excluded keeps showing its remaining
 * parts on the next cycle; a group whose every part is excluded drops out
 * entirely. That local set is what keeps a flagged item from resurfacing on
 * the *next* cycle within this same session; the server-side exclusion (via
 * `api.fetchExercisePool`'s feedback join) is what makes it durable across
 * future sessions.
 *
 * "Spring over" (skip) on a part never touches feedback, attempt log or
 * memory state — it only marks that part done for the purposes of unlocking
 * "Næste problem →", per LEARN_PLAN.md: "records nothing".
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
  type ItemConcept,
  type ProblemGroup,
  type ProblemPart,
} from "./api";
import { applyGrade, defaultMemoryState } from "./memory";
import { Markdown } from "./Markdown";
import { useCourse } from "./CourseContext";
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
function buildCycle(groups: ProblemGroup[]): ProblemGroup[] {
  const buckets = new Map<number, ProblemGroup[]>();
  for (const group of groups) {
    const list = buckets.get(group.attemptCount) ?? [];
    list.push(group);
    buckets.set(group.attemptCount, list);
  }
  const counts = Array.from(buckets.keys()).sort((a, b) => a - b);
  return counts.flatMap((c) => shuffle(buckets.get(c)!));
}

/** Drops excluded parts from every group and drops any group left with none. */
function availableGroups(pool: ProblemGroup[], excludedIds: Set<number>): ProblemGroup[] {
  return pool
    .map((g) => ({ ...g, parts: g.parts.filter((p) => !excludedIds.has(p.item_id)) }))
    .filter((g) => g.parts.length > 0);
}

/**
 * "LinAlgDat 2024 Opgave 1 (a)" / "LinAlg bog Opgave 0.2 (a)" → "LinAlgDat ·
 * Opgave 1 · 2024" / "LinAlg bog · Opgave 0.2" — a clean source line derived
 * from `lr_item.title`, without the per-part "(a)" suffix (the part is
 * already its own chip on the part card) or the duplicate `LA
 * eksamen2024/book …` shape `source_ref` carries. Falls back to a plain
 * join of whatever fields exist when the title doesn't match the "… Opgave
 * N …" shape the ported book/exam data uses.
 */
function deriveSourceLabel(source: { title: string | null; year: number | null; source_ref: string | null }): string {
  const title = (source.title ?? "").trim();
  const stripped = title.replace(/\s*\([a-zA-Z]\)\s*$/, "").trim();
  const m = stripped.match(/^(.+?)\s+Opgave\s+([\d.]+)$/i);
  if (m) {
    const course = m[1].replace(/\s+\d{4}$/, "").trim();
    const parts = [course, `Opgave ${m[2]}`];
    if (source.year) parts.push(String(source.year));
    return parts.join(" · ");
  }
  return [stripped || null, source.year, source.source_ref].filter(Boolean).join(" · ");
}

type PartStatus = "pending" | "graded" | "skipped";

interface PartState {
  solution: string | null | undefined; // undefined = not fetched yet
  revealed: boolean;
  difficulty: 1 | 2 | 3 | null;
  understood: boolean | null;
  exerciseBroken: boolean;
  solutionBroken: boolean;
  note: string;
  status: PartStatus;
}

const BLANK_PART_STATE: PartState = {
  solution: undefined,
  revealed: false,
  difficulty: null,
  understood: null,
  exerciseBroken: false,
  solutionBroken: false,
  note: "",
  status: "pending",
};

const DIFFICULTY_OPTIONS: Array<{ value: 1 | 2 | 3; label: string }> = [
  { value: 1, label: "Let" },
  { value: 2, label: "Mellem" },
  { value: 3, label: "Svær" },
];

/** One sub-part's card: task, its own reveal, its own compact feedback bar. */
function ProblemPartCard({
  part,
  state,
  onReveal,
  onSkip,
  onFieldChange,
  onSave,
}: {
  part: ProblemPart;
  state: PartState;
  onReveal: () => void;
  onSkip: () => void;
  onFieldChange: (patch: Partial<PartState>) => void;
  onSave: () => void;
}) {
  const canSave = state.difficulty !== null && state.understood !== null;
  const flagNoteVisible = state.exerciseBroken || state.solutionBroken;
  const showHeaderRow = !!part.part_label || state.status === "pending";

  return (
    <div className={`relative overflow-hidden ${CARD} p-3 md:p-6`}>
      {showHeaderRow && (
        <div className="flex items-center justify-between gap-2">
          <span>
            {part.part_label && (
              <span className="inline-flex items-center justify-center rounded-full bg-black/[0.05] px-2.5 py-0.5 text-[11px] font-semibold text-[#1A1A24]/75">
                {part.part_label}
              </span>
            )}
          </span>
          {state.status === "pending" && (
            <button
              type="button"
              onClick={onSkip}
              className="min-h-[28px] shrink-0 text-[11px] text-[#6E6E78] underline decoration-black/15 underline-offset-4 active:text-[#1A1A24]/70"
            >
              Spring over
            </button>
          )}
        </div>
      )}

      <Markdown
        className={`${showHeaderRow ? "mt-2" : ""} text-[15px] leading-relaxed text-[#1A1A24]/85 md:text-[16.5px]`}
      >
        {part.task_md}
      </Markdown>

      {state.status === "skipped" && <p className="mt-3 text-[11px] italic text-[#6E6E78]/60">Sprunget over.</p>}

      {state.status === "graded" && (
        <p className="mt-3 text-[11px] text-emerald-700/80">
          ✓ Gemt
          {state.difficulty !== null
            ? ` · ${DIFFICULTY_OPTIONS.find((o) => o.value === state.difficulty)?.label}`
            : ""}
          {state.understood === false ? " · Forstod det ikke" : ""}
        </p>
      )}

      {state.status === "pending" && !state.revealed && (
        <button
          type="button"
          onClick={onReveal}
          className="mt-3 rounded-lg bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-3.5 py-2.5 text-[13px] font-semibold text-white transition-transform active:scale-[0.97]"
        >
          Vis løsning
        </button>
      )}

      {state.status === "pending" && state.revealed && (
        <>
          <div className="relative mt-3 overflow-hidden rounded-xl border border-black/[0.06] bg-white p-3 pl-4 md:mt-5 md:rounded-2xl md:p-5 md:pl-7">
            <div className="absolute inset-y-0 left-0 w-[2px] bg-gradient-to-b from-indigo-500 to-fuchsia-600" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6E6E78]/70">SOLUTION</p>
            {state.solution === undefined && <p className="mt-1.5 text-[13px] text-[#6E6E78]/70">Loading…</p>}
            {state.solution === null && (
              <p className="mt-1.5 text-[13px] text-[#6E6E78]/70">No solution text on record.</p>
            )}
            {state.solution && (
              <Markdown className="mt-1.5 text-[14px] leading-relaxed text-[#1A1A24]/80 md:mt-2.5 md:text-[15px]">
                {state.solution}
              </Markdown>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 md:mt-4">
            {DIFFICULTY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onFieldChange({ difficulty: opt.value })}
                className={`min-h-[32px] rounded-lg px-2.5 text-[11px] font-medium transition-colors ${
                  state.difficulty === opt.value
                    ? "bg-black/[0.06] text-[#1A1A24]/90 ring-1 ring-black/20"
                    : "bg-white text-[#1A1A24]/70 ring-1 ring-black/10 active:bg-black/[0.04]"
                }`}
              >
                {opt.label}
              </button>
            ))}
            <span className="mx-0.5 h-4 w-px shrink-0 bg-black/10" />
            <button
              type="button"
              onClick={() => onFieldChange({ understood: true })}
              className={`min-h-[32px] rounded-lg px-2.5 text-[11px] font-medium transition-colors ${
                state.understood === true
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500/30"
                  : "bg-white text-[#1A1A24]/70 ring-1 ring-black/10 active:bg-black/[0.04]"
              }`}
            >
              Forstod
            </button>
            <button
              type="button"
              onClick={() => onFieldChange({ understood: false })}
              className={`min-h-[32px] rounded-lg px-2.5 text-[11px] font-medium transition-colors ${
                state.understood === false
                  ? "bg-black/[0.06] text-[#1A1A24]/90 ring-1 ring-black/20"
                  : "bg-white text-[#1A1A24]/70 ring-1 ring-black/10 active:bg-black/[0.04]"
              }`}
            >
              Forstod ikke
            </button>
            <button
              type="button"
              onClick={() => onFieldChange({ exerciseBroken: !state.exerciseBroken })}
              className={`min-h-[32px] rounded-lg px-2 text-[11px] font-medium ring-1 transition-colors ${
                state.exerciseBroken
                  ? "bg-amber-50 text-amber-700 ring-amber-500/30"
                  : "bg-transparent text-[#6E6E78] ring-black/10 active:bg-black/[0.04]"
              }`}
              title="Opgaven er i stykker"
            >
              ⚑ opgave
            </button>
            <button
              type="button"
              onClick={() => onFieldChange({ solutionBroken: !state.solutionBroken })}
              className={`min-h-[32px] rounded-lg px-2 text-[11px] font-medium ring-1 transition-colors ${
                state.solutionBroken
                  ? "bg-amber-50 text-amber-700 ring-amber-500/30"
                  : "bg-transparent text-[#6E6E78] ring-black/10 active:bg-black/[0.04]"
              }`}
              title="Løsningen er uklar"
            >
              ⚑ løsning
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave}
              className="ml-auto min-h-[32px] rounded-lg bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-3.5 text-[12px] font-semibold text-white transition-transform active:scale-[0.97] disabled:opacity-40"
            >
              Gem
            </button>
          </div>

          {flagNoteVisible && (
            <textarea
              rows={2}
              value={state.note}
              onChange={(e) => onFieldChange({ note: e.target.value })}
              placeholder="Valgfri note til den flaggede opgave…"
              className="mt-2 w-full animate-[learn-step-in_.18s_ease-out] rounded-xl border border-black/15 bg-white px-3 py-2 text-[13px] text-[#1A1A24] outline-none transition-shadow placeholder:text-[#6E6E78]/60 focus:border-indigo-500/50 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]"
            />
          )}
        </>
      )}
    </div>
  );
}

export function ExerciseSession({ onClose }: { onClose: () => void }) {
  const { course } = useCourse();
  // undefined = loading, null = the pool fetch failed outright.
  const [pool, setPool] = useState<ProblemGroup[] | null | undefined>(undefined);
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set());
  const [bumpedCounts, setBumpedCounts] = useState<Record<string, number>>({});
  const [queue, setQueue] = useState<ProblemGroup[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [problemsCompleted, setProblemsCompleted] = useState(0);
  const [partStates, setPartStates] = useState<Record<number, PartState>>({});

  useEffect(() => {
    let alive = true;
    fetchExercisePool(course.itemSlugPrefix)
      .then((groups) => {
        if (alive) setPool(groups);
      })
      .catch((e) => {
        console.error("[learn] fetchExercisePool failed", e);
        if (alive) setPool(null);
      });
    return () => {
      alive = false;
    };
  }, [course.itemSlugPrefix]);

  const current = queueIndex < queue.length ? queue[queueIndex] : null;

  // Build (or rebuild) the shuffle order whenever the current one runs out —
  // covers both the initial load (queue starts empty) and every later cycle.
  useEffect(() => {
    if (!pool) return;
    if (queueIndex < queue.length) return;
    const available = availableGroups(pool, excludedIds).map((g) => ({
      ...g,
      attemptCount: g.attemptCount + (bumpedCounts[g.group_key] ?? 0),
    }));
    if (available.length === 0) return; // renders the "no exercises left" state below
    setQueue(buildCycle(available));
    setQueueIndex(0);
    // bumpedCounts intentionally excluded: it only needs to be read at the
    // moment a *new* cycle is built, not on every increment mid-cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, excludedIds, queueIndex, queue.length]);

  // Fresh per-part state whenever the current group changes.
  useEffect(() => {
    setPartStates({});
  }, [queueIndex, current?.group_key]);

  const poolExhausted = pool !== undefined && pool !== null && availableGroups(pool, excludedIds).length === 0;
  const buildingQueue = !!pool && pool.length > 0 && !poolExhausted && !current;

  function stateFor(itemId: number): PartState {
    return partStates[itemId] ?? BLANK_PART_STATE;
  }

  function handleRevealPart(part: ProblemPart) {
    setPartStates((prev) => ({
      ...prev,
      [part.item_id]: { ...(prev[part.item_id] ?? BLANK_PART_STATE), revealed: true, solution: part.solution_md },
    }));
    if (part.solution_md) return; // already have it — enrichment-provided
    fetchItemSolution(part.item_id)
      .then((solution) => {
        setPartStates((prev) => {
          const existing = prev[part.item_id];
          if (!existing || existing.solution !== undefined) return prev;
          return { ...prev, [part.item_id]: { ...existing, solution } };
        });
      })
      .catch((e) => {
        console.error("[learn] fetchItemSolution failed", e);
        setPartStates((prev) => {
          const existing = prev[part.item_id];
          if (!existing || existing.solution !== undefined) return prev;
          return { ...prev, [part.item_id]: { ...existing, solution: null } };
        });
      });
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

  function handleSkipPart(part: ProblemPart) {
    setPartStates((prev) => ({ ...prev, [part.item_id]: { ...(prev[part.item_id] ?? BLANK_PART_STATE), status: "skipped" } }));
  }

  function handleSavePart(part: ProblemPart) {
    const state = stateFor(part.item_id);
    if (state.difficulty === null || state.understood === null) return;
    const { difficulty, understood, exerciseBroken, solutionBroken, note } = state;
    const grade: Grade = !understood ? 0 : difficulty === 3 ? 1 : difficulty === 2 ? 2 : 3;

    submitItemFeedback({
      itemId: part.item_id,
      difficulty,
      understood,
      exerciseBroken,
      solutionBroken,
      note: note.trim() ? note.trim() : null,
    }).catch((e) => console.error("[learn] submitItemFeedback failed", e));

    logAttempt({ itemRef: part.slug, lens: null, grade }).catch((e) =>
      console.error("[learn] logAttempt failed", e)
    );

    applyWeightedGrade(part.item_id, grade);

    if (exerciseBroken || solutionBroken) {
      const itemId = part.item_id;
      setExcludedIds((prev) => {
        const next = new Set(prev);
        next.add(itemId);
        return next;
      });
    }

    setPartStates((prev) => ({ ...prev, [part.item_id]: { ...prev[part.item_id], status: "graded" } }));
  }

  const allPartsDone = !!current && current.parts.every((p) => stateFor(p.item_id).status !== "pending");

  function handleNextProblem() {
    if (!current || !allPartsDone) return;
    const graded = current.parts.some((p) => stateFor(p.item_id).status === "graded");
    if (graded) {
      setBumpedCounts((prev) => ({ ...prev, [current.group_key]: (prev[current.group_key] ?? 0) + 1 }));
      setProblemsCompleted((n) => n + 1);
    }
    setQueueIndex((i) => i + 1);
  }

  const sourceLabel = current ? deriveSourceLabel(current.source) : "";

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
              {queue.length > 0
                ? `∞ · problem ${Math.min(queueIndex + 1, queue.length)} / ${queue.length}`
                : "∞ Infinite exercises"}
            </span>
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
            {problemsCompleted > 0 ? ` ${problemsCompleted} solved.` : ""}
          </p>
        </main>
      )}

      {current && !poolExhausted && (
        <>
          <main className={`${MAIN_SHELL} pb-32`}>
            <div className={READING_COL}>
              <div key={current.group_key} className="mt-2 animate-[learn-step-in_.18s_ease-out] md:mt-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6E6E78]/70">
                  ∞ EXERCISE
                </span>
                <p className="mt-1 text-[13px] text-[#1A1A24]/70 md:text-[14px]">{sourceLabel}</p>

                {current.intro_md && (
                  <div className="relative mt-3 overflow-hidden rounded-xl border border-black/[0.05] bg-black/[0.025] p-3 md:mt-5 md:rounded-2xl md:p-7">
                    <Markdown className="text-[14px] leading-relaxed text-[#1A1A24]/75 md:text-[15.5px]">
                      {current.intro_md}
                    </Markdown>
                  </div>
                )}

                <div className="mt-3 flex flex-col gap-3 md:mt-6 md:gap-5">
                  {current.parts.map((part) => (
                    <ProblemPartCard
                      key={part.item_id}
                      part={part}
                      state={stateFor(part.item_id)}
                      onReveal={() => handleRevealPart(part)}
                      onSkip={() => handleSkipPart(part)}
                      onFieldChange={(patch) =>
                        setPartStates((prev) => ({
                          ...prev,
                          [part.item_id]: { ...(prev[part.item_id] ?? BLANK_PART_STATE), ...patch },
                        }))
                      }
                      onSave={() => handleSavePart(part)}
                    />
                  ))}
                </div>

                {current.context_md && (
                  <div className="mt-4 flex gap-1.5 text-[12px] italic leading-relaxed text-[#6E6E78]/80 md:mt-6">
                    <span className="not-italic text-[#6E6E78]/50">↳</span>
                    <Markdown className="flex-1 text-[12px] leading-relaxed md:text-[13.5px]">
                      {current.context_md}
                    </Markdown>
                  </div>
                )}
              </div>
            </div>
          </main>

          <footer className={DOCK_SHELL}>
            <div className={DOCK_STACK}>
              <button
                type="button"
                onClick={handleNextProblem}
                disabled={!allPartsDone}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985] disabled:opacity-40"
              >
                Næste problem →
              </button>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
