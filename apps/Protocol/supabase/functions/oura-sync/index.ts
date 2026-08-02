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

/** Check-then-write per (user_id, date) — no unique constraint to rely on, so this stays safe against existing duplicate rows in protocol_body_metrics. */
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

async function syncUser(
  supabase: SupabaseClient,
  userId: string,
  clientId: string,
  clientSecret: string,
): Promise<{ user_id: string; status: string; sleepDays?: number; bodyDays?: number }> {
  const accessToken = await ensureFreshToken(supabase, userId, clientId, clientSecret);
  if (!accessToken) return { user_id: userId, status: "no_token_or_refresh_failed" };

  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - SYNC_WINDOW_DAYS);
  const params = { start_date: isoDate(start), end_date: isoDate(end) };

  const [dailySleep, sleepPeriods, dailyReadiness, dailySpo2] = await Promise.all([
    ouraGet(accessToken, "daily_sleep", params),
    ouraGet(accessToken, "sleep", params),
    ouraGet(accessToken, "daily_readiness", params),
    ouraGet(accessToken, "daily_spo2", params),
  ]);

  const sleepByDay = new Map(dailySleep.map((d) => [d.day as string, d]));
  const periodByDay = new Map(
    sleepPeriods.filter((p) => p.type === "long_sleep").map((p) => [p.day as string, p]),
  );
  const readinessByDay = new Map(dailyReadiness.map((d) => [d.day as string, d]));
  const spo2ByDay = new Map(dailySpo2.map((d) => [d.day as string, d]));

  const days = new Set([...sleepByDay.keys(), ...periodByDay.keys(), ...readinessByDay.keys(), ...spo2ByDay.keys()]);

  let sleepDays = 0;
  let bodyDays = 0;

  for (const day of days) {
    const ds = sleepByDay.get(day) as Record<string, any> | undefined;
    const period = periodByDay.get(day) as Record<string, any> | undefined;
    const readiness = readinessByDay.get(day) as Record<string, any> | undefined;
    const spo2 = spo2ByDay.get(day) as Record<string, any> | undefined;

    if (ds || period) {
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
          respiratory_rate: period?.average_breath ?? null,
          temperature_deviation: readiness?.temperature_deviation ?? null,
          bedtime_start: period?.bedtime_start ?? null,
          bedtime_end: period?.bedtime_end ?? null,
          notes: "Synced from Oura",
        });
        sleepDays++;
      }
    }

    if (readiness || period || spo2) {
      await upsertByDate(supabase, "protocol_body_metrics", userId, day, {
        weight_kg: null,
        hrv_ms: period?.average_hrv ?? null,
        resting_hr_bpm: period?.lowest_heart_rate ?? null,
        spo2_pct: spo2?.spo2_percentage?.average ?? null,
        readiness_score: readiness?.score ?? null,
        temperature_deviation: readiness?.temperature_deviation ?? null,
        recovery_index: readiness?.contributors?.recovery_index ?? null,
        notes: "Synced from Oura",
      });
      bodyDays++;
    }
  }

  return { user_id: userId, status: "ok", sleepDays, bodyDays };
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

  const results = [];
  for (const userId of userIds) {
    results.push(await syncUser(supabase, userId, clientId, clientSecret));
  }

  return jsonResponse({ synced: results });
});
