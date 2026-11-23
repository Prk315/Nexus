// garmin-import: which row does a Garmin activity land in?
//
// Pure on purpose — no Deno globals, no I/O, no jsr imports — so the rule can
// be tested without a database and without importing index.ts (which calls
// Deno.serve at module scope). index.ts fetches the rows, this decides, and
// index.ts writes.
//
// # The three outcomes
//
//   1. The activity was imported before (a row already carries its
//      `external_id`). Update THAT row, under ITS id. Never rewrite a primary
//      key: `protocol_exercises.session_id` references `protocol_workout_sessions.id`
//      (ON DELETE CASCADE, no ON UPDATE), so a PK change either fails on the
//      FK or, with no exercises attached, silently re-identifies the session.
//        - id === stableId(key): this function inserted it. Full upsert, as
//          before — a rename on the watch still reaches the row.
//        - any other id: it was a PLANNED row that a previous run claimed.
//          Measured fields only; the planned name, routine, plan, notes,
//          planned_km and start_time are the user's and stay.
//   2. New activity, and a planned session exists that day → CLAIM it
//      (UPDATE by the planned row's id) instead of inserting a second row.
//   3. Otherwise → insert, exactly as before.
//
// # The type rule — conservative by design
//
// The bridge collapses Garmin's activity types into two buckets: "run" (any
// typeKey containing `running` OR `walk`) and "workout" (everything else:
// strength, cycling, hiking, yoga, swimming, …). The bucket alone is therefore
// useless for matching — a walk arrives as a "run", a bike ride as a
// "workout". So the bridge now also sends Garmin's raw `type_key`, and only
// these may claim:
//
//   runs     → typeKey contains "running"  (running, trail_running,
//              treadmill_running, track_running, indoor_running, …).
//              A walk is "walking"/"casual_walking"/… and never claims a run.
//   workouts → typeKey contains "strength" (strength_training, …) — the same
//              predicate the bridge's own exercise_sets command uses to decide
//              what a strength session is. A walk, ride or yoga class never
//              completes a planned leg day.
//
// No `type_key` (a bridge older than this change) → never claims. The
// activity is inserted as it always was. Refusing to merge costs one
// duplicate row the user can delete; a wrong merge silently overwrites a
// plan with someone else's numbers.
//
// # What counts as a planned row
//
// `external_id IS NULL` (filtered by the query), same local date, and NOT
// written by another importer. `external_id IS NULL` alone is not enough:
// oura-sync, the Strava backfill and the pre-#60 Protocol Garmin importer all
// wrote completed sessions with no external_id. Claiming an Oura row would be
// actively destructive — oura-sync delete-and-reinserts every row with
// `notes = 'Synced from Oura'` in its window, which would delete the claimed
// Garmin data on its next pass. Those writers are recognised by their `notes`
// marker (see IMPORTED_NOTES). A new importer that writes no external_id must
// add its marker here, or — better — write an external_id.
//
// A planned row is a candidate whether or not it is `completed`: ticking it
// by hand and then syncing the watch must merge, not duplicate.
//
// # Choosing among several candidates
//
// Per date, every (activity, candidate) pair is ranked by
//   1. |activity local start − planned start_time| in minutes; a pair where
//      either side has no time ranks after every timed pair ("nulls last");
//   2. the candidate's created_at, oldest first;
//   3. the activity's position in the payload, then candidate id (determinism).
// and pairs are taken greedily, skipping any whose activity or candidate is
// already used. So each planned row is claimed at most once per run, each
// activity claims at most one row, and the closest pairing of the day wins
// globally rather than whichever activity happened to be listed first (plans
// 09:00 + 12:00, activities 11:00 + 12:00 → 12:00↔12:00, 11:00↔09:00).

export type ActivityKind = "run" | "workout";

export interface ActivityIn {
  kind: ActivityKind;
  /** `garmin:<key>` — what lands in the external_id column. */
  externalId: string;
  /** stableId(namespace, key) — the id this function would insert under. */
  stableId: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Garmin's naive local start ("2026-08-15 18:03:21"), or null. */
  startLocal: string | null;
  /** Garmin's activityType.typeKey, or null from an older bridge. */
  typeKey: string | null;
}

export interface ExistingRow {
  id: string;
  external_id: string;
}

export interface Candidate {
  id: string;
  /** scheduled_date for workouts, date for runs (aliased in the query). */
  date: string;
  /** Postgres `time` as PostgREST renders it: "18:00:00", or null. */
  start_time: string | null;
  created_at: string;
  notes: string | null;
}

export type Decision =
  /** Insert, or re-sync a row this function inserted. `id` is the row's id. */
  | { action: "upsert"; id: string }
  /** Re-sync of a row claimed on an earlier run: measured fields only. */
  | { action: "resync-claimed"; id: string }
  /** Complete this planned row. */
  | { action: "claim"; id: string }
  /** Same external_id earlier in this payload — written once, not twice. */
  | { action: "duplicate" };

/** Exact `notes` values written by importers that set no external_id. */
const IMPORTED_NOTES = new Set(["Synced from Oura", "Garmin import"]);
/** Strava backfill: "Strava: Lunch Run" (runs), "Strava (Svømning)" (workouts). */
const STRAVA_NOTES = /^Strava[ :(]/;

export function isImportedRow(notes: string | null): boolean {
  if (!notes) return false;
  const n = notes.trim();
  return IMPORTED_NOTES.has(n) || STRAVA_NOTES.test(n);
}

export function canClaim(kind: ActivityKind, typeKey: string | null): boolean {
  if (!typeKey) return false;
  const t = typeKey.toLowerCase();
  return kind === "run" ? t.includes("running") : t.includes("strength");
}

/**
 * Minutes since local midnight from either "18:03:21" or a naive
 * "2026-08-15 18:03:21" / "2026-08-15T18:03". Null when there is no clock time.
 */
export function minutesOfDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /(?:^|[T ])(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/**
 * Pair activities with planned rows. Returns activity index → candidate id.
 * `eligible` lists the indices allowed to claim (new + canClaim); the caller
 * passes candidates for ONE table, so kinds never cross.
 */
export function matchPlans(
  activities: ActivityIn[],
  eligible: number[],
  candidates: Candidate[],
): Map<number, string> {
  const usable = candidates.filter((c) => !isImportedRow(c.notes));
  const pairs: { ai: number; c: Candidate; dist: number }[] = [];
  for (const ai of eligible) {
    const a = activities[ai];
    const am = minutesOfDay(a.startLocal);
    for (const c of usable) {
      if (c.date !== a.date) continue;
      const cm = minutesOfDay(c.start_time);
      const dist = am === null || cm === null ? Number.POSITIVE_INFINITY : Math.abs(am - cm);
      pairs.push({ ai, c, dist });
    }
  }
  pairs.sort((x, y) =>
    x.dist - y.dist ||
    // Infinity - Infinity is NaN, which `||` treats as falsy → falls through.
    cmp(x.c.created_at, y.c.created_at) ||
    x.ai - y.ai ||
    cmp(x.c.id, y.c.id)
  );

  const out = new Map<number, string>();
  const taken = new Set<string>();
  for (const p of pairs) {
    if (out.has(p.ai) || taken.has(p.c.id)) continue;
    out.set(p.ai, p.c.id);
    taken.add(p.c.id);
  }
  return out;
}

/** Compare created_at as instants (`…Z` vs `…+00:00` are the same moment). */
function cmp(a: string, b: string): number {
  const ta = Date.parse(a), tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Decide every activity of ONE kind. `existing` are rows already carrying one
 * of these external_ids; `candidates` are that table's planned rows for the
 * relevant dates.
 */
export function planImport(
  activities: ActivityIn[],
  existing: ExistingRow[],
  candidates: Candidate[],
): Decision[] {
  const byExt = new Map(existing.map((r) => [r.external_id, r.id]));
  const seen = new Set<string>();
  const decisions: (Decision | null)[] = [];
  const eligible: number[] = [];

  activities.forEach((a, i) => {
    if (seen.has(a.externalId)) {
      decisions.push({ action: "duplicate" });
      return;
    }
    seen.add(a.externalId);
    const id = byExt.get(a.externalId);
    if (id !== undefined) {
      decisions.push(id === a.stableId ? { action: "upsert", id } : { action: "resync-claimed", id });
      return;
    }
    if (canClaim(a.kind, a.typeKey)) eligible.push(i);
    decisions.push(null);
  });

  const claims = matchPlans(activities, eligible, candidates);
  return decisions.map((d, i) => {
    if (d) return d;
    const planned = claims.get(i);
    return planned ? { action: "claim", id: planned } : { action: "upsert", id: activities[i].stableId };
  });
}

/** Dates that need a candidate lookup at all — skip the query when empty. */
export function claimableDates(activities: ActivityIn[], existing: ExistingRow[]): string[] {
  const ext = new Set(existing.map((r) => r.external_id));
  const dates = new Set<string>();
  for (const a of activities) {
    if (!ext.has(a.externalId) && canClaim(a.kind, a.typeKey)) dates.add(a.date);
  }
  return [...dates].sort();
}
