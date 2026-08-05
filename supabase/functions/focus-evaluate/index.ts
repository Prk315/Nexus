// Supabase Edge Function: focus-evaluate
//
// Collapses focus_blocks + unlock_rules + blocked_sites + blocked_apps + today's
// time_entries into ONE materialized verdict row per user:
//
//   blocking_state(user_id, effective_domains, effective_processes,
//                  reasons, today_minutes, computed_at)
//
// Runs on pg_cron every 5 minutes (job `nexus-focus-evaluate`). This is what
// makes blocking autonomous: a sideloaded free-tier iOS app gets no
// BGTaskScheduler and no silent push, so a schedule window opening at 09:00 or a
// reward unlocking at 60 tracked minutes has to be decided somewhere that is
// awake. That somewhere is here. Every client — widget, Mac grid node, app UI —
// reads the row and acts; none of them re-derive it.
//
// Same split as the Vellafit bridge (apps/Protocol/supabase/functions/
// bodyscan-sync): the device dumps raw facts, the server does the thinking on a
// schedule.
//
// The business rules are a port of `tick()` in
// apps/TimeTrackerApp/src-tauri/src/blocker/mod.rs. All of the decision logic
// lives in ./logic.ts so it can be unit-tested without a network or a clock;
// this file is I/O, validation, and the write.
//
// TIMEZONE: hardcoded to Europe/Copenhagen. Full reasoning in logic.ts — the
// short version is that focus_blocks times and time_entries.start_time are both
// naive *local* strings while this function runs in UTC, so `now` is resolved
// into local space once and every comparison happens there.
//
// CLOBBER-SAFE: the only table written is `blocking_state`, which nothing else
// writes. It touches no column it does not own — following the posture stated in
// bodyscan-sync.
//
// FAILS LOUDLY: every query error aborts with a 500 *before* any write. An empty
// effective_domains because a query errored is indistinguishable from "nothing
// is blocked", and the failure mode is that blocking silently switches off — so
// a partial state is never written.
//
// IDEMPOTENT: upserts on user_id. Two back-to-back runs produce identical policy
// columns; only computed_at moves.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

import {
  type BlockedAppRow,
  type BlockedSiteRow,
  evaluate,
  type EvaluateOutput,
  type FocusBlockRow,
  isoWeekday,
  localNow,
  TIMEZONE,
  type UnlockRuleRow,
} from "./logic.ts";

const DEFAULT_USER = "default";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Any query failure becomes this, and this aborts the run. */
class QueryFailure extends Error {
  constructor(readonly table: string, readonly detail: string) {
    super(`${table}: ${detail}`);
    this.name = "QueryFailure";
  }
}

/**
 * Unwrap a PostgREST result, converting an error into a thrown QueryFailure.
 * Nothing in this function is allowed to treat a failed query as an empty set.
 */
function unwrap<T>(
  table: string,
  res: { data: T[] | null; error: { message: string } | null },
): T[] {
  if (res.error) throw new QueryFailure(table, res.error.message);
  return res.data ?? [];
}

/**
 * Completed tracked minutes for `userId` on the local calendar day `localDate`.
 *
 * Only completed entries count — an in-flight session contributes nothing until
 * it is stopped, matching `tracked_minutes_today` in TimeTracker's schedule.rs.
 *
 * Two deliberate choices:
 *
 *  - `like '<date>%'` rather than a lexical range. time_entries.start_time is a
 *    naive local string and the SQLite era wrote some with a space separator
 *    instead of 'T' (see the note in NexusLocal's timetracker/mod.rs). Space
 *    (0x20) sorts below 'T' (0x54), so a `gte`/`lt` range would silently drop
 *    those rows, today_minutes would read low, and unlocks would never fire.
 *    A date-prefix match is separator-agnostic.
 *
 *  - For the default user, rows with a NULL user_id are included. This is a
 *    single-user system and the 252 legacy TimeTracker rows carry NULL;
 *    TimeTrackerApp is still in tree and can write more. They belong to
 *    'default'.
 *
 * Integer division to match the Rust/SQLite `SUM(duration_seconds) / 60`.
 */
async function trackedMinutesToday(
  supabase: SupabaseClient,
  userId: string,
  localDate: string,
): Promise<number> {
  let query = supabase
    .from("time_entries")
    .select("duration_seconds")
    .like("start_time", `${localDate}%`)
    .not("end_time", "is", null);

  query = userId === DEFAULT_USER
    ? query.or(`user_id.eq.${DEFAULT_USER},user_id.is.null`)
    : query.eq("user_id", userId);

  const rows = unwrap<{ duration_seconds: number | null }>(
    "time_entries",
    await query,
  );
  const seconds = rows.reduce((sum, r) => sum + (r.duration_seconds ?? 0), 0);
  return Math.floor(seconds / 60);
}

/** True when a session is running and not paused — drives `focus_only`. */
async function timerRunning(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const rows = unwrap<{ id: string }>(
    "active_sessions",
    await supabase
      .from("active_sessions")
      .select("id")
      .eq("user_id", userId)
      .is("paused_at", null)
      .limit(1),
  );
  return rows.length > 0;
}

/** Group rows by user_id, folding NULL into the default user. */
function byUser<T extends { user_id: string | null }>(
  rows: T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.user_id ?? DEFAULT_USER;
    const list = out.get(key);
    if (list) list.push(row);
    else out.set(key, [row]);
  }
  return out;
}

async function computeAll(
  supabase: SupabaseClient,
  now: Date,
): Promise<{ user_id: string; state: EvaluateOutput }[]> {
  // Config tables are tiny (single-digit rows), so they are fetched whole and
  // grouped in memory rather than queried once per user.
  const sites = unwrap<BlockedSiteRow>(
    "blocked_sites",
    await supabase.from("blocked_sites").select("user_id, domain, enabled"),
  );
  const apps = unwrap<BlockedAppRow>(
    "blocked_apps",
    await supabase
      .from("blocked_apps")
      .select("user_id, display_name, process_name, block_mode, enabled"),
  );
  const blocks = unwrap<FocusBlockRow>(
    "focus_blocks",
    await supabase
      .from("focus_blocks")
      .select(
        "id, user_id, name, start_time, end_time, days_of_week, color, enabled",
      ),
  );
  // `enabled` is selected explicitly on purpose. If the column is missing this
  // 400s and the whole run aborts — far better than `select("*")` plus a
  // default, which would make "column absent" indistinguishable from "every
  // rule is active" and hand out every unlock. The migration adds the column.
  const rules = unwrap<UnlockRuleRow>(
    "unlock_rules",
    await supabase
      .from("unlock_rules")
      .select("user_id, process_name, domain, required_minutes, enabled"),
  );

  // Schedule payload, joined by block_id. A 404 here means work unit 1's
  // migration has not been applied; that must abort rather than quietly
  // evaluate every focus block as blocking nothing.
  const blockIds = blocks.map((b) => b.id);
  const blockApps = new Map<string, string[]>();
  const blockSites = new Map<string, string[]>();

  if (blockIds.length > 0) {
    const appLinks = unwrap<{ block_id: string; process_name: string }>(
      "schedule_block_apps",
      await supabase
        .from("schedule_block_apps")
        .select("block_id, process_name")
        .in("block_id", blockIds),
    );
    for (const link of appLinks) {
      const list = blockApps.get(link.block_id);
      if (list) list.push(link.process_name);
      else blockApps.set(link.block_id, [link.process_name]);
    }

    const siteLinks = unwrap<{ block_id: string; domain: string }>(
      "schedule_block_sites",
      await supabase
        .from("schedule_block_sites")
        .select("block_id, domain")
        .in("block_id", blockIds),
    );
    for (const link of siteLinks) {
      const list = blockSites.get(link.block_id);
      if (list) list.push(link.domain);
      else blockSites.set(link.block_id, [link.domain]);
    }
  }

  const sitesByUser = byUser(sites);
  const appsByUser = byUser(apps);
  const blocksByUser = byUser(blocks);
  const rulesByUser = byUser(rules);

  // Currently only 'default', but derived rather than assumed so a second user
  // does not silently go unevaluated. 'default' is always present so its row is
  // written (and correctly emptied) even with no config rows at all.
  const users = new Set<string>([
    DEFAULT_USER,
    ...sitesByUser.keys(),
    ...appsByUser.keys(),
    ...blocksByUser.keys(),
    ...rulesByUser.keys(),
  ]);

  const { date: localDate, minutes: nowMinutes } = localNow(now, TIMEZONE);
  const weekday = isoWeekday(localDate);

  const out: { user_id: string; state: EvaluateOutput }[] = [];
  for (const userId of users) {
    const todayMinutes = await trackedMinutesToday(supabase, userId, localDate);
    const timerActive = await timerRunning(supabase, userId);

    out.push({
      user_id: userId,
      state: evaluate({
        sites: sitesByUser.get(userId) ?? [],
        apps: appsByUser.get(userId) ?? [],
        blocks: blocksByUser.get(userId) ?? [],
        blockApps,
        blockSites,
        rules: rulesByUser.get(userId) ?? [],
        weekday,
        nowMinutes,
        todayMinutes,
        timerActive,
      }),
    });
  }
  return out;
}

// Handles both the pg_cron POST and a manual POST/GET for testing. There is no
// auth check beyond the platform's: the cron job sends the service-role key and
// this function only ever recomputes a verdict from data the caller could
// already read. It accepts no input that changes the outcome.
Deno.serve(async (req: Request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "server_misconfigured" }, 500);

  const supabase = createClient(url, key);
  const now = new Date();

  let computed: { user_id: string; state: EvaluateOutput }[];
  try {
    computed = await computeAll(supabase, now);
  } catch (err) {
    // Nothing has been written at this point, so the previous verdict stands.
    // Stale blocking is a far better failure than absent blocking.
    const detail = err instanceof Error ? err.message : String(err);
    console.error("focus-evaluate: aborting before write —", detail);
    return json({ error: "evaluation_failed", detail, wrote: false }, 500);
  }

  const computedAt = now.toISOString();
  const rows = computed.map(({ user_id, state }) => ({
    user_id,
    effective_domains: state.effective_domains,
    effective_processes: state.effective_processes,
    reasons: state.reasons,
    today_minutes: state.today_minutes,
    computed_at: computedAt,
  }));

  // on_conflict named explicitly — PostgREST would default to the primary key
  // (which is user_id here), but a mismatch surfaces as an opaque 409.
  const { error } = await supabase
    .from("blocking_state")
    .upsert(rows, { onConflict: "user_id" });

  if (error) {
    console.error("focus-evaluate: write failed —", error.message);
    return json(
      { error: "write_failed", detail: error.message, wrote: false },
      500,
    );
  }

  // Returned so the state can be inspected without reading the table.
  return json({
    ok: true,
    timezone: TIMEZONE,
    computed_at: computedAt,
    local: localNow(now, TIMEZONE),
    states: rows,
  });
});
