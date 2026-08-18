/**
 * Supabase access for the Learn feature. All `lr_*` tables are anon-keyed
 * (`user_id = "default"`, permissive `anon_all` RLS) — same posture as the
 * productivity stack, so every call here goes through `supabasePublic`, never
 * `supabase`. Reading these tables with the authenticated JWT returns an
 * empty set, not an error (see CLAUDE.md's "Conventions that fail silently").
 */

import { supabasePublic } from "../supabase";
import type {
  AnswerType,
  Archetype,
  ChallengeRoundSummary,
  ContentStatus,
  Drill,
  Grade,
  JudgeResult,
  Lens,
  LrChallengeRun,
  LrDisposition,
  LrItemFeedback,
  LrItemRenderRow,
  LrLearnState,
  LrMemoryState,
  LrProofContentRow,
  LrProofProgress,
  LrProofUnit,
  LrSocraticContentRow,
  LrUnit,
  LrUnitContentRow,
  LrUnitProgress,
  PathUnit,
  PracticeGroup,
  PrereqEdge,
  ProofProgressStatus,
  ProofUnitEntry,
  SocraticExchangeTurn,
  SocraticQuestion,
  UnitProgressStatus,
} from "./types";

import { nodeUserId } from "../nodeUser";
import { applyBlame } from "./memory";

// Resolved per call from the node config rather than hardcoded — see
// `lib/nodeUser.ts`.

// ── Socratic judge (LEARN_PLAN.md "Socratic dialogue nodes") — the ONE call
// in this file that doesn't go through `supabasePublic`. Edge functions are
// invoked over plain HTTPS + the anon key as a Bearer token (same pattern as
// `GarminPanel.tsx`'s `functions/v1/garmin-import` call), not the
// `supabase-js` client, so a network/503/malformed-JSON failure is a plain
// `fetch` rejection or a non-2xx response `judgeAnswer` can catch cleanly and
// turn into `null` — never an exception that reaches the caller. ───────────
const SOCRATIC_JUDGE_URL = `${(import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "")}/functions/v1/socratic-judge`;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Content status preference when several rows exist for the same unit_id:
// live beats approved beats draft. The app never renders a plain "draft" as
// if it were finished content — see Player.tsx's "KLADDE" badge.
const STATUS_RANK: Record<ContentStatus, number> = {
  live: 2,
  approved: 1,
  draft: 0,
};

// Generic over `LrUnitContentRow` / `LrProofContentRow` — both carry the same
// `{ status, version }` shape and the same live > approved > draft, then
// highest-version-within-status resolution rule.
function bestContentRow<T extends { status: ContentStatus; version: number }>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, row) => {
    const rankDiff = STATUS_RANK[row.status] - STATUS_RANK[best.status];
    if (rankDiff > 0) return row;
    if (rankDiff < 0) return best;
    return row.version > best.version ? row : best;
  });
}

/**
 * The path spine: every unit IN THE GIVEN COURSE, this user's progress on it
 * (defaulting to "locked"), and whether it has any content to show — one
 * round trip per table, joined client-side.
 *
 * `courseId` (`lr_unit.course_id`, `courses.ts`'s `CourseDef.courseId`) is
 * required and filters `lr_unit` — LEARN_PLAN.md "App course support": "the
 * critical fix, today it selects all units" (pre-multi-course, this function
 * had no course filter at all and returned every course's units mixed
 * together on one spine). Every caller now resolves its course via
 * `CourseContext.useCourse()` and passes `course.courseId` — there is no
 * "give me everything" mode.
 */
export async function fetchPath(courseId: number): Promise<PathUnit[]> {
  const [unitsRes, progressRes, contentRes] = await Promise.all([
    supabasePublic.from("lr_unit").select("*").eq("course_id", courseId).order("idx", { ascending: true }),
    supabasePublic.from("lr_unit_progress").select("*").eq("user_id", await nodeUserId()),
    supabasePublic.from("lr_unit_content").select("unit_id, version, status"),
  ]);

  if (unitsRes.error) throw unitsRes.error;
  if (progressRes.error) throw progressRes.error;
  if (contentRes.error) throw contentRes.error;

  const units = (unitsRes.data ?? []) as LrUnit[];
  const progressByUnit = new Map<number, UnitProgressStatus>();
  for (const p of (progressRes.data ?? []) as LrUnitProgress[]) {
    progressByUnit.set(p.unit_id, p.status);
  }

  const contentByUnit = new Map<number, ContentStatus[]>();
  for (const row of (contentRes.data ?? []) as Array<Pick<LrUnitContentRow, "unit_id" | "version" | "status">>) {
    const list = contentByUnit.get(row.unit_id) ?? [];
    list.push(row.status);
    contentByUnit.set(row.unit_id, list);
  }

  return units.map((unit) => {
    const statuses = contentByUnit.get(unit.unit_id) ?? [];
    const best = statuses.reduce<ContentStatus | null>((acc, s) => {
      if (acc === null || STATUS_RANK[s] > STATUS_RANK[acc]) return s;
      return acc;
    }, null);
    return {
      unit,
      progress: progressByUnit.get(unit.unit_id) ?? "locked",
      hasContent: statuses.length > 0,
      contentStatus: best,
    };
  });
}

/**
 * Best available content for one unit: prefer status live > approved > draft,
 * then the highest version within that status. Returns null if the unit has
 * no content rows at all.
 *
 * Returns the full row (including `version`) so callers — namely Player.tsx's
 * approve/demote control — can address exactly the row that was loaded
 * without a second lookup.
 */
export async function fetchUnitContent(unitId: number): Promise<LrUnitContentRow | null> {
  const { data, error } = await supabasePublic
    .from("lr_unit_content")
    .select("*")
    .eq("unit_id", unitId);
  if (error) throw error;
  return bestContentRow((data ?? []) as LrUnitContentRow[]);
}

/**
 * The draft → live curation transition (LEARN_PLAN.md: "Humans flip status;
 * agents only ever write `draft`"). Targets exactly one row via the table's
 * `(unit_id, version)` primary key — never a bare `eq("unit_id", …)`, which
 * would flip every version of the unit's content at once.
 */
export async function approveUnitContent(unitId: number, version: number): Promise<void> {
  const { error } = await supabasePublic
    .from("lr_unit_content")
    .update({ status: "live" })
    .eq("unit_id", unitId)
    .eq("version", version);
  if (error) throw error;
}

/**
 * The undo side of `approveUnitContent` — mistakes happen. Sets exactly one
 * row back to `draft` by its `(unit_id, version)` primary key.
 */
export async function demoteUnitContent(unitId: number, version: number): Promise<void> {
  const { error } = await supabasePublic
    .from("lr_unit_content")
    .update({ status: "draft" })
    .eq("unit_id", unitId)
    .eq("version", version);
  if (error) throw error;
}

// ── Proof side-paths (LEARN_PLAN.md "Proof side-paths (pinned, 2026-08-10)")
// — optional content branching off a mastered unit. Same anon-keyed
// `supabasePublic` posture, same live > approved > draft resolution as the
// unit-content functions above. Never touches `lr_unit_progress`,
// `lr_unit_content`, or memory/heat state — those stay Player.tsx's job via
// the normal grading path, unchanged for proof drills. ─────────────────────

/**
 * Every proof unit, this user's progress on it (defaulting to "available" —
 * the DB column's own default; a proof is available the moment its parent
 * masters, not locked-until-granted), and whether it has content — same
 * three-way join shape as `fetchPath()`. PathPanel filters this by
 * `parent_unit_id` and derives "locked" itself from the parent unit's
 * mastery; this function does no such filtering, matching `fetchPath()`'s
 * "return everything, let the caller derive display status" contract.
 */
export async function fetchProofUnits(): Promise<ProofUnitEntry[]> {
  const [proofRes, progressRes, contentRes] = await Promise.all([
    supabasePublic.from("lr_proof_unit").select("*"),
    supabasePublic.from("lr_proof_progress").select("*").eq("user_id", await nodeUserId()),
    supabasePublic.from("lr_proof_content").select("proof_id, version, status"),
  ]);

  if (proofRes.error) throw proofRes.error;
  if (progressRes.error) throw progressRes.error;
  if (contentRes.error) throw contentRes.error;

  const proofUnits = (proofRes.data ?? []) as LrProofUnit[];
  const progressByProof = new Map<number, ProofProgressStatus>();
  for (const p of (progressRes.data ?? []) as LrProofProgress[]) {
    progressByProof.set(p.proof_id, p.status);
  }

  const contentByProof = new Map<number, ContentStatus[]>();
  for (const row of (contentRes.data ?? []) as Array<Pick<LrProofContentRow, "proof_id" | "version" | "status">>) {
    const list = contentByProof.get(row.proof_id) ?? [];
    list.push(row.status);
    contentByProof.set(row.proof_id, list);
  }

  return proofUnits.map((proofUnit) => {
    const statuses = contentByProof.get(proofUnit.proof_id) ?? [];
    const best = statuses.reduce<ContentStatus | null>((acc, s) => {
      if (acc === null || STATUS_RANK[s] > STATUS_RANK[acc]) return s;
      return acc;
    }, null);
    return {
      proofUnit,
      progress: progressByProof.get(proofUnit.proof_id) ?? "available",
      hasContent: statuses.length > 0,
      contentStatus: best,
    };
  });
}

/**
 * Best available content for one proof unit: prefer status live > approved >
 * draft, then the highest version within that status. Returns null if the
 * proof has no content rows at all — callers render the quiet "ikke klar
 * endnu" state, not an error (LEARN_PLAN.md: the pilot content is authored
 * concurrently with this app slice).
 */
export async function fetchProofContent(proofId: number): Promise<LrProofContentRow | null> {
  const { data, error } = await supabasePublic.from("lr_proof_content").select("*").eq("proof_id", proofId);
  if (error) throw error;
  return bestContentRow((data ?? []) as LrProofContentRow[]);
}

/**
 * Same table, same resolution rule as `fetchProofContent` — only the return
 * type differs (`content: SocraticScript`, not `UnitContent`). `kind:
 * "socratic"` rows live in `lr_proof_content` exactly like `kind: "proof"` /
 * `"workshop"` rows do; there is no separate table (LEARN_PLAN.md "Socratic
 * dialogue nodes": "Storage: the lr_proof_* trio with kind='socratic'").
 * `approveProofContent` / `demoteProofContent` below are reused as-is for
 * socratic content — they only ever address the row by `(proof_id, version)`
 * and never look at `content`.
 */
export async function fetchSocraticContent(proofId: number): Promise<LrSocraticContentRow | null> {
  const { data, error } = await supabasePublic.from("lr_proof_content").select("*").eq("proof_id", proofId);
  if (error) throw error;
  return bestContentRow((data ?? []) as LrSocraticContentRow[]);
}

/**
 * Classify one learner answer via the `socratic-judge` edge function
 * (LEARN_PLAN.md "Runtime judge": Claude `claude-opus-5`, structured JSON —
 * "input = the question's rubric material + the learner's answer (+ short
 * exchange history); output = { verdict, facets_hit, misconception,
 * coach_md }. The judge CLASSIFIES ONLY — every question the learner sees is
 * authored.").
 *
 * **Fail-open, no exceptions**: network failure, a non-2xx status, or a
 * response that doesn't parse as JSON / doesn't carry a recognised `verdict`
 * ALL resolve to `null` — never a thrown error. `SocraticSession.tsx` reads
 * `null` as "judge unavailable for this exchange" and falls into rubric mode
 * for the rest of the session (LEARN_PLAN.md "Fail-open": "judge unavailable
 * (no ANTHROPIC_API_KEY secret, network, 503) → RUBRIC MODE ... The node
 * never breaks; the LLM upgrades it.").
 */
export async function judgeAnswer(
  question: SocraticQuestion,
  answer: string,
  history: SocraticExchangeTurn[]
): Promise<JudgeResult | null> {
  try {
    const res = await fetch(SOCRATIC_JUDGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        prompt_md: question.prompt_md,
        target_md: question.target_md,
        facets: question.facets,
        misconceptions: question.misconceptions,
        answer,
        history,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data || (data.verdict !== "solid" && data.verdict !== "partial" && data.verdict !== "off")) {
      return null;
    }
    return {
      verdict: data.verdict,
      facets_hit: Array.isArray(data.facets_hit) ? data.facets_hit.filter((f: unknown) => typeof f === "string") : [],
      misconception: typeof data.misconception === "string" ? data.misconception : null,
      coach_md: typeof data.coach_md === "string" ? data.coach_md : "",
    };
  } catch {
    return null;
  }
}

/** The draft → live curation transition for proof content — mirrors `approveUnitContent`. */
export async function approveProofContent(proofId: number, version: number): Promise<void> {
  const { error } = await supabasePublic
    .from("lr_proof_content")
    .update({ status: "live" })
    .eq("proof_id", proofId)
    .eq("version", version);
  if (error) throw error;
}

/** The undo side of `approveProofContent` — mirrors `demoteUnitContent`. */
export async function demoteProofContent(proofId: number, version: number): Promise<void> {
  const { error } = await supabasePublic
    .from("lr_proof_content")
    .update({ status: "draft" })
    .eq("proof_id", proofId)
    .eq("version", version);
  if (error) throw error;
}

/**
 * Flip a proof's progress status. Deliberately separate from
 * `setUnitProgress` — a proof completion must never touch
 * `lr_unit_progress` or trigger heat-seeding; concept credit for proof
 * drills flows only through the normal `logAttempt`/`upsertMemory` path in
 * Player.tsx's grading handler, identical to a unit's drills.
 */
export async function setProofProgress(proofId: number, status: ProofProgressStatus): Promise<void> {
  const { error } = await supabasePublic.from("lr_proof_progress").upsert(
    {
      user_id: await nodeUserId(),
      proof_id: proofId,
      status,
      ...(status === "completed" ? { completed_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,proof_id" }
  );
  if (error) throw error;
}

/** Record one graded attempt (drill or test question). */
export async function logAttempt(params: {
  itemRef: string;
  lens: Lens | null;
  grade: Grade;
}): Promise<void> {
  const { error } = await supabasePublic.from("lr_attempt_log").insert({
    user_id: await nodeUserId(),
    item_ref: params.itemRef,
    lens: params.lens,
    grade: params.grade,
  });
  if (error) throw error;
}

/** Fetch current memory state for a set of concepts (missing = never bootstrapped). */
export async function fetchMemoryStates(
  conceptIds: string[]
): Promise<Record<string, LrMemoryState>> {
  if (conceptIds.length === 0) return {};
  const { data, error } = await supabasePublic
    .from("lr_memory_state")
    .select("*")
    .eq("user_id", await nodeUserId())
    .in("concept_id", conceptIds);
  if (error) throw error;
  const out: Record<string, LrMemoryState> = {};
  for (const row of (data ?? []) as LrMemoryState[]) {
    out[row.concept_id] = row;
  }
  return out;
}

/** Upsert a full memory-state row (alpha/beta/heat/lens_counts already computed by memory.ts). */
export async function upsertMemory(state: LrMemoryState): Promise<void> {
  const { error } = await supabasePublic
    .from("lr_memory_state")
    .upsert({ ...state, user_id: await nodeUserId() }, { onConflict: "user_id,concept_id" });
  if (error) throw error;
}

/**
 * Batched direct-prerequisite lookup — `lr_concept_prereq(prereq_id,
 * concept_id)`, one row per edge (migration `20260806190000`, mirrors
 * `concept_prereq` in the LearnAndRetain source 1:1). One hop only: this
 * returns each input concept's own `prereq_id`s, never walking further up
 * the DAG — the "blame propagation" pinned charter (LEARN_PLAN.md "DAG-v2
 * review brain") is explicit that blame is "never recursive (one hop)".
 * Returns `{ concept_id: prereq_id[] }`; concepts with no prereqs (roots)
 * are simply absent from the result, not mapped to `[]`.
 */
export async function fetchDirectPrereqs(conceptIds: string[]): Promise<Record<string, string[]>> {
  if (conceptIds.length === 0) return {};
  const { data, error } = await supabasePublic
    .from("lr_concept_prereq")
    .select("concept_id, prereq_id")
    .in("concept_id", conceptIds);
  if (error) throw error;
  const out: Record<string, string[]> = {};
  for (const row of (data ?? []) as { concept_id: string; prereq_id: string }[]) {
    (out[row.concept_id] ??= []).push(row.prereq_id);
  }
  return out;
}

/**
 * Blame-propagation orchestration (LEARN_PLAN.md "DAG-v2 review brain",
 * item 3) — the fetch→apply→upsert wiring around `memory.applyBlame`'s pure
 * computation. Called fire-and-forget after a grading path's normal
 * `applyGrade`/`upsertMemory` updates, same pattern as `logAttempt`
 * elsewhere in this file: callers do `applyBlamePropagation(...).catch(...)`
 * and never await it inline.
 *
 * `gradedConceptIds` are the concept(s) just graded (a whole practice
 * group's `concept_ids` for Player/Review, one challenge drill's tagged
 * concepts, or a single Infinite-exercise concept — callers pass whatever
 * shares `grade`/`weight`). Skips the network round-trip entirely when
 * `grade` isn't 0/1 (memory.py:377's gate, mirrored in `applyBlame`) or
 * there's nothing to grade.
 *
 * Mirrors `_propagate_to_dag_neighbors`'s own "skip prereqs with no
 * existing memory_state row" behavior (memory.py:359–361, `if not
 * state_resp.data: continue`) — a prereq never attempted has no evidence to
 * revise, so it is left out of `fetchMemoryStates`' result and never
 * bootstrapped here.
 */
export async function applyBlamePropagation(
  gradedConceptIds: string[],
  grade: Grade,
  weight: number = 1.0
): Promise<void> {
  if ((grade !== 0 && grade !== 1) || gradedConceptIds.length === 0) return;

  const prereqMap = await fetchDirectPrereqs(gradedConceptIds);
  const prereqIds = Array.from(new Set(Object.values(prereqMap).flat()));
  if (prereqIds.length === 0) return;

  const states = await fetchMemoryStates(prereqIds);
  const existing = prereqIds.map((id) => states[id]).filter((s): s is LrMemoryState => s != null);
  if (existing.length === 0) return;

  const blamed = applyBlame(existing, grade, weight);
  await Promise.all(blamed.map((state) => upsertMemory(state)));
}

/** Flip a unit's progress status. Pass `masteredAt` when status transitions to "mastered". */
export async function setUnitProgress(
  unitId: number,
  status: UnitProgressStatus,
  masteredAt?: string
): Promise<void> {
  const { error } = await supabasePublic.from("lr_unit_progress").upsert(
    {
      user_id: await nodeUserId(),
      unit_id: unitId,
      status,
      ...(masteredAt ? { mastered_at: masteredAt } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,unit_id" }
  );
  if (error) throw error;
}

/**
 * The server-computed verdict row (blocking_state pattern). A missing row
 * means "no verdict has ever been computed" — NEVER "nothing due". Callers
 * must render that as "ingen dom endnu", not as an empty due queue.
 */
export async function fetchLearnState(): Promise<LrLearnState | null> {
  const { data, error } = await supabasePublic
    .from("lr_learn_state")
    .select("*")
    .eq("user_id", await nodeUserId())
    .maybeSingle();
  if (error) throw error;
  return (data as LrLearnState | null) ?? null;
}

/** How many times (any grade) this user has attempted each of the given drill ids. */
async function fetchAttemptCounts(itemRefs: string[]): Promise<Record<string, number>> {
  if (itemRefs.length === 0) return {};
  const { data, error } = await supabasePublic
    .from("lr_attempt_log")
    .select("item_ref")
    .eq("user_id", await nodeUserId())
    .in("item_ref", itemRefs);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ item_ref: string }>) {
    counts[row.item_ref] = (counts[row.item_ref] ?? 0) + 1;
  }
  return counts;
}

/**
 * Which of these drills this user has already graded at least once — i.e. the
 * Player's "solved" set, recovered from `lr_attempt_log`.
 *
 * Same definition of "solved" the Player uses in-session (a drill counts once
 * it has been graded, at any grade), just persisted. The layered flow needs it
 * for continuity: re-entering a unit resumes at the first layer with unsolved
 * drills, and the test's `unlock_ratio` no longer resets every time the
 * overlay is closed.
 *
 * Failures are the caller's to swallow — an empty set means "no evidence of
 * solving", which keeps the test gate closed rather than opening it, the same
 * fail-toward-still-gated posture the productivity stack uses.
 */
export async function fetchSolvedDrillIds(drillIds: string[]): Promise<Set<string>> {
  const counts = await fetchAttemptCounts(drillIds);
  return new Set(Object.keys(counts));
}

const REVIEW_QUEUE_SIZE = 10;

/** One resolved drill in a review session, plus the bookkeeping ReviewSession.tsx needs. */
export interface ReviewQueueItem {
  drill: Drill;
  // The drill's own practice group — grading credits every concept in
  // `group.concept_ids`, exactly like Player.tsx's Practice step.
  group: PracticeGroup;
  archetype: Archetype;
  // The due concept this item was selected to cover (may differ from every
  // id in group.concept_ids — a group can span several concepts).
  conceptId: string;
  unitId: number;
}

/**
 * Builds a flat, concept-level review queue (~`REVIEW_QUEUE_SIZE` drills)
 * from `lr_learn_state.due_concepts` (LEARN_PLAN.md's pinned Phase 3
 * contract — already sorted by priority desc, capped at 30 server-side).
 *
 * For each due concept, in priority order:
 *   1. Resolve that concept's unit's best content row (live > approved >
 *      draft, per `fetchUnitContent`).
 *   2. Collect every drill in that unit whose *group* or *own* `concept_ids`
 *      include the due concept.
 *   3. Prefer drills whose `lens` matches the concept's `least_seen_lens`
 *      (falls back to the full candidate pool when nothing matches or
 *      `least_seen_lens` is null).
 *   4. Within that pool, prefer the least-attempted drill (fewest rows in
 *      `lr_attempt_log`, ties broken by content order).
 *
 * A due concept with no resolvable drill (unit has no content yet, or the
 * concept is theory-only) is skipped, not an error — the queue is simply
 * shorter. Stops once `limit` items are collected or due concepts run out.
 *
 * Returns `null` when `lr_learn_state` has no row at all — "never
 * computed", per the blocking_state doctrine — so the UI can render "ingen
 * dom endnu" instead of a queue that merely looks empty. Returns `[]` (a
 * real, legitimate empty queue) when the row exists but nothing is due or
 * resolvable — that is a different, honest state from "unknown".
 */
export async function fetchReviewQueue(limit: number = REVIEW_QUEUE_SIZE): Promise<ReviewQueueItem[] | null> {
  const state = await fetchLearnState();
  if (!state) return null;

  const due = state.due_concepts ?? [];
  if (due.length === 0) return [];

  const unitIds = Array.from(new Set(due.map((d) => d.unit_id)));
  const contentEntries = await Promise.all(
    unitIds.map(async (uid) => [uid, await fetchUnitContent(uid).catch(() => null)] as const)
  );
  const contentByUnit = new Map(contentEntries);

  type Candidate = { drill: Drill; group: PracticeGroup; archetype: Archetype };
  const perConcept = new Map<string, Candidate[]>();
  const allCandidateIds = new Set<string>();

  for (const dc of due) {
    const row = contentByUnit.get(dc.unit_id);
    const content = row?.content;
    if (!content) continue;
    const candidates: Candidate[] = [];
    for (const group of content.practice) {
      const groupCovers = group.concept_ids.includes(dc.concept_id);
      for (const drill of group.drills) {
        const drillCovers = groupCovers || (drill.concept_ids?.includes(dc.concept_id) ?? false);
        if (drillCovers) {
          candidates.push({ drill, group, archetype: group.archetype });
          allCandidateIds.add(drill.id);
        }
      }
    }
    if (candidates.length > 0) perConcept.set(dc.concept_id, candidates);
  }

  let attemptCounts: Record<string, number> = {};
  try {
    attemptCounts = await fetchAttemptCounts(Array.from(allCandidateIds));
  } catch {
    // Best-effort ranking signal only — an unattempted-looking pool (all
    // zero counts) still yields a valid, deterministic pick.
  }

  const items: ReviewQueueItem[] = [];
  for (const dc of due) {
    if (items.length >= limit) break;
    const candidates = perConcept.get(dc.concept_id);
    if (!candidates || candidates.length === 0) continue;

    let pool = candidates;
    if (dc.least_seen_lens) {
      const lensMatched = candidates.filter((c) => c.drill.lens === dc.least_seen_lens);
      if (lensMatched.length > 0) pool = lensMatched;
    }

    let best = pool[0];
    let bestCount = attemptCounts[best.drill.id] ?? 0;
    for (const c of pool.slice(1)) {
      const count = attemptCounts[c.drill.id] ?? 0;
      if (count < bestCount) {
        best = c;
        bestCount = count;
      }
    }

    items.push({
      drill: best.drill,
      group: best.group,
      archetype: best.archetype,
      conceptId: dc.concept_id,
      unitId: dc.unit_id,
    });
  }

  return items;
}

// ── Infinite exercises (LEARN_PLAN.md "Infinite exercises", pinned
// 2026-08-10) — shuffle-practice over the ported LA exam/book item bank,
// separate from the unit path. ──────────────────────────────────────────

/**
 * One sub-part inside a `ProblemGroup`. `task_md` is the structured,
 * enrichment-cleaned ask when `lr_item_render` has a row for this item;
 * otherwise it falls back to `lr_item.prompt` verbatim (`hasRender: false`),
 * which on the raw path still carries the parent problem's duplicated
 * introduction and stray PDF-conversion HTML — see the migration's DDL
 * comment. `solution_md` is populated eagerly here (the render row is
 * already fetched, so it costs nothing extra) when a render row exists;
 * `null` otherwise, and `ExerciseSession.tsx` falls back to lazily fetching
 * `lr_written_item.solution` via `fetchItemSolution` on reveal, exactly like
 * the pre-grouping flow.
 */
export interface ProblemPart {
  item_id: number;
  slug: string;
  part_label: string | null;
  task_md: string;
  solution_md: string | null;
  hasRender: boolean;
}

/**
 * One exam/book problem, possibly multi-part. Fallback (no `lr_item_render`
 * row) items group as singletons keyed `item:<slug>` — LEARN_PLAN.md's
 * "Infinite exercises" rebuild spec. `parts` is sorted by `part_label`
 * ascending (nulls — i.e. singleton groups — sort first).
 */
export interface ProblemGroup {
  group_key: string;
  source: { title: string | null; year: number | null; source_ref: string | null };
  intro_md: string | null;
  context_md: string | null;
  parts: ProblemPart[];
  /** Min of each part's `lr_attempt_log` count — the shuffle's
   *  fewest-attempts-first bucketing signal, now computed across the whole
   *  group rather than one item. */
  attemptCount: number;
}

/** One `lr_qmatrix` row — the concept(s) an item's grading credits, and how much. */
export interface ItemConcept {
  concept_id: string;
  weight: number;
}

/**
 * Groups a flat item list into `ProblemGroup[]` using each item's
 * `lr_item_render` row (if any). Pure — no I/O — so it's unit-testable and
 * kept separate from the fetch below.
 */
function groupItems(
  items: Array<{
    item_id: number;
    slug: string;
    title: string | null;
    year: number | null;
    source_ref: string | null;
    prompt: string;
  }>,
  renderByItem: Map<number, LrItemRenderRow>,
  attemptCounts: Record<string, number>
): ProblemGroup[] {
  type Item = (typeof items)[number];
  type Bucket = { items: Item[]; renders: Map<number, LrItemRenderRow> };
  const buckets = new Map<string, Bucket>();
  for (const item of items) {
    const render = renderByItem.get(item.item_id);
    const key = render ? render.group_key : `item:${item.slug}`;
    const bucket: Bucket = buckets.get(key) ?? { items: [], renders: new Map() };
    bucket.items.push(item);
    if (render) bucket.renders.set(item.item_id, render);
    buckets.set(key, bucket);
  }

  const groups: ProblemGroup[] = [];
  for (const [group_key, bucket] of buckets) {
    let intro_md: string | null = null;
    let context_md: string | null = null;

    const parts: ProblemPart[] = bucket.items.map((item) => {
      const render = bucket.renders.get(item.item_id);
      if (render?.intro_md && intro_md === null) intro_md = render.intro_md;
      if (render?.context_md && context_md === null) context_md = render.context_md;
      return {
        item_id: item.item_id,
        slug: item.slug,
        part_label: render?.part_label ?? null,
        task_md: render?.task_md ?? item.prompt,
        solution_md: render?.solution_md ?? null,
        hasRender: !!render,
      };
    });
    parts.sort((a, b) => (a.part_label ?? "").localeCompare(b.part_label ?? ""));

    const first = bucket.items[0];
    const attemptCount = Math.min(...bucket.items.map((item) => attemptCounts[item.slug] ?? 0));

    groups.push({
      group_key,
      source: { title: first.title, year: first.year, source_ref: first.source_ref },
      intro_md,
      context_md,
      parts,
      attemptCount,
    });
  }
  return groups;
}

/**
 * The Infinite-exercises pool: every `format='written'` item whose slug
 * matches the course prefix and has a non-null `lr_written_item.solution`,
 * minus items this user has flagged broken or unclear
 * (`lr_item_feedback.exercise_broken` / `.solution_broken`), grouped into
 * `ProblemGroup[]` via `lr_item_render.group_key` (fallback items — no
 * render row yet — group as singletons; see `groupItems`).
 *
 * Three independent round trips, not one query, because PostgREST has no
 * single-request way to express "exists a solution" AND "does not exist a
 * true-flagged feedback row" together, and the render join is a separate
 * table keyed by `item_id`:
 *   1. `lr_item` inner-joined to `lr_written_item` (`!inner` join hint) with
 *      `lr_written_item.solution=not.is.null` — the inner join is what turns
 *      "no written_item row at all" into "row excluded", not null-padded.
 *   2. This user's `lr_item_feedback` rows carrying either flag, to build a
 *      client-side exclusion set.
 *   3. `lr_item_render` rows for exactly the surviving item ids — an
 *      enrichment pass fills this table concurrently (LEARN_PLAN.md), so a
 *      missing row per item is the expected steady state until it completes,
 *      not an error; those items simply group as singletons on their raw
 *      prompt (the migration's documented fallback contract).
 * A fourth, best-effort query (`fetchAttemptCounts`, already used by
 * `fetchReviewQueue`) attaches per-slug attempt counts for the shuffle's
 * ordering signal; its own failure degrades to "0 attempts everywhere" — a
 * valid, if less-informed, ordering — never a thrown error, matching this
 * file's existing best-effort-ranking-signal posture.
 *
 * `slugPrefix` (`courses.ts`'s `CourseDef.itemSlugPrefix`, e.g. `"la-"` /
 * `"dbms-"`) scopes the pool to one course's items — LEARN_PLAN.md "App
 * course support": "Challenge/review/exercise pools stay course-scoped by
 * slug/unit conventions". Sampled live 2026-08-10 for the LA pool: 401
 * `format='written'`, `slug like 'la-%'` items carry a non-null
 * `lr_written_item.solution` (of 656 `lr_written_item` rows total across
 * every course/format — LEARN_PLAN.md's "~656 items" describes that
 * unfiltered total, not this pool).
 */
export async function fetchExercisePool(slugPrefix: string): Promise<ProblemGroup[]> {
  const userId = await nodeUserId();

  const [poolRes, feedbackRes] = await Promise.all([
    supabasePublic
      .from("lr_item")
      .select("item_id, slug, title, year, source_ref, prompt, lr_written_item!inner(solution)")
      .eq("format", "written")
      .like("slug", `${slugPrefix}%`)
      .not("lr_written_item.solution", "is", null),
    supabasePublic
      .from("lr_item_feedback")
      .select("item_id")
      .eq("user_id", userId)
      .or("exercise_broken.eq.true,solution_broken.eq.true"),
  ]);
  if (poolRes.error) throw poolRes.error;
  if (feedbackRes.error) throw feedbackRes.error;

  const excluded = new Set((feedbackRes.data ?? []).map((row: { item_id: number }) => row.item_id));

  type Row = {
    item_id: number;
    slug: string | null;
    title: string | null;
    year: number | null;
    source_ref: string | null;
    prompt: string | null;
  };
  const rows = (poolRes.data ?? []) as Row[];
  const items = rows
    .filter((r) => r.slug && r.prompt && !excluded.has(r.item_id))
    .map((r) => ({
      item_id: r.item_id,
      slug: r.slug as string,
      title: r.title,
      year: r.year,
      source_ref: r.source_ref,
      prompt: r.prompt as string,
    }));

  const renderByItem = new Map<number, LrItemRenderRow>();
  if (items.length > 0) {
    const { data, error } = await supabasePublic
      .from("lr_item_render")
      .select("item_id, group_key, part_label, intro_md, task_md, context_md, solution_md")
      .in(
        "item_id",
        items.map((i) => i.item_id)
      );
    if (error) throw error;
    for (const row of (data ?? []) as LrItemRenderRow[]) {
      renderByItem.set(row.item_id, row);
    }
  }

  let counts: Record<string, number> = {};
  try {
    counts = await fetchAttemptCounts(items.map((i) => i.slug));
  } catch {
    // Best-effort ranking signal only, per this file's existing posture in
    // `fetchReviewQueue` — an all-zero pool still yields a valid ordering.
  }

  return groupItems(items, renderByItem, counts);
}

/** Lazily-fetched solution markdown for one item, revealed on "Vis løsning". */
export async function fetchItemSolution(itemId: number): Promise<string | null> {
  const { data, error } = await supabasePublic
    .from("lr_written_item")
    .select("solution")
    .eq("item_id", itemId)
    .maybeSingle();
  if (error) throw error;
  return (data as { solution: string | null } | null)?.solution ?? null;
}

/** This item's q-matrix rows — the concepts its grading credits, and each one's weight. */
export async function fetchItemConcepts(itemId: number): Promise<ItemConcept[]> {
  const { data, error } = await supabasePublic.from("lr_qmatrix").select("concept_id, weight").eq("item_id", itemId);
  if (error) throw error;
  return (data ?? []) as ItemConcept[];
}

/** Append one row to the append-only `lr_item_feedback` log. */
export async function submitItemFeedback(row: {
  itemId: number;
  difficulty: number | null;
  understood: boolean | null;
  exerciseBroken: boolean;
  solutionBroken: boolean;
  note?: string | null;
}): Promise<void> {
  const insert: Omit<LrItemFeedback, "fb_id" | "at"> = {
    user_id: await nodeUserId(),
    item_id: row.itemId,
    difficulty: row.difficulty,
    understood: row.understood,
    exercise_broken: row.exerciseBroken,
    solution_broken: row.solutionBroken,
    note: row.note ?? null,
  };
  const { error } = await supabasePublic.from("lr_item_feedback").insert(insert);
  if (error) throw error;
}

// ── Lynudfordring — timed challenge (LEARN_PLAN.md "Lynudfordring — timed
// challenge", pinned 2026-08-10; scoped chapter-checkpoint pilot added
// 2026-08-10) — a 15-minute, 3-round arcade session drawn from the same unit
// content `Player.tsx` renders, not a separate content pool. Two entry
// points: the unscoped Learn-page card (whole unlocked course) and a
// per-chapter checkpoint node on `PathPanel`'s spine (piloted at LA 2's end,
// generic by chapter). ────────────────────────────────────────────────────

/** Same `code.indexOf("·")` split `PathPanel.tsx` uses to derive a chapter
 * label ("LA 2 · U1" -> "LA 2") — duplicated here (not imported from
 * PathPanel, a UI file) so a chapter-scoped pool groups units exactly the way
 * the chapter checkpoint node that requests it does. */
function chapterOf(code: string): string {
  const i = code.indexOf("·");
  return i === -1 ? code.trim() : code.slice(0, i).trim();
}

/** Difficulty ≤ 2 drills, `text` excluded (never machine-checkable fast
 * enough for a timer), classified into exactly one of the three rounds by
 * `answer_type` and (for `choice`) the containing group's `archetype` —
 * LEARN_PLAN.md: "R1 numeric/vector/matrix + computational choice · R2
 * tiles only · R3 truefalse/conceptual choice". `numeric`/`vector`/`matrix`
 * always land in R1 regardless of archetype (only `translate` drills use
 * those types in practice, and a translate drill's numeric answer is still
 * "a quick, machine-checkable answer" in the same sense a computational
 * drill's is). `choice` needs the archetype split explicitly: a
 * `computational`/`translate` choice question is a fast fact-check (R1); a
 * `truefalse`/`conceptual` choice question is a judgment call (R3). Returns
 * `null` for `text`/`tiles`-mismatched/unknown types — fail closed, not into
 * a wrong round (tiles is handled by its own branch above this call).
 */
function classifyChallengeRound(archetype: Archetype, answerType: AnswerType): 1 | 2 | 3 | null {
  switch (answerType) {
    case "tiles":
      return 2;
    case "numeric":
    case "vector":
    case "matrix":
      return 1;
    case "choice":
      return archetype === "truefalse" || archetype === "conceptual" ? 3 : 1;
    default:
      return null;
  }
}

const CHALLENGE_MAX_DIFFICULTY = 2;
/** Exported so `ChallengeSession.tsx` can shrink its per-round queue size
 * proportionally off the same threshold rather than duplicating the number
 * (LEARN_PLAN.md's "shrink the session instead" rule, pinned 2026-08-11). */
export const CHALLENGE_MIN_POOL = 24;

export interface ChallengePoolDrill {
  drill: Drill;
  unitId: number;
  unitCode: string;
  /** `drill.concept_ids` when present, else the containing group's — same
   * "credit every concept the drill's own group covers" rule Player.tsx's
   * grading path and `fetchReviewQueue` both use. */
  conceptIds: string[];
  round: 1 | 2 | 3;
}

export interface ChallengePool {
  r1: ChallengePoolDrill[];
  r2: ChallengePoolDrill[];
  r3: ChallengePoolDrill[];
  /** True when the primary pool fell under `CHALLENGE_MIN_POOL` and the
   * fallback widened it. Unscoped: widened to every unit with content in the
   * whole course. Chapter-scoped: widened BACKWARDS only — earlier chapters
   * (by `lr_unit.idx` path order) were prepended one at a time; a later
   * chapter is never reached, even if the pool stays thin after exhausting
   * every earlier chapter (LEARN_PLAN.md's pool rule, pinned 2026-08-11).
   * Exposed so the session/panel can be transparent about it rather than
   * silently pulling in extra units. */
  widened: boolean;
}

/**
 * Builds the Lynudfordring drill pool.
 *
 * Unscoped (`opts.chapter` omitted — the Learn-page card): difficulty ≤ 2,
 * non-`text` drills from units in the *unlocked region*
 * (mastered/in_progress/available — mirrors `PathPanel.tsx`'s own status
 * derivation exactly, since `lr_unit_progress` only ever stores
 * `locked`/`in_progress`/`mastered` and "available" is a client-side read of
 * "previous unit mastered, or this one already has progress"). Falls back to
 * every unit with content in the whole course when that pool has fewer than
 * `CHALLENGE_MIN_POOL` eligible drills total. Unchanged by the 2026-08-11
 * chapter-scoping fix below.
 *
 * Chapter-scoped (`opts.chapter` set, e.g. `"LA 2"` — a `PathPanel`
 * checkpoint node): the unlocked-region rule does NOT apply — a checkpoint
 * draws from every unit in that chapter (`chapterOf(unit.code) === chapter`)
 * regardless of lock status, since the checkpoint itself is what determines
 * reachability (rendered only once ≥1 unit in the chapter is mastered — see
 * `PathPanel.tsx`), not `lr_unit_progress`.
 *
 * **Backwards-only widening (fixed 2026-08-11 — was pulling in later,
 * unseen chapters).** A chapter checkpoint must never serve material the
 * learner hasn't reached yet. When the scoped chapter alone yields fewer
 * than `CHALLENGE_MIN_POOL` drills, the nearest EARLIER chapter (by
 * `lr_unit.idx` path order — chapters occur in contiguous idx blocks, same
 * assumption `PathPanel.tsx`'s own chapter grouping makes) is prepended, one
 * chapter at a time, until the threshold is met or the start of the course
 * is reached. A later chapter is never included, no matter how thin the
 * pool stays — see `ChallengeSession.tsx` for how a still-thin pool degrades
 * the session (smaller round queues, or a round skipped entirely) instead of
 * ever widening forward.
 */
export async function fetchChallengePool(opts: { courseId: number; chapter?: string }): Promise<ChallengePool> {
  const chapter = opts.chapter;
  const path = await fetchPath(opts.courseId);
  const sorted = [...path].sort((a, b) => a.unit.idx - b.unit.idx);

  const unlockedUnitIds = new Set<number>();
  let prevMastered = true; // the first unit on the spine is never locked
  for (const pu of sorted) {
    const unlocked = pu.progress === "mastered" || pu.progress === "in_progress" || prevMastered;
    if (unlocked) unlockedUnitIds.add(pu.unit.unit_id);
    prevMastered = pu.progress === "mastered";
  }

  const withContent = sorted.filter((pu) => pu.hasContent);
  const contentPairs = await Promise.all(
    withContent.map(async (pu) => [pu.unit.unit_id, await fetchUnitContent(pu.unit.unit_id).catch(() => null)] as const)
  );
  const contentByUnit = new Map<number, LrUnitContentRow>();
  for (const [id, row] of contentPairs) if (row) contentByUnit.set(id, row);

  function collect(filterUnit: (pu: PathUnit) => boolean): ChallengePoolDrill[] {
    const out: ChallengePoolDrill[] = [];
    for (const pu of withContent) {
      if (!filterUnit(pu)) continue;
      const row = contentByUnit.get(pu.unit.unit_id);
      if (!row) continue;
      for (const group of row.content.practice) {
        for (const drill of group.drills) {
          const difficulty = drill.difficulty ?? 1;
          if (difficulty > CHALLENGE_MAX_DIFFICULTY) continue;
          const round = classifyChallengeRound(group.archetype, drill.answer_type);
          if (round === null) continue;
          out.push({
            drill,
            unitId: pu.unit.unit_id,
            unitCode: pu.unit.code,
            conceptIds: drill.concept_ids && drill.concept_ids.length > 0 ? drill.concept_ids : group.concept_ids,
            round,
          });
        }
      }
    }
    return out;
  }

  let pool: ChallengePoolDrill[];
  let widened = false;

  if (chapter) {
    // Distinct chapters in path order — first-seen while walking the full
    // idx-sorted spine (not just units with content), so "the nearest
    // earlier chapter" is well-defined even when that chapter's content
    // isn't authored yet (it will simply contribute zero drills).
    const chapterOrder: string[] = [];
    for (const pu of sorted) {
      const c = chapterOf(pu.unit.code);
      if (chapterOrder[chapterOrder.length - 1] !== c) chapterOrder.push(c);
    }
    const targetIdx = chapterOrder.indexOf(chapter);
    const included = new Set<string>([chapter]);
    let lo = targetIdx; // widening cutoff: chapterOrder[lo..targetIdx] are included
    pool = collect((pu) => included.has(chapterOf(pu.unit.code)));
    while (pool.length < CHALLENGE_MIN_POOL && targetIdx !== -1 && lo > 0) {
      lo -= 1;
      included.add(chapterOrder[lo]);
      widened = true;
      pool = collect((pu) => included.has(chapterOf(pu.unit.code)));
    }
  } else {
    pool = collect((pu) => unlockedUnitIds.has(pu.unit.unit_id));
    if (pool.length < CHALLENGE_MIN_POOL) {
      pool = collect(() => true);
      widened = true;
    }
  }

  return {
    r1: pool.filter((d) => d.round === 1),
    r2: pool.filter((d) => d.round === 2),
    r3: pool.filter((d) => d.round === 3),
    widened,
  };
}

/**
 * This user's highest-scoring run for the given scope, or `null` if none has
 * been submitted yet. `scope` is `null` for the unscoped whole-course session
 * (the Learn-page card's personal best) or a chapter label (a checkpoint
 * node's personal best) — matches whatever `submitChallengeRun` was called
 * with. Filtered client-side on `rounds.scope` rather than a server-side
 * jsonb-path query: the `rounds` column has no index for it and this table is
 * one row per completed session (a handful at most), so a full per-user scan
 * costs nothing meaningful today. Revisit with a real query (or a dedicated
 * `scope` column) if that stops being true.
 */
export async function fetchChallengeBest(scope: string | null = null): Promise<LrChallengeRun | null> {
  const { data, error } = await supabasePublic
    .from("lr_challenge_run")
    .select("*")
    .eq("user_id", await nodeUserId())
    .order("score", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as LrChallengeRun[];
  return rows.find((r) => (r.rounds?.scope ?? null) === scope) ?? null;
}

/** Persists one completed run. Append-only — every attempt gets its own row,
 * `fetchChallengeBest` picks the max per scope. `scope` (`null` = unscoped
 * whole-course session, else a chapter label) is folded into the `rounds`
 * jsonb payload rather than a new column — see `LrChallengeRun.rounds`'s doc
 * comment in types.ts. */
export async function submitChallengeRun(row: {
  score: number;
  correct: number;
  total: number;
  bestStreak: number;
  durationSecs: number;
  rounds: ChallengeRoundSummary[];
  scope?: string | null;
}): Promise<void> {
  const { error } = await supabasePublic.from("lr_challenge_run").insert({
    user_id: await nodeUserId(),
    score: row.score,
    correct: row.correct,
    total: row.total,
    best_streak: row.bestStreak,
    duration_secs: row.durationSecs,
    rounds: { scope: row.scope ?? null, rounds: row.rounds },
  });
  if (error) throw error;
}

// ── Generalprøve (LEARN_PLAN.md "Generalprøve — the final canvas node",
// pinned 2026-08-17 — P1 slice). Same anon-keyed `supabasePublic` posture as
// everything else in this file: `lr_disposition` / `lr_concept_prereq` /
// `lr_unit_concept` all carry `anon_all` RLS (verified 2026-08-18), so the
// authenticated client would return an empty set, not an error. ────────────

/**
 * Every disposition authored for one course, in code order. Unlike
 * lr_unit_content there is NO version column and no live>approved>draft
 * resolution — each row is its own artefact, and draft rows are RETURNED,
 * badged KLADDE by the caller (Player.tsx's convention). Empty is the normal
 * state today: lr_disposition has 0 rows until the authoring pass lands.
 */
export async function fetchDispositions(courseId: number): Promise<LrDisposition[]> {
  const { data, error } = await supabasePublic
    .from("lr_disposition")
    .select("disposition_id, course_id, code, title, status, content, authored_by, notes, created_at")
    .eq("course_id", courseId)
    .order("code", { ascending: true });
  if (error) throw error;
  return (data ?? []) as LrDisposition[];
}

/**
 * Prerequisite edges among ONE course's concepts — the DAG the canvas lights
 * up automatically when two placed cards happen to be an edge.
 *
 * Course scoping goes through `lr_unit_concept` because neither
 * `lr_concept_prereq` nor `lr_concept` carries a course_id (verified against
 * information_schema, 2026-08-18). Verified sound for LA (course 2): 180
 * concepts via lr_unit_concept, and all 138 distinct concept_ids appearing in
 * the course's theory boxes are inside that set — so no card can be silently
 * edgeless because of scoping. 269 edges have both endpoints in the course;
 * 196 of them join two theory-box concepts.
 *
 * Note the existing `fetchDirectPrereqs` above is a DIFFERENT query with a
 * different contract (one-hop blame propagation, keyed by concept, returns a
 * Record) — the canvas needs the edge list, filtered to a course, in both
 * directions, so the two are deliberately not merged.
 */
export async function fetchPrereqEdges(courseId: number): Promise<PrereqEdge[]> {
  // FK `lr_unit_concept_unit_id_fkey` makes the !inner embed resolvable.
  const ucRes = await supabasePublic
    .from("lr_unit_concept")
    .select("concept_id, lr_unit!inner(course_id)")
    .eq("lr_unit.course_id", courseId)
    .limit(5000);
  if (ucRes.error) throw ucRes.error;

  const ids = Array.from(new Set((ucRes.data ?? []).map((r: { concept_id: string }) => r.concept_id)));
  if (ids.length === 0) return [];
  const inCourse = new Set(ids);

  // Chunked: LA's 180 ids total 4005 chars, and a single `.in()` builds a ~6 KB
  // GET URL — uncomfortably close to proxy header limits. 60 per chunk keeps
  // each request ~2 KB and makes this deterministic rather than lucky.
  const CHUNK = 60;
  const out: PrereqEdge[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabasePublic
      .from("lr_concept_prereq")
      .select("concept_id, prereq_id")
      .in("concept_id", ids.slice(i, i + CHUNK));
    if (error) throw error;
    for (const row of (data ?? []) as { concept_id: string; prereq_id: string }[]) {
      if (!inCourse.has(row.prereq_id)) continue; // both endpoints must be in-course
      const key = `${row.prereq_id}\u0000${row.concept_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ prereqId: row.prereq_id, conceptId: row.concept_id });
    }
  }
  return out;
}
