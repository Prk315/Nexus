import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const SYNC_WINDOW_DAYS = 7;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const payload = jwt.split(".")[1];
  return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function ouraGet(
  accessToken: string,
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const url = new URL(`https://api.ouraring.com/v2/usercollection/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    console.error(`Oura ${path} request failed`, res.status, await res.text());
    return [];
  }
  const json = await res.json();
  return json.data ?? [];
}

/** The heartrate endpoint is a flat time series (not day-keyed like the others)
 * and takes start_datetime/end_datetime instead of start_date/end_date. */
async function ouraGetHeartRate(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<{ bpm: number; timestamp: string }[]> {
  const url = new URL("https://api.ouraring.com/v2/usercollection/heartrate");
  url.searchParams.set("start_datetime", `${startDate}T00:00:00`);
  url.searchParams.set("end_datetime", `${endDate}T23:59:59`);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    console.error("Oura heartrate request failed", res.status, await res.text());
    return [];
  }
  const json = await res.json();
  return json.data ?? [];
}

/** Groups intraday heart rate samples by local calendar day (matching isoDate's
 * convention) and reduces each day to avg/min/max bpm. */
function aggregateHeartRateByDay(
  samples: { bpm: number; timestamp: string }[],
): Map<string, { avg: number; min: number; max: number }> {
  const byDay = new Map<string, number[]>();
  for (const s of samples) {
    const day = s.timestamp.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(s.bpm);
    byDay.set(day, list);
  }
  const result = new Map<string, { avg: number; min: number; max: number }>();
  for (const [day, bpms] of byDay) {
    result.set(day, {
      avg: Math.round((bpms.reduce((a, b) => a + b, 0) / bpms.length) * 10) / 10,
      min: Math.min(...bpms),
      max: Math.max(...bpms),
    });
  }
  return result;
}

async function ensureFreshToken(
  supabase: SupabaseClient,
  userId: string,
  clientId: string,
  clientSecret: string,
): Promise<string | null> {
  const { data: row } = await supabase
    .from("protocol_oura_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return null;

  if (new Date(row.expires_at).getTime() - Date.now() > REFRESH_BUFFER_MS) {
    return row.access_token;
  }

  const res = await fetch("https://api.ouraring.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    console.error(`Oura token refresh failed for ${userId}`, await res.text());
    return null;
  }
  const tokens = await res.json();
  await supabase
    .from("protocol_oura_tokens")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token, // Oura rotates refresh tokens — single use
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  return tokens.access_token;
}

type DataSource = "garmin" | "oura";
interface DataSourceSettings {
  sleep_source: DataSource;
  workouts_source: DataSource;
  hrv_source: DataSource;
  resting_hr_source: DataSource;
  readiness_source: DataSource;
  recovery_source: DataSource;
  spo2_source: DataSource;
  temperature_source: DataSource;
}
const DEFAULT_DATA_SOURCE_SETTINGS: DataSourceSettings = {
  sleep_source: "oura",
  workouts_source: "garmin",
  hrv_source: "oura",
  resting_hr_source: "oura",
  readiness_source: "oura",
  recovery_source: "oura",
  spo2_source: "oura",
  temperature_source: "oura",
};

/** No settings row means the user has never opened Settings — fall back to
 * the same defaults the client uses, so behavior is unchanged until they
 * actively pick a source. */
async function getDataSourceSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<DataSourceSettings> {
  const { data } = await supabase
    .from("protocol_data_source_settings")
    .select("sleep_source, workouts_source, hrv_source, resting_hr_source, readiness_source, recovery_source, spo2_source, temperature_source")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as DataSourceSettings | null) ?? DEFAULT_DATA_SOURCE_SETTINGS;
}

/** Check-then-write per (user_id, date). A unique constraint now backs this
 * as a defensive backstop, but the logic itself doesn't depend on it — only
 * the keys present in `fields` are touched on update, which is what lets
 * gated-off Oura vitals leave Garmin's existing values alone (see syncUser). */
async function upsertByDate(
  supabase: SupabaseClient,
  table: "protocol_sleep" | "protocol_body_metrics",
  userId: string,
  date: string,
  fields: Record<string, unknown>,
) {
  const { data: existing } = await supabase
    .from(table)
    .select("id")
    .eq("user_id", userId)
    .eq("date", date)
    .order("created_at", { ascending: false })
    .limit(1);

  if (existing && existing.length > 0) {
    await supabase.from(table).update(fields).eq("id", existing[0].id);
  } else {
    await supabase.from(table).insert({ id: crypto.randomUUID(), user_id: userId, date, ...fields });
  }
}

/** Oura's workout endpoint is session-level (activity/duration/calories), not
 * set/rep/weight like Garmin's exerciseSets — it maps to protocol_workout_sessions,
 * not protocol_exercise_sets. Field names below follow Oura's documented v2
 * schema; this account has no Oura-logged workouts yet to verify against a
 * live response, so double check on the first real sync (get_logs / a
 * fresh query) once a workout actually lands here.
 *
 * Multiple workouts can land on the same day, unlike sleep/body-vitals — so
 * this doesn't collapse to one-per-day. Re-running the sync must not
 * accumulate duplicates, so (mirroring replaceExerciseSetsInCloud's proven
 * pattern) it deletes-then-reinserts every Oura-sourced session in the sync
 * window, scoped by `notes = 'Synced from Oura'` so Garmin/Strava/manual
 * sessions in the same window are never touched. */
async function syncOuraWorkouts(
  supabase: SupabaseClient,
  userId: string,
  workouts: Record<string, unknown>[],
  startDate: string,
  endDate: string,
): Promise<{ count: number; error?: string }> {
  await supabase
    .from("protocol_workout_sessions")
    .delete()
    .eq("user_id", userId)
    .eq("notes", "Synced from Oura")
    .gte("scheduled_date", startDate)
    .lte("scheduled_date", endDate);

  const rows = workouts
    // scheduled_date is NOT NULL — an Oura workout with no `day` can't be stored.
    .filter((w) => typeof w.day === "string" && w.day)
    .map((w) => {
      const start = w.start_datetime as string | undefined;
      const end = w.end_datetime as string | undefined;
      const durationMin = start && end
        ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
        : null;
      // calories_burned is an INTEGER column, but Oura returns calories as a
      // float (e.g. 300.5). PostgREST rejects a fractional value for an int
      // column ("invalid input syntax for type integer"), which failed the
      // entire batch insert and silently dropped every Oura workout. Round it.
      const cal = w.calories != null ? Math.round(Number(w.calories)) : null;
      return {
        id: crypto.randomUUID(),
        user_id: userId,
        plan_id: null,
        name: (w.label as string | null) ?? (w.activity as string | null) ?? "Workout",
        scheduled_date: w.day as string,
        completed: true,
        duration_min: durationMin,
        calories_burned: cal != null && Number.isFinite(cal) ? cal : null,
        avg_heart_rate: null,
        notes: "Synced from Oura",
      };
    });

  if (rows.length === 0) return { count: 0 };

  const { error } = await supabase.from("protocol_workout_sessions").insert(rows);
  if (error) {
    // Surface it in the response too — this used to only console.error, which
    // is why the failure was invisible from the sync result.
    console.error(`Oura workout insert failed for ${userId}`, error.message);
    return { count: 0, error: error.message };
  }
  return { count: rows.length };
}

async function syncUser(
  supabase: SupabaseClient,
  userId: string,
  clientId: string,
  clientSecret: string,
  windowDays: number,
): Promise<{ user_id: string; status: string; sleepDays?: number; bodyDays?: number; workoutCount?: number; workoutError?: string }> {
  const accessToken = await ensureFreshToken(supabase, userId, clientId, clientSecret);
  if (!accessToken) return { user_id: userId, status: "no_token_or_refresh_failed" };

  const settings = await getDataSourceSettings(supabase, userId);

  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - windowDays);
  const params = { start_date: isoDate(start), end_date: isoDate(end) };

  const [dailySleep, sleepPeriods, dailyReadiness, dailySpo2, dailyStress, heartRateSamples, dailyResilience, dailyCardioAge, dailyActivity, workouts] = await Promise.all([
    ouraGet(accessToken, "daily_sleep", params),
    ouraGet(accessToken, "sleep", params),
    ouraGet(accessToken, "daily_readiness", params),
    ouraGet(accessToken, "daily_spo2", params),
    ouraGet(accessToken, "daily_stress", params),
    ouraGetHeartRate(accessToken, params.start_date, params.end_date),
    ouraGet(accessToken, "daily_resilience", params),
    ouraGet(accessToken, "daily_cardiovascular_age", params),
    ouraGet(accessToken, "daily_activity", params),
    ouraGet(accessToken, "workout", params),
  ]);

  const sleepByDay = new Map(dailySleep.map((d) => [d.day as string, d]));
  const periodByDay = new Map(
    sleepPeriods.filter((p) => p.type === "long_sleep").map((p) => [p.day as string, p]),
  );
  const readinessByDay = new Map(dailyReadiness.map((d) => [d.day as string, d]));
  const spo2ByDay = new Map(dailySpo2.map((d) => [d.day as string, d]));
  const stressByDay = new Map(dailyStress.map((d) => [d.day as string, d]));
  const heartRateByDay = aggregateHeartRateByDay(heartRateSamples);
  const resilienceByDay = new Map(dailyResilience.map((d) => [d.day as string, d]));
  const cardioAgeByDay = new Map(dailyCardioAge.map((d) => [d.day as string, d]));
  const activityByDay = new Map(dailyActivity.map((d) => [d.day as string, d]));

  const days = new Set([
    ...sleepByDay.keys(), ...periodByDay.keys(), ...readinessByDay.keys(), ...spo2ByDay.keys(),
    ...stressByDay.keys(), ...heartRateByDay.keys(), ...resilienceByDay.keys(), ...cardioAgeByDay.keys(),
    ...activityByDay.keys(),
  ]);

  let sleepDays = 0;
  let bodyDays = 0;

  for (const day of days) {
    const ds = sleepByDay.get(day) as Record<string, any> | undefined;
    const period = periodByDay.get(day) as Record<string, any> | undefined;
    const readiness = readinessByDay.get(day) as Record<string, any> | undefined;
    const spo2 = spo2ByDay.get(day) as Record<string, any> | undefined;
    const stress = stressByDay.get(day) as Record<string, any> | undefined;
    const heartRate = heartRateByDay.get(day);
    const resilience = resilienceByDay.get(day) as Record<string, any> | undefined;
    const cardioAge = cardioAgeByDay.get(day) as Record<string, any> | undefined;
    const activity = activityByDay.get(day) as Record<string, any> | undefined;

    if ((ds || period) && settings.sleep_source === "oura") {
      const durationMin = period?.total_sleep_duration != null
        ? Math.round(period.total_sleep_duration / 60)
        : period?.time_in_bed != null && period?.awake_time != null
        ? Math.round((period.time_in_bed - period.awake_time) / 60)
        : 0;

      if (durationMin > 0) {
        await upsertByDate(supabase, "protocol_sleep", userId, day, {
          duration_min: durationMin,
          quality_score: ds?.score != null ? Math.round(ds.score) / 10 : 0,
          deep_sleep_min: period?.deep_sleep_duration != null ? Math.round(period.deep_sleep_duration / 60) : null,
          rem_sleep_min: period?.rem_sleep_duration != null ? Math.round(period.rem_sleep_duration / 60) : null,
          light_sleep_min: period?.light_sleep_duration != null ? Math.round(period.light_sleep_duration / 60) : null,
          awake_time_min: period?.awake_time != null ? Math.round(period.awake_time / 60) : null,
          sleep_latency_min: period?.latency != null ? Math.round(period.latency / 60) : null,
          respiratory_rate: period?.average_breath ?? null,
          temperature_deviation: readiness?.temperature_deviation ?? null,
          bedtime_start: period?.bedtime_start ?? null,
          bedtime_end: period?.bedtime_end ?? null,
          notes: "Synced from Oura",
        });
        sleepDays++;
      }
    }

    if (readiness || period || spo2 || stress || heartRate || resilience || cardioAge || activity) {
      // Fields Garmin can also produce — only written when Oura is the
      // selected body-vitals source, so a "garmin" selection isn't clobbered
      // with Oura nulls/values on every sync.
      //
      // NOTE: weight_kg is intentionally NOT written here. Oura has no body
      // weight, and blindly writing weight_kg:null onto the (user_id,date) row
      // wiped the Vellafit scale's real weight every morning (the scale's
      // body-composition row shares this row). Leaving the key out means the
      // update never touches weight_kg, so the scale value survives.
      // Per-metric: Oura only writes a field it owns, so a "garmin" selection for
      // that metric isn't clobbered. avg/min/max HR ride with resting_hr_source.
      const overlappingFields = {
        ...(settings.hrv_source === "oura" ? { hrv_ms: period?.average_hrv ?? null } : {}),
        ...(settings.resting_hr_source === "oura" ? { resting_hr_bpm: period?.lowest_heart_rate ?? null } : {}),
        ...(settings.spo2_source === "oura" ? { spo2_pct: spo2?.spo2_percentage?.average ?? null } : {}),
        ...(settings.readiness_source === "oura" ? { readiness_score: readiness?.score ?? null } : {}),
        ...(settings.temperature_source === "oura" ? { temperature_deviation: readiness?.temperature_deviation ?? null } : {}),
        ...(settings.recovery_source === "oura" ? { recovery_index: readiness?.contributors?.recovery_index ?? null } : {}),
        ...(settings.resting_hr_source === "oura" ? {
          avg_heart_rate_bpm: heartRate?.avg ?? null,
          min_heart_rate_bpm: heartRate?.min ?? null,
          max_heart_rate_bpm: heartRate?.max ?? null,
        } : {}),
      };
      // Oura-exclusive — Garmin has no equivalent, so always write these
      // regardless of the body-vitals toggle; there's no real conflict to
      // arbitrate.
      const exclusiveFields = {
        stress_high_min: stress?.stress_high != null ? Math.round(stress.stress_high / 60) : null,
        stress_recovery_min: stress?.recovery_high != null ? Math.round(stress.recovery_high / 60) : null,
        stress_summary: stress?.day_summary ?? null,
        resilience_level: resilience?.level ?? null,
        resilience_sleep_recovery: resilience?.contributors?.sleep_recovery ?? null,
        resilience_daytime_recovery: resilience?.contributors?.daytime_recovery ?? null,
        resilience_stress: resilience?.contributors?.stress ?? null,
        cardio_age: cardioAge?.vascular_age ?? null,
        pulse_wave_velocity: cardioAge?.pulse_wave_velocity ?? null,
      };
      // Oura daily activity — steps/calories/MET. Not gated by a source toggle
      // (there's no activity_source, and nothing else writes these columns), so
      // written whenever Oura returns an activity day.
      const activityFields = activity ? {
        activity_score: activity.score ?? null,
        steps: activity.steps ?? null,
        active_calories: activity.active_calories ?? null,
        total_calories: activity.total_calories ?? null,
        target_calories: activity.target_calories ?? null,
        high_activity_min: activity.high_activity_time != null ? Math.round(activity.high_activity_time / 60) : null,
        medium_activity_min: activity.medium_activity_time != null ? Math.round(activity.medium_activity_time / 60) : null,
        low_activity_min: activity.low_activity_time != null ? Math.round(activity.low_activity_time / 60) : null,
        average_met: activity.average_met_minutes ?? null,
      } : {};
      await upsertByDate(supabase, "protocol_body_metrics", userId, day, {
        ...overlappingFields,
        ...exclusiveFields,
        ...activityFields,
        notes: "Synced from Oura",
      });
      bodyDays++;
    }
  }

  const workoutResult = settings.workouts_source === "oura"
    ? await syncOuraWorkouts(supabase, userId, workouts, params.start_date, params.end_date)
    : { count: 0 };

  return {
    user_id: userId,
    status: "ok",
    sleepDays,
    bodyDays,
    workoutCount: workoutResult.count,
    workoutError: workoutResult.error,
  };
}

// Browser calls (Connect/Sync UI) trigger a CORS preflight; pg_cron's net.http_post
// call does not, but sending these headers on every response is harmless either way.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");

  let claims: Record<string, unknown>;
  try {
    claims = decodeJwtPayload(jwt);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const [{ data: clientId }, { data: clientSecret }] = await Promise.all([
    supabase.rpc("get_protocol_secret", { secret_name: "oura_client_id" }),
    supabase.rpc("get_protocol_secret", { secret_name: "oura_client_secret" }),
  ]);
  if (!clientId || !clientSecret) {
    return jsonResponse({ error: "missing_oura_credentials" }, 500);
  }

  let userIds: string[];
  if (claims.role === "service_role") {
    // Cron / system call — sync every connected account.
    const { data } = await supabase.from("protocol_oura_tokens").select("user_id");
    userIds = (data ?? []).map((r) => r.user_id as string);
  } else if (typeof claims.sub === "string") {
    // A real user session — sync just that account.
    userIds = [claims.sub];
  } else {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  // Optional { "days": N } body widens the sync window for one-off backfills;
  // the daily cron sends {} and uses the default. Clamped to 90.
  let windowDays = SYNC_WINDOW_DAYS;
  try {
    const body = await req.json();
    if (typeof body?.days === "number" && body.days > 0) windowDays = Math.min(Math.floor(body.days), 90);
  } catch { /* no/invalid body — use default */ }

  const results = [];
  for (const userId of userIds) {
    results.push(await syncUser(supabase, userId, clientId, clientSecret, windowDays));
  }

  return jsonResponse({ synced: results, windowDays });
});
