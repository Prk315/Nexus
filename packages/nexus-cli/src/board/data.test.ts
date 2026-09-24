// The board's rules, with no terminal and no database in sight.

import { describe, expect, it } from "vitest";
import type { PfPlan, PfTask } from "@nexus/core/pathfinder";
import {
  addDays,
  bar,
  buildModel,
  currentRows,
  currentTasks,
  goalOfTask,
  headlineCounts,
  isIsoDate,
  leafCounts,
  planLeafCounts,
  planTopLevel,
  progressRows,
  scrollWindow,
  roadmapRows,
  subtreeIds,
  todayIso,
  upcomingGroups,
  upcomingRows,
  type BoardModel,
} from "./data.ts";
import { FIXTURE_BRIEF, FIXTURE_GOALS, FIXTURE_PLANS, FIXTURE_TASKS, FIXTURE_TODAY } from "./fixture.ts";

function model(over: Partial<Parameters<typeof buildModel>[0]> = {}): BoardModel {
  return buildModel({
    tasks: FIXTURE_TASKS,
    plans: FIXTURE_PLANS,
    goals: FIXTURE_GOALS,
    brief: FIXTURE_BRIEF,
    today: FIXTURE_TODAY,
    loadedAt: new Date("2026-09-24T09:00:00Z"),
    ...over,
  });
}

const ids = (rows: { id: number | null }[]) => rows.map((r) => r.id);

describe("dates", () => {
  it("validates by round trip, so a rolled-over month is refused", () => {
    expect(isIsoDate("2026-09-24")).toBe(true);
    // Date.UTC(2026, 12, 1) silently becomes January 2027.
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("24/09/2026")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it("adds days across a month and a year boundary", () => {
    expect(addDays("2026-09-24", 7)).toBe("2026-10-01");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("takes today from the LOCAL date, not toISOString", () => {
    // 00:30 local on the 24th is still the 23rd in UTC for any positive offset.
    const local = new Date(2026, 8, 24, 0, 30, 0);
    expect(todayIso(local)).toBe("2026-09-24");
  });
});

describe("leaf counting", () => {
  it("counts leaves, not nodes, and follows the subtree past a missing plan_id", () => {
    // Plan 10 holds tasks 100 and 110; 101/102 are steps of 100 carrying no
    // plan_id of their own. Nodes in the closure: 4. Leaves: 101, 102, 110.
    expect(planLeafCounts(FIXTURE_TASKS, 10)).toEqual({ done: 1, total: 3 });
  });

  it("treats a container as a heading, never as work", () => {
    const only100 = subtreeIds(FIXTURE_TASKS, [100]);
    expect(only100.size).toBe(3);
    expect(leafCounts(FIXTURE_TASKS, only100)).toEqual({ done: 1, total: 2 });
  });

  it("terminates on a parent cycle instead of hanging", () => {
    const a = { ...FIXTURE_TASKS[0], id: 900, parent_id: 901 } as PfTask;
    const b = { ...FIXTURE_TASKS[0], id: 901, parent_id: 900 } as PfTask;
    expect(subtreeIds([a, b], [900])).toEqual(new Set([900, 901]));
  });

  it("prefers a task's direct goal over the one inherited from its plan", () => {
    const plans = new Map<number, PfPlan>(FIXTURE_PLANS.map((p) => [p.id, p]));
    const viaPlan = FIXTURE_TASKS.find((t) => t.id === 200)!;
    expect(goalOfTask(viaPlan, plans)).toBe(2);
    expect(goalOfTask({ ...viaPlan, goal_id: 1 }, plans)).toBe(1);
    expect(goalOfTask({ ...viaPlan, plan_id: null }, plans)).toBeNull();
  });

  it("lists a plan's top-level tasks with their own roll-ups", () => {
    const top = planTopLevel(FIXTURE_TASKS, 10);
    expect(top.map((t) => t.task.id)).toEqual([100, 110]);
    expect(top[0].counts).toEqual({ done: 1, total: 2 });
    expect(top[1].counts).toEqual({ done: 0, total: 1 });
  });
});

describe("bar", () => {
  it("fills in proportion and leaves an empty track when there is nothing to measure", () => {
    expect(bar({ done: 5, total: 10 })).toBe("█████░░░░░");
    expect(bar({ done: 0, total: 3 })).toBe("░░░░░░░░░░");
    expect(bar({ done: 3, total: 3 })).toBe("██████████");
    // Zero leaves is "nothing to measure", not "0% done" and never "full".
    expect(bar({ done: 0, total: 0 })).toBe("░░░░░░░░░░");
  });
});

describe("current", () => {
  it("is active plus due-today plus overdue, overdue first", () => {
    const list = currentTasks(FIXTURE_TASKS, FIXTURE_TODAY);
    expect(list.map((t) => t.id)).toEqual([110, 102]);
  });

  it("sorts by due date, then urgency, within the overdue group", () => {
    const base = FIXTURE_TASKS.find((t) => t.id === 110)!;
    const mk = (id: number, due: string, urgency: "high" | "medium" | "low"): PfTask => ({
      ...base,
      id,
      due_date: due,
      planning: { ...base.planning!, urgency },
    });
    const list = currentTasks(
      [mk(3, "2026-09-22", "low"), mk(1, "2026-09-20", "low"), mk(2, "2026-09-20", "high")],
      FIXTURE_TODAY,
    );
    expect(list.map((t) => t.id)).toEqual([2, 1, 3]);
  });

  it("keeps a done task out, however overdue it is", () => {
    const done = { ...FIXTURE_TASKS.find((t) => t.id === 110)!, done: true };
    expect(currentTasks([done], FIXTURE_TODAY)).toEqual([]);
  });

  it("says so rather than rendering an empty pane", () => {
    const rows = currentRows(model({ tasks: [] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("note");
  });
});

describe("upcoming", () => {
  it("partitions the open backlog Current does not hold", () => {
    const g = upcomingGroups(FIXTURE_TASKS, FIXTURE_TODAY);
    expect(g.week.map((t) => t.id)).toEqual([200]);
    expect(g.later.map((t) => t.id)).toEqual([300]);
    expect(g.undated.map((t) => t.id)).toEqual([100, 400, 201]);
  });

  it("never repeats what Current already shows", () => {
    const g = upcomingGroups(FIXTURE_TASKS, FIXTURE_TODAY);
    const all = [...g.week, ...g.later, ...g.undated].map((t) => t.id);
    for (const t of currentTasks(FIXTURE_TASKS, FIXTURE_TODAY)) expect(all).not.toContain(t.id);
  });

  it("sorts dated work by due date then priority", () => {
    const base = FIXTURE_TASKS.find((t) => t.id === 200)!;
    const mk = (id: number, due: string, priority: "high" | "medium" | "low"): PfTask => ({ ...base, id, due_date: due, priority });
    const g = upcomingGroups([mk(1, "2026-09-30", "low"), mk(2, "2026-09-26", "low"), mk(3, "2026-09-26", "high")], FIXTURE_TODAY);
    expect(g.week.map((t) => t.id)).toEqual([3, 2, 1]);
  });

  it("buckets an uncomparable due date as undated rather than sorting it at random", () => {
    const bad = { ...FIXTURE_TASKS.find((t) => t.id === 200)!, id: 777, due_date: "2026-13-01" };
    const g = upcomingGroups([bad], FIXTURE_TODAY);
    expect(g.undated.map((t) => t.id)).toEqual([777]);
    // …and the raw value still reaches the row, so it is visible rather than hidden.
    const rows = upcomingRows(model({ tasks: [bad] }));
    expect(rows.find((r) => r.id === 777)!.cells[0]).toBe("2026-13-01");
  });

  it("groups with a heading per bucket", () => {
    const rows = upcomingRows(model());
    expect(rows.filter((r) => r.kind === "group").map((r) => r.title)).toEqual([
      "due within 7 days (1)",
      "due later (1)",
      "no date (3)",
    ]);
  });
});

describe("roadmap", () => {
  it("nests plans under goals and hides tasks until the plan is expanded", () => {
    // Goals come back in title order, as loadGoals() returns them.
    const collapsed = roadmapRows(model(), new Set());
    expect(collapsed.map((r) => r.key)).toEqual(["g:2", "g:1", "g:none"]);

    const openGoal = roadmapRows(model(), new Set(["g:1"]));
    expect(openGoal.map((r) => r.key)).toEqual(["g:2", "g:1", "p:10", "g:none"]);

    const openPlan = roadmapRows(model(), new Set(["g:1", "p:10"]));
    expect(openPlan.map((r) => r.key)).toEqual(["g:2", "g:1", "p:10", "p:10:t:100", "p:10:t:110", "g:none"]);
  });

  it("gives a plan its done/total leaves and a bar", () => {
    const rows = roadmapRows(model(), new Set(["g:1"]));
    const plan = rows.find((r) => r.key === "p:10")!;
    expect(plan.cells[0]).toBe("███░░░░░░░");
    expect(plan.cells[2]).toBe("1/3");
  });

  it("collects what no goal claims into one bucket, counting nothing twice", () => {
    const rows = roadmapRows(model(), new Set(["g:none"]));
    expect(rows.filter((r) => r.key.startsWith("g:none") || r.key === "p:12").map((r) => r.title)).toEqual([
      "(no goal)",
      "Odd jobs",
    ]);
    // 300 (plan 12, no goal) and 400 (no plan at all) are the only leaves here:
    // 101/102 reach no goal of their own but sit inside goal 1's closure, and
    // counting them here as well would double them.
    expect(rows.find((r) => r.key === "g:none")!.cells[2]).toBe("0/2");
  });

  it("makes the goal buckets a partition of every task", () => {
    const m = model();
    const total = m.goals.reduce((n, g) => n + g.counts.total, 0);
    const done = m.goals.reduce((n, g) => n + g.counts.done, 0);
    // Every leaf in the fixture is counted once and only once.
    const leaves = FIXTURE_TASKS.filter((t) => !FIXTURE_TASKS.some((c) => c.parent_id === t.id));
    expect(total).toBe(leaves.length);
    expect(done).toBe(leaves.filter((t) => t.done).length);
  });

  it("takes goal priority and deadline from the brief, and leaves them blank without one", () => {
    const withBrief = roadmapRows(model(), new Set());
    expect(withBrief.find((r) => r.key === "g:1")!.cells[4]).toBe("2026-10-31");
    const without = roadmapRows(model({ brief: null }), new Set());
    expect(without.find((r) => r.key === "g:1")!.cells[4]).toBe("");
  });

  it("force-expands the ancestors of a filter match", () => {
    const rows = roadmapRows(model(), new Set(), "readme");
    expect(rows.map((r) => r.key)).toEqual(["g:1", "p:10", "p:10:t:110"]);
  });

  it("keeps every plan of a goal whose own title matches", () => {
    const rows = roadmapRows(model(), new Set(), "Read more");
    expect(rows.map((r) => r.title)).toEqual(["Read more", "Books", "[ ] Book: The Selfish Gene", "[ ] Book: Sapiens", "[x] Book: Dune"]);
  });
});

describe("progress", () => {
  it("reports the brief's headline numbers", () => {
    expect(headlineCounts(model())).toBe("open 7  roots 5  active 1  overdue 1");
  });

  it("says ? rather than 0 when the brief did not answer", () => {
    // An empty brief looks exactly like "nothing planned"; zero would be a lie.
    expect(headlineCounts(model({ brief: null, briefError: "boom" }))).toBe("open ?  roots ?  active ?  overdue ?");
  });

  it("lists every goal with its leaf progress", () => {
    const rows = progressRows(model());
    expect(rows.map((r) => [r.title, r.cells[2]])).toEqual([
      ["Read more", "1/3"],
      ["Ship the board", "1/3"],
      ["(no goal)", "0/2"],
    ]);
  });
});

describe("scrollWindow", () => {
  it("shows everything when it fits", () => {
    expect(scrollWindow(3, 0, 10)).toEqual({ start: 0, end: 3 });
  });

  it("centres the selection and clamps at both ends", () => {
    expect(scrollWindow(100, 0, 10)).toEqual({ start: 0, end: 10 });
    expect(scrollWindow(100, 4, 10)).toEqual({ start: 0, end: 10 });
    expect(scrollWindow(100, 50, 10)).toEqual({ start: 45, end: 55 });
    expect(scrollWindow(100, 99, 10)).toEqual({ start: 90, end: 100 });
  });

  it("puts the selection inside the window it returns", () => {
    for (const selected of [0, 1, 7, 42, 98, 99]) {
      const w = scrollWindow(100, selected, 12);
      expect(selected).toBeGreaterThanOrEqual(w.start);
      expect(selected).toBeLessThan(w.end);
    }
  });

  it("never returns a window off either end", () => {
    for (const selected of [-1, 0, 5, 50, 99, 200]) {
      const w = scrollWindow(100, selected, 12);
      expect(w.start).toBeGreaterThanOrEqual(0);
      expect(w.end).toBeLessThanOrEqual(100);
      expect(w.end - w.start).toBe(12);
    }
  });

  it("is empty rather than negative for an empty list", () => {
    expect(scrollWindow(0, 0, 10)).toEqual({ start: 0, end: 0 });
    expect(scrollWindow(5, 0, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe("buildModel", () => {
  it("keeps the row cap and the brief's failure visible", () => {
    const m = model({ capped: true, briefError: "pf_agent_brief: boom", brief: null });
    expect(m.capped).toBe(true);
    expect(m.briefError).toBe("pf_agent_brief: boom");
    expect(ids(m.goals)).toEqual([2, 1, null]);
  });
});
