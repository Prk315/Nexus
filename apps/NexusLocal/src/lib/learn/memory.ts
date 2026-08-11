/**
 * TS port of the memory model in
 * `/Users/bastianthomsen/Repositories/LearnAndRetain/pipeline/memory/memory.py`
 * and the graduation seeding in
 * `/Users/bastianthomsen/Repositories/LearnAndRetain/pipeline/modules/progress.py`.
 * Constants and formulas below are copied from those files line-for-line
 * (cited per constant); this file is client-side so the learner gets instant
 * grading feedback, while decay itself stays server-side (Phase 3,
 * `learn-evaluate`) — the module comment in memory.py's docstring:
 * "heat — ACT-R retrievability proxy, decays exponentially with time.
 *  Spikes on every attempt regardless of correctness. value — Beta(alpha,
 *  beta) distribution tracking mastery. alpha increments on correct, beta on
 *  incorrect. Never decays."
 *
 * ── Grade (0–3) vs. Python's binary correct/incorrect ──────────────────────
 * `memory.py`'s `log_attempt(user_id, concept_id, correct)` (lines 172–229)
 * only ever takes a boolean `correct` — there is no grade-weighted alpha/beta
 * increment or spike-scaling-by-grade anywhere in the Python source (checked:
 * `grep -rn grade pipeline/` turns up nothing that varies the update amount).
 * `lr_attempt_log.grade` (0 don't-know | 1 hard | 2 normal | 3 easy) is a
 * Nexus Local UI convenience for richer self-report, not a Python concept.
 * This port is faithful to the *binary* update by mapping:
 *   grade 0 (don't know)         -> correct = false
 *   grade 1, 2, 3 (hard/normal/easy) -> correct = true
 * exactly reproducing `log_attempt`'s alpha += 1 / beta += 1 (never a
 * fraction) and its unconditional heat spike ("regardless of correctness").
 * If per-grade weighting is wanted later, it does not exist upstream to port
 * — it would be a new invention, which LEARN_PLAN.md explicitly says not to do
 * without reading the Python first.
 */

import type { Grade, Lens, LensCounts, LrMemoryState } from "./types";

// ── Tuning constants — memory.py lines 34–40 ────────────────────────────────
export const HALF_LIFE_HOURS = 24.0;
export const DECAY_K = Math.log(2) / HALF_LIFE_HOURS; // memory.py:35
export const SPIKE_FACTOR = 0.6; // memory.py:36

// ── Bootstrap defaults — memory.py bootstrap_memory(), lines 144–148 ───────
export const DEFAULT_ALPHA = 1.0;
export const DEFAULT_BETA = 1.0;
export const DEFAULT_HEAT = 0.0;

// ── Stability thresholds — selector.py lines 38–40 ──────────────────────────
// Used by selector.py's `_prereq_stable` (a prereq concept is "stable" once
// its value_mean clears PREREQ_THRESHOLD with at least MIN_EVIDENCE attempts
// behind it) and `_score_concept`'s evidence_factor, which ramps from 0 at
// confidence<=2 to 1 at confidence>=EVIDENCE_CAP.
export const PREREQ_THRESHOLD = 0.6; // selector.py:38 — "stable" value_mean floor
export const MIN_EVIDENCE = 4; // selector.py:39 — "stable" value_confidence floor
export const EVIDENCE_CAP = 8; // selector.py:41 — confidence for full retention weight

// ── Graduation heat seeding — progress.py line 13, graduate_unit() ─────────
// "a just-learned concept starts hot, then decays in retention"
export const FRESH_HEAT = 1.0; // progress.py:13 FRESH_HEAT

// ── Blame propagation — memory.py lines 38–39, 337–388 ──────────────────────
// `_propagate_to_dag_neighbors(user_id, concept_id, correct, weight=1.0)`
// (memory.py:337–388) is the gated blame/Markov-blanket implementation:
// on FAILURE only, walk the graded concept's DIRECT prereqs (one hop —
// `concept_prereq.select("prereq_id").eq("concept_id", concept_id)`,
// memory.py:366–368) and nudge each weak one's `value_beta` up a fraction,
// "if a student fails on a concept and its prereqs are weak, the failure is
// partly evidence about the prereq" (memory.py:349–351). Constants ported
// verbatim:
//   MAX_CREDIT_PER_ATTEMPT = 1.0   (memory.py:38 — cap per-concept credit
//                                    from one attempt; reused here as the
//                                    blame cap per memory.py:383)
//   BLAME_FRACTION         = 0.3   (memory.py:39 — fractional beta increment
//                                    for weak prereqs)
// The Python gate itself (memory.py:376, `if value_mean >= 0.6: continue`)
// checks ONLY `value_mean` — it does not consult `value_confidence`/
// `MIN_EVIDENCE` the way `_prereq_stable` (selector.py:55–58) does for DAG
// eligibility. That is a different, stricter gate used for study-session
// scheduling (see `isStable` above); blame's own local check is looser and
// is ported here unchanged as `weak = valueMean(...) < PREREQ_THRESHOLD`
// (no confidence floor), matching `_propagate_to_dag_neighbors` literally.
//
// Exact steps ported (memory.py:369–388), read per-prereq:
//   1. value_mean = alpha / (alpha + beta)
//   2. if value_mean >= 0.6 (PREREQ_THRESHOLD): skip — only weak prereqs
//      are blamed.
//   3. blame = min(BLAME_FRACTION * weight, MAX_CREDIT_PER_ATTEMPT)
//   4. new_beta = beta + blame
//   5. persist: value_beta, last_decayed = now (heat/alpha/last_reviewed
//      are untouched — memory.py writes only these two fields, lines
//      384–386).
//
// This port's `correct` gate is the LEARN_PLAN.md "DAG-v2 review brain"
// extension for the 0–3 grade scale (memory.py's own `correct` is a plain
// boolean): blame fires on grade 0 (don't know) OR grade 1 (hard) — never
// grade 2/3 — where the Python source, being binary, would only ever see
// `correct=False` for grade 0. Widening to include grade 1 is a deliberate,
// pinned product decision (LEARN_PLAN.md §"DAG-v2 review brain", item 3:
// "on grade 0/1 ... never on grades 2/3"), not a Python-source constant.
export const MAX_CREDIT_PER_ATTEMPT = 1.0; // memory.py:38
export const BLAME_FRACTION = 0.3; // memory.py:39

/**
 * Pure port of `_propagate_to_dag_neighbors`'s per-prereq computation
 * (memory.py:337–388, see header block above for the full citation).
 * `prereqStates` are the graded concept(s)' DIRECT prerequisites' current
 * memory states (one hop — callers must not pass prereqs-of-prereqs; see
 * `api.fetchDirectPrereqs`). `weight` is the triggering grading update's own
 * weight (1.0 for a normal Player/Review grade, `CHALLENGE_WEIGHT` for
 * Lynudfordring, a q-matrix weight for Infinite exercises) — blame composes
 * multiplicatively with it: `BLAME_FRACTION * weight`, exactly like a
 * half-weight item attempt scales `log_item_attempt`'s update in the Python
 * source (memory.py:264–275).
 *
 * Returns only the prereq states that were actually blamed (weak ones,
 * `value_beta` bumped, `last_decayed` restamped) — unweak prereqs and
 * anything filtered by the grade gate are simply absent from the result, so
 * callers can upsert the return value directly with no further filtering.
 */
export function applyBlame(
  prereqStates: LrMemoryState[],
  grade: Grade,
  weight: number = 1.0,
  now: Date = new Date()
): LrMemoryState[] {
  // memory.py:377 `if correct or not DAG_BLAME_ENABLED: return` — ported as
  // "fires only on grade 0/1" (see header comment on the correct↔grade gap).
  if (grade !== 0 && grade !== 1) return [];

  const nowIso = now.toISOString();
  const blame = Math.min(BLAME_FRACTION * weight, MAX_CREDIT_PER_ATTEMPT); // memory.py:381–383

  const blamed: LrMemoryState[] = [];
  for (const state of prereqStates) {
    const mean = valueMean(state.value_alpha, state.value_beta);
    if (mean >= PREREQ_THRESHOLD) continue; // memory.py:376 — "Only blame weak prereqs"
    blamed.push({
      ...state,
      value_beta: state.value_beta + blame, // memory.py:378
      last_decayed: nowIso, // memory.py:386 — note: NOT last_reviewed, NOT heat
    });
  }
  return blamed;
}

/** Bootstrap defaults for a concept never seen before (memory.py bootstrap_memory). */
export function defaultMemoryState(
  userId: string,
  conceptId: string,
  nowIso: string = new Date().toISOString()
): LrMemoryState {
  return {
    user_id: userId,
    concept_id: conceptId,
    value_alpha: DEFAULT_ALPHA,
    value_beta: DEFAULT_BETA,
    heat: DEFAULT_HEAT,
    lens_counts: {},
    last_reviewed: nowIso,
    last_decayed: nowIso,
  };
}

/** Hours between an ISO timestamp and `now` (memory.py `_hours_since`). */
function hoursSince(lastIso: string, now: Date): number {
  const then = new Date(lastIso).getTime();
  return (now.getTime() - then) / (1000 * 60 * 60);
}

/**
 * Lazy exponential decay: `heat *= exp(-k * hours)` (memory.py `_decay_heat`,
 * lines 99–104). Read-only — mirrors `get_state()`'s "decayed to current time
 * but NOT persisted" behavior; callers decide whether to persist.
 */
export function decayHeat(heat: number, lastDecayedIso: string, now: Date = new Date()): number {
  const hours = hoursSince(lastDecayedIso, now);
  if (hours <= 0) return heat;
  return heat * Math.exp(-DECAY_K * hours);
}

export function valueMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

export function valueConfidence(alpha: number, beta: number): number {
  return alpha + beta;
}

/**
 * A concept is "stable" once it clears both the value-mean and evidence
 * floors used by selector.py's `_prereq_stable` to gate DAG eligibility.
 */
export function isStable(state: Pick<LrMemoryState, "value_alpha" | "value_beta">): boolean {
  const mean = valueMean(state.value_alpha, state.value_beta);
  const confidence = valueConfidence(state.value_alpha, state.value_beta);
  return mean >= PREREQ_THRESHOLD && confidence >= MIN_EVIDENCE;
}

function incrementLensCount(counts: LensCounts, lens: Lens | null): LensCounts {
  if (lens === null) return counts;
  return { ...counts, [lens]: (counts[lens] ?? 0) + 1 };
}

/**
 * Faithful port of `log_attempt` (memory.py lines 172–229), extended with
 * `lens_counts` increment (LEARN_PLAN.md's lens-coverage mastery dimension,
 * not present upstream — Python has no lens concept) and an optional
 * `weight` (Infinite-exercises addition, LEARN_PLAN.md's "Infinite
 * exercises" section: "applies the α/β/heat update to the item's
 * `lr_qmatrix` concepts, weighted by q-matrix weight — its documented
 * purpose: spreading practice credit"). Like `lens_counts`, this is not a
 * Python source concept — `log_attempt` always adds a flat 1.0. `weight`
 * defaults to `1.0`, which reproduces the original unweighted update
 * exactly; callers crediting several concepts off one item (Infinite
 * exercises) pass each concept's own (normalized) q-matrix weight instead.
 *
 * Steps, matching the source 1:1:
 *   1. Lazy-decay heat from `last_decayed` to `now`.
 *   2. Spike heat unconditionally: `heat += (1 - heat) * SPIKE_FACTOR *
 *      weight`, capped at 1.0 (memory.py:200–202 scaled by `weight`).
 *   3. Beta update: correct -> alpha += weight; incorrect -> beta += weight
 *      (memory.py:205–206 scaled by `weight`) — see the grade-mapping note
 *      in the file header.
 *   4. Stamp `last_reviewed` / `last_decayed` to `now`.
 *   5. Increment `lens_counts[lens]` (Nexus Local addition) — a `null` lens
 *      (Infinite exercises' past-exam items carry no `tre-perspektiver` tag)
 *      leaves `lens_counts` untouched; `incrementLensCount` already no-ops
 *      on `null`, this signature just exposes that instead of hiding it.
 *
 * Pure — returns the next state; the caller persists via `api.upsertMemory`.
 */
export function applyGrade(
  state: LrMemoryState,
  grade: Grade,
  lens: Lens | null,
  now: Date = new Date(),
  weight: number = 1.0
): LrMemoryState {
  const nowIso = now.toISOString();
  const correct = grade > 0; // grade 0 = don't know; 1–3 = correct (see header)

  const decayedHeat = decayHeat(state.heat, state.last_decayed, now);
  const spikedHeat = Math.min(decayedHeat + (1.0 - decayedHeat) * SPIKE_FACTOR * weight, 1.0);

  const nextAlpha = state.value_alpha + (correct ? weight : 0.0);
  const nextBeta = state.value_beta + (correct ? 0.0 : weight);

  return {
    ...state,
    heat: spikedHeat,
    value_alpha: nextAlpha,
    value_beta: nextBeta,
    lens_counts: incrementLensCount(state.lens_counts, lens),
    last_reviewed: nowIso,
    last_decayed: nowIso,
  };
}

/**
 * Graduation seeding (progress.py `graduate_unit`, lines 20–36): preserve the
 * alpha/beta earned during acquisition, refresh heat to FRESH_HEAT since the
 * concept was "just learned", and re-stamp both timestamps to now.
 */
export function seedGraduationHeat(state: LrMemoryState, now: Date = new Date()): LrMemoryState {
  const nowIso = now.toISOString();
  return {
    ...state,
    heat: FRESH_HEAT,
    last_reviewed: nowIso,
    last_decayed: nowIso,
  };
}

/**
 * Least-seen lens for a concept, for the review selector (LEARN_PLAN.md's
 * lens-coverage rule). `lensOrder` is the active course's lens set
 * (`courses.ts`'s `CourseDef.lensOrder` — `["row","matrix","column"]` for LA,
 * `["nl","rc","ra","sql"]` for DBMS); it used to be hardcoded to LA's three
 * here, which would have silently misjudged coverage for any other course's
 * lens vocabulary. Defaults to LA's order only for backward compatibility —
 * every real caller should pass the course's own `lensOrder`.
 */
export function leastSeenLens(counts: LensCounts, lensOrder: Lens[] = ["row", "matrix", "column"]): Lens {
  return lensOrder.reduce((least, lens) => ((counts[lens] ?? 0) < (counts[least] ?? 0) ? lens : least));
}
