// Pure scheduling-slot math for the task quick-actions ("Schedule today" /
// "Schedule tomorrow" in TaskActionMenu). No Supabase, no React — the day's
// already-loaded blocks and a duration go in, a start/end time or `null`
// comes out. `lib/api/quickActions.ts` is the only caller; it fetches the
// day's blocks and hands them here.
//
// The scheduling day runs 05:00–23:00 (DAY_WINDOW_*). That is a product
// choice, not a technical one — nobody wants a "quick schedule" action
// proposing 2am — and it deliberately does NOT reuse Week's HOUR_START/
// HOUR_END (which now span the full 24h grid per Phase E): this module has
// no reason to import a components/ file, and the two constants are free to
// diverge if the grid's rendered range ever changes again.

export const DAY_WINDOW_START_MIN = 5 * 60;  // 05:00
export const DAY_WINDOW_END_MIN = 23 * 60;   // 23:00

/** Minutes a slot is snapped to — matches Week's own drag/resize snap. */
export const SLOT_GRANULARITY_MIN = 5;

export function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** "HH:MM" for a minute-of-day count, clamped into [0, 23:59]. */
export function minToTime(min: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Rounds a minute-of-day value UP to the next 5-minute mark. */
function snapUp(min: number): number {
  return Math.ceil(min / SLOT_GRANULARITY_MIN) * SLOT_GRANULARITY_MIN;
}

export interface FreeSlotOpts {
  /** "HH:MM" — nothing is proposed before this time. */
  notBefore: string;
  /** "HH:MM" — defaults to DAY_WINDOW_END_MIN (23:00). */
  notAfter?: string;
}

export interface FreeSlot {
  startTime: string;
  endTime: string;
}

/**
 * First gap of at least `durationMin`, at 5-minute granularity, at or after
 * `opts.notBefore`, inside the 05:00–23:00 scheduling window (or
 * `opts.notAfter` if narrower).
 *
 * Three outcomes, in order:
 *   1. A gap (before the first block, between two blocks, or after the last
 *      one) that's big enough for the full duration — returned as-is.
 *   2. No gap is big enough, but there's SOME room left after the last block
 *      — a slot is still returned, its end clamped to the window's end (so
 *      the proposed block may be shorter than `durationMin`). This is the
 *      "better than nothing" case: a barely-full day still gets an offer.
 *   3. No room left at all (the window is already fully booked, or
 *      `notBefore` is at/after the window's end) — `null`.
 */
export function findFreeSlot(
  dayBlocks: { start_time: string; end_time: string }[],
  durationMin: number,
  opts: FreeSlotOpts,
): FreeSlot | null {
  const windowEnd = opts.notAfter !== undefined ? timeToMin(opts.notAfter) : DAY_WINDOW_END_MIN;
  const searchStart = snapUp(Math.max(timeToMin(opts.notBefore), DAY_WINDOW_START_MIN));
  if (searchStart >= windowEnd) return null;

  const sorted = dayBlocks
    .map((b) => ({ start: timeToMin(b.start_time), end: timeToMin(b.end_time) }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);

  let cursor = searchStart;
  for (const b of sorted) {
    if (b.start > cursor && b.start - cursor >= durationMin) {
      return { startTime: minToTime(cursor), endTime: minToTime(cursor + durationMin) };
    }
    if (b.end > cursor) cursor = snapUp(b.end);
  }

  if (cursor >= windowEnd) return null; // truly full — no room anywhere after notBefore

  const end = Math.min(windowEnd, cursor + durationMin); // clamp: outcome 2 shortens the slot rather than overrunning the window
  return { startTime: minToTime(cursor), endTime: minToTime(end) };
}

/** "YYYY-MM-DD" for a Date, in LOCAL time (matches `toISO` in week/_shared.ts — never UTC, which would shift the date near midnight). */
function dateStrFor(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayDateStr(now: Date = new Date()): string {
  return dateStrFor(now);
}

export function tomorrowDateStr(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  return dateStrFor(d);
}

/** "HH:MM" for the next quarter-hour at or after `now` (already snapped if `now` sits exactly on one). */
export function nextQuarterHour(now: Date): string {
  const totalMin = now.getHours() * 60 + now.getMinutes();
  const rounded = Math.ceil(totalMin / 15) * 15;
  return minToTime(rounded);
}

/**
 * The default search window for scheduling something TODAY: never propose a
 * time that has already passed. (Tomorrow doesn't need this — quickActions.ts
 * just starts its search at "09:00".)
 */
export function defaultScheduleWindow(now: Date = new Date()): { notBefore: string } {
  return { notBefore: nextQuarterHour(now) };
}
