import { describe, it, expect } from "vitest";
import { DEFAULT_FILTER, type TaskFilter } from "./filter";
import {
  ancestorsOf,
  descendantIds,
  buildTaskTree,
  flattenTaskTree,
  runTreeQuery,
  subtreeStats,
  type TaskTreeNode,
} from "./tree";
import type { PfTask } from "./types";

const TODAY = "2026-08-27";

function task(over: Partial<PfTask> = {}): PfTask {
  return {
    id: 1,
    plan_id: null,
    parent_id: null,
    goal_id: null,
    task_type: "task",
    title: "Write the thing",
    done: false,
    sort_order: 0,
    priority: "medium",
    due_date: null,
    created_at: "2026-01-01T00:00:00Z",
    time_estimate: null,
    aggregate_estimate: 0,
    kanban_status: "backlog",
    category: null,
    team_id: null,
    assigned_to: null,
    planning: { urgency: "medium", stage: "refine", completion_mode: "binary", target_count: null, notes: null },
    plan_title: null,
    goal_title: null,
    ...over,
  };
}

const filter = (over: Partial<TaskFilter> = {}): TaskFilter => ({ ...DEFAULT_FILTER, ...over });
const MANUAL = { key: "manual" as const, dir: "asc" as const };

/** ids in render order, so a test reads like the list on screen. */
const ids = (nodes: TaskTreeNode[]): number[] =>
  nodes.flatMap((n) => [n.task.id, ...ids(n.children)]);

// 1 ─ 2 ─ 4
//   └ 3
// 5 (root, no children)
const TREE = [
  task({ id: 1, title: "Thesis" }),
  task({ id: 2, title: "Chapter one", parent_id: 1 }),
  task({ id: 3, title: "Chapter two", parent_id: 1 }),
  task({ id: 4, title: "Draft intro", parent_id: 2 }),
  task({ id: 5, title: "Buy milk" }),
];

describe("subtreeStats", () => {
  it("counts every descendant, not just direct children", () => {
    const s = subtreeStats(TREE);
    expect(s.get(1)).toEqual({ direct: 2, total: 3, done: 0 });
    expect(s.get(2)).toEqual({ direct: 1, total: 1, done: 0 });
    expect(s.get(5)).toEqual({ direct: 0, total: 0, done: 0 });
  });

  it("counts done descendants at any depth", () => {
    const s = subtreeStats([
      task({ id: 1 }),
      task({ id: 2, parent_id: 1 }),
      task({ id: 3, parent_id: 2, done: true }),
    ]);
    expect(s.get(1)).toEqual({ direct: 1, total: 2, done: 1 });
  });

  // Nothing in pf_tasks stops an UPDATE making a task its own ancestor, and a
  // hierarchy view is where that would first be noticed. It must not hang.
  it("terminates on a parent_id cycle", () => {
    const cyclic = [
      task({ id: 1, parent_id: 3 }),
      task({ id: 2, parent_id: 1 }),
      task({ id: 3, parent_id: 2 }),
    ];
    const s = subtreeStats(cyclic);
    expect(s.get(1)!.total).toBe(2);
  });
});

describe("buildTaskTree — matched mode", () => {
  it("nests matched tasks under their real parents", () => {
    const tree = buildTaskTree(TREE, TREE, "matched", MANUAL);
    expect(ids(tree)).toEqual([1, 2, 4, 3, 5]);
  });

  it("promotes a matched step whose parent was filtered out", () => {
    // Only the leaf matches. It must still appear — as a root, not nowhere.
    const matched = [TREE[3]];
    const tree = buildTaskTree(TREE, matched, "matched", MANUAL);
    expect(ids(tree)).toEqual([4]);
    expect(tree[0].children).toEqual([]);
  });

  it("re-parents to the NEAREST matched ancestor, skipping unmatched ones", () => {
    // 1 and 4 match; 2 (the real parent of 4) does not.
    const matched = [TREE[0], TREE[3]];
    const tree = buildTaskTree(TREE, matched, "matched", MANUAL);
    expect(ids(tree)).toEqual([1, 4]);
    expect(tree[0].children.map((c) => c.task.id)).toEqual([4]);
  });

  it("never renders an unmatched task", () => {
    const matched = [TREE[0], TREE[2]];
    const tree = buildTaskTree(TREE, matched, "matched", MANUAL);
    expect(ids(tree).sort()).toEqual([1, 3]);
  });

  it("renders every matched task exactly once", () => {
    const tree = buildTaskTree(TREE, TREE, "matched", MANUAL);
    const flat = ids(tree);
    expect(new Set(flat).size).toBe(flat.length);
    expect(flat.length).toBe(TREE.length);
  });

  it("treats a parent outside the fetched window as no parent", () => {
    const orphan = task({ id: 9, parent_id: 999 });
    const tree = buildTaskTree([orphan], [orphan], "matched", MANUAL);
    expect(ids(tree)).toEqual([9]);
  });

  it("terminates on a parent_id cycle", () => {
    const cyclic = [
      task({ id: 1, parent_id: 3 }),
      task({ id: 2, parent_id: 1 }),
      task({ id: 3, parent_id: 2 }),
    ];
    const tree = buildTaskTree(cyclic, cyclic, "matched", MANUAL);
    expect(ids(tree).length).toBeLessThanOrEqual(3);
  });
});

describe("buildTaskTree — full mode", () => {
  it("drags the whole real subtree in behind a matched root", () => {
    const matched = [TREE[0]];
    const tree = buildTaskTree(TREE, matched, "full", MANUAL);
    expect(ids(tree)).toEqual([1, 2, 4, 3]);
  });

  it("does not duplicate a task that both matches and is a descendant", () => {
    const matched = [TREE[0], TREE[3]];
    const tree = buildTaskTree(TREE, matched, "full", MANUAL);
    const flat = ids(tree);
    expect(flat).toEqual([1, 2, 4, 3]);
    expect(new Set(flat).size).toBe(flat.length);
  });
});

describe("buildTaskTree — expandFull", () => {
  it("pulls one row's hidden children in without changing the block's filter", () => {
    const matched = [TREE[0]]; // only the root matches
    const plain = buildTaskTree(TREE, matched, "matched", MANUAL);
    expect(ids(plain)).toEqual([1]);

    const opened = buildTaskTree(TREE, matched, "matched", MANUAL, new Set([1]));
    expect(ids(opened)).toEqual([1, 2, 4, 3]);
  });
});

describe("flattenTaskTree", () => {
  const stats = subtreeStats(TREE);

  it("reports descendant roll-ups from the full dataset, not the tree", () => {
    // Only the root is in the tree, but it still says it has three steps.
    const tree = buildTaskTree(TREE, [TREE[0]], "matched", MANUAL);
    const { rows } = flattenTaskTree(tree, stats, new Set(), 0);
    expect(rows[0].descendants).toBe(3);
    expect(rows[0].childCount).toBe(0);
    expect(rows[0].hiddenChildren).toBe(2);
  });

  it("assigns depth by nesting level", () => {
    const tree = buildTaskTree(TREE, TREE, "matched", MANUAL);
    const { rows } = flattenTaskTree(tree, stats, new Set(), 0);
    expect(rows.map((r) => [r.task.id, r.depth])).toEqual([[1, 0], [2, 1], [4, 2], [3, 1], [5, 0]]);
  });

  it("hides a collapsed row's children but keeps the row", () => {
    const tree = buildTaskTree(TREE, TREE, "matched", MANUAL);
    const { rows } = flattenTaskTree(tree, stats, new Set([2]), 0);
    expect(rows.map((r) => r.task.id)).toEqual([1, 2, 3, 5]);
    expect(rows.find((r) => r.task.id === 2)!.collapsed).toBe(true);
  });

  it("does not mark a childless row collapsed", () => {
    const tree = buildTaskTree(TREE, TREE, "matched", MANUAL);
    const { rows } = flattenTaskTree(tree, stats, new Set([5]), 0);
    expect(rows.find((r) => r.task.id === 5)!.collapsed).toBe(false);
  });

  // The whole reason the walk is depth-first: a prefix of it can never contain
  // an indented row whose parent was cut off above it.
  it("never orphans a row when the limit cuts the tree", () => {
    const tree = buildTaskTree(TREE, TREE, "matched", MANUAL);
    const { rows, truncated, total } = flattenTaskTree(tree, stats, new Set(), 3);
    expect(rows.map((r) => r.task.id)).toEqual([1, 2, 4]);
    expect(truncated).toBe(true);
    expect(total).toBe(5);
    const shown = new Set(rows.map((r) => r.task.id));
    for (const r of rows) {
      if (r.depth > 0) expect(shown.has(r.task.parent_id!)).toBe(true);
    }
  });
});

describe("runTreeQuery", () => {
  it("filters, nests and caps in one pass", () => {
    const res = runTreeQuery({
      all: TREE, filter: filter(), sort: MANUAL, limit: 0, today: TODAY, mode: "matched",
    });
    expect(res.matched).toBe(5);
    expect(res.rows.map((r) => r.task.id)).toEqual([1, 2, 4, 3, 5]);
  });

  it("applies `extra` before the limit, not after", () => {
    const res = runTreeQuery({
      all: TREE,
      filter: filter(),
      sort: MANUAL,
      limit: 2,
      today: TODAY,
      mode: "matched",
      extra: (t) => t.id === 5,
    });
    // Without `extra` inside the predicate, a limit of 2 would have consumed
    // ids 1 and 2 and this would be empty.
    expect(res.rows.map((r) => r.task.id)).toEqual([5]);
    expect(res.matched).toBe(1);
  });

  it("keeps a matched subtask visible when its parent is done", () => {
    const all = [
      task({ id: 1, done: true }),
      task({ id: 2, parent_id: 1 }),
    ];
    const res = runTreeQuery({
      all, filter: filter({ done: "open" }), sort: MANUAL, limit: 0, today: TODAY, mode: "matched",
    });
    expect(res.rows.map((r) => r.task.id)).toEqual([2]);
    expect(res.rows[0].depth).toBe(0);
  });
});

describe("ancestorsOf", () => {
  const byId = new Map(TREE.map((t) => [t.id, t]));

  it("returns the chain outermost first", () => {
    expect(ancestorsOf(TREE[3], byId).map((t) => t.id)).toEqual([1, 2]);
  });

  it("is empty for a root", () => {
    expect(ancestorsOf(TREE[0], byId)).toEqual([]);
  });

  it("stops at the edge of the fetched window", () => {
    const orphan = task({ id: 9, parent_id: 999 });
    expect(ancestorsOf(orphan, byId)).toEqual([]);
  });

  it("terminates on a cycle", () => {
    const cyclic = [
      task({ id: 1, parent_id: 3 }),
      task({ id: 2, parent_id: 1 }),
      task({ id: 3, parent_id: 2 }),
    ];
    const map = new Map(cyclic.map((t) => [t.id, t]));
    expect(ancestorsOf(cyclic[0], map).length).toBeLessThanOrEqual(3);
  });
});

describe("descendantIds", () => {
  const tree = [
    task({ id: 1 }),
    task({ id: 2, parent_id: 1 }),
    task({ id: 3, parent_id: 1 }),
    task({ id: 4, parent_id: 2 }),
    task({ id: 5, parent_id: 4 }),
    task({ id: 9 }),                    // unrelated root
    task({ id: 10, parent_id: 9 }),
  ];

  it("returns every descendant at any depth", () => {
    expect(descendantIds(tree, 1).sort()).toEqual([2, 3, 4, 5]);
  });

  it("excludes the root itself", () => {
    expect(descendantIds(tree, 1)).not.toContain(1);
  });

  it("does not cross into another branch", () => {
    expect(descendantIds(tree, 1)).not.toContain(10);
    expect(descendantIds(tree, 9)).toEqual([10]);
  });

  it("is empty for a leaf and for an unknown id", () => {
    expect(descendantIds(tree, 5)).toEqual([]);
    expect(descendantIds(tree, 999)).toEqual([]);
  });

  // ⚠️ `parent_id` is a plain column with nothing stopping A→B→A. A cycle here
  // would not be a wrong answer, it would be an infinite loop inside a
  // pointerup handler — which takes the tab with it.
  it("terminates on a cycle rather than hanging", () => {
    const cyclic = [
      task({ id: 1, parent_id: 3 }),
      task({ id: 2, parent_id: 1 }),
      task({ id: 3, parent_id: 2 }),
    ];
    expect(descendantIds(cyclic, 1).sort()).toEqual([2, 3]);
  });

  it("survives a parent_id pointing at nothing", () => {
    expect(descendantIds([task({ id: 1, parent_id: 77 })], 1)).toEqual([]);
  });
});
