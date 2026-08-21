// What should I work on right now?
//
// Everything needed to answer that already existed after the task rework —
// calendar commitments, the importance x urgency pair, due dates, logged
// sessions, the scheduling gate — but it lived in the Workspace board, which is
// not where the day is actually spent. This module turns those signals into one
// ranked answer with a stated reason.
//
// The reason matters as much as the ranking. "Do this next" with no explanation
// is a black box you learn to distrust; "booked 16:00–17:30" is checkable, and
// when it is wrong you can see *why* it is wrong.
//
// Pure and React-free, like taskTree.ts and systems.ts.

import type { CalBlock, TaskWithContext } from "../types";
import { blockMinutes, isFullTask, planningOf } from "./taskTree";

/** Why a candidate surfaced. Ordered strongest-first; the enum IS the ranking. */
export type NextUpKind =
  | "now"        // a calendar block is running right this minute
  | "next"       // a block starts later today
  | "overdue"    // past its due date
  | "today"      // due today, nothing booked
  | "unblocked"; // active and workable, nothing scheduled

export interface NextUpItem {
  task: TaskWithContext;
  kind: NextUpKind;
  /** Human explanation, e.g. "on now until 17:30" or "3d overdue". */
  reason: string;
  /** The block that put it here, when there is one. */
  block?: CalBlock;
  /** Minutes of the block, for a "start a session" affordance. */
  minutes?: number;
}

const KIND_RANK: Record<NextUpKind, number> = {
  now: 0, next: 1, overdue: 2, today: 3, unblocked: 4,
};
const IMPORTANCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** "09:05" -> 545. Returns null when unparseable, so callers can skip rather than guess. */
function toMinutes(hhmm: string): number | null {
  const [h, m] = (hhmm ?? "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

function daysLate(due: string, today: string): number {
  const a = new Date(due + "T12:00:00").getTime();
  const b = new Date(today + "T12:00:00").getTime();
  return Math.round((b - a) / 86_400_000);
}

export interface NextUpInput {
  tasks: TaskWithContext[];
  /** Today's calendar blocks, keyed by the task they commit time to. */
  blocksByTask: Map<number, CalBlock[]>;
  /** Block ids already ticked as worked — those stop being "next". */
  workedBlockIds: Set<number>;
  today: string;
  /** Minutes since midnight. Injected rather than read from the clock so this stays pure. */
  nowMinutes: number;
}

/**
 * Ranks what to do next, strongest signal first.
 *
 * A task with unfinished steps never appears itself — its steps do. Scheduling
 * and working happen at the leaf, so pointing at the parent would be pointing at
 * something you cannot actually sit down and do.
 *
 * Quick tasks (reminder/chore/shopping) are excluded: they are standing lists
 * captured on the phone, not the thing you block time for.
 */
export function nextUp(input: NextUpInput, limit = 4): NextUpItem[] {
  const { tasks, blocksByTask, workedBlockIds, today, nowMinutes } = input;

  const hasChildren = new Set(
    tasks.map((t) => t.parent_id).filter((id): id is number => id != null),
  );

  const candidates: NextUpItem[] = [];

  for (const t of tasks) {
    if (t.done) continue;
    if (!isFullTask(t)) continue;      // quick tasks are not "work on now" material
    if (hasChildren.has(t.id)) continue; // its steps are the workable units

    const allBlocks = blocksByTask.get(t.id) ?? [];
    const blocks = allBlocks.filter((b) => !workedBlockIds.has(b.id));

    // 1. Something is running right now.
    const running = blocks.find((b) => {
      const s = toMinutes(b.start_time), e = toMinutes(b.end_time);
      return s != null && e != null && s <= nowMinutes && nowMinutes < e;
    });
    if (running) {
      candidates.push({
        task: t, kind: "now", block: running,
        minutes: blockMinutes(running.start_time, running.end_time),
        reason: `on now until ${running.end_time}`,
      });
      continue;
    }

    // 2. Something starts later today.
    const upcoming = blocks
      .filter((b) => { const s = toMinutes(b.start_time); return s != null && s >= nowMinutes; })
      .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
    if (upcoming) {
      candidates.push({
        task: t, kind: "next", block: upcoming,
        minutes: blockMinutes(upcoming.start_time, upcoming.end_time),
        reason: `booked ${upcoming.start_time}`,
      });
      continue;
    }

    // Past this point nothing is actionable on the calendar today, but WHY
    // differs and the distinction is the useful part: a task with no time booked
    // needs scheduling, whereas one whose booked time came and went is a
    // commitment you already broke. Saying "nothing booked" for both would be
    // false, and it was — the panel claimed it for three tasks while the gate
    // counted two.
    const everBooked = allBlocks.length > 0;
    const lapsed = everBooked && blocks.length > 0;   // unworked, but the slot has passed
    const spent  = everBooked && blocks.length === 0; // every slot already ticked

    // 3. Overdue.
    if (t.due_date && t.due_date < today) {
      const late = daysLate(t.due_date, today);
      const base = late === 1 ? "1 day overdue" : `${late} days overdue`;
      candidates.push({
        task: t, kind: "overdue",
        reason: lapsed ? `${base}, booked time passed` : base,
      });
      continue;
    }

    // 4. Due today.
    if (t.due_date === today) {
      candidates.push({
        task: t, kind: "today",
        reason: spent  ? "due today, booked time already logged"
              : lapsed ? "due today, booked time passed"
              :          "due today, nothing booked",
      });
      continue;
    }

    // 5. Already marked active but with no commitment behind it today.
    if (planningOf(t).stage === "active") {
      candidates.push({ task: t, kind: "unblocked", reason: "in progress" });
    }
  }

  return candidates
    .sort((a, b) => {
      const k = KIND_RANK[a.kind] - KIND_RANK[b.kind];
      if (k !== 0) return k;
      // Within a kind: earlier block first, then importance, then urgency.
      if (a.block && b.block) {
        const t = a.block.start_time.localeCompare(b.block.start_time);
        if (t !== 0) return t;
      }
      const imp = (IMPORTANCE_RANK[a.task.priority] ?? 1) - (IMPORTANCE_RANK[b.task.priority] ?? 1);
      if (imp !== 0) return imp;
      return (IMPORTANCE_RANK[planningOf(a.task).urgency] ?? 1)
           - (IMPORTANCE_RANK[planningOf(b.task).urgency] ?? 1);
    })
    .slice(0, limit);
}

/**
 * Tasks due today that nothing has been booked for.
 *
 * The scheduling gate says you cannot work what you have not committed time to.
 * That rule is only fair if the things it blocks are visible, so this is counted
 * separately rather than buried in the ranking.
 */
export function needsScheduling(input: Omit<NextUpInput, "nowMinutes">): TaskWithContext[] {
  const { tasks, blocksByTask, today } = input;
  const hasChildren = new Set(
    tasks.map((t) => t.parent_id).filter((id): id is number => id != null),
  );
  return tasks.filter((t) =>
    !t.done
    && isFullTask(t)
    && !hasChildren.has(t.id)
    && (t.due_date === today || (t.due_date != null && t.due_date < today))
    && (blocksByTask.get(t.id)?.length ?? 0) === 0,
  );
}
