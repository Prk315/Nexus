/**
 * Supabase access for the Learn feature. All `lr_*` tables are anon-keyed
 * (`user_id = "default"`, permissive `anon_all` RLS) — same posture as the
 * productivity stack, so every call here goes through `supabasePublic`, never
 * `supabase`. Reading these tables with the authenticated JWT returns an
 * empty set, not an error (see CLAUDE.md's "Conventions that fail silently").
 */

import { supabasePublic } from "../supabase";
import type {
  Archetype,
  ContentStatus,
  Drill,
  Grade,
  Lens,
  LrLearnState,
  LrMemoryState,
  LrUnit,
  LrUnitContentRow,
  LrUnitProgress,
  PathUnit,
  PracticeGroup,
  UnitProgressStatus,
} from "./types";

const USER_ID = "default";

// Content status preference when several rows exist for the same unit_id:
// live beats approved beats draft. The app never renders a plain "draft" as
// if it were finished content — see Player.tsx's "KLADDE" badge.
const STATUS_RANK: Record<ContentStatus, number> = {
  live: 2,
  approved: 1,
  draft: 0,
};

function bestContentRow(rows: LrUnitContentRow[]): LrUnitContentRow | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, row) => {
    const rankDiff = STATUS_RANK[row.status] - STATUS_RANK[best.status];
    if (rankDiff > 0) return row;
    if (rankDiff < 0) return best;
    return row.version > best.version ? row : best;
  });
}

/**
 * The path spine: every unit, this user's progress on it (defaulting to
 * "locked"), and whether it has any content to show — one round trip per
 * table, joined client-side.
 */
export async function fetchPath(): Promise<PathUnit[]> {
  const [unitsRes, progressRes, contentRes] = await Promise.all([
    supabasePublic.from("lr_unit").select("*").order("idx", { ascending: true }),
    supabasePublic.from("lr_unit_progress").select("*").eq("user_id", USER_ID),
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
 */
export async function fetchUnitContent(unitId: number): Promise<LrUnitContentRow | null> {
  const { data, error } = await supabasePublic
    .from("lr_unit_content")
    .select("*")
    .eq("unit_id", unitId);
  if (error) throw error;
  return bestContentRow((data ?? []) as LrUnitContentRow[]);
}

/** Record one graded attempt (drill or test question). */
export async function logAttempt(params: {
  itemRef: string;
  lens: Lens | null;
  grade: Grade;
}): Promise<void> {
  const { error } = await supabasePublic.from("lr_attempt_log").insert({
    user_id: USER_ID,
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
    .eq("user_id", USER_ID)
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
    .upsert({ ...state, user_id: USER_ID }, { onConflict: "user_id,concept_id" });
  if (error) throw error;
}

/** Flip a unit's progress status. Pass `masteredAt` when status transitions to "mastered". */
export async function setUnitProgress(
  unitId: number,
  status: UnitProgressStatus,
  masteredAt?: string
): Promise<void> {
  const { error } = await supabasePublic.from("lr_unit_progress").upsert(
    {
      user_id: USER_ID,
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
    .eq("user_id", USER_ID)
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
    .eq("user_id", USER_ID)
    .in("item_ref", itemRefs);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ item_ref: string }>) {
    counts[row.item_ref] = (counts[row.item_ref] ?? 0) + 1;
  }
  return counts;
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
