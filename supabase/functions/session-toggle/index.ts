import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  computeStop,
  IDLE_STATE,
  parseRequest,
  rfc3339Utc,
  secretIsUsable,
  secretMatches,
  type SessionState,
  stateFromRow,
} from "./logic.ts";

/**
 * session-toggle — the write path the Nexus Local iOS widget uses to start and
 * stop a time-tracking session from the home screen.
 *
 * Same posture as `habit-toggle`, and for the same reason: a widget extension on
 * a free-tier sideloaded install cannot receive the user's JWT (App Groups need
 * paid provisioning — commit bbf60f1), so it cannot authenticate as the user.
 * Granting the *public* anon key INSERT/DELETE on `active_sessions` would make
 * those rows world-writable to anyone holding a key that ships in every web
 * bundle. Instead the widget holds a dedicated secret good for exactly two
 * operations — start a session, stop a session — and nothing else. It grants no
 * read access beyond the session state it returns (which the anon key can
 * already read anyway) and is revoked by rotating a single env var:
 *
 *     supabase secrets set WIDGET_SESSION_KEY=<value> --project-ref efxmzsdisaymtpebaxlp
 *
 * The residual risk, stated plainly: the secret ships inside a distributed
 * binary, so it is extractable. What this design buys is a blast radius of "can
 * start and stop this user's timer" instead of "can read and write everything
 * the anon role can reach".
 *
 * # Why the owner check is weaker here than in habit-toggle
 *
 * `habit-toggle` looks the habit up by the caller-supplied id and refuses ids
 * that don't belong to `OWNER_UID`, so a leaked key still can't touch another
 * account's rows. There is no caller-supplied id here: the TimeTracker tables
 * predate auth and key every row on the literal `user_id = 'default'` (see
 * `WidgetData.swift`'s `kTimeTrackerUserID` and `timetracker/mod.rs`). Pinning
 * `OWNER_USER_ID` below is therefore a *scoping* constant — it guarantees the
 * function can only ever address the one row set the widget also reads — not the
 * uid ownership proof `habit-toggle` performs. When TimeTracker's tables move to
 * `auth.uid()`, this becomes a real ownership check for free; until then, don't
 * read it as one.
 */

/** TimeTracker rows are keyed on this literal, not on an auth uid. */
const OWNER_USER_ID = "default";

/**
 * `active_sessions.device_id` and `time_entries.device_id` are both NOT NULL
 * with no default — omitting either is a 23502 on every single tap. One constant
 * for both so the `time_entries` conflict key stays deterministic across a retry.
 */
const WIDGET_DEVICE_ID = "ios-widget";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const state = (s: SessionState, extra: Record<string, unknown> = {}) =>
  json({ ok: true, session: s, ...extra });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const expected = Deno.env.get("WIDGET_SESSION_KEY") ?? "";
  // Fail closed: an unset or too-short secret must never mean "allow everyone".
  if (!secretIsUsable(expected)) return json({ error: "server_misconfigured" }, 500);

  if (!secretMatches(req.headers.get("x-widget-key") ?? "", expected)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const parsed = parseRequest(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // `active_sessions` has UNIQUE(user_id): exactly one active session per user
  // across every device, so this row is the whole world state.
  // `tags`, `notes`, `billable` and `hourly_rate` are selected only so `stop`
  // can copy them onto the `time_entries` row. The TimeTracker desktop app
  // writes them; dropping them here would silently strip a billable session's
  // rate the moment it happened to be stopped from the phone.
  const { data: existing, error: lookupError } = await supabase
    .from("active_sessions")
    // One string literal, not a concatenation: supabase-js parses the select at
    // the type level, and a `+` expression collapses the row type to
    // GenericStringError so every field access below fails to compile.
    .select("id,task_name,project,start_time,paused_at,elapsed_seconds,device_id,tags,notes,billable,hourly_rate")
    .eq("user_id", OWNER_USER_ID)
    .maybeSingle();

  if (lookupError) return json({ error: "lookup_failed" }, 500);

  // MARK: - start

  if (parsed.action === "start") {
    // Idempotent: a double-tap, or a tap on a phone that hadn't seen a session
    // started on the desktop, returns what is already running rather than
    // erroring or clobbering it. Deliberately NOT an upsert with
    // merge-duplicates — that would keep a paused row's `paused_at` and stale
    // `elapsed_seconds`, and the widget renders the brand-new session as
    // permanently paused.
    if (existing) return state(stateFromRow(existing), { alreadyRunning: true });

    const startTime = rfc3339Utc(new Date());
    const { data: inserted, error: insertError } = await supabase
      .from("active_sessions")
      .insert({
        user_id: OWNER_USER_ID,
        device_id: WIDGET_DEVICE_ID,
        task_name: parsed.taskName,
        project: parsed.project,
        start_time: startTime,
        // Explicit, not defaulted: a fresh session must never inherit a paused
        // shape from anywhere.
        paused_at: null,
        elapsed_seconds: 0,
      })
      .select("task_name,project,start_time,paused_at,elapsed_seconds")
      .maybeSingle();

    if (insertError) {
      // A concurrent start (another device, the same second) trips
      // UNIQUE(user_id). That is the idempotent case arriving a moment late, so
      // report the winner rather than a 500.
      const { data: raced } = await supabase
        .from("active_sessions")
        .select("task_name,project,start_time,paused_at,elapsed_seconds")
        .eq("user_id", OWNER_USER_ID)
        .maybeSingle();
      if (raced) return state(stateFromRow(raced), { alreadyRunning: true });
      return json({ error: "start_failed" }, 500);
    }

    return state(stateFromRow(inserted));
  }

  // MARK: - stop

  // Idempotent: stopping when nothing is running is a no-op success. A widget
  // whose timeline is a few minutes stale will do exactly this, and a 500 there
  // would clear the optimistic override into a state that is already correct.
  if (!existing) return state(IDLE_STATE, { alreadyStopped: true });

  // `now` is sampled exactly once and reused, matching session.rs's invariant —
  // two clock reads in one stop would let `end_time` and `duration_seconds`
  // disagree.
  const { durationSeconds, endTime } = computeStop({
    startTime: typeof existing.start_time === "string" ? existing.start_time : null,
    pausedAt: typeof existing.paused_at === "string" ? existing.paused_at : null,
    now: new Date(),
  });

  // Write the entry before clearing the session: if this fails the session
  // survives and the next tap retries, whereas the other order would lose the
  // session and the time with it.
  //
  // Upsert on the natural key so a retry after a partial failure (entry written,
  // delete failed) cannot double-count. Every component comes from the session
  // row, so the key is identical on every retry.
  const { error: entryError } = await supabase
    .from("time_entries")
    .upsert({
      user_id: OWNER_USER_ID,
      // Attribute the entry to the device that did the work, not the one tapping
      // stop — it also keeps the conflict key stable if two devices race here.
      device_id: typeof existing.device_id === "string" && existing.device_id.length > 0
        ? existing.device_id
        : WIDGET_DEVICE_ID,
      task_name: existing.task_name,
      project: existing.project,
      // Passed through verbatim rather than re-normalised: every component of
      // the conflict key then comes straight from the session row, so a retry
      // reproduces it byte for byte.
      start_time: existing.start_time,
      end_time: endTime,
      duration_seconds: durationSeconds,
      tags: existing.tags,
      notes: existing.notes,
      billable: existing.billable,
      hourly_rate: existing.hourly_rate,
    }, { onConflict: "device_id,start_time,task_name" });

  if (entryError) return json({ error: "entry_write_failed" }, 500);

  // Compare-and-swap on the row id, not just user_id. `active_sessions` is keyed
  // by `user_id` alone, so between the read above and this delete another device
  // can have stopped that session and started a *different* one under the same
  // key. Without the id clause this would delete the newcomer.
  //
  // A zero-row match is still a success: the entry is durable, and the session
  // is either already gone or is one this request must not touch. Erroring here
  // would clear the widget's optimistic override into a state that is already
  // correct — the opposite of what the idempotency contract asks for.
  const { error: deleteError } = await supabase
    .from("active_sessions")
    .delete()
    .eq("user_id", OWNER_USER_ID)
    .eq("id", existing.id);

  if (deleteError) return json({ error: "clear_failed" }, 500);

  return state(IDLE_STATE, {
    stopped: {
      taskName: existing.task_name,
      project: existing.project,
      startTime: existing.start_time,
      endTime,
      durationSeconds,
    },
  });
});
