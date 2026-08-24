// Shared internals for the week view's components: grid geometry, the block
// colour table, and the date/time helpers.
//
// Week.tsx was 2,676 lines holding eight modals, the time column, four panels
// and the month grid. These constants are what they had in common.

import { dayStartMs } from "@nexus/core/coverage";
import type { Span } from "@nexus/core/coverage";

import type { ActualDay } from "../../lib/actual";
import type { CalBlock, Goal, Plan, SystemEntry, TaskWithContext } from "../../types";
// ── Date helpers ──────────────────────────────────────────────────────────────

export function weekStart(from: Date): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}
export function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
export function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function todayISO() { return toISO(new Date()); }

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Returns true if the system should appear on the given ISO date
export const MONTHS    = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Time grid constants ───────────────────────────────────────────────────────
//
// Full 24h day (Phase E §6, "a big goal should be to make the weekly review
// be full 24 hours a day"). HOUR_START/HOUR_END name the first/last *hour
// row* rendered (0..23) — matching the meaning they always had here, just
// widened from the old bounded 5..23 window. GRID_END_MIN is the absolute
// grid boundary in minutes-since-midnight (the bottom of the 23:00 row, i.e.
// the next day's midnight) and is what every span-clipping / now-line /
// click-time computation should use instead of `HOUR_END * 60` — using the
// row label directly there silently drops the whole last hour (see below).

export const HOUR_START = 0;
export const HOUR_END   = 23;
export const HOURS      = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
export const HOUR_PX    = 56; // pixels per hour — the DEFAULT/unzoomed scale, and what the
                               // always-fixed mobile grid still renders at (U2 is desktop-only).
export const GRID_END_MIN = (HOUR_END + 1) * 60;

// ── Zoom (U2) ─────────────────────────────────────────────────────────────────
//
// Desktop's `hourPx` is state in Week.tsx (default HOUR_PX, persisted in
// localStorage), threaded down to every grid-geometry consumer below.
// Mobile never reads this state — it always renders at the fixed HOUR_PX
// default, unaffected by desktop zoom/pan/drag (see spec U2 §"desktop-only").
export const HOUR_PX_MIN = 28;
export const HOUR_PX_MAX = 160;
export const HOUR_PX_STORAGE_KEY = "pf-week-hour-px";

/** Clamps a candidate pixels-per-hour value into the zoomable range, falling
 *  back to the default for anything non-finite (a corrupt/cleared localStorage
 *  value, for instance). */
export function clampHourPx(px: number): number {
  if (!Number.isFinite(px)) return HOUR_PX;
  return Math.min(HOUR_PX_MAX, Math.max(HOUR_PX_MIN, px));
}

/** One multiplicative wheel-zoom step, already clamped. `deltaY` is the raw
 *  wheel event value (ctrl/meta-wheel, which is how trackpad pinch arrives). */
export function zoomHourPx(hourPx: number, deltaY: number): number {
  return clampHourPx(hourPx * (1 - deltaY * 0.002));
}

/** Rounds a minute-of-day value to the nearest `step` minutes (default 5 —
 *  the drag/resize snap increment; pxToTime's own 30-minute click-to-create
 *  snap is unrelated and untouched). Pure and unclamped — callers that need
 *  the result inside the grid's bounds clamp separately. */
export function snapMinutes(min: number, step = 5): number {
  return Math.round(min / step) * step;
}

/** The previous bounded window's start, kept as the initial scroll position
 *  now that the grid always renders the full day — see the mount-scroll
 *  effects in Week(). */
export const DEFAULT_SCROLL_HOUR = 5;

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}
export function minutesToPx(min: number, hourPx: number = HOUR_PX): number {
  return ((min - HOUR_START * 60) / 60) * hourPx;
}
/** Inverse of `minutesToPx`, unsnapped and unclamped into the grid's own
 *  bounds — used by the zoom-anchor and drag-geometry math, which each apply
 *  their own snap/clamp afterward. */
export function pxToMinutes(px: number, hourPx: number = HOUR_PX): number {
  return HOUR_START * 60 + (px / hourPx) * 60;
}
export function pxToTime(px: number, containerHeight: number, hourPx: number = HOUR_PX): string {
  const clamped = Math.max(0, Math.min(px, containerHeight));
  const totalMin = pxToMinutes(clamped, hourPx);
  // Clamp to the grid's actual last selectable half-hour slot (23:30), not
  // `HOUR_END * 60` (23:00) — the old formula capped `h` at HOUR_END *after*
  // rounding, which mapped every click in the grid's final hour to :00 and
  // could even produce an end-time earlier than the click's own start-time
  // (see addHour below). Same bug, same fix.
  const rounded = Math.min(GRID_END_MIN - 30, Math.round(totalMin / 30) * 30);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
/** Binds `pxToTime` to one zoom scale — "close over hourPx" per spec §1,
 *  for a call site that wants a plain `(px, containerHeight) => string`
 *  without repeating the scale at every call. */
export function makePxToTime(hourPx: number): (px: number, containerHeight: number) => string {
  return (px, containerHeight) => pxToTime(px, containerHeight, hourPx);
}
/** "HH:MM" for a minute-of-day count, clamped into [0, 23:59]. */
export function minToHHMM(min: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The first free stretch of time inside `parent`'s span, after subtracting
 * its existing `children` (already-placed segments) — used to prefill a new
 * segment's start/end so "Add segment" lands somewhere useful instead of on
 * top of another child.
 *
 * Returns the FULL extent of the first gap found (not a fixed duration): if
 * the parent opens with 20 free minutes before its first child, that whole
 * 20-minute window is offered. Falls back to 30 minutes from the parent's own
 * start when there is no free time left at all (fully booked) — the modal's
 * save-time clamp brings an over-long segment back inside the parent's range.
 */
export function firstFreeSubSpan(parent: CalBlock, children: CalBlock[]): { start: string; end: string } {
  const pStart = timeToMinutes(parent.start_time);
  const pEnd   = timeToMinutes(parent.end_time);

  const busy = children
    .map((c): [number, number] => [
      Math.max(pStart, timeToMinutes(c.start_time)),
      Math.min(pEnd,   timeToMinutes(c.end_time)),
    ])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  let cursor = pStart;
  for (const [s, e] of busy) {
    if (s > cursor) return { start: minToHHMM(cursor), end: minToHHMM(s) };
    cursor = Math.max(cursor, e);
  }
  if (cursor < pEnd) return { start: minToHHMM(cursor), end: minToHHMM(pEnd) };

  // Fully booked — 30 minutes from the parent's start; may run past the
  // parent's own end, which the modal clamps at save time.
  return { start: minToHHMM(pStart), end: minToHHMM(pStart + 30) };
}

/**
 * Clamps a [startTime, endTime) span into `parent`'s own range, preserving
 * the original duration where it fits. Used on save (create or edit) for any
 * block that carries a `parent_block_id` — "silent clamp", matching the
 * app's existing forgiving style elsewhere (addHour/pxToTime never block a
 * save over an out-of-range time, they just bring it back in range).
 *
 * Always returns start < end when `parent`'s own span is non-empty (true for
 * every real block — `start_time < end_time` is enforced by the modal's own
 * `ok` check before either side is ever saved).
 */
export function clampChildSpan(startTime: string, endTime: string, parent: CalBlock): { start: string; end: string } {
  const pStart = timeToMinutes(parent.start_time);
  const pEnd   = timeToMinutes(parent.end_time);
  const dur    = Math.max(1, timeToMinutes(endTime) - timeToMinutes(startTime));

  let s = Math.min(Math.max(timeToMinutes(startTime), pStart), Math.max(pStart, pEnd - 1));
  let e = Math.min(pEnd, s + dur);
  if (e <= s) e = Math.min(pEnd, s + 1);
  return { start: minToHHMM(s), end: minToHHMM(e) };
}

export function addHour(t: string, h: number): string {
  // Cap at 23:59, not `HOUR_END * 60` (23:00) — a block starting at 23:30
  // plus a 1h default duration must still end *after* its own start, or the
  // "ok" validation in CalBlockModal keeps Add/Save disabled.
  const min = Math.min(GRID_END_MIN - 1, timeToMinutes(t) + h * 60);
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// ── Actual-day overlay (sleep/screen/training behind planned blocks) ──────────

/**
 * Reuses the column's minute→pixel mapping so the overlay never drifts from
 * the blocks. Clips to `GRID_END_MIN` (the true grid boundary, midnight),
 * not `HOUR_END * 60` — the latter is the *label* of the last hour row
 * (23:00) and would truncate anything in the final hour, which is exactly
 * where a bed-time band tends to land.
 */
export function actualSpanPx(span: Span, iso: string, hourPx: number = HOUR_PX): { top: number; height: number } | null {
  const dayStart = dayStartMs(iso);
  const startMin = Math.max(HOUR_START * 60, (span.start - dayStart) / 60_000);
  const endMin   = Math.min(GRID_END_MIN,    (span.end   - dayStart) / 60_000);
  if (endMin <= startMin) return null;
  const top = minutesToPx(startMin, hourPx);
  return { top, height: Math.max(1, minutesToPx(endMin, hourPx) - top) };
}

// Sleep is no longer a track here — it renders as its own always-on
// SleepBand layer (Phase E §7), independent of the "Actual" toggle below.
export const ACTUAL_TRACKS: { key: Exclude<keyof ActualDay, "sleep">; colorCls: string }[] = [
  { key: "screen",   colorCls: "bg-sky-400"     },
  { key: "training", colorCls: "bg-emerald-400" },
];


// ── Moved here: declared between components, needed by several ──

export const BLOCK_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  blue:    { bg: "bg-blue-500/20",    border: "border-blue-400/50",    text: "text-blue-700 dark:text-blue-300",    dot: "bg-blue-500" },
  indigo:  { bg: "bg-indigo-500/20",  border: "border-indigo-400/50",  text: "text-indigo-700 dark:text-indigo-300",  dot: "bg-indigo-500" },
  violet:  { bg: "bg-violet-500/20",  border: "border-violet-400/50",  text: "text-violet-700 dark:text-violet-300",  dot: "bg-violet-500" },
  purple:  { bg: "bg-purple-500/20",  border: "border-purple-400/50",  text: "text-purple-700 dark:text-purple-300",  dot: "bg-purple-500" },
  pink:    { bg: "bg-pink-500/20",    border: "border-pink-400/50",    text: "text-pink-700 dark:text-pink-300",    dot: "bg-pink-500" },
  rose:    { bg: "bg-rose-500/20",    border: "border-rose-400/50",    text: "text-rose-700 dark:text-rose-300",    dot: "bg-rose-500" },
  red:     { bg: "bg-red-500/20",     border: "border-red-400/50",     text: "text-red-700 dark:text-red-300",     dot: "bg-red-500" },
  orange:  { bg: "bg-orange-500/20",  border: "border-orange-400/50",  text: "text-orange-700 dark:text-orange-300",  dot: "bg-orange-500" },
  amber:   { bg: "bg-amber-500/20",   border: "border-amber-400/50",   text: "text-amber-700 dark:text-amber-300",   dot: "bg-amber-500" },
  yellow:  { bg: "bg-yellow-500/20",  border: "border-yellow-400/50",  text: "text-yellow-700 dark:text-yellow-300",  dot: "bg-yellow-500" },
  green:   { bg: "bg-green-500/20",   border: "border-green-400/50",   text: "text-green-700 dark:text-green-300",   dot: "bg-green-500" },
  emerald: { bg: "bg-emerald-500/20", border: "border-emerald-400/50", text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  teal:    { bg: "bg-teal-500/20",    border: "border-teal-400/50",    text: "text-teal-700 dark:text-teal-300",    dot: "bg-teal-500" },
  cyan:    { bg: "bg-cyan-500/20",    border: "border-cyan-400/50",    text: "text-cyan-700 dark:text-cyan-300",    dot: "bg-cyan-500" },
  slate:   { bg: "bg-slate-500/20",   border: "border-slate-400/50",   text: "text-slate-600 dark:text-slate-300",   dot: "bg-slate-400" },
};

export const MAX_CELL_ITEMS = 3;

export type BlockDraft = {
  title: string; start_time: string; end_time: string; color: string;
  description: string; location: string;
  is_recurring: boolean;
  recurrence: "daily" | "weekly" | "weekdays" | "monthly";
  days_of_week: number[];
  series_end_date: string;
  task_id: number | null;
  /** Name of a coverage_categories row, or null for "none". */
  category: string | null;
};

export function fmtWeekMinutes(min: number): string {
  const n = Math.max(0, Math.round(min));
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60), m = n % 60;
  return m === 0 ? `${h}h` : `${h}h${m}`;
}

export type ModalState =
  | { kind: "pick";          date: string }
  | { kind: "create-task";   date: string }
  | { kind: "create-goal";   date: string }
  | { kind: "create-plan";   date: string }
  | { kind: "edit-task";     task: TaskWithContext }
  | { kind: "edit-goal";     goal: Goal }
  | { kind: "edit-plan";     plan: Plan }
  | { kind: "create-system" }
  | { kind: "edit-system";   system: SystemEntry }
  | {
      kind: "create-block"; date: string; startTime: string;
      /**
       * Set when this creation is the "Add segment" flow from a parent's
       * edit view: the date is locked to the parent's, `parent_block_id` is
       * preset on save, and the modal shows a read-only "Inside: <title>"
       * line instead of the normal free-form date context.
       */
      parentBlock?: CalBlock;
      /** One-tap step chip prefill — title/task_id straight from an unscheduled step. */
      presetTitle?: string;
      presetTaskId?: number | null;
    }
  | { kind: "edit-block";    block: CalBlock };
