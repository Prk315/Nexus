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

import { createClient } from "jsr:@supabase/supabase-js@2";

const MIN_KEY_LEN = 32;
const MAX_ITEMS = 2000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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
 * Manually-created rows keep their random ids and are never touched by this.
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

Deno.serve(async (req: Request) => {
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
  const activities = arr(body.activities);
  const runRows = [];
  const workoutRows = [];
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

    if (a.type === "run") {
      runRows.push({
        id: await stableId("garmin:run", key),
        user_id: userId,
        // The database's real dedupe key. `id` being deterministic makes THIS
        // function idempotent; `external_id` + its partial unique index makes
        // a duplicate impossible no matter which client writes.
        external_id: `garmin:${key}`,
        plan_id: null,
        date,
        planned_km: null,
        actual_km: num(a.actual_km),
        avg_pace_s_per_km: int(a.avg_pace_s_per_km),
        heart_rate_avg: int(a.heart_rate_avg),
        heart_rate_max: int(a.heart_rate_max),
        elevation_gain_m: int(a.elevation_gain_m),
        cadence_avg: int(a.cadence_avg),
        calories: int(a.calories),
        completed: true,
        notes: str(a.name),
      });
    } else if (settings.workouts_source === "garmin") {
      workoutRows.push({
        id: await stableId("garmin:workout", key),
        user_id: userId,
        external_id: `garmin:${key}`,
        plan_id: null,
        name: str(a.name) ?? "Workout",
        scheduled_date: date,
        completed: true,
        duration_min: int(a.duration_min),
        calories_burned: int(a.calories_burned) ?? int(a.calories),
        avg_heart_rate: int(a.avg_heart_rate) ?? int(a.heart_rate_avg),
        notes: "Garmin import",
      });
    } else {
      skippedWorkouts++;
    }
  }

  if (runRows.length) {
    const { error } = await sb.from("protocol_running_sessions").upsert(runRows, { onConflict: "user_id,external_id" });
    if (error) errors.push(`runs: ${error.message}`);
    else counts.runs = runRows.length;
  }
  if (workoutRows.length) {
    const { error } = await sb.from("protocol_workout_sessions").upsert(workoutRows, { onConflict: "user_id,external_id" });
    if (error) errors.push(`workouts: ${error.message}`);
    else counts.workouts = workoutRows.length;
  }
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

  return json({ ok: errors.length === 0, counts, skipped, errors, settings });
});
