// Pure decision logic for `focus-evaluate`. No I/O, no Deno APIs, no clock
// reads — everything that decides whether a target is blocked lives here so it
// can be unit-tested (see index_test.ts).
//
// This is a faithful port of the `tick()` function in
// apps/TimeTrackerApp/src-tauri/src/blocker/mod.rs (lines ~105-241). Where the
// original silently `continue`s, this returns false rather than throwing — the
// behaviours are deliberately identical, including the ones that look like bugs.
// See the comments on `windowActive` and `evaluate` for the two that matter.

// ── Timezone ─────────────────────────────────────────────────────────────────
//
// THE DECISION: the user's local timezone is hardcoded to Europe/Copenhagen.
//
// This is a single-user personal system, and saying so plainly beats pretending
// otherwise. There is no per-user timezone column to read, and inventing one
// would be a schema fiction with exactly one row in it.
//
// Why it matters: `focus_blocks.start_time`/`end_time` are local "HH:MM" and
// `time_entries.start_time` is a naive local timestamp string with no offset
// (TimeTracker's SQLite legacy — verified in the live table: all 260 rows look
// like `2026-07-02T18:44:30.059`). The edge function runs in UTC. Comparing
// those local strings against UTC is a real off-by-hours bug: in Copenhagen it
// shifts every window by 1h in winter and 2h in summer, and it moves the
// "today" boundary for reward unlocks.
//
// The approach: resolve *now* into a local calendar date and a local
// minute-of-day exactly once, via Intl with an explicit zone, then do all
// comparisons in that local space as plain strings/integers. Entries are never
// converted — their date prefix is matched against the local date string.
export const TIMEZONE = "Europe/Copenhagen";

// ── Row shapes (only the columns this function reads) ────────────────────────

export interface BlockedSiteRow {
  user_id: string | null;
  domain: string;
  enabled: boolean;
}

export interface BlockedAppRow {
  user_id: string | null;
  display_name: string;
  process_name: string;
  /** "always" | "focus_only" */
  block_mode: string;
  enabled: boolean;
}

export interface FocusBlockRow {
  id: string;
  user_id: string | null;
  name: string;
  /** Local "HH:MM". */
  start_time: string;
  /** Local "HH:MM". */
  end_time: string;
  /** Comma-separated ISO weekdays, e.g. "1,2,3,4,5". TEXT, not an array. */
  days_of_week: string;
  color: string;
  enabled: boolean;
}

export interface UnlockRuleRow {
  user_id: string | null;
  process_name: string | null;
  domain: string | null;
  required_minutes: number;
  enabled: boolean;
}

export interface MealSessionRow {
  user_id: string | null;
  /** "breakfast" | "lunch" | "dinner" (CHECK-constrained; treated as opaque here). */
  meal: string;
  /** timestamptz — PostgREST renders RFC3339 with an offset. */
  started_at: string;
  /** timestamptz, started_at + 30 min as written by the app. */
  ends_at: string;
}

export interface MealTargetRow {
  user_id: string | null;
  meal: string;
  domain: string | null;
  process_name: string | null;
}

export interface EvaluateInput {
  sites: BlockedSiteRow[];
  apps: BlockedAppRow[];
  blocks: FocusBlockRow[];
  /** block_id -> process names, from schedule_block_apps. */
  blockApps: Map<string, string[]>;
  /** block_id -> domains, from schedule_block_sites. */
  blockSites: Map<string, string[]>;
  rules: UnlockRuleRow[];
  /**
   * Meal-session state. All three are optional so pre-existing callers (and
   * tests) keep compiling; absent means "no meal session can be active", which
   * fails toward blocked — the direction every accidental path here must take.
   */
  mealSessions?: MealSessionRow[];
  mealTargets?: MealTargetRow[];
  /** Epoch ms of *now*, for comparing meal session windows. */
  nowMs?: number;
  /** ISO weekday of *today* in local time: 1=Mon … 7=Sun. */
  weekday: number;
  /** Local minute-of-day, 0..1439. */
  nowMinutes: number;
  /** Completed tracked minutes today, local-day scoped. */
  todayMinutes: number;
  /** True when a session is running and not paused. Drives `focus_only`. */
  timerActive: boolean;
}

export type Reason = Record<string, unknown>;

export interface EvaluateOutput {
  effective_domains: string[];
  effective_processes: string[];
  reasons: Record<string, Reason>;
  today_minutes: number;
}

// ── Time helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve an instant into the local calendar date ("YYYY-MM-DD") and
 * minute-of-day, in `tz`.
 *
 * `hourCycle: "h23"` rather than `hour12: false` — the latter renders midnight
 * as "24" under some ICU versions, which would put nowMinutes at 1440 and make
 * every normal window read as already-ended for the first hour of the day.
 */
export function localNow(
  now: Date,
  tz: string = TIMEZONE,
): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return { date, minutes };
}

/** Matches a trailing UTC designator or numeric offset: Z, +02:00, -0500. */
const HAS_OFFSET = /([Zz]|[+-]\d{2}:?\d{2})$/;

/**
 * The local calendar day a `time_entries` row belongs to.
 *
 * `time_entries.start_time` is TEXT and TWO formats coexist:
 *
 *  - **Naive local, no offset** — `2026-07-02T18:44:30.059`. TimeTracker's
 *    SQLite era, and all 260 rows live today. Some legacy rows use a space
 *    separator instead of `T`, so the date is taken by prefix rather than by
 *    parsing.
 *  - **RFC3339 UTC with an offset** — `2026-08-05T22:30:00+00:00`. What
 *    `now_rfc3339()` in NexusLocal's timetracker/mod.rs produces, which is what
 *    new writes use.
 *
 * Treating the second kind as naive is a real off-by-hours bug: a 00:30-local
 * session stores as `…T22:30:00+00:00` and would be attributed to the previous
 * local day, so `today_minutes` reads low and unlocks never fire.
 *
 * So: offset-bearing strings are parsed as instants and projected into `tz`;
 * everything else is already local and its date prefix is taken verbatim.
 */
export function entryLocalDate(startTime: string, tz: string = TIMEZONE): string {
  const value = (startTime ?? "").trim();
  if (HAS_OFFSET.test(value)) {
    const instant = new Date(value);
    if (!Number.isNaN(instant.getTime())) return localNow(instant, tz).date;
  }
  return value.slice(0, 10);
}

/**
 * ISO weekday (1=Mon … 7=Sun) for a "YYYY-MM-DD" local date string.
 *
 * Built from the date *parts* via Date.UTC so the result is independent of the
 * runtime's own timezone — the caller already resolved locality.
 */
export function isoWeekday(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/**
 * Parse "HH:MM" (or "HH:MM:SS") into minute-of-day. Returns null when
 * unparseable, which callers treat as "skip this block" — matching the Rust,
 * which `continue`s on a NaiveTime parse failure.
 */
export function parseHHMM(value: string): number | null {
  // `focus_blocks.start_time` is TEXT ("09:00") on this project. Seconds and
  // fractional seconds are tolerated anyway: if the column ever became a
  // Postgres `time`, PostgREST would render "09:00:00" or "09:00:00.5", and a
  // stricter regex would silently make EVERY schedule window inactive — a
  // failure that un-blocks rather than blocks, in a function whose whole posture
  // is to fail loudly.
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec((value ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Is `nowMinutes` inside [start, end)?
 *
 * OVERNIGHT WRAP: when start > end (e.g. 22:00-06:00) the window is
 * `now >= start || now < end`. Getting this wrong silently un-blocks every
 * night shift — it is the single highest-consequence line in this file.
 *
 * start == end takes the normal branch and yields false (an empty window),
 * which is what the Rust `start <= end` comparison does too.
 */
export function windowActive(
  startTime: string,
  endTime: string,
  nowMinutes: number,
): boolean {
  const start = parseHHMM(startTime);
  const end = parseHHMM(endTime);
  if (start === null || end === null) return false;
  return start <= end
    ? nowMinutes >= start && nowMinutes < end
    : nowMinutes >= start || nowMinutes < end;
}

/**
 * Parse the comma-separated `days_of_week` TEXT column into ISO weekdays.
 * Mirrors the Rust `.split(',').filter_map(|d| d.trim().parse().ok())`:
 * unparseable segments are dropped, not fatal.
 *
 * Note this is a *split*, not a substring search — `"11,2".includes("1")` is
 * true, which is exactly the class of subtle error that would block on the
 * wrong days.
 */
export function parseDaysOfWeek(value: string): number[] {
  return (value ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => /^-?\d+$/.test(p))
    .map(Number);
}

/**
 * Is this focus block currently active?
 *
 * PORTED QUIRK: the weekday tested is that of *today*, not of the day the
 * overnight window opened. A 22:00-06:00 block scheduled Mondays only is
 * therefore NOT active at 01:00 on Tuesday. That is what the original does
 * (`tick()` compares `now.weekday()` before evaluating the window), so it is
 * what this does. Pinned by a test so nobody "fixes" it into a behaviour change.
 */
export function blockActive(
  block: Pick<
    FocusBlockRow,
    "enabled" | "days_of_week" | "start_time" | "end_time"
  >,
  weekday: number,
  nowMinutes: number,
): boolean {
  if (!block.enabled) return false;
  if (!parseDaysOfWeek(block.days_of_week).includes(weekday)) return false;
  return windowActive(block.start_time, block.end_time, nowMinutes);
}

/**
 * Does this unlock rule currently grant its target?
 *
 * A daily threshold, not a balance: nothing is deducted, and it resets at local
 * midnight purely because `todayMinutes` is date-scoped by the caller.
 * `>=` — a rule requiring 60 minutes fires at exactly 60.
 */
export function unlockGranted(
  rule: Pick<UnlockRuleRow, "enabled" | "required_minutes">,
  todayMinutes: number,
): boolean {
  if (!rule.enabled) return false;
  // TS types are erased at runtime and PostgREST hands back whatever the column
  // holds. The failure modes are asymmetric: a null `enabled` is falsy and skips
  // the rule (safe), but `0 >= null` is TRUE in JS, so a null `required_minutes`
  // would grant the unlock at zero tracked minutes — overriding permanent AND
  // schedule blocking. The column is NOT NULL DEFAULT 60 today; this guard keeps
  // that from being load-bearing.
  if (
    typeof rule.required_minutes !== "number" ||
    !Number.isFinite(rule.required_minutes)
  ) {
    return false;
  }
  return todayMinutes >= rule.required_minutes;
}

/**
 * Is this meal session running right now?
 *
 * [started_at, ends_at) — same inclusive-start/exclusive-end shape as
 * `windowActive`. Both columns are timestamptz, so PostgREST always renders an
 * offset and `Date.parse` resolves them as instants regardless of the runtime's
 * own timezone. Anything unparseable (or an inverted window) yields false:
 * a malformed session must fail toward blocked, never toward an open valve.
 */
export function mealSessionActive(
  session: Pick<MealSessionRow, "started_at" | "ends_at">,
  nowMs: number,
): boolean {
  const start = Date.parse((session.started_at ?? "").trim());
  const end = Date.parse((session.ends_at ?? "").trim());
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return nowMs >= start && nowMs < end;
}

/**
 * Is this permanently-blocked app in force right now?
 *
 * `block_mode = "focus_only"` means the app is blocked ONLY while a timer is
 * currently running — the inverse of what the name suggests to most readers.
 */
export function permanentAppInForce(
  app: Pick<BlockedAppRow, "enabled" | "block_mode">,
  timerActive: boolean,
): boolean {
  if (!app.enabled) return false;
  if (app.block_mode === "focus_only" && !timerActive) return false;
  return true;
}

// ── The verdict ──────────────────────────────────────────────────────────────

/**
 * Collapse every rule into the two effective sets plus a display-only
 * explanation per target.
 *
 * Rule precedence, straight from `tick()`:
 *   1. Schedule windows block their targets *regardless* of any global
 *      permanent-block toggle.
 *   2. Enabled permanent rows block their targets (apps additionally gated by
 *      `focus_only` + timer state).
 *   3. An unlock rule that has met its threshold REMOVES its target from the
 *      effective sets, overriding both of the above.
 *   4. An *active meal session* (started_at <= now < ends_at) likewise removes
 *      that meal's configured targets, overriding schedule and permanent
 *      blocks. Where a meal session and a satisfied unlock rule both free the
 *      same target, the meal session claims the explanation — it is the
 *      time-bounded, user-initiated reason and the one about to be asked about.
 *
 * NOTE ON THE GLOBAL TOGGLE: `tick()` gates permanent blocks on
 * `app_blocker::is_blocker_on(&db)`, a local SQLite setting. There is no
 * server-side equivalent — no such column exists in the Supabase schema — so
 * permanent blocks are treated as unconditionally on here. Per-row `enabled`
 * already carries per-target enablement, and the device-level opt-in now lives
 * in NexusLocal's `config.rs` (`blocking_enabled`), which gates enforcement on
 * the client rather than computation on the server. Stated explicitly because
 * silently picking one becomes a mystery later.
 */
export function evaluate(input: EvaluateInput): EvaluateOutput {
  const {
    sites,
    apps,
    blocks,
    blockApps,
    blockSites,
    rules,
    mealSessions,
    mealTargets,
    nowMs,
    weekday,
    nowMinutes,
    todayMinutes,
    timerActive,
  } = input;

  // ── Active meal sessions ───────────────────────────────────────────────────
  // With no `nowMs` there is no way to know a session is active, so none is —
  // fails toward blocked. Two active sessions for one meal cannot happen under
  // the once-per-day unique index, but if they did, the later ends_at wins so
  // the displayed expiry is never premature.
  const activeMealEnds = new Map<string, string>(); // meal -> ends_at
  if (typeof nowMs === "number") {
    for (const session of mealSessions ?? []) {
      if (!mealSessionActive(session, nowMs)) continue;
      const existing = activeMealEnds.get(session.meal);
      if (!existing || session.ends_at > existing) {
        activeMealEnds.set(session.meal, session.ends_at);
      }
    }
  }

  const mealDomains = new Map<string, { meal: string; ends_at: string }>();
  const mealProcesses = new Map<string, { meal: string; ends_at: string }>();
  for (const target of mealTargets ?? []) {
    const ends = activeMealEnds.get(target.meal);
    if (!ends) continue;
    const entry = { meal: target.meal, ends_at: ends };
    if (target.domain && !mealDomains.has(target.domain)) {
      mealDomains.set(target.domain, entry);
    }
    if (target.process_name && !mealProcesses.has(target.process_name)) {
      mealProcesses.set(target.process_name, entry);
    }
  }

  const mealReason = (entry: { meal: string; ends_at: string }): Reason => ({
    blocked: false,
    source: "meal_session",
    meal: entry.meal,
    ends_at: entry.ends_at,
  });

  // ── Unlocks ────────────────────────────────────────────────────────────────
  const unlockedDomains = new Map<string, UnlockRuleRow>();
  const unlockedProcesses = new Map<string, UnlockRuleRow>();
  // Rules that exist but have not met their threshold — used to explain a
  // still-blocked target in terms of the progress toward unlocking it.
  const pendingDomains = new Map<string, UnlockRuleRow>();
  const pendingProcesses = new Map<string, UnlockRuleRow>();

  // For pending rules, keep the NEAREST unmet threshold rather than whichever
  // row PostgREST happened to return last — otherwise the UI can show
  // "38 / 600 min" while a 60-minute rule is 22 minutes away.
  const keepNearest = (
    map: Map<string, UnlockRuleRow>,
    key: string,
    rule: UnlockRuleRow,
  ) => {
    const existing = map.get(key);
    if (!existing || rule.required_minutes < existing.required_minutes) {
      map.set(key, rule);
    }
  };

  for (const rule of rules) {
    const granted = unlockGranted(rule, todayMinutes);
    if (rule.domain) {
      if (granted) unlockedDomains.set(rule.domain, rule);
      else keepNearest(pendingDomains, rule.domain, rule);
    }
    if (rule.process_name) {
      if (granted) unlockedProcesses.set(rule.process_name, rule);
      else keepNearest(pendingProcesses, rule.process_name, rule);
    }
  }

  // ── Active schedule windows ────────────────────────────────────────────────
  const schedDomains = new Map<string, string>(); // domain -> block name
  const schedProcesses = new Map<string, string>(); // process -> block name

  for (const block of blocks) {
    if (!blockActive(block, weekday, nowMinutes)) continue;
    for (const process of blockApps.get(block.id) ?? []) {
      if (!schedProcesses.has(process)) schedProcesses.set(process, block.name);
    }
    for (const domain of blockSites.get(block.id) ?? []) {
      if (!schedDomains.has(domain)) schedDomains.set(domain, block.name);
    }
  }

  const reasons: Record<string, Reason> = {};
  const domains = new Set<string>();
  const processes = new Set<string>();

  const unlockReason = (rule: UnlockRuleRow): Reason => ({
    blocked: false,
    source: "unlock_rule",
    required_minutes: rule.required_minutes,
    today_minutes: todayMinutes,
  });

  // ── Domains ────────────────────────────────────────────────────────────────
  for (const site of sites) {
    const meal = mealDomains.get(site.domain);
    if (meal) {
      reasons[site.domain] = mealReason(meal);
      continue;
    }
    const unlock = unlockedDomains.get(site.domain);
    if (unlock) {
      reasons[site.domain] = unlockReason(unlock);
      continue;
    }
    if (!site.enabled) {
      // Not blocked by THIS row, but a schedule window below may still claim
      // it, and a duplicate enabled row may already have blocked it. Only
      // claim the explanation when nothing else has — otherwise `reasons`
      // would contradict the effective set.
      if (!schedDomains.has(site.domain) && !domains.has(site.domain)) {
        reasons[site.domain] = { blocked: false, source: "disabled" };
      }
      continue;
    }
    domains.add(site.domain);
    reasons[site.domain] = { blocked: true, source: "permanent" };
  }

  for (const [domain, blockName] of schedDomains) {
    const meal = mealDomains.get(domain);
    if (meal) {
      reasons[domain] = mealReason(meal);
      continue;
    }
    const unlock = unlockedDomains.get(domain);
    if (unlock) {
      reasons[domain] = unlockReason(unlock);
      continue;
    }
    domains.add(domain);
    // Schedule wins the explanation: it is the more specific, time-bounded
    // reason and the one the user is about to ask about.
    reasons[domain] = {
      blocked: true,
      source: "focus_block",
      block_name: blockName,
    };
  }

  // ── Processes ──────────────────────────────────────────────────────────────
  for (const app of apps) {
    const meal = mealProcesses.get(app.process_name);
    if (meal) {
      reasons[app.process_name] = mealReason(meal);
      continue;
    }
    const unlock = unlockedProcesses.get(app.process_name);
    if (unlock) {
      reasons[app.process_name] = unlockReason(unlock);
      continue;
    }
    if (!permanentAppInForce(app, timerActive)) {
      // Same guard as the sites loop: never explain a target as free when a
      // schedule window or a duplicate row has already blocked it. `domains` is
      // checked too because `reasons` is a single flat map shared by domains and
      // process names (the shape the schema documents), so a process name that
      // collides with a blocked domain must not overwrite its explanation.
      if (
        !schedProcesses.has(app.process_name) &&
        !processes.has(app.process_name) &&
        !domains.has(app.process_name)
      ) {
        reasons[app.process_name] = app.enabled
          ? {
            blocked: false,
            source: "focus_only",
            note: "no session running",
            display_name: app.display_name,
          }
          : { blocked: false, source: "disabled", display_name: app.display_name };
      }
      continue;
    }
    processes.add(app.process_name);
    reasons[app.process_name] = {
      blocked: true,
      source: app.block_mode === "focus_only" ? "focus_only" : "permanent",
      display_name: app.display_name,
    };
  }

  for (const [process, blockName] of schedProcesses) {
    const meal = mealProcesses.get(process);
    if (meal) {
      reasons[process] = mealReason(meal);
      continue;
    }
    const unlock = unlockedProcesses.get(process);
    if (unlock) {
      reasons[process] = unlockReason(unlock);
      continue;
    }
    processes.add(process);
    reasons[process] = {
      blocked: true,
      source: "focus_block",
      block_name: blockName,
    };
  }

  // ── Progress annotations ───────────────────────────────────────────────────
  // A target that is blocked AND has an unmet unlock rule gets the progress
  // attached, so the UI can render "38 / 60 min" without a second query.
  for (const [domain, rule] of pendingDomains) {
    const reason = reasons[domain];
    if (reason && reason.blocked === true) {
      reason.unlock_required_minutes = rule.required_minutes;
      reason.today_minutes = todayMinutes;
    }
  }
  for (const [process, rule] of pendingProcesses) {
    const reason = reasons[process];
    if (reason && reason.blocked === true) {
      reason.unlock_required_minutes = rule.required_minutes;
      reason.today_minutes = todayMinutes;
    }
  }

  // Sorted so back-to-back runs produce byte-identical arrays — the Rust used a
  // BTreeSet for exactly this reason.
  return {
    effective_domains: [...domains].sort(),
    effective_processes: [...processes].sort(),
    reasons,
    today_minutes: todayMinutes,
  };
}
