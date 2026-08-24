import { describe, it, expect } from "vitest";
import {
  buildForest, subtreeNode, flatten, leaves, rollupEstimate, storedAggregate,
  isDerivedEstimate, ownProgress, rollupProgress, blockMinutes, coverageByTask,
  rollupCoverage, unscheduledMinutes, isWorkable, gateReason, applyTaskPatch,
  planningOf, isFullTask, cellKey, parseCellKey, cellAdvice, formatMinutes,
  addMinutesToTime, IMPLICIT_PLANNING,
} from "./taskTree";
import type { TaskWithContext, TaskPlanning, CalBlock, TaskSession } from "../types";

// ── Builders ─────────────────────────────────────────────────────────────────

const planning = (over: Partial<TaskPlanning> = {}): TaskPlanning => ({
  ...IMPLICIT_PLANNING, ...over,
});

let nextId = 1;
function task(over: Partial<TaskWithContext> = {}): TaskWithContext {
  return {
    id: nextId++, plan_id: null, parent_id: null, task_type: "task",
    plan_title: null, goal_id: null, goal_title: null,
    title: "t", done: false, sort_order: 0, priority: "medium",
    due_date: null, created_at: "", time_estimate: null, aggregate_estimate: 0,
    kanban_status: "backlog", category: null, planning: planning(),
    ...over,
  };
}

const block = (over: Partial<CalBlock> = {}): CalBlock => ({
  id: 1, date: "2026-08-21", title: "b", start_time: "09:00", end_time: "10:00",
  color: "blue", description: null, location: null, created_at: "",
  is_recurring: false, recurring_id: null, recurrence: null, days_of_week: null,
  series_start_date: null, series_end_date: null, task_id: null, category: null,
  parent_block_id: null, ...over,
});

const session = (over: Partial<TaskSession> = {}): TaskSession => ({
  id: 1, task_id: 1, date: "2026-08-21", minutes: 30,
  cal_block_id: null, note: null, created_at: "", ...over,
});

// ── Tree construction ────────────────────────────────────────────────────────

describe("buildForest", () => {
  it("nests children under their parent", () => {
    const p = task({ id: 1 });
    const c = task({ id: 2, parent_id: 1 });
    const forest = buildForest([p, c]);
    expect(forest).toHaveLength(1);
    expect(forest[0].children.map((n) => n.task.id)).toEqual([2]);
    expect(forest[0].children[0].depth).toBe(1);
  });

  it("promotes an orphan rather than dropping it", () => {
    // A step whose parent is filtered out of the current view must still appear —
    // losing work off-screen is worse than showing it one level too high.
    const orphan = task({ id: 5, parent_id: 999 });
    const forest = buildForest([orphan]);
    expect(forest.map((n) => n.task.id)).toEqual([5]);
  });

  it("orders siblings by sort_order then id", () => {
    const p = task({ id: 1 });
    const b = task({ id: 3, parent_id: 1, sort_order: 1 });
    const a = task({ id: 2, parent_id: 1, sort_order: 0 });
    expect(buildForest([p, b, a])[0].children.map((n) => n.task.id)).toEqual([2, 3]);
  });

  it("does not hang on a parent cycle", () => {
    // The DB trigger prevents cycles, but an optimistic cache mid-edit can hold one.
    const a = task({ id: 1, parent_id: 2 });
    const b = task({ id: 2, parent_id: 1 });
    expect(() => buildForest([a, b])).not.toThrow();
  });
});

describe("subtreeNode", () => {
  it("returns the subtree rooted at an id", () => {
    const rows = [task({ id: 1 }), task({ id: 2, parent_id: 1 }), task({ id: 3, parent_id: 2 }), task({ id: 9 })];
    const n = subtreeNode(rows, 1)!;
    expect(flatten(n).map((x) => x.task.id)).toEqual([1, 2, 3]);
    expect(leaves(n).map((x) => x.task.id)).toEqual([3]);
  });

  it("returns null for an unknown id", () => {
    expect(subtreeNode([task({ id: 1 })], 42)).toBeNull();
  });
});

// ── Effort roll-up ───────────────────────────────────────────────────────────

describe("rollupEstimate", () => {
  it("sums leaves and ignores the parent's own estimate", () => {
    // A 6h parent with 2h+1h of steps is 3h of work, not 9h.
    const rows = [
      task({ id: 1, time_estimate: 360 }),
      task({ id: 2, parent_id: 1, time_estimate: 120 }),
      task({ id: 3, parent_id: 1, time_estimate: 60 }),
    ];
    expect(rollupEstimate(subtreeNode(rows, 1)!)).toBe(180);
  });

  it("treats an unset leaf estimate as 0, matching the DB trigger", () => {
    // The aggregate_estimate trigger uses coalesce(time_estimate, 0). If this
    // invented a default the number would visibly jump on refresh.
    const rows = [task({ id: 1 }), task({ id: 2, parent_id: 1 })];
    expect(rollupEstimate(subtreeNode(rows, 1)!)).toBe(0);
  });

  it("nests arbitrarily deep", () => {
    const rows = [
      task({ id: 1 }),
      task({ id: 2, parent_id: 1 }),
      task({ id: 3, parent_id: 2, time_estimate: 25 }),
      task({ id: 4, parent_id: 2, time_estimate: 5 }),
    ];
    expect(rollupEstimate(subtreeNode(rows, 1)!)).toBe(30);
  });

  it("isDerivedEstimate is true only for parents", () => {
    const rows = [task({ id: 1 }), task({ id: 2, parent_id: 1 })];
    const root = subtreeNode(rows, 1)!;
    expect(isDerivedEstimate(root)).toBe(true);
    expect(isDerivedEstimate(root.children[0])).toBe(false);
  });

  it("storedAggregate prefers the trigger column", () => {
    expect(storedAggregate(task({ aggregate_estimate: 90, time_estimate: 30 }))).toBe(90);
    expect(storedAggregate(task({ aggregate_estimate: 0, time_estimate: 30 }))).toBe(30);
    expect(storedAggregate(task({ aggregate_estimate: 0 }))).toBe(0);
  });
});

// ── Progress ─────────────────────────────────────────────────────────────────

describe("ownProgress", () => {
  it("binary mode reads the checkbox", () => {
    expect(ownProgress(task({ done: true }), []).fraction).toBe(1);
    expect(ownProgress(task({ done: false }), []).fraction).toBe(0);
  });

  it("sessions mode counts logged sessions against the target", () => {
    const t = task({ planning: planning({ completion_mode: "sessions", target_count: 3 }) });
    const p = ownProgress(t, [session(), session({ id: 2 })]);
    expect(p.fraction).toBeCloseTo(2 / 3);
    expect(p.done).toBe(false);
    expect(ownProgress(t, [session(), session({ id: 2 }), session({ id: 3 })]).done).toBe(true);
  });

  it("sessions mode with no target falls back to binary rather than dividing by zero", () => {
    const t = task({ planning: planning({ completion_mode: "sessions", target_count: null }) });
    expect(ownProgress(t, []).fraction).toBe(0);
    expect(ownProgress(t, []).label).toBe("Not started");
  });

  it("time mode measures logged minutes, and never divides by a zero estimate", () => {
    const t = task({ time_estimate: 60, planning: planning({ completion_mode: "time" }) });
    expect(ownProgress(t, [session({ minutes: 30 })]).fraction).toBeCloseTo(0.5);

    const noEstimate = task({ time_estimate: 0, planning: planning({ completion_mode: "time" }) });
    expect(Number.isFinite(ownProgress(noEstimate, [session({ minutes: 1 })]).fraction)).toBe(true);
  });

  it("a sparse subtype has no planning row and reads as binary", () => {
    const chore = task({ task_type: "chore", category: "chore", planning: null, done: true });
    expect(ownProgress(chore, []).fraction).toBe(1);
  });
});

describe("rollupProgress", () => {
  it("weights children by effort, not by count", () => {
    // Finishing a 3h step should move the bar further than a 10-minute one.
    const rows = [
      task({ id: 1 }),
      task({ id: 2, parent_id: 1, time_estimate: 180, done: true }),
      task({ id: 3, parent_id: 1, time_estimate: 10 }),
    ];
    const p = rollupProgress(subtreeNode(rows, 1)!, new Map());
    expect(p.fraction).toBeCloseTo(180 / 190);
    expect(p.label).toBe("1/2 subtasks");
    expect(p.done).toBe(false);
  });

  it("a parent is done only when every child is", () => {
    const rows = [
      task({ id: 1 }),
      task({ id: 2, parent_id: 1, time_estimate: 10, done: true }),
      task({ id: 3, parent_id: 1, time_estimate: 10, done: true }),
    ];
    expect(rollupProgress(subtreeNode(rows, 1)!, new Map()).done).toBe(true);
  });
});

// ── Scheduling coverage ──────────────────────────────────────────────────────

describe("blockMinutes", () => {
  it("measures a normal block", () => {
    expect(blockMinutes("09:00", "10:30")).toBe(90);
  });

  it("wraps past midnight instead of going negative", () => {
    expect(blockMinutes("23:00", "00:30")).toBe(90);
  });

  it("returns 0 for unparseable times rather than NaN", () => {
    expect(blockMinutes("", "10:00")).toBe(0);
    expect(blockMinutes("nope", "also-nope")).toBe(0);
  });
});

describe("coverageByTask", () => {
  it("sums per task and ignores unlinked blocks", () => {
    const cov = coverageByTask([
      block({ id: 1, task_id: 7, start_time: "09:00", end_time: "10:00" }),
      block({ id: 2, task_id: 7, start_time: "14:00", end_time: "14:30" }),
      block({ id: 3, task_id: null }),
    ]);
    expect(cov.get(7)!.scheduledMin).toBe(90);
    expect(cov.get(7)!.blockCount).toBe(2);
    expect(cov.size).toBe(1);
  });

  it("counts each recurring occurrence separately and keeps the earliest date", () => {
    // getCalBlocks expands a series into one entry per occurrence; a Mon/Wed
    // series over two weeks must count as four commitments, not one.
    const occurrences = ["2026-09-07", "2026-09-09", "2026-08-31", "2026-09-02"].map((date, i) =>
      block({ id: -(1000 + i), date, task_id: 3, start_time: "07:00", end_time: "08:00", is_recurring: true }),
    );
    const cov = coverageByTask(occurrences).get(3)!;
    expect(cov.blockCount).toBe(4);
    expect(cov.scheduledMin).toBe(240);
    expect(cov.firstDate).toBe("2026-08-31");
  });
});

describe("rollupCoverage", () => {
  it("a parent inherits its descendants' commitments", () => {
    // Scheduling a step IS scheduling part of the parent — this is what makes
    // "4h of 6h committed" legible on the parent row.
    const rows = [task({ id: 1 }), task({ id: 2, parent_id: 1, time_estimate: 120 })];
    const cov = coverageByTask([block({ id: 1, task_id: 2, start_time: "09:00", end_time: "10:00" })]);
    const root = subtreeNode(rows, 1)!;
    expect(rollupCoverage(root, cov).scheduledMin).toBe(60);
    expect(unscheduledMinutes(root, cov)).toBe(60);
  });

  it("unscheduled never goes negative when over-committed", () => {
    const rows = [task({ id: 1, time_estimate: 30 })];
    const cov = coverageByTask([block({ id: 1, task_id: 1, start_time: "09:00", end_time: "12:00" })]);
    expect(unscheduledMinutes(subtreeNode(rows, 1)!, cov)).toBe(0);
  });
});

// ── The gate ─────────────────────────────────────────────────────────────────

describe("isWorkable", () => {
  it("a full task needs committed calendar time", () => {
    const rows = [task({ id: 1 })];
    const root = subtreeNode(rows, 1)!;
    expect(isWorkable(root, new Map())).toBe(false);
    expect(gateReason(root, new Map())).toMatch(/schedule/i);

    const cov = coverageByTask([block({ id: 1, task_id: 1 })]);
    expect(isWorkable(root, cov)).toBe(true);
    expect(gateReason(root, cov)).toBeNull();
  });

  it("time committed to a step unlocks the parent", () => {
    const rows = [task({ id: 1 }), task({ id: 2, parent_id: 1 })];
    const cov = coverageByTask([block({ id: 1, task_id: 2 })]);
    expect(isWorkable(subtreeNode(rows, 1)!, cov)).toBe(true);
  });

  it("sparse subtypes are exempt — a shopping list is not gated", () => {
    for (const kind of ["chore", "reminder", "shopping"] as const) {
      const rows = [task({ id: 1, task_type: kind, category: kind, planning: null })];
      expect(isWorkable(subtreeNode(rows, 1)!, new Map())).toBe(true);
    }
  });
});

// ── ISA reading and patching ─────────────────────────────────────────────────

describe("planningOf / isFullTask", () => {
  it("supplies read-only defaults for a sparse subtype", () => {
    const chore = task({ task_type: "chore", category: "chore", planning: null });
    expect(planningOf(chore)).toEqual(IMPLICIT_PLANNING);
    expect(isFullTask(chore)).toBe(false);
    expect(isFullTask(task())).toBe(true);
  });
});

describe("applyTaskPatch", () => {
  it("routes planning keys under `planning`, not onto the task", () => {
    // Spreading a patch containing `urgency` straight onto the task sets a dead
    // property, and the matrix pad appears frozen until the refetch lands.
    const t = task({ priority: "low" });
    const next = applyTaskPatch(t, { priority: "high", urgency: "high" });
    expect(next.priority).toBe("high");
    expect(next.planning!.urgency).toBe("high");
    expect((next as any).urgency).toBeUndefined();
  });

  it("ignores planning keys on a sparse subtype, like the server does", () => {
    const chore = task({ task_type: "chore", category: "chore", planning: null });
    expect(applyTaskPatch(chore, { urgency: "high" }).planning).toBeNull();
  });

  it("never writes database-maintained fields", () => {
    const t = task({ aggregate_estimate: 90 });
    const next = applyTaskPatch(t, { aggregate_estimate: 5, task_type: "chore", title: "x" });
    expect(next.aggregate_estimate).toBe(90);
    expect(next.task_type).toBe("task");
    expect(next.title).toBe("x");
  });
});

// ── Matrix ───────────────────────────────────────────────────────────────────

describe("matrix cells", () => {
  it("cellKey and parseCellKey round-trip", () => {
    expect(parseCellKey(cellKey("high", "low"))).toEqual({ importance: "high", urgency: "low" });
    expect(parseCellKey("nonsense")).toBeNull();
    expect(parseCellKey("high:banana")).toBeNull();
  });

  it("only the four corners carry advice", () => {
    expect(cellAdvice("high", "high")).toBe("Do now");
    expect(cellAdvice("high", "low")).toBe("Schedule");
    expect(cellAdvice("low", "high")).toBe("Do quickly");
    expect(cellAdvice("low", "low")).toBe("Drop or defer");
    expect(cellAdvice("medium", "medium")).toBe("");
    expect(cellAdvice("high", "medium")).toBe("");
  });
});

// ── Formatting ───────────────────────────────────────────────────────────────

describe("formatMinutes / addMinutesToTime", () => {
  it("formats minutes and hours", () => {
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(90)).toBe("1h30");
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(-5)).toBe("0m");
  });

  it("adds minutes and clamps at end of day instead of wrapping", () => {
    expect(addMinutesToTime("09:00", 90)).toBe("10:30");
    expect(addMinutesToTime("23:30", 120)).toBe("23:59");
    expect(addMinutesToTime("bad", 30)).toBe("bad");
  });
});
