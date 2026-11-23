// Supabase Edge Function: garmin-import
//
// Maps raw Garmin bridge JSON into the `protocol_*` tables.
//
// # Why this exists server-side
//
// The mapping used to live only in `apps/Protocol/src/lib/importers/garmin.ts`,
// wired to Protocol's push helpers and store types. That meant only Protocol
// could import — Nexus Local could pull from Garmin but had nowhere to put the
// result. Copying the mapping into Nexus Local would have forked it, and two
// drifting copies of health-data mapping produce *wrong* numbers, which is worse
// than none. One server-side copy, callable from anywhere, is the fix.
//
// # The data-source settings are load-bearing, not decorative
//
// `protocol_data_source_settings` decides, per metric, whether Garmin or Oura
// wins. A user can have Garmin for workouts and Oura for sleep and body — that
// is the real configuration this was built against. Importing everything Garmin
// returns would silently overwrite Oura's sleep with Garmin's, so each gated
// category is checked and skips are reported explicitly rather than passed over
// in silence.
//
// Running sessions and exercise sets are deliberately NOT gated: they are not
// among the three settings-controlled categories, and Oura has no equivalent.
// That matches the behaviour of the Protocol importer this replaces.

// ⚠️ DEPLOY WITH `--no-verify-jwt`.
//
// The Nexus Local WebView calls this with `X-Garmin-Key` and no `Authorization`
// header. With the platform's JWT check on, the gateway returns 401 *before*
// this code runs, and the UI shows a bare "import failed (401)" that looks like
// a bad scoped key. Same posture as `habit-toggle`, the closest precedent:
// the scoped secret is the authentication, and the anon key the gateway would
// demand is public anyway — requiring it adds friction, not security.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type ActivityIn,
  type Candidate,
  claimableDates,
  type Decision,
  type ExistingRow,
  planImport,
} from "./match.ts";

const MIN_KEY_LEN = 32;

/**
 * CORS, because a **browser** calls this one.
 *
 * `usage-ingest` never needed it: only the daemon posts there, via reqwest,
 * which does not preflight. This function is called from the Nexus Local
 * WebView, and the custom `X-Garmin-Key` header makes the request non-simple —
 * so WebKit sends an `OPTIONS` preflight first. Rejecting that (405, no CORS
 * headers) meant the real POST was never sent, and the only symptom in the UI
 * was WebKit's uselessly generic "Load failed".
 *
 * `*` is safe here: the scoped key is the authentication, and CORS is not the
 * boundary. A page that lacks the key gains nothing from being allowed to ask.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-garmin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const MAX_ITEMS = 2000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha), vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

/**
 * A UUID derived deterministically from a Garmin activity id.
 *
 * This is what makes re-syncing idempotent. `protocol_running_sessions` and
 * `protocol_workout_sessions` are unique on `id` alone, and the Protocol
 * importer minted `crypto.randomUUID()` on every run — so syncing the same week
 * twice inserted every activity twice, with no constraint to stop it. Hashing
 * Garmin's own activity id into the primary key means the second import updates
 * the row the first one wrote.
 *
 * Manually-created rows keep their random ids. A PLANNED row an activity
 * completes (see match.ts) keeps its random id too — after that it is found by
 * `external_id`, so stableId is only the id of rows this function inserted,
 * never an id to write onto a row that already exists.
 */
async function stableId(namespace: string, key: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${namespace}:${key}`),
  );
  const b = Array.from(new Uint8Array(digest)).slice(0, 16);
  // Stamp version 5 / RFC-4122 variant bits so it is a well-formed UUID rather
  // than 32 arbitrary hex digits in a uuid column.
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type Raw = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
/**
 * Rounded, for the many `integer` columns in `protocol_*`.
 *
 * Garmin returns floats for things Protocol stores as integers — elevation
 * comes back as 156.109375, and cadence and calories are often fractional too.
 * Postgres rejects those outright ("invalid input syntax for type integer"),
 * so the whole batch fails on one decimal. Only `actual_km`, `weight_kg` and
 * the other genuinely-numeric columns keep their precision via `num`.
 */
const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

/**
 * The user's timezone, for interpreting Garmin's naive local timestamps.
 * Same single-user decision as focus-evaluate's TIMEZONE — see the reasoning
 * there before "fixing" this into a per-user column.
 */
const TIMEZONE = "Europe/Copenhagen";

/** Matches a trailing UTC designator or numeric offset: Z, +02:00, -0500. */
const HAS_OFFSET = /([Zz]|[+-]\d{2}:?\d{2})$/;

/**
 * Garmin's `startTimeLocal` ("2026-08-15 18:03:21", naive, watch-local) as a
 * UTC ISO instant, for the `started_at timestamptz` columns.
 *
 * The naive string MUST be converted here: handing it to Postgres unlabelled
 * makes the database read it as UTC, shifting every workout by the whole
 * Copenhagen offset — 1 h in winter, 2 h in summer, silently.
 *
 * The offset is resolved via Intl in two passes: format the candidate instant
 * in TIMEZONE, measure how far the wall clock landed from the target, correct,
 * and measure once more so a start near a DST transition settles on the right
 * side. Null on anything unparseable — a missing start is a row that simply
 * doesn't render on a timeline, which beats a wrong one.
 */
function localToUtcIso(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  // Defensive: if a future bridge ever sends an offset-bearing string, it is
  // already an instant — converting it again would double-shift it.
  if (HAS_OFFSET.test(v)) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map((p) => Number(p ?? 0));
  const target = Date.UTC(y, mo - 1, d, h, mi, s || 0);

  const wallAsUtc = (instant: number): number => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  };

  let utc = target - (wallAsUtc(target) - target);
  utc = target - (wallAsUtc(utc) - utc);
  return new Date(utc).toISOString();
}

/** A positive integer or null — `protocol_running_sessions.duration_min` has a CHECK > 0. */
const positiveInt = (v: unknown): number | null => {
  const n = int(v);
  return n !== null && n > 0 ? n : null;
};

/** Drop null/undefined so a claim never erases a value the user typed by hand. */
function defined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
}

const IN_CHUNK = 200;

/** Rows in `table` that already carry one of these external_ids. Null on error. */
async function loadExisting(
  sb: SupabaseClient,
  table: string,
  userId: string,
  externalIds: string[],
): Promise<ExistingRow[] | null> {
  const out: ExistingRow[] = [];
  const ids = [...new Set(externalIds)];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await sb
      .from(table)
      .select("id, external_id")
      .eq("user_id", userId)
      .in("external_id", ids.slice(i, i + IN_CHUNK));
    if (error) return null;
    out.push(...(data as ExistingRow[]));
  }
  return out;
}

/** Planned rows (no external_id) on these dates. Null on error. */
async function loadCandidates(
  sb: SupabaseClient,
  table: string,
  dateCol: string,
  userId: string,
  dates: string[],
): Promise<Candidate[] | null> {
  if (!dates.length) return [];
  const { data, error } = await sb
    .from(table)
    .select(`id, date:${dateCol}, start_time, created_at, notes`)
    .eq("user_id", userId)
    .is("external_id", null)
    .in(dateCol, dates);
  if (error) return null;
  // The select string is built at runtime, so supabase-js cannot infer its
  // row type statically.
  return data as unknown as Candidate[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const expected = Deno.env.get("GARMIN_IMPORT_KEY") ?? "";
  const allowed = (Deno.env.get("GARMIN_ALLOWED_UIDS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  if (!url || !serviceKey) return json({ error: "server_misconfigured" }, 500);
  if (expected.length < MIN_KEY_LEN) return json({ error: "server_misconfigured" }, 500);

  if (!(await constantTimeEqual(req.headers.get("X-Garmin-Key") ?? "", expected))) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: Raw;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const userId = str(body.user_id);
  if (!userId) return json({ error: "missing_user_id" }, 400);
  // Same posture as usage-ingest: never fall back to a default owner. Writing
  // one person's training data under another's account is worse than refusing.
  if (!allowed.includes(userId)) return json({ error: "user_not_allowed" }, 403);

  const sb = createClient(url, serviceKey);

  const { data: settingsRow } = await sb
    .from("protocol_data_source_settings")
    .select("sleep_source, body_vitals_source, workouts_source")
    .eq("user_id", userId)
    .maybeSingle();
  // Defaults match Protocol's DEFAULT_DATA_SOURCE_SETTINGS: absent settings must
  // not silently enable an import the user never opted into.
  const settings = {
    sleep_source: settingsRow?.sleep_source ?? "oura",
    body_vitals_source: settingsRow?.body_vitals_source ?? "oura",
    workouts_source: settingsRow?.workouts_source ?? "oura",
  };

  const counts: Record<string, number> = {
    sleep: 0, body_stats: 0, runs: 0, workouts: 0, exercise_sets: 0,
  };
  const skipped: string[] = [];
  const errors: string[] = [];

  const arr = (v: unknown): Raw[] =>
    Array.isArray(v) ? (v.slice(0, MAX_ITEMS) as Raw[]) : [];

  // ── Sleep ────────────────────────────────────────────────────────────────
  const sleep = arr(body.sleep);
  if (sleep.length && settings.sleep_source !== "garmin") {
    skipped.push(`sleep: ${sleep.length} skipped — Oura is the selected sleep source`);
  } else if (sleep.length) {
    const rows = sleep.map((r) => ({
      user_id: userId,
      date: str(r.date),
      duration_min: int(r.duration_min),
      // Garmin scores sleep 0-100; every other producer and all of the UI use
      // 0-10. Dropping this division silently inflates sleep quality tenfold.
      quality_score: num(r.quality_score) === null ? null : Math.round(num(r.quality_score)!) / 10,
      deep_sleep_min: int(r.deep_sleep_min),
      rem_sleep_min: int(r.rem_sleep_min),
      light_sleep_min: int(r.light_sleep_min),
      awake_time_min: int(r.awake_time_min),
      respiratory_rate: num(r.respiratory_rate),
      temperature_deviation: num(r.temperature_deviation),
      bedtime_start: str(r.bedtime_start),
      bedtime_end: str(r.bedtime_end),
      notes: str(r.notes),
    })).filter((r) => r.date);
    const { error } = await sb.from("protocol_sleep").upsert(rows, { onConflict: "user_id,date" });
    if (error) errors.push(`sleep: ${error.message}`);
    else counts.sleep = rows.length;
  }

  // ── Body metrics ─────────────────────────────────────────────────────────
  const bodyStats = arr(body.body_stats);
  if (bodyStats.length && settings.body_vitals_source !== "garmin") {
    skipped.push(`body: ${bodyStats.length} skipped — Oura is the selected body vitals source`);
  } else if (bodyStats.length) {
    const rows = bodyStats.map((r) => ({
      user_id: userId,
      date: str(r.date),
      weight_kg: num(r.weight_kg),
      hrv_ms: num(r.hrv_ms),
      resting_hr_bpm: int(r.resting_hr_bpm),
      spo2_pct: num(r.spo2_pct),
      readiness_score: int(r.readiness_score),
      temperature_deviation: num(r.temperature_deviation),
      recovery_index: int(r.recovery_index),
      notes: str(r.notes),
    })).filter((r) => r.date);
    const { error } = await sb
      .from("protocol_body_metrics")
      .upsert(rows, { onConflict: "user_id,date" });
    if (error) errors.push(`body: ${error.message}`);
    else counts.body_stats = rows.length;
  }

  // ── Activities → runs + workouts ─────────────────────────────────────────
  //
  // Which row each activity lands in — the row it already has, a PLANNED
  // session it completes, or a new one — is decided in match.ts, pure and
  // tested; its header holds the rules (type gating, candidate ranking, why a
  // primary key is never rewritten). This section only reads and writes.
  const activities = arr(body.activities);
  type Item = { a: Raw; act: ActivityIn };
  const runItems: Item[] = [];
  const workoutItems: Item[] = [];
  let skippedWorkouts = 0;

  for (const a of activities) {
    const date = str(a.date);
    if (!date) continue;
    // Garmin sends `activityId` as a NUMBER (e.g. 23910675150), so this must
    // not go through the string guard — doing so rejects every real id and
    // silently falls through to the composite, which is the one case this key
    // exists to avoid.
    //
    // The composite is the fallback for a bridge predating `activity_id`: still
    // stable per (day, type, name, start), so an older client updates rather
    // than duplicating.
    const rawId = a.activity_id;
    const key =
      rawId !== null && rawId !== undefined && String(rawId).trim() !== ""
        ? String(rawId)
        : `${date}|${str(a.type) ?? ""}|${str(a.name) ?? ""}|${str(a.start_time) ?? ""}`;

    const isRun = a.type === "run";
    if (!isRun && settings.workouts_source !== "garmin") {
      skippedWorkouts++;
      continue;
    }
    (isRun ? runItems : workoutItems).push({
      a,
      act: {
        kind: isRun ? "run" : "workout",
        // The database's real dedupe key. `id` being deterministic makes THIS
        // function idempotent; `external_id` + its unique index makes a
        // duplicate impossible no matter which client writes.
        externalId: `garmin:${key}`,
        stableId: await stableId(isRun ? "garmin:run" : "garmin:workout", key),
        date,
        startLocal: str(a.start_time),
        // Garmin's raw activityType.typeKey. Absent from bridges older than
        // 2026-11-23 — such activities are inserted as before, never merged.
        typeKey: str(a.type_key),
      },
    });
  }

  /** Duration from the bridge, else derived from distance × pace. */
  const runDuration = (a: Raw): number | null => {
    const d = positiveInt(a.duration_min);
    if (d !== null) return d;
    const km = num(a.actual_km), pace = num(a.avg_pace_s_per_km);
    return km !== null && pace !== null ? positiveInt((km * pace) / 60) : null;
  };

  // What the watch MEASURED. This is all a claim writes onto a planned row —
  // the plan's name, routine_id, plan_id, planned_km, notes and start_time stay.
  const runMeasured = (a: Raw) => ({
    started_at: localToUtcIso(str(a.start_time)),
    actual_km: num(a.actual_km),
    avg_pace_s_per_km: int(a.avg_pace_s_per_km),
    heart_rate_avg: int(a.heart_rate_avg),
    heart_rate_max: int(a.heart_rate_max),
    elevation_gain_m: int(a.elevation_gain_m),
    cadence_avg: int(a.cadence_avg),
    calories: int(a.calories),
    duration_min: runDuration(a),
  });
  const workoutMeasured = (a: Raw) => ({
    started_at: localToUtcIso(str(a.start_time)),
    duration_min: int(a.duration_min),
    calories_burned: int(a.calories_burned) ?? int(a.calories),
    avg_heart_rate: int(a.avg_heart_rate) ?? int(a.heart_rate_avg),
  });

  // The full row this function owns: a new insert, or a re-sync of a row it
  // inserted (under that row's own id, which equals stableId).
  const runRow = (a: Raw, act: ActivityIn, id: string) => ({
    id,
    user_id: userId,
    external_id: act.externalId,
    plan_id: null,
    date: act.date,
    planned_km: null,
    ...runMeasured(a),
    completed: true,
    notes: str(a.name),
  });
  const workoutRow = (a: Raw, act: ActivityIn, id: string) => ({
    id,
    user_id: userId,
    external_id: act.externalId,
    plan_id: null,
    name: str(a.name) ?? "Workout",
    scheduled_date: act.date,
    ...workoutMeasured(a),
    completed: true,
    notes: "Garmin import",
  });

  // `counts` = activity rows written (new, or re-synced). `claimed` = planned
  // sessions completed by an activity THIS run — reported apart, so "0
  // imported" and "3 merged into your plans" never read the same.
  const claimed = { runs: 0, workouts: 0 };

  const importKind = async (
    label: "runs" | "workouts",
    table: string,
    dateCol: string,
    list: Item[],
    measured: (a: Raw) => Record<string, unknown>,
    fullRow: (a: Raw, act: ActivityIn, id: string) => Record<string, unknown>,
  ): Promise<void> => {
    if (!list.length) return;
    const acts = list.map((i) => i.act);

    // Without knowing which rows exist we could rewrite a claimed row's
    // primary key; without the plans we would re-create exactly the duplicate
    // this exists to prevent. Write nothing instead — the next sync retries.
    const existing = await loadExisting(sb, table, userId, acts.map((x) => x.externalId));
    if (!existing) {
      errors.push(`${label}: could not read existing rows — nothing written`);
      return;
    }
    const candidates = await loadCandidates(sb, table, dateCol, userId, claimableDates(acts, existing));
    if (!candidates) {
      errors.push(`${label}: could not read planned sessions — nothing written`);
      return;
    }

    const decisions: Decision[] = planImport(acts, existing, candidates);
    const upserts: Record<string, unknown>[] = [];
    let written = 0;

    // Sequential on purpose: a connection per row in parallel is the shape
    // that wedged Supabase on 2026-08-15.
    for (let i = 0; i < list.length; i++) {
      const d = decisions[i];
      const { a, act } = list[i];
      if (d.action === "duplicate") continue;
      if (d.action === "upsert") {
        upserts.push(fullRow(a, act, d.id));
        continue;
      }

      // Nulls dropped: a claim must not erase a value typed in by hand.
      const patch = { ...defined(measured(a)), completed: true };
      if (d.action === "resync-claimed") {
        const { error } = await sb.from(table).update(patch).eq("id", d.id).eq("user_id", userId);
        if (error) errors.push(`${label} ${act.externalId}: ${error.message}`);
        else written++;
        continue;
      }

      // Claim: an UPDATE by the planned row's id — not an upsert, which would
      // conflict on the PK rather than on external_id. Guarded on
      // external_id IS NULL so a plan a concurrent sync claimed is left alone.
      const { data, error } = await sb
        .from(table)
        .update({ ...patch, external_id: act.externalId })
        .eq("id", d.id)
        .eq("user_id", userId)
        .is("external_id", null)
        .select("id");
      if (error) {
        errors.push(`${label} ${act.externalId} → plan ${d.id}: ${error.message}`);
      } else if (data && data.length) {
        claimed[label]++;
      } else {
        // The plan changed under us (claimed concurrently, or deleted).
        // Inserting now could collide with that claim on (user_id,
        // external_id) and rewrite its id — so leave it: the next sync sees
        // the claimed row, or the gap, and does the right thing.
        skipped.push(`${label}: ${act.externalId} skipped — its planned session changed during import`);
      }
    }

    if (upserts.length) {
      const { error } = await sb.from(table).upsert(upserts, { onConflict: "user_id,external_id" });
      if (error) errors.push(`${label}: ${error.message}`);
      else written += upserts.length;
    }
    counts[label] = written;
  };

  await importKind("runs", "protocol_running_sessions", "date", runItems, runMeasured, runRow);
  await importKind("workouts", "protocol_workout_sessions", "scheduled_date", workoutItems, workoutMeasured, workoutRow);
  if (skippedWorkouts) {
    skipped.push(`workouts: ${skippedWorkouts} skipped — Oura is the selected workouts source`);
  }

  // ── Exercise sets ────────────────────────────────────────────────────────
  //
  // Replace-by-range, matching `replaceExerciseSetsInCloud`. Sets have no
  // stable per-set id from Garmin (they are positional within an activity), so
  // upserting would accumulate duplicates as sets are edited on the watch.
  //
  // The range is REQUIRED for this reason: a delete with a missing bound would
  // clear the user's whole history. Absent range = skip, never a broad delete.
  const sets = arr(body.exercise_sets);
  const rangeStart = str((body.range as Raw | undefined)?.start);
  const rangeEnd = str((body.range as Raw | undefined)?.end);
  if (sets.length || (rangeStart && rangeEnd && body.exercise_sets !== undefined)) {
    if (!rangeStart || !rangeEnd) {
      skipped.push("exercise_sets: skipped — a start/end range is required to replace safely");
    } else {
      const { error: delErr } = await sb
        .from("protocol_exercise_sets")
        .delete()
        .eq("user_id", userId)
        .gte("date", rangeStart)
        .lte("date", rangeEnd);
      if (delErr) errors.push(`exercise_sets delete: ${delErr.message}`);
      else if (sets.length) {
        const rows = sets.map((r) => ({
          user_id: userId,
          date: str(r.date),
          activity_name: str(r.activity_name),
          category: str(r.category),
          exercise_name: str(r.exercise_name),
          reps: int(r.reps),
          weight_kg: num(r.weight_kg),
          notes: "Garmin import",
        })).filter((r) => r.date);
        const { error } = await sb.from("protocol_exercise_sets").insert(rows);
        if (error) errors.push(`exercise_sets: ${error.message}`);
        else counts.exercise_sets = rows.length;
      }
    }
  }

  return json({ ok: errors.length === 0, counts, claimed, skipped, errors, settings });
});
