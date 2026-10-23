import { describe, it, expect } from "vitest";
import type { PfTask } from "@nexus/core/pathfinder";
import { renderTaskTree, taskTree } from "./tree.ts";

function task(id: number, parent_id: number | null, title: string, done = false, extra: Partial<PfTask> = {}): PfTask {
  return {
    id, parent_id, title, done, plan_id: null, goal_id: null, task_type: "task", sort_order: id, priority: "medium",
    due_date: null, created_at: "", time_estimate: null, aggregate_estimate: 0, kanban_status: "backlog", category: null,
    team_id: null, assigned_to: null, plan_title: null, goal_title: null,
    planning: { urgency: "medium", stage: "refine", completion_mode: "binary", target_count: null, notes: null },
    ...extra,
  };
}

// 1 → {2 → {3 → {4 → {5 → {6}}}}, 7}: a chain deeper than the cap, plus a leaf.
const tasks = [
  task(1, null, "Plan"),
  task(2, 1, "UX"),
  task(3, 2, "Sidebar"),
  task(4, 3, "Collapse"),
  task(5, 4, "Animate"),
  task(6, 5, "Too deep"),
  task(7, 1, "Ship it", true),
  task(8, null, "Unrelated"),
];

describe("taskTree", () => {
  it("counts leaves, not nodes, and reports containers separately", () => {
    const r = taskTree(tasks, 1)!;
    expect(r.summary).toMatchObject({ nodes: 6, leaves: 1, done_leaves: 1, open_leaves: 0, containers: 5 });
  });

  it("stops at depth 4 and says where it was cut", () => {
    const r = taskTree(tasks, 1)!;
    expect(r.summary.truncated_at).toEqual([5]);
    expect(renderTaskTree(r.tree)).toContain("… (children below depth cap)");
  });

  it("counts a real leaf when the depth cap is not reached", () => {
    const r = taskTree(tasks, 3)!;
    expect(r.summary).toMatchObject({ nodes: 4, leaves: 1, containers: 3, truncated_at: [] });
  });

  it("returns null for an unknown root", () => {
    expect(taskTree(tasks, 99)).toBeNull();
  });

  it("renders the outline the brief skill prints", () => {
    const r = taskTree(tasks, 1, 1)!;
    expect(renderTaskTree(r.tree).split("\n")).toEqual([
      "[ ] 1  Plan  (refine)",
      "    [ ] 2  UX  (refine)  … (children below depth cap)",
      "    [x] 7  Ship it  (refine)",
    ]);
  });

  it("survives a parent cycle", () => {
    const cyclic = [task(1, 2, "a"), task(2, 1, "b")];
    expect(() => taskTree(cyclic, 1)).not.toThrow();
  });
});
