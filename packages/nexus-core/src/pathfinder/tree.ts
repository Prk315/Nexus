// PathFinder tasks are recursive — a task's steps are tasks, and those have
// steps. This turns a flat `pf_tasks` array into the tree that fact implies, as
// pure functions, so the shape can be tested without a database exactly like
// `filter.ts` next door.
//
// ── The rule that decides everything here ───────────────────────────────────
//
// A filter and a hierarchy disagree by nature. "Open tasks" matches a subtask
// whose parent is done; "plan = Thesis" matches a step whose parent carries no
// plan. Naively nesting the matched rows under their real parents would then
// have to render parents that did not match — and dropping any matched row whose
// parent is missing would hide work that the filter explicitly asked for.
//
// So the tree is built over the MATCHED set and every matched task is re-parented
// to its **nearest matched ancestor**. A step whose parent was filtered out is
// promoted to a root rather than vanishing. Two invariants fall out of that, and
// both are tested:
//
//   1. Every matched task appears exactly once.
//   2. No unmatched task appears — except under `"full"`, which is the mode that
//      explicitly asks for whole subtrees.
//
// The counts on a row are deliberately NOT computed from the tree. A row saying
// "3/12" means three of the task's twelve real descendants are done, whatever the
// filter is hiding — the same choice `aggregate_estimate` already makes, and for
// the same reason: a roll-up that changes when you change a view is not a
// roll-up, it is a coincidence.

import { matchesFilter, sortTasks, type SortDir, type SortKey, type TaskFilter } from "./filter";
import type { PfTask } from "./types";

/**
 * How much of the hierarchy a view renders.
 *
 * - `off` — one flat row per matched task, the pre-hierarchy behaviour.
 * - `matched` — matched tasks only, nested by nearest matched ancestor.
 * - `full` — matched roots drag their entire real subtree in, filter or no filter.
 */
export type TreeMode = "off" | "matched" | "full";

export const TREE_MODES: TreeMode[] = ["off", "matched", "full"];

export interface TaskTreeNode {
  task: PfTask;
  children: TaskTreeNode[];
}

/** Descendant roll-ups for one task, over the FULL dataset. */
export interface SubtreeStat {
  /** Direct children, whether or not any view is showing them. */
  direct: number;
  /** Every descendant, at any depth. */
  total: number;
  /** Descendants that are done. */
  done: number;
}

const EMPTY_STAT: SubtreeStat = { direct: 0, total: 0, done: 0 };

/** Children of each task id, in input order. */
function childMap(all: PfTask[]): Map<number, PfTask[]> {
  const kids = new Map<number, PfTask[]>();
  for (const t of all) {
    if (t.parent_id == null) continue;
    const list = kids.get(t.parent_id);
    if (list) list.push(t);
    else kids.set(t.parent_id, [t]);
  }
  return kids;
}

/**
 * Descendant counts for every task.
 *
 * Walked iteratively from the roots rather than recursively from each task:
 * recursion would be O(n·depth) and, more to the point, a `parent_id` cycle
 * would blow the stack. `pf_tasks` has no constraint preventing one — nothing
 * stops an UPDATE making a task its own grandparent — and a hierarchy view is
 * exactly where such a row would first be noticed. A `seen` set makes a cycle
 * render as a truncated branch instead of a white screen.
 */
export function subtreeStats(all: PfTask[]): Map<number, SubtreeStat> {
  const kids = childMap(all);
  const out = new Map<number, SubtreeStat>();

  for (const t of all) {
    const direct = kids.get(t.id)?.length ?? 0;
    let total = 0;
    let done = 0;

    if (direct > 0) {
      const seen = new Set<number>([t.id]);
      const stack = [...(kids.get(t.id) ?? [])];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        total++;
        if (node.done) done++;
        for (const c of kids.get(node.id) ?? []) stack.push(c);
      }
    }

    out.set(t.id, { direct, total, done });
  }

  return out;
}

export function statFor(stats: Map<number, SubtreeStat>, id: number): SubtreeStat {
  return stats.get(id) ?? EMPTY_STAT;
}

/**
 * The nearest ancestor of `task` that is in `keep`, or null.
 *
 * Cycle-guarded for the same reason `subtreeStats` is: this walks `parent_id`
 * upward and a cycle would loop forever.
 */
function nearestKeptAncestor(
  task: PfTask,
  byId: Map<number, PfTask>,
  keep: ReadonlySet<number>,
): number | null {
  const seen = new Set<number>([task.id]);
  let pid = task.parent_id;
  while (pid != null && !seen.has(pid)) {
    seen.add(pid);
    if (keep.has(pid)) return pid;
    const parent = byId.get(pid);
    // A parent outside the fetched window is indistinguishable from no parent
    // here, and treating it as a root is the honest answer — the alternative is
    // dropping the row.
    if (!parent) return null;
    pid = parent.parent_id;
  }
  return null;
}

/**
 * Builds the nesting.
 *
 * `expandFull` is the per-row escape hatch: an id listed there pulls its whole
 * real subtree in even in `"matched"` mode. That is what lets a row say "+3
 * hidden" and mean it — without it the only way to see a filtered-out step is to
 * change the filter for the entire block, which is a heavy answer to "what else
 * is under this one?".
 */
export function buildTaskTree(
  all: PfTask[],
  matched: PfTask[],
  mode: Exclude<TreeMode, "off">,
  sort: { key: SortKey; dir: SortDir },
  expandFull: ReadonlySet<number> = new Set(),
): TaskTreeNode[] {
  const byId = new Map<number, PfTask>(all.map((t) => [t.id, t]));
  const kids = childMap(all);
  const matchedIds = new Set(matched.map((t) => t.id));

  const roots: PfTask[] = [];
  const childrenOf = new Map<number, PfTask[]>();

  for (const t of matched) {
    const anchor = nearestKeptAncestor(t, byId, matchedIds);
    if (anchor == null) roots.push(t);
    else {
      const list = childrenOf.get(anchor);
      if (list) list.push(t);
      else childrenOf.set(anchor, [t]);
    }
  }

  /** Every descendant, from `all` — used by `"full"` and by `expandFull`. */
  const buildFull = (task: PfTask, seen: Set<number>): TaskTreeNode => {
    if (seen.has(task.id)) return { task, children: [] };
    seen.add(task.id);
    const children = sortTasks(kids.get(task.id) ?? [], sort.key, sort.dir)
      .map((c) => buildFull(c, seen));
    return { task, children };
  };

  const build = (task: PfTask, seen: Set<number>): TaskTreeNode => {
    if (seen.has(task.id)) return { task, children: [] };
    seen.add(task.id);

    if (mode === "full" || expandFull.has(task.id)) {
      // Hand off to the full walk, but keep the SAME `seen` set so a cycle
      // spanning both walks still terminates.
      const children = sortTasks(kids.get(task.id) ?? [], sort.key, sort.dir)
        .filter((c) => !seen.has(c.id))
        .map((c) => buildFull(c, seen));
      return { task, children };
    }

    const children = sortTasks(childrenOf.get(task.id) ?? [], sort.key, sort.dir)
      .filter((c) => !seen.has(c.id))
      .map((c) => build(c, seen));
    return { task, children };
  };

  const seen = new Set<number>();
  return sortTasks(roots, sort.key, sort.dir)
    .filter((r) => !seen.has(r.id))
    .map((r) => build(r, seen));
}

export interface TaskTreeRow {
  task: PfTask;
  /** 0 for a root. */
  depth: number;
  /** Children this tree holds for the row — what expanding actually reveals. */
  childCount: number;
  /** Direct children the task really has, whatever the filter shows. */
  directCount: number;
  /** Every descendant in the full dataset, and how many are done. */
  descendants: number;
  descendantsDone: number;
  /** Real children this tree is not showing — the "+N hidden" affordance. */
  hiddenChildren: number;
  collapsed: boolean;
}

export interface TreeQueryResult {
  rows: TaskTreeRow[];
  /** Tasks that passed the filter, before nesting or capping. */
  matched: number;
  /** Rows the current collapse state would render with no limit. */
  total: number;
  truncated: boolean;
}

/**
 * Depth-first flatten, capped.
 *
 * Taking a PREFIX of a depth-first walk is what makes the cap safe: a parent is
 * always emitted before its children, so a truncated list can never contain an
 * indented row whose parent was cut. Slicing a breadth-first order, or filtering
 * after flattening, both produce exactly that orphan.
 */
export function flattenTaskTree(
  nodes: TaskTreeNode[],
  stats: Map<number, SubtreeStat>,
  collapsed: ReadonlySet<number>,
  limit: number,
): { rows: TaskTreeRow[]; total: number; truncated: boolean } {
  const rows: TaskTreeRow[] = [];

  const walk = (node: TaskTreeNode, depth: number) => {
    const stat = statFor(stats, node.task.id);
    const isCollapsed = collapsed.has(node.task.id) && node.children.length > 0;
    rows.push({
      task: node.task,
      depth,
      childCount: node.children.length,
      directCount: stat.direct,
      descendants: stat.total,
      descendantsDone: stat.done,
      hiddenChildren: Math.max(0, stat.direct - node.children.length),
      collapsed: isCollapsed,
    });
    if (isCollapsed) return;
    for (const c of node.children) walk(c, depth + 1);
  };

  for (const n of nodes) walk(n, 0);

  const capped = limit > 0 ? rows.slice(0, limit) : rows;
  return { rows: capped, total: rows.length, truncated: capped.length < rows.length };
}

/**
 * Filter, nest, flatten, cap — the whole pipeline a hierarchical view needs.
 *
 * `extra` is how a consumer bolts on a predicate this module knows nothing
 * about. Vault uses it for its own task tags, which are a Vault concept and have
 * no business in PathFinder's filter type. It has to run HERE rather than over
 * the result, because `limit` is applied last: filtering after the cap would let
 * a block show nothing while matching rows sat just past the window.
 */
export function runTreeQuery(opts: {
  all: PfTask[];
  filter: TaskFilter;
  sort: { key: SortKey; dir: SortDir };
  limit: number;
  today: string;
  myUid?: string | null;
  mode: Exclude<TreeMode, "off">;
  collapsed?: ReadonlySet<number>;
  expandFull?: ReadonlySet<number>;
  extra?: (task: PfTask) => boolean;
  stats?: Map<number, SubtreeStat>;
}): TreeQueryResult {
  const {
    all, filter, sort, limit, today, myUid = null, mode,
    collapsed = new Set<number>(), expandFull = new Set<number>(), extra,
  } = opts;

  const matched = all.filter(
    (t) => matchesFilter(t, filter, today, myUid) && (extra ? extra(t) : true),
  );
  const stats = opts.stats ?? subtreeStats(all);
  const tree = buildTaskTree(all, matched, mode, sort, expandFull);
  const { rows, total, truncated } = flattenTaskTree(tree, stats, collapsed, limit);

  return { rows, matched: matched.length, total, truncated };
}

/**
 * A task's ancestors, outermost first — the breadcrumb a detail panel shows.
 *
 * Cycle-guarded, and stops at the edge of the fetched window rather than
 * pretending the chain ended there.
 */
export function ancestorsOf(task: PfTask, byId: Map<number, PfTask>): PfTask[] {
  const out: PfTask[] = [];
  const seen = new Set<number>([task.id]);
  let pid = task.parent_id;
  while (pid != null && !seen.has(pid)) {
    seen.add(pid);
    const parent = byId.get(pid);
    if (!parent) break;
    out.unshift(parent);
    pid = parent.parent_id;
  }
  return out;
}
