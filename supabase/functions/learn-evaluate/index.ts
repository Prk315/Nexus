// Supabase Edge Function: learn-evaluate
//
// Server-side brain for the Learn (lr_) module — the LearnAndRetain concept-
// graph learning system embedded in Nexus Local. See
// apps/NexusLocal/LEARN_PLAN.md, "Phase 3 — lr_learn_state contract" (pinned),
// for the row shape this function writes.
//
// Intended to run on pg_cron (following the `nexus-focus-evaluate` /
// `protocol-bodyscan-sync` pattern in CLAUDE.md's "Scheduled server-side work"
// table) and folds four things into ONE verdict row per user:
//
//   1. HEAT DECAY    — lazily decay lr_memory_state.heat for every RETAINED
//                       concept (lr_retained_concept), then persist heat +
//                       last_decayed. Acquisition-space concepts (not yet
//                       graduated into retention) never decay — the two-space
//                       model from LearnAndRetain's ARCHITECTURE.md.
//   2. DUE + PRIORITY — which retained concepts need review, and in what order.
//   3. FRONTIER       — which unit(s) to work on next.
//   4. STREAK         — consecutive local (Europe/Copenhagen) days with ≥1
//                        attempt, ending today or yesterday.
//
//   lr_learn_state(user_id, due_concepts, frontier_units, streak_days,
//                  last_session_date, computed_at)
//
// BLOCKING_STATE PATTERN: lr_learn_state is deliberately NOT seeded (see the
// migration). A missing row means "no verdict has ever been computed" — never
// "nothing is due". Every consumer (ReviewPanel, a future LearnWidget) must
// keep treating missing/stale as last-known-state, never as an empty queue.
// This function follows the same posture as focus-evaluate: every query
// failure aborts BEFORE the lr_learn_state write, because a stale verdict
// beats a wrong, fresh-looking one.
//
// ── PORTED CONSTANTS (do not invent new ones without updating this comment) ──
//
//   Heat decay — LearnAndRetain/pipeline/memory/memory.py:34-35, 99-104
//     HALF_LIFE_HOURS = 24.0
//     DECAY_K = ln(2) / HALF_LIFE_HOURS
//     decayed = heat * exp(-DECAY_K * hoursSinceLastDecayed)      [line 104]
//   This decay formula IS implemented upstream already — it is not a roadmap
//   gap — so it is ported verbatim rather than substituted with a task-brief
//   fallback. The half-life is 24 HOURS, not days: `heat` is an ACT-R
//   retrievability proxy meant to cool fast between sessions. The separate,
//   never-decaying mastery signal is `value_alpha`/`value_beta` (Beta dist.).
//
//   Selector priority — LearnAndRetain/pipeline/memory/selector.py:38-42, 111-134
//     EVIDENCE_CAP   = 8                                          [line 40]
//     DEFAULT_LAMBDA = 0.5   (retention-vs-competence balance)    [line 41]
//     evidence_factor = clamp((confidence - 2) / EVIDENCE_CAP, 0, 1) [line 121]
//     retention  = (1 - heat) * value_mean * evidence_factor
//     competence = 1 - value_mean
//     priority   = LAMBDA * retention + (1 - LAMBDA) * competence
//
// ── DEVIATIONS FROM THE PYTHON (per LEARN_PLAN.md's Phase 3 task brief) ──────
//
//   - selector.py's PREREQ_THRESHOLD / MIN_EVIDENCE (the DAG eligibility gate
//     in `get_eligible_concepts`) is NOT reapplied. A concept only reaches
//     `lr_retained_concept` once its *unit* is mastered, and unit mastery
//     already implies its concepts passed acquisition — that gate stands in
//     for selector.py's eligibility filter here.
//   - The due filter ("decayed heat < 0.5 OR comp < 0.6") is the fixed
//     threshold pinned in LEARN_PLAN.md's Phase 3 contract, not selector.py's
//     `get_eligible_concepts` gate — that gate answers "what's eligible for a
//     *new* session", a different question from "what's due for review".
//   - selector.py's structural-importance boost (`* (1 + gamma * imp)`,
//     concept-DAG out-degree, DEFAULT_GAMMA = 0.2) is SKIPPED per instruction
//     ("skip PageRank importance — uniform importance is fine, note it").
//     Concretely: priority below is the *raw* λ-weighted sum, no importance
//     multiplier.
//   - `next_item_session`'s greedy weighted set-cover (turning due concepts
//     into an *item* list via lr_qmatrix) is not ported. lr_item/lr_qmatrix
//     are authoring-grounding/capstone tables in this migration, not the
//     primary drill source — the app resolves a `due_concepts` entry into a
//     drill via lr_unit_content + least_seen_lens instead.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const DEFAULT_USER = "default";
const TIMEZONE = "Europe/Copenhagen";

// Heat decay (memory.py:34-35).
const HALF_LIFE_HOURS = 24.0;
const DECAY_K = Math.log(2) / HALF_LIFE_HOURS;

// Due thresholds — LEARN_PLAN.md Phase 3 contract, pinned.
const DUE_HEAT_THRESHOLD = 0.5;
const DUE_COMP_THRESHOLD = 0.6;

// Selector priority weighting (selector.py:38-41).
const EVIDENCE_CAP = 8;
const LAMBDA = 0.5;

const DUE_CAP = 30;
const FRONTIER_CAP = 3;
// Generous lookback bound for the streak scan — far beyond any real streak,
// just keeps the lr_attempt_log query from scanning the whole table forever.
const STREAK_WINDOW_DAYS = 400;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Any query failure becomes this, and this aborts the run before any write. */
class QueryFailure extends Error {
  readonly table: string;
  readonly detail: string;

  constructor(table: string, detail: string) {
    super(`${table}: ${detail}`);
    this.name = "QueryFailure";
    this.table = table;
    this.detail = detail;
  }
}

/**
 * Unwrap a PostgREST result, converting an error into a thrown QueryFailure.
 * Nothing here is allowed to treat a failed query as an empty set.
 */
function unwrap<T>(
  table: string,
  res: { data: T[] | null; error: { message: string } | null },
): T[] {
  if (res.error) throw new QueryFailure(table, res.error.message);
  return res.data ?? [];
}

/** Local "YYYY-MM-DD" for a Date, resolved via Intl in `tz`. */
function localDate(d: Date, tz: string = TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** `YYYY-MM-DD` shifted by whole days. Used only to build query/scan bounds. */
function shiftDate(ymd: string, days: number): string {
  const [y, m, dd] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + days)).toISOString().slice(0, 10);
}

// ── Row shapes (only the columns this function reads) ───────────────────────

interface MemoryStateRow {
  concept_id: string;
  value_alpha: number;
  value_beta: number;
  heat: number;
  lens_counts: Record<string, number> | null;
  last_decayed: string;
}

interface UnitConceptRow {
  unit_id: number;
  concept_id: string;
}

interface UnitRow {
  unit_id: number;
  idx: number;
  code: string;
}

interface UnitProgressRow {
  unit_id: number;
  status: string;
}

// ── Step 1: heat decay ────────────────────────────────────────────────────

interface DecayedState extends MemoryStateRow {
  decayedHeat: number;
}

/**
 * heat *= exp(-DECAY_K * hoursSinceLastDecayed) — a verbatim port of
 * memory.py's `_decay_heat` (lines 99-104), including the `hours <= 0`
 * short-circuit for clock skew / same-tick reads.
 */
function decayHeat(heat: number, lastDecayedIso: string, now: Date): number {
  const hours = (now.getTime() - new Date(lastDecayedIso).getTime()) / 3_600_000;
  if (hours <= 0) return heat;
  return heat * Math.exp(-DECAY_K * hours);
}

// ── Step 2: due + priority ───────────────────────────────────────────────

interface DueConcept {
  concept_id: string;
  unit_id: number | null;
  priority: number;
  least_seen_lens: "row" | "matrix" | "column" | null;
}

const LENS_KEYS = ["row", "matrix", "column"] as const;

/** Least-exercised lens from lens_counts, or null when all three are zero. */
function leastSeenLens(
  lensCounts: Record<string, number> | null,
): "row" | "matrix" | "column" | null {
  const counts = LENS_KEYS.map((k) => lensCounts?.[k] ?? 0);
  if (counts.every((c) => c === 0)) return null;
  let bestIdx = 0;
  for (let i = 1; i < counts.length; i++) {
    if (counts[i] < counts[bestIdx]) bestIdx = i;
  }
  return LENS_KEYS[bestIdx];
}

/**
 * selector.py's `_score_concept` (lines 111-134), minus the structural-
 * importance boost — see the file-header "Deviations" note.
 */
function priorityOf(decayedHeat: number, alpha: number, beta: number): number {
  const valueMean = alpha / (alpha + beta);
  const confidence = alpha + beta;
  const evidenceFactor = Math.min(1, Math.max(0, (confidence - 2) / EVIDENCE_CAP));
  const retention = (1 - decayedHeat) * valueMean * evidenceFactor;
  const competence = 1 - valueMean;
  return LAMBDA * retention + (1 - LAMBDA) * competence;
}

// ── Step 3: frontier ─────────────────────────────────────────────────────

interface FrontierUnit {
  unit_id: number;
  code: string;
  status: "in_progress" | "available";
}

// ── Step 4: streak ───────────────────────────────────────────────────────

function computeStreak(
  localDates: Set<string>,
  todayLocal: string,
): { streakDays: number; lastSessionDate: string | null } {
  if (localDates.size === 0) return { streakDays: 0, lastSessionDate: null };

  let lastSessionDate: string | null = null;
  for (const d of localDates) {
    if (lastSessionDate === null || d > lastSessionDate) lastSessionDate = d;
  }

  const yesterdayLocal = shiftDate(todayLocal, -1);
  let cursor: string;
  if (localDates.has(todayLocal)) cursor = todayLocal;
  else if (localDates.has(yesterdayLocal)) cursor = yesterdayLocal;
  else return { streakDays: 0, lastSessionDate };

  let streakDays = 0;
  while (localDates.has(cursor)) {
    streakDays++;
    cursor = shiftDate(cursor, -1);
  }
  return { streakDays, lastSessionDate };
}

// ── Orchestration ───────────────────────────────────────────────────────

interface LearnStateRow {
  user_id: string;
  due_concepts: DueConcept[];
  frontier_units: FrontierUnit[];
  streak_days: number;
  last_session_date: string | null;
  computed_at: string;
}

async function compute(
  supabase: SupabaseClient,
  now: Date,
): Promise<LearnStateRow> {
  // ── Step 1: heat decay, retained concepts only ──────────────────────────
  const retainedRows = unwrap<{ concept_id: string }>(
    "lr_retained_concept",
    await supabase
      .from("lr_retained_concept")
      .select("concept_id")
      .eq("user_id", DEFAULT_USER),
  );
  const retainedIds = retainedRows.map((r) => r.concept_id);

  let memStates: MemoryStateRow[] = [];
  if (retainedIds.length > 0) {
    memStates = unwrap<MemoryStateRow>(
      "lr_memory_state",
      await supabase
        .from("lr_memory_state")
        .select(
          "concept_id, value_alpha, value_beta, heat, lens_counts, last_decayed",
        )
        .eq("user_id", DEFAULT_USER)
        .in("concept_id", retainedIds),
    );
  }

  const nowIso = now.toISOString();
  const decayed: DecayedState[] = memStates.map((row) => ({
    ...row,
    decayedHeat: decayHeat(row.heat, row.last_decayed, now),
  }));

  // Persist decay via targeted column updates, NOT a full-row upsert. A
  // concurrent client write to value_alpha/value_beta/lens_counts (from a
  // fresh attempt, via api.ts) must never be clobbered by this job's stale
  // in-memory copy of those columns.
  const decayResults = await Promise.all(
    decayed.map((row) =>
      supabase
        .from("lr_memory_state")
        .update({ heat: row.decayedHeat, last_decayed: nowIso })
        .eq("user_id", DEFAULT_USER)
        .eq("concept_id", row.concept_id),
    ),
  );
  for (const res of decayResults) {
    if (res.error) {
      throw new QueryFailure("lr_memory_state (decay write)", res.error.message);
    }
  }

  // ── Step 2: due + priority ───────────────────────────────────────────────
  const unitConceptRows = unwrap<UnitConceptRow>(
    "lr_unit_concept",
    await supabase.from("lr_unit_concept").select("unit_id, concept_id"),
  );
  const unitOfConcept = new Map<string, number>();
  for (const r of unitConceptRows) {
    if (!unitOfConcept.has(r.concept_id)) unitOfConcept.set(r.concept_id, r.unit_id);
  }

  const due: DueConcept[] = decayed
    .filter((row) => {
      const comp = row.value_alpha / (row.value_alpha + row.value_beta);
      return row.decayedHeat < DUE_HEAT_THRESHOLD || comp < DUE_COMP_THRESHOLD;
    })
    .map((row) => ({
      concept_id: row.concept_id,
      unit_id: unitOfConcept.get(row.concept_id) ?? null,
      priority: priorityOf(row.decayedHeat, row.value_alpha, row.value_beta),
      least_seen_lens: leastSeenLens(row.lens_counts),
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, DUE_CAP);

  // ── Step 3: frontier ──────────────────────────────────────────────────
  const units = unwrap<UnitRow>(
    "lr_unit",
    await supabase
      .from("lr_unit")
      .select("unit_id, idx, code")
      .order("idx", { ascending: true }),
  );
  const progressRows = unwrap<UnitProgressRow>(
    "lr_unit_progress",
    await supabase
      .from("lr_unit_progress")
      .select("unit_id, status")
      .eq("user_id", DEFAULT_USER),
  );
  const statusOf = new Map<number, string>(progressRows.map((r) => [r.unit_id, r.status]));

  // "Has content" = at least one lr_unit_content row exists for the unit,
  // any status — draft/approved/live all count as "has something to show".
  const contentRows = unwrap<{ unit_id: number }>(
    "lr_unit_content",
    await supabase.from("lr_unit_content").select("unit_id"),
  );
  const unitsWithContent = new Set(contentRows.map((r) => r.unit_id));

  const inProgress = units.filter((u) => statusOf.get(u.unit_id) === "in_progress");

  let frontier: FrontierUnit[];
  if (inProgress.length > 0) {
    frontier = inProgress
      .slice(0, FRONTIER_CAP)
      .map((u) => ({ unit_id: u.unit_id, code: u.code, status: "in_progress" as const }));
  } else {
    // Fallback: the first not-mastered unit, in path order, that has content
    // and whose predecessor (previous idx) is mastered. The first unit in
    // the course has no predecessor, so it is vacuously eligible.
    frontier = [];
    for (let i = 0; i < units.length && frontier.length < FRONTIER_CAP; i++) {
      const u = units[i];
      if (statusOf.get(u.unit_id) === "mastered") continue;
      if (!unitsWithContent.has(u.unit_id)) continue;
      const predecessor = i > 0 ? units[i - 1] : null;
      const predecessorMastered =
        predecessor === null || statusOf.get(predecessor.unit_id) === "mastered";
      if (!predecessorMastered) continue;
      frontier.push({ unit_id: u.unit_id, code: u.code, status: "available" });
      break; // "the first" — the pinned spec names a single fallback candidate
    }
  }

  // ── Step 4: streak ────────────────────────────────────────────────────
  const todayLocal = localDate(now);
  const windowStart = shiftDate(todayLocal, -STREAK_WINDOW_DAYS);
  const attemptRows = unwrap<{ at: string }>(
    "lr_attempt_log",
    await supabase
      .from("lr_attempt_log")
      .select("at")
      .eq("user_id", DEFAULT_USER)
      .gte("at", windowStart),
  );
  const attemptLocalDates = new Set(attemptRows.map((r) => localDate(new Date(r.at))));
  const { streakDays, lastSessionDate } = computeStreak(attemptLocalDates, todayLocal);

  return {
    user_id: DEFAULT_USER,
    due_concepts: due,
    frontier_units: frontier,
    streak_days: streakDays,
    last_session_date: lastSessionDate,
    computed_at: nowIso,
  };
}

// Handles both the pg_cron POST and a manual POST/GET for testing. No auth
// check beyond the platform's: this function only ever recomputes a verdict
// from data the caller could already read, and accepts no input that changes
// the outcome.
Deno.serve(async (_req: Request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "server_misconfigured" }, 500);

  const supabase = createClient(url, key);
  const now = new Date();

  let row: LearnStateRow;
  try {
    row = await compute(supabase, now);
  } catch (err) {
    // lr_learn_state has NOT been touched at this point. (Heat decay may have
    // partially applied to lr_memory_state before the failure — that's fine,
    // it's idempotent/monotonic bookkeeping on a different table, not the
    // verdict row this invariant is about.) The previous lr_learn_state
    // verdict stands, which beats writing a wrong, fresh-looking one.
    const detail = err instanceof Error ? err.message : String(err);
    console.error("learn-evaluate: aborting before write —", detail);
    return json({ error: "evaluation_failed", detail, wrote: false }, 500);
  }

  // on_conflict named explicitly — PostgREST would default to the primary
  // key (user_id, here), but a mismatch surfaces as an opaque 409.
  const { error } = await supabase
    .from("lr_learn_state")
    .upsert(row, { onConflict: "user_id" });

  if (error) {
    console.error("learn-evaluate: write failed —", error.message);
    return json({ error: "write_failed", detail: error.message, wrote: false }, 500);
  }

  return json({ ok: true, timezone: TIMEZONE, ...row });
});
