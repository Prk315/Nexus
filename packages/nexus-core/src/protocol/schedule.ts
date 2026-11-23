// Turning Protocol rows into calendar items. Pure and React-free on purpose:
// every rule about WHEN a Protocol item happens and WHETHER it is done lives
// here once, so PathFinder's Week, its Dashboard and anything later cannot
// disagree about it.

import type {
  DoneMark,
  HabitRow,
  MealEntryRow,
  MealSlot,
  RunRow,
  StackRow,
  SupplementRow,
  SyncedItem,
  SyncedPart,
  WorkoutRow,
} from "./types";

// ── Time and date primitives ────────────────────────────────────────────────

/**
 * ⚠️ Protocol numbers weekdays MONDAY = 0 … Sunday = 6 (`protocol_habits.
 * repeat_days`, and now the stack columns). PathFinder's
 * `pf_recurring_cal_blocks` numbers them SUNDAY = 0. Both are live in the same
 * database; this function is the Protocol one and must not be "simplified" to
 * `getUTCDay()`, which would shift every routine by a day.
 */
export function protocolWeekday(ymd: string): number {
  const d = new Date(`${ymd}T00:00:00Z`);
  return (d.getUTCDay() + 6) % 7;
}

/** null / empty = every day, which is how Protocol's habit editor stores "all seven". */
export function isDueOn(repeatDays: number[] | null | undefined, ymd: string): boolean {
  if (!repeatDays || repeatDays.length === 0) return true;
  return repeatDays.includes(protocolWeekday(ymd));
}

/** Postgres `time` arrives as "06:00:00"; the calendar speaks "06:00". */
export function hhmm(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Adds minutes and CLAMPS at 23:59 rather than wrapping. A late session that
 * wrapped to "00:30" would end before it starts, and the calendar would draw
 * it with negative height.
 */
export function addMinutes(t: string, minutes: number): string {
  const total = Math.min(toMinutes(t) + Math.max(0, minutes), 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Local wall-clock HH:MM of a timestamptz (Garmin's `started_at`). */
export function localHHMM(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Local calendar date of a timestamptz. `slice(0, 10)` would give the UTC date. */
export function localYmd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Every YYYY-MM-DD from start to end inclusive. Empty when end < start. */
export function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  // A runaway guard, not a limit anyone should meet: a year of days.
  for (let i = 0; cur <= last && i < 400; i++) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// ── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_WORKOUT_MIN = 60;
export const DEFAULT_RUN_MIN = 45;
export const DEFAULT_STACK_MIN = 15;

/**
 * Where a meal sits when nobody gave it a time. Marked `timeIsDefault` on the
 * item so the UI can say "default" rather than presenting a guess as a plan.
 */
export const MEAL_SLOT_DEFAULTS: Record<MealSlot, { start: string; minutes: number; label: string }> = {
  breakfast: { start: "08:00", minutes: 30, label: "Breakfast" },
  lunch: { start: "12:00", minutes: 30, label: "Lunch" },
  snack: { start: "15:30", minutes: 15, label: "Snack" },
  dinner: { start: "18:30", minutes: 45, label: "Dinner" },
};

export const MEAL_SLOTS: readonly MealSlot[] = ["breakfast", "lunch", "snack", "dinner"];

export function isMealSlot(s: string): s is MealSlot {
  return (MEAL_SLOTS as readonly string[]).includes(s);
}

// ── Who recorded a session ──────────────────────────────────────────────────

/**
 * ⚠️ `external_id IS NULL` does NOT mean "planned". Live data holds ~165
 * `Synced from Oura` workouts and ~120 Strava backfill rows with no
 * external_id. The markers below are the ones `garmin-import/match.ts`
 * `isImportedRow` excludes from claiming; `schedule.test.ts` imports that
 * function and asserts the two agree, so neither can grow a marker alone.
 */
export const IMPORTED_NOTES: Readonly<Record<string, string>> = {
  "Synced from Oura": "Oura",
  "Garmin import": "Garmin",
};
export const STRAVA_NOTES = /^Strava[ :(]/;

export function recordedBy(externalId: string | null, notes: string | null): string | null {
  if (externalId) return externalId.startsWith("garmin:") ? "Garmin" : "Import";
  const n = notes?.trim();
  if (!n) return null;
  if (IMPORTED_NOTES[n]) return IMPORTED_NOTES[n];
  if (STRAVA_NOTES.test(n)) return "Strava";
  return null;
}

// ── Builders ────────────────────────────────────────────────────────────────

function progressOf(parts: SyncedPart[]): { done: number; total: number } {
  return { done: parts.filter((p) => p.done).length, total: parts.length };
}

function byOrder<T extends { sort_order: number | null; name: string }>(a: T, b: T): number {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name);
}

export function workoutItem(r: WorkoutRow): SyncedItem {
  // A planned time wins; otherwise a Garmin session sits where it actually happened.
  const start = hhmm(r.start_time) ?? localHHMM(r.started_at);
  const minutes = r.duration_min && r.duration_min > 0 ? r.duration_min : DEFAULT_WORKOUT_MIN;
  return {
    key: `workout:${r.id}:${r.scheduled_date}`,
    kind: "workout",
    ref: r.id,
    date: r.scheduled_date,
    start_time: start,
    end_time: start ? addMinutes(start, minutes) : null,
    timeIsDefault: false,
    title: r.name,
    subtitle: recordedBy(r.external_id, r.notes),
    parts: [],
    done: r.completed,
    progress: { done: r.completed ? 1 : 0, total: 1 },
    recurring: false,
    recordedBy: recordedBy(r.external_id, r.notes),
  };
}

/**
 * Duration precedence: stored → pace × distance (how Garmin runs are
 * reconstructed elsewhere, see DayCoveragePanel) → default.
 */
export function runMinutes(r: RunRow): number {
  if (r.duration_min && r.duration_min > 0) return r.duration_min;
  if (r.avg_pace_s_per_km && r.actual_km) return Math.max(1, Math.round((r.avg_pace_s_per_km * r.actual_km) / 60));
  return DEFAULT_RUN_MIN;
}

export function runItem(r: RunRow): SyncedItem {
  const start = hhmm(r.start_time) ?? localHHMM(r.started_at);
  const km = r.completed && r.actual_km != null ? r.actual_km : r.planned_km;
  return {
    key: `run:${r.id}:${r.date}`,
    kind: "run",
    ref: r.id,
    date: r.date,
    start_time: start,
    end_time: start ? addMinutes(start, runMinutes(r)) : null,
    timeIsDefault: false,
    title: km != null ? `Run · ${Math.round(km * 10) / 10} km` : "Run",
    subtitle: recordedBy(r.external_id, r.notes) ?? r.notes,
    parts: [],
    done: r.completed,
    progress: { done: r.completed ? 1 : 0, total: 1 },
    recurring: false,
    recordedBy: recordedBy(r.external_id, r.notes),
  };
}

/**
 * One item per (date, slot). A meal block is every entry sharing them, which
 * is how Protocol's planner already groups them. Its time is the earliest
 * entry's `start_time`, or the slot default.
 */
export function mealItems(entries: MealEntryRow[]): SyncedItem[] {
  const groups = new Map<string, MealEntryRow[]>();
  for (const e of entries) {
    const k = `${e.date}|${e.slot}`;
    const g = groups.get(k);
    if (g) g.push(e);
    else groups.set(k, [e]);
  }
  const items: SyncedItem[] = [];
  for (const [, group] of groups) {
    group.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const { date, slot } = group[0];
    const def = isMealSlot(slot) ? MEAL_SLOT_DEFAULTS[slot] : null;
    const set = group.map((e) => hhmm(e.start_time)).filter((t): t is string => t != null).sort();
    const start = set[0] ?? def?.start ?? null;
    const parts: SyncedPart[] = group.map((e) => ({
      id: e.id,
      label: e.name ?? "Unknown food",
      detail: e.quantity != null && e.quantity !== 1 ? `× ${e.quantity}` : null,
      done: e.logged,
    }));
    const progress = progressOf(parts);
    items.push({
      key: `meal:${slot}:${date}`,
      kind: "meal",
      ref: slot,
      date,
      start_time: start,
      end_time: start ? addMinutes(start, def?.minutes ?? 30) : null,
      timeIsDefault: set.length === 0 && def != null,
      title: def?.label ?? slot,
      subtitle: parts.map((p) => p.label).join(", ") || null,
      parts,
      done: progress.total > 0 && progress.done === progress.total,
      progress,
      recurring: false,
      recordedBy: null,
    });
  }
  return items;
}

/**
 * Habit stacks → one routine item per day it is due.
 *
 * - A stack is due on a day when ITS repeat_days allow it AND at least one of
 *   its habits is due that day (each habit keeps its own repeat_days).
 * - Its time is the stack's `scheduled_time`, else its earliest due habit's.
 *   With neither it is UNSCHEDULED and produces nothing — it has no position,
 *   and parking it at midnight would assert a time nobody chose.
 * - A habit created after a day is not part of that day; otherwise adding a
 *   habit today would mark every past routine incomplete.
 * - A habit with its own time but no stack is a routine of one.
 */
export function routineItems(
  stacks: StackRow[],
  habits: HabitRow[],
  completions: DoneMark[],
  dates: string[],
): SyncedItem[] {
  const done = new Set(completions.map((c) => `${c.ref_id}|${c.date}`));
  const byStack = new Map<string, HabitRow[]>();
  for (const h of habits) {
    if (!h.stack_id) continue;
    const g = byStack.get(h.stack_id);
    if (g) g.push(h);
    else byStack.set(h.stack_id, [h]);
  }
  const groups: { stack: StackRow; habits: HabitRow[]; ref: string }[] = [
    ...[...stacks].sort(byOrder).map((s) => ({ stack: s, habits: (byStack.get(s.id) ?? []).sort(byOrder), ref: s.id })),
    ...habits
      .filter((h) => !h.stack_id && hhmm(h.scheduled_time))
      .map((h) => ({
        // A standalone habit behaves exactly like a stack of one whose
        // schedule is the habit's own — so it needs no second code path.
        stack: { id: h.id, name: h.name, sort_order: h.sort_order, scheduled_time: h.scheduled_time, duration_min: h.duration_min, repeat_days: h.repeat_days },
        habits: [h],
        ref: `habit:${h.id}`,
      })),
  ];

  const items: SyncedItem[] = [];
  for (const date of dates) {
    for (const { stack, habits: members, ref } of groups) {
      if (!isDueOn(stack.repeat_days, date)) continue;
      const due = members.filter((h) => isDueOn(h.repeat_days, date) && localYmd(h.created_at) <= date);
      if (due.length === 0) continue;
      const habitTimes = due.map((h) => hhmm(h.scheduled_time)).filter((t): t is string => t != null).sort();
      const start = hhmm(stack.scheduled_time) ?? habitTimes[0] ?? null;
      if (!start) continue;
      const summed = due.reduce((n, h) => n + (h.duration_min ?? 0), 0);
      const minutes = stack.duration_min && stack.duration_min > 0 ? stack.duration_min : summed > 0 ? summed : DEFAULT_STACK_MIN;
      const parts: SyncedPart[] = due.map((h) => ({
        id: h.id,
        label: h.name,
        detail: hhmm(h.scheduled_time),
        done: done.has(`${h.id}|${date}`),
      }));
      const progress = progressOf(parts);
      items.push({
        key: `routine:${ref}:${date}`,
        kind: "routine",
        ref,
        date,
        start_time: start,
        end_time: addMinutes(start, minutes),
        timeIsDefault: false,
        title: stack.name,
        subtitle: null,
        parts,
        done: progress.done === progress.total,
        progress,
        recurring: true,
        recordedBy: null,
      });
    }
  }
  return items;
}

/**
 * Supplement stacks → one item per day it is due. Same rules as routines,
 * except a supplement has no time of its own, so a stack without a
 * `scheduled_time` is simply unscheduled.
 */
export function supplementItems(
  stacks: StackRow[],
  supplements: SupplementRow[],
  logs: DoneMark[],
  dates: string[],
): SyncedItem[] {
  const taken = new Set(logs.map((l) => `${l.ref_id}|${l.date}`));
  const items: SyncedItem[] = [];
  const sorted = [...stacks].sort(byOrder);
  for (const date of dates) {
    for (const stack of sorted) {
      const start = hhmm(stack.scheduled_time);
      if (!start || !isDueOn(stack.repeat_days, date)) continue;
      const members = supplements
        .filter((s) => s.stack_id === stack.id && localYmd(s.created_at) <= date)
        .sort(byOrder);
      if (members.length === 0) continue;
      const parts: SyncedPart[] = members.map((s) => ({
        id: s.id,
        label: s.name,
        detail: s.dose,
        done: taken.has(`${s.id}|${date}`),
      }));
      const progress = progressOf(parts);
      items.push({
        key: `supplements:${stack.id}:${date}`,
        kind: "supplements",
        ref: stack.id,
        date,
        start_time: start,
        end_time: addMinutes(start, stack.duration_min && stack.duration_min > 0 ? stack.duration_min : DEFAULT_STACK_MIN),
        timeIsDefault: false,
        title: stack.name,
        subtitle: null,
        parts,
        done: progress.done === progress.total,
        progress,
        recurring: true,
        recordedBy: null,
      });
    }
  }
  return items;
}

/** Calendar order: by date, timed before untimed, then by start time, then title. */
export function sortItems(items: SyncedItem[]): SyncedItem[] {
  return [...items].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.start_time == null ? 1 : 0) - (b.start_time == null ? 1 : 0) ||
      (a.start_time ?? "").localeCompare(b.start_time ?? "") ||
      a.title.localeCompare(b.title),
  );
}
