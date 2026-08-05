/**
 * Pure logic for `session-toggle`, split out of `index.ts` so it can be tested
 * without booting `Deno.serve` or reaching Supabase. Nothing in here does I/O.
 *
 * Test files are not imported by `index.ts`, so they are never bundled into the
 * deployed function.
 */

/** `active_sessions.task_name` is NOT NULL; keep the bound well under any UI. */
export const MAX_TASK_NAME = 120;
export const MAX_PROJECT = 120;

/** Minimum length for `WIDGET_SESSION_KEY`. Below this the function fails closed. */
export const MIN_SECRET_LENGTH = 32;

/**
 * Length-independent comparison so a wrong key can't be recovered by timing.
 * (Length itself still leaks — same as `habit-toggle`; it is not the secret.)
 */
export function secretMatches(candidate: string, expected: string): boolean {
  const a = new TextEncoder().encode(candidate);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Is the configured secret usable? An unset or stubby env var must never mean
 * "allow everyone" — an empty string compiles and deploys perfectly cleanly and
 * would turn `x-widget-key: ""` into a valid credential.
 */
export function secretIsUsable(expected: string | undefined): boolean {
  return typeof expected === "string" && expected.length >= MIN_SECRET_LENGTH;
}

// MARK: - Input validation

export type ParsedRequest =
  | { ok: true; action: "start"; taskName: string; project: string | null }
  | { ok: true; action: "stop" }
  | { ok: false; error: string };

/**
 * Validate the request body. `start` needs a non-empty, length-bounded task
 * name; `project` is optional. `stop` takes nothing — the row on the server is
 * the only description of what is being stopped.
 */
export function parseRequest(body: unknown): ParsedRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_body" };
  }
  const { action, taskName, project } = body as Record<string, unknown>;

  if (action === "stop") return { ok: true, action: "stop" };
  if (action !== "start") return { ok: false, error: "invalid_action" };

  if (typeof taskName !== "string") return { ok: false, error: "invalid_taskName" };
  const trimmed = taskName.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TASK_NAME) {
    return { ok: false, error: "invalid_taskName" };
  }

  let cleanProject: string | null = null;
  if (project !== undefined && project !== null) {
    if (typeof project !== "string") return { ok: false, error: "invalid_project" };
    const p = project.trim();
    if (p.length > MAX_PROJECT) return { ok: false, error: "invalid_project" };
    cleanProject = p.length > 0 ? p : null;
  }

  return { ok: true, action: "start", taskName: trimmed, project: cleanProject };
}

// MARK: - Timestamps

/**
 * RFC3339 UTC at *second* precision.
 *
 * The trailing `.mmm` that `toISOString()` emits is the difference between the
 * widget showing a live counter and showing "paused": `ISO8601DateFormatter()`
 * defaults to `.withInternetDateTime`, which rejects fractional seconds, so
 * `TimeTrackerProvider.fetchEntry` would decode `start_time` to nil and fall
 * through to the paused branch. Everything written from here drops them.
 */
export function rfc3339Utc(date: Date): string {
  return date.toISOString().replace(/\.\d{1,9}Z$/, "Z");
}

// MARK: - Duration

/**
 * Parse a timestamp out of these TEXT columns. RFC3339 is what everything
 * writes now; the offset-less fallbacks read rows the SQLite-era desktop app
 * left behind, in both the `T` and space-separated spellings.
 *
 * Mirrors `session.rs::parse_ts`, with one difference worth knowing: an
 * offset-less string is resolved in the *reading* process's zone, and this
 * process is an edge function running in UTC, whereas the Rust client runs in
 * the user's zone. So the two can derive elapsed values that differ by the
 * user's UTC offset — but only for legacy rows, and only until the first stop
 * rewrites them. Nothing written from here is ever offset-free.
 */
export function parseTimestamp(value: string | null | undefined): Date | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (s.length === 0) return null;
  const ms = Date.parse(s);
  if (Number.isFinite(ms)) return new Date(ms);
  const retry = Date.parse(s.replace(" ", "T"));
  return Number.isFinite(retry) ? new Date(retry) : null;
}

export interface StopInput {
  /** `active_sessions.start_time` as stored (TEXT). */
  startTime: string | null;
  /** `active_sessions.paused_at` — non-null means the timer is frozen. */
  pausedAt: string | null;
  now: Date;
}

export interface StopResult {
  durationSeconds: number;
  endTime: string;
}

/**
 * How long the session ran: `end - start_time`, where `end` is the moment it was
 * paused if it was paused, otherwise now.
 *
 * This is deliberately the *same single formula* as `session.rs::tt_session_stop`
 * rather than a separate `elapsed_seconds` branch for the paused case. Both give
 * the same number, because `pause` writes `paused_at` and `elapsed_seconds` from
 * one clock read and so `paused_at - start_time == elapsed_seconds` holds by
 * construction. Where they could differ, two writers to the same table
 * disagreeing about a duration is worse than either formula's edge case — so
 * this matches the Rust path exactly.
 *
 * Taking `end` from `paused_at` is what stops a session paused at 17:00 and
 * stopped the next morning from billing the whole night.
 *
 * Clamped `>= 0`: clock skew or a hand-edited row must not write a negative
 * duration that then subtracts from today's total. An unparseable `start_time`
 * yields 0, never NaN — NaN would reach Postgres as null and silently drop the
 * entry out of every total.
 */
export function computeStop(input: StopInput): StopResult {
  const { startTime, pausedAt, now } = input;

  const end = parseTimestamp(pausedAt) ?? now;
  const start = parseTimestamp(startTime);
  const durationSeconds = start === null
    ? 0
    : Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));

  return { durationSeconds, endTime: rfc3339Utc(end) };
}

// MARK: - Response shape

export interface SessionState {
  running: boolean;
  taskName: string | null;
  project: string | null;
  startTime: string | null;
  pausedAt: string | null;
  elapsedSeconds: number;
}

export const IDLE_STATE: SessionState = {
  running: false,
  taskName: null,
  project: null,
  startTime: null,
  pausedAt: null,
  elapsedSeconds: 0,
};

/** Project an `active_sessions` row into the JSON the widget reconciles against. */
export function stateFromRow(row: Record<string, unknown> | null): SessionState {
  if (!row) return IDLE_STATE;
  const pausedAt = typeof row.paused_at === "string" && row.paused_at.length > 0
    ? row.paused_at
    : null;
  return {
    // "running" means a session exists and is not paused — the same predicate
    // TimeTrackerProvider uses, so widget and server can't disagree about it.
    running: pausedAt === null,
    taskName: typeof row.task_name === "string" ? row.task_name : null,
    project: typeof row.project === "string" ? row.project : null,
    startTime: typeof row.start_time === "string" ? row.start_time : null,
    pausedAt,
    elapsedSeconds: typeof row.elapsed_seconds === "number" ? row.elapsed_seconds : 0,
  };
}
