// How well the schedule is actually kept.
//
// The unit is a calendar block committed to a task — the only kind of block
// that can be ticked off, and the kind a planned day is made of. Bare blocks
// (meals filed over a gap after the fact, recurring rest/routine bands) are
// counted as booked time but never graded: most of them record what happened
// rather than what was promised.
//
// Each task block ends up in one of four states:
//   done      — ticked off as worked (a pf_task_sessions row on its cal_block_id)
//   missed    — explicitly marked "did not complete" (pf_block_misses)
//   unmarked  — already over, but neither. Counted AGAINST the rate: a block
//               you never confirmed is not a block you kept, and grading it
//               neutral would make not marking the best-scoring habit.
//   upcoming  — not over yet. Not graded at all, so a morning check of today
//               does not read as a failing day.
//
// Rates are by minutes, not block count: skipping a 4-hour study block is not
// the same miss as skipping a 15-minute errand.
//
// Pure and React-free, like taskTree.ts and nextUp.ts.

import type { CalBlock } from "../types";
import { blockMinutes } from "./taskTree";

export type BlockOutcome = "done" | "missed" | "unmarked" | "upcoming";

export interface DayAdherence {
  iso: string;
  /** Minutes of every calendar block that day — how much was scheduled at all. */
  booked: number;
  /** Of which, minutes on task blocks — the graded schedule. */
  scheduled: number;
  done: number;
  missed: number;
  unmarked: number;
  upcoming: number;
  /** Task blocks that day, by count. */
  blocks: number;
  /** done / (done + missed + unmarked), 0–1; null when nothing has ended yet. */
  rate: number | null;
}

export interface AdherenceSummary {
  days: DayAdherence[];
  scheduled: number;
  done: number;
  missed: number;
  unmarked: number;
  upcoming: number;
  rate: number | null;
  /** Mean task-block minutes over days that had any. */
  avgScheduledPerActiveDay: number;
  activeDays: number;
}

const MIN_PER_DAY = 24 * 60;

function dayIndex(iso: string): number {
  return Math.floor(Date.parse(iso + "T00:00:00Z") / 86_400_000);
}

function toMin(hhmm: string): number {
  const [h, m] = (hhmm ?? "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
}

/** Whether a block has finished by `now` (local date + minutes since midnight). */
export function hasEnded(
  block: Pick<CalBlock, "date" | "start_time" | "end_time">,
  now: { date: string; minutes: number },
): boolean {
  // Measured from the block's own midnight so a block that wraps past
  // midnight (23:00–01:00) only ends the next morning.
  const end = toMin(block.start_time) + blockMinutes(block.start_time, block.end_time);
  const nowFromBlockDay = (dayIndex(now.date) - dayIndex(block.date)) * MIN_PER_DAY + now.minutes;
  return end <= nowFromBlockDay;
}

export function blockOutcome(
  block: CalBlock,
  workedIds: ReadonlySet<number>,
  missedIds: ReadonlySet<number>,
  now: { date: string; minutes: number },
): BlockOutcome {
  if (workedIds.has(block.id)) return "done";
  if (missedIds.has(block.id)) return "missed";
  return hasEnded(block, now) ? "unmarked" : "upcoming";
}

export function rateOf(d: { done: number; missed: number; unmarked: number }): number | null {
  const graded = d.done + d.missed + d.unmarked;
  return graded > 0 ? d.done / graded : null;
}

/**
 * Grades every task block on each of `days`.
 *
 * `workedIds` / `missedIds` are occurrence ids (cal_block_id) — for a recurring
 * series that is the occurrence's negative virtual id, which is what both
 * ledgers store.
 */
export function summariseAdherence(
  days: string[],
  blocks: CalBlock[],
  workedIds: ReadonlySet<number>,
  missedIds: ReadonlySet<number>,
  now: { date: string; minutes: number },
): AdherenceSummary {
  const byDay = new Map<string, DayAdherence>(days.map((iso) => [iso, {
    iso, booked: 0, scheduled: 0, done: 0, missed: 0, unmarked: 0, upcoming: 0, blocks: 0, rate: null,
  }]));

  for (const b of blocks) {
    const d = byDay.get(b.date);
    if (!d) continue;
    const mins = blockMinutes(b.start_time, b.end_time);
    d.booked += mins;
    if (b.task_id == null) continue;
    d.scheduled += mins;
    d.blocks += 1;
    d[blockOutcome(b, workedIds, missedIds, now)] += mins;
  }

  const out = days.map((iso) => {
    const d = byDay.get(iso)!;
    d.rate = rateOf(d);
    return d;
  });

  const sum = (k: "scheduled" | "done" | "missed" | "unmarked" | "upcoming") =>
    out.reduce((s, d) => s + d[k], 0);
  const totals = {
    scheduled: sum("scheduled"), done: sum("done"), missed: sum("missed"),
    unmarked: sum("unmarked"), upcoming: sum("upcoming"),
  };
  const activeDays = out.filter((d) => d.scheduled > 0).length;

  return {
    days: out,
    ...totals,
    rate: rateOf(totals),
    avgScheduledPerActiveDay: activeDays > 0 ? totals.scheduled / activeDays : 0,
    activeDays,
  };
}
