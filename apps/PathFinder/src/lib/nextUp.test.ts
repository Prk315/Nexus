import { describe, it, expect } from "vitest";
import { nextUp, needsScheduling } from "./nextUp";
import { IMPLICIT_PLANNING } from "./taskTree";
import type { CalBlock, TaskWithContext, TaskPlanning } from "../types";

const TODAY = "2026-08-21";
const NOON = 12 * 60;

const planning = (o: Partial<TaskPlanning> = {}): TaskPlanning => ({ ...IMPLICIT_PLANNING, ...o });

let id = 1;
const task = (o: Partial<TaskWithContext> = {}): TaskWithContext => ({
  id: id++, plan_id: null, parent_id: null, goal_id: null, task_type: "task",
  plan_title: null, goal_title: null, title: "t", done: false, sort_order: 0,
  priority: "medium", due_date: null, created_at: "", time_estimate: null,
  aggregate_estimate: 0, kanban_status: "backlog", category: null,
  team_id: null, assigned_to: null,
  planning: planning(), ...o,
});

const block = (o: Partial<CalBlock> = {}): CalBlock => ({
  id: 1, date: TODAY, title: "b", start_time: "09:00", end_time: "10:00",
  color: "blue", description: null, location: null, created_at: "",
  is_recurring: false, recurring_id: null, recurrence: null, days_of_week: null,
  series_start_date: null, series_end_date: null, task_id: null, category: null,
  parent_block_id: null, ...o,
});

const run = (tasks: TaskWithContext[], blocks: [number, CalBlock[]][] = [], worked: number[] = [], nowMinutes = NOON) =>
  nextUp({ tasks, blocksByTask: new Map(blocks), workedBlockIds: new Set(worked), today: TODAY, nowMinutes });

describe("nextUp ranking", () => {
  it("a block running right now outranks everything else", () => {
    const running = task({ id: 1, title: "running" });
    const overdue = task({ id: 2, title: "overdue", due_date: "2026-08-01", priority: "high" });
    const out = run([running, overdue], [[1, [block({ id: 10, task_id: 1, start_time: "11:30", end_time: "13:00" })]]]);
    expect(out[0].task.title).toBe("running");
    expect(out[0].kind).toBe("now");
    expect(out[0].reason).toBe("on now until 13:00");
    expect(out[0].minutes).toBe(90);
  });

  it("prefers a later-today booking over an overdue task with nothing booked", () => {
    // A commitment you made beats a date that has already slipped — the slipped
    // one has no time behind it, so "do it now" would be a wish, not a plan.
    const booked  = task({ id: 1, title: "booked" });
    const overdue = task({ id: 2, title: "overdue", due_date: "2026-08-01" });
    const out = run([booked, overdue], [[1, [block({ id: 10, task_id: 1, start_time: "16:00", end_time: "17:00" })]]]);
    expect(out.map((i) => i.task.title)).toEqual(["booked", "overdue"]);
    expect(out[0].reason).toBe("booked 16:00");
  });

  it("ignores a block that has already been ticked as worked", () => {
    const t = task({ id: 1 });
    const b = block({ id: 10, task_id: 1, start_time: "11:30", end_time: "13:00" });
    expect(run([t], [[1, [b]]], [10])).toHaveLength(0);
  });

  it("ignores a block that already finished", () => {
    const t = task({ id: 1 });
    const out = run([t], [[1, [block({ id: 10, task_id: 1, start_time: "08:00", end_time: "09:00" })]]]);
    expect(out).toHaveLength(0);
  });

  it("reports overdue in days, singular at one", () => {
    const one  = task({ id: 1, due_date: "2026-08-20" });
    const many = task({ id: 2, due_date: "2026-08-18" });
    const out = run([one, many]);
    expect(out.find((i) => i.task.id === 1)!.reason).toBe("1 day overdue");
    expect(out.find((i) => i.task.id === 2)!.reason).toBe("3 days overdue");
  });

  it("surfaces due-today-with-nothing-booked, which is what the gate blocks", () => {
    const out = run([task({ id: 1, due_date: TODAY })]);
    expect(out[0].kind).toBe("today");
    expect(out[0].reason).toBe("due today, nothing booked");
  });

  it("distinguishes never-booked from lapsed from already-logged", () => {
    // The panel once claimed "nothing booked" for three tasks while the gate
    // counted two, because a finished or ticked block still counted as nothing.
    const never  = task({ id: 1, due_date: TODAY });
    const lapsed = task({ id: 2, due_date: TODAY });
    const spent  = task({ id: 3, due_date: TODAY });
    const out = run(
      [never, lapsed, spent],
      [
        [2, [block({ id: 20, task_id: 2, start_time: "08:00", end_time: "09:00" })]],  // passed, unworked
        [3, [block({ id: 30, task_id: 3, start_time: "08:00", end_time: "09:00" })]],  // passed, worked
      ],
      [30],
    );
    const reason = (id: number) => out.find((i) => i.task.id === id)!.reason;
    expect(reason(1)).toBe("due today, nothing booked");
    expect(reason(2)).toBe("due today, booked time passed");
    expect(reason(3)).toBe("due today, booked time already logged");
  });

  it("says so when an overdue task's booked time also lapsed", () => {
    const t = task({ id: 1, due_date: "2026-08-19" });
    const out = run([t], [[1, [block({ id: 10, task_id: 1, start_time: "08:00", end_time: "09:00" })]]]);
    expect(out[0].reason).toBe("2 days overdue, booked time passed");
  });

  it("only 'nothing booked' agrees with needsScheduling", () => {
    // The count beside the panel and the reasons inside it must not disagree.
    const tasks = [
      task({ id: 1, due_date: TODAY }),
      task({ id: 2, due_date: TODAY }),
    ];
    const blocks: [number, CalBlock[]][] = [[2, [block({ id: 20, task_id: 2, start_time: "08:00", end_time: "09:00" })]]];
    const ranked = run(tasks, blocks);
    const gated = needsScheduling({ tasks, blocksByTask: new Map(blocks), workedBlockIds: new Set(), today: TODAY });
    expect(ranked.filter((i) => i.reason.includes("nothing booked")).map((i) => i.task.id))
      .toEqual(gated.map((t) => t.id));
  });

  it("breaks ties by importance then urgency", () => {
    const lowLow   = task({ id: 1, title: "low",  due_date: TODAY, priority: "low" });
    const highSoon = task({ id: 2, title: "high", due_date: TODAY, priority: "high", planning: planning({ urgency: "medium" }) });
    const highNow  = task({ id: 3, title: "urgent", due_date: TODAY, priority: "high", planning: planning({ urgency: "high" }) });
    expect(run([lowLow, highSoon, highNow]).map((i) => i.task.title)).toEqual(["urgent", "high", "low"]);
  });

  it("points at the step, never the broken-down parent", () => {
    // You cannot sit down and do a parent; scheduling and working happen at the leaf.
    const parent = task({ id: 1, title: "parent", due_date: TODAY });
    const step   = task({ id: 2, title: "step", parent_id: 1, due_date: TODAY });
    expect(run([parent, step]).map((i) => i.task.title)).toEqual(["step"]);
  });

  it("excludes quick tasks and completed work", () => {
    const chore = task({ id: 1, task_type: "chore", category: "chore", planning: null, due_date: TODAY });
    const done  = task({ id: 2, done: true, due_date: TODAY });
    expect(run([chore, done])).toHaveLength(0);
  });

  it("falls back to an active task with nothing booked", () => {
    const t = task({ id: 1, planning: planning({ stage: "active" }) });
    const out = run([t]);
    expect(out[0].kind).toBe("unblocked");
    expect(out[0].reason).toBe("in progress");
  });

  it("caps the list", () => {
    const many = Array.from({ length: 9 }, (_, i) => task({ id: i + 1, due_date: TODAY }));
    expect(nextUp({ tasks: many, blocksByTask: new Map(), workedBlockIds: new Set(), today: TODAY, nowMinutes: NOON }, 3))
      .toHaveLength(3);
  });
});

describe("needsScheduling", () => {
  const call = (tasks: TaskWithContext[], blocks: [number, CalBlock[]][] = []) =>
    needsScheduling({ tasks, blocksByTask: new Map(blocks), workedBlockIds: new Set(), today: TODAY });

  it("lists due and overdue tasks with no block", () => {
    const out = call([
      task({ id: 1, due_date: TODAY }),
      task({ id: 2, due_date: "2026-08-01" }),
      task({ id: 3, due_date: "2026-09-01" }),  // future — not yet a problem
      task({ id: 4 }),                          // undated
    ]);
    expect(out.map((t) => t.id)).toEqual([1, 2]);
  });

  it("drops anything that already has time booked", () => {
    const out = call([task({ id: 1, due_date: TODAY })], [[1, [block({ id: 10, task_id: 1 })]]]);
    expect(out).toHaveLength(0);
  });

  it("ignores steps' parents, quick tasks and done work", () => {
    const out = call([
      task({ id: 1, due_date: TODAY }),
      task({ id: 2, parent_id: 1, due_date: TODAY }),
      task({ id: 3, due_date: TODAY, task_type: "shopping", category: "shopping", planning: null }),
      task({ id: 4, due_date: TODAY, done: true }),
    ]);
    expect(out.map((t) => t.id)).toEqual([2]);
  });
});
