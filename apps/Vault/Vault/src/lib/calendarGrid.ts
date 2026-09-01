// The month grid: which days a calendar renders, and what lands on each.
//
// Pure, and it reuses `timeline.ts`'s day arithmetic rather than growing a
// second one. Two date implementations in one app disagree about leap years
// and week starts eventually, and the disagreement shows up as an entry one
// column out — which looks like a rendering bug and is not.
//
// ── ⚠️ Weeks start on MONDAY here, and that is not the same convention
//    PathFinder's recurring blocks use ────────────────────────────────────
//
// `pf_recurring_cal_blocks` numbers weekdays 0=Sunday (CLAUDE.md says so, and
// says it is NOT ISO). This grid is a display concern and starts on Monday,
// which is what a Danish calendar looks like. The two must never be conflated:
// `weekdayOfDay` below returns the 0=Sunday number for talking to the database,
// and `columnOfDay` returns the Monday-first column for drawing. Using one
// where the other belongs shifts everything by a day, and a one-day shift is
// exactly the kind of wrong that reads as correct.

import { dayIndex, isoFromDay, isIsoDate, type IsoDate } from "./timeline";

export { dayIndex, isoFromDay, isIsoDate, type IsoDate };

/** 0 = Sunday … 6 = Saturday. The number `pf_recurring_cal_blocks` stores. */
export function weekdayOfDay(day: number): number {
  // Epoch day 0 was a Thursday, and getUTCDay() numbers Sunday 0.
  return ((day + 4) % 7 + 7) % 7;
}

/** 0 = Monday … 6 = Sunday. The column this day is drawn in. */
export function columnOfDay(day: number): number {
  return (weekdayOfDay(day) + 6) % 7;
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface GridDay {
  day: number;
  iso: IsoDate;
  /** False for the leading and trailing days borrowed from the neighbouring
   *  months. They are drawn dimmed — dropping them would leave ragged rows,
   *  and hiding the distinction would let you schedule into the wrong month
   *  without noticing. */
  inMonth: boolean;
  isToday: boolean;
}

export interface MonthGrid {
  /** First of the month, as a day index. */
  monthStart: number;
  label: string;
  /** Always whole weeks, Monday first. 5 or 6 rows depending on the month. */
  days: GridDay[];
  weeks: number;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The grid for the month containing `anchor`.
 *
 * ⚠️ Whole weeks, always. A grid that started on the 1st in whichever column it
 * falls would put the first row's cells under the wrong weekday headers, and a
 * grid that stopped on the last day would leave a short final row that reads as
 * missing days rather than as the end of the month.
 */
export function monthGrid(anchor: number, today: number): MonthGrid {
  const d = new Date(anchor * 86_400_000);
  const first = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 86_400_000);
  const nextMonth = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 86_400_000);

  const start = first - columnOfDay(first);
  // Pad to a whole final week. `nextMonth - 1` is the last day of this month.
  const lastCol = columnOfDay(nextMonth - 1);
  const end = (nextMonth - 1) + (6 - lastCol);

  const days: GridDay[] = [];
  for (let day = start; day <= end; day++) {
    days.push({
      day,
      iso: isoFromDay(day),
      inMonth: day >= first && day < nextMonth,
      isToday: day === today,
    });
  }

  return {
    monthStart: first,
    label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    days,
    weeks: days.length / 7,
  };
}

/** Step whole months, never 30 days — a fixed step drifts and eventually
 *  skips February entirely. */
export function shiftMonth(anchor: number, delta: number): number {
  const d = new Date(anchor * 86_400_000);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1) / 86_400_000);
}

/** One thing shown in a day cell. */
export interface DayEntry {
  taskId: number;
  title: string;
  done: boolean;
  /** A scheduled calendar block (movable, deletable) or a bare due date
   *  (a property of the task, not something this view owns). */
  kind: "scheduled" | "due";
  /** `pf_cal_blocks.id`, present only for a scheduled entry. */
  blockId?: number;
}

export interface CalendarInput {
  id: number;
  title: string;
  done: boolean;
  dueDate: string | null | undefined;
  /** `pf_cal_blocks` rows for this task: day → block id. */
  scheduled?: ReadonlyArray<{ iso: IsoDate; blockId: number }>;
}

/**
 * Entries per ISO day.
 *
 * ⚠️ A task scheduled on a day it is ALSO due appears once, as scheduled. Two
 * chips for one task on one day reads as two pieces of work, and the scheduled
 * one is the actionable of the pair — it is the one you can drag.
 */
export function entriesByDay(tasks: readonly CalendarInput[]): Map<IsoDate, DayEntry[]> {
  const out = new Map<IsoDate, DayEntry[]>();
  const push = (iso: IsoDate, e: DayEntry) => {
    const list = out.get(iso) ?? [];
    list.push(e);
    out.set(iso, list);
  };

  for (const t of tasks) {
    const days = new Set<string>();
    for (const s of t.scheduled ?? []) {
      if (!isIsoDate(s.iso) || days.has(s.iso)) continue;
      days.add(s.iso);
      push(s.iso, { taskId: t.id, title: t.title, done: t.done, kind: "scheduled", blockId: s.blockId });
    }
    if (isIsoDate(t.dueDate) && !days.has(t.dueDate)) {
      push(t.dueDate, { taskId: t.id, title: t.title, done: t.done, kind: "due" });
    }
  }

  // Scheduled before due, then by title, so a cell's order does not shuffle
  // between renders just because the task list came back in another order.
  for (const list of out.values()) {
    list.sort((a, b) =>
      (a.kind === b.kind ? 0 : a.kind === "scheduled" ? -1 : 1) ||
      a.title.localeCompare(b.title) ||
      a.taskId - b.taskId);
  }
  return out;
}

/**
 * Tasks with nowhere to be: no due date and nothing scheduled.
 *
 * The timeline has to leave these out — they have no position on an axis. Here
 * they get a tray to be dragged from, which is what turns that honest omission
 * into something you can act on rather than a number in a footer.
 */
export function unscheduled(tasks: readonly CalendarInput[]): CalendarInput[] {
  return tasks.filter(
    (t) => !isIsoDate(t.dueDate) && !(t.scheduled ?? []).some((s) => isIsoDate(s.iso)),
  );
}
