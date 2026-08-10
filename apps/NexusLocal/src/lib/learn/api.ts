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
  LrItemFeedback,
  LrItemRenderRow,
  LrLearnState,
  LrMemoryState,
  LrUnit,
  LrUnitContentRow,
  LrUnitProgress,
  PathUnit,
  PracticeGroup,
  UnitProgressStatus,
} from "./types";

import { nodeUserId } from "../nodeUser";

// Resolved per call from the node config rather than hardcoded — see
// `lib/nodeUser.ts`.

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

/** Sampled live 2026-08-10: 401 `format='written'`, `slug like 'la-%'` items
 * carry a non-null `lr_written_item.solution` (of 656 `lr_written_item` rows
 * total across every course/format — LEARN_PLAN.md's "~656 items" describes
 * that unfiltered total, not this pool). */
const EXERCISE_SLUG_PREFIX = "la-%";

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
 */
export async function fetchExercisePool(): Promise<ProblemGroup[]> {
  const userId = await nodeUserId();

  const [poolRes, feedbackRes] = await Promise.all([
    supabasePublic
      .from("lr_item")
      .select("item_id, slug, title, year, source_ref, prompt, lr_written_item!inner(solution)")
      .eq("format", "written")
      .like("slug", EXERCISE_SLUG_PREFIX)
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
