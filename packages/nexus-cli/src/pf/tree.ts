// Task subtree walking, following the `brief` skill's rule: ALWAYS read to
// depth 4 and count LEAVES, not nodes. A single-level read looks complete and
// is not — the parents are usually headings and the work is in the
// grandchildren. Pure: takes the already-loaded task list.

import type { PfTask } from "@nexus/core/pathfinder";

export const TREE_DEPTH = 4;

export interface TaskTreeRow {
  id: number;
  title: string;
  done: boolean;
  depth: number;
  is_leaf: boolean;
  kanban_status: string;
  stage: string | null;
  urgency: string | null;
  due_date: string | null;
  /** True when the walk stopped here because of the depth cap and children exist below. */
  truncated?: boolean;
  children?: TaskTreeRow[];
}

export interface TaskTreeSummary {
  root: number;
  depth: number;
  nodes: number;
  leaves: number;
  open_leaves: number;
  done_leaves: number;
  containers: number;
  /** Ids where the depth cap hid further children. Non-empty means the counts are a floor. */
  truncated_at: number[];
}

export function childrenIndex(tasks: PfTask[]): Map<number, PfTask[]> {
  const kids = new Map<number, PfTask[]>();
  for (const t of tasks) {
    if (t.parent_id == null) continue;
    const list = kids.get(t.parent_id);
    if (list) list.push(t);
    else kids.set(t.parent_id, [t]);
  }
  for (const list of kids.values()) list.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  return kids;
}

export function taskTree(tasks: PfTask[], rootId: number, maxDepth = TREE_DEPTH): { tree: TaskTreeRow; summary: TaskTreeSummary } | null {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const root = byId.get(rootId);
  if (!root) return null;
  const kids = childrenIndex(tasks);
  const summary: TaskTreeSummary = {
    root: rootId, depth: maxDepth, nodes: 0, leaves: 0, open_leaves: 0, done_leaves: 0, containers: 0, truncated_at: [],
  };
  const seen = new Set<number>();

  const walk = (t: PfTask, depth: number): TaskTreeRow => {
    const children = kids.get(t.id) ?? [];
    const row: TaskTreeRow = {
      id: t.id, title: t.title, done: t.done, depth,
      is_leaf: children.length === 0,
      kanban_status: t.kanban_status,
      stage: t.planning?.stage ?? null,
      urgency: t.planning?.urgency ?? null,
      due_date: t.due_date,
    };
    summary.nodes++;
    if (seen.has(t.id)) return row; // a cycle would otherwise never end
    seen.add(t.id);
    if (row.is_leaf) {
      summary.leaves++;
      if (t.done) summary.done_leaves++;
      else summary.open_leaves++;
      return row;
    }
    summary.containers++;
    if (depth >= maxDepth) {
      row.truncated = true;
      summary.truncated_at.push(t.id);
      return row;
    }
    row.children = children.map((c) => walk(c, depth + 1));
    return row;
  };

  return { tree: walk(root, 0), summary };
}

export function flattenTaskTree(row: TaskTreeRow, out: TaskTreeRow[] = []): TaskTreeRow[] {
  out.push(row);
  for (const c of row.children ?? []) flattenTaskTree(c, out);
  return out;
}

/** The outline the brief skill's SQL prints: indent, [x]/[ ], id, title. */
export function renderTaskTree(row: TaskTreeRow): string {
  return flattenTaskTree(row)
    .map((r) => {
      const box = r.done ? "[x]" : "[ ]";
      const meta = [r.stage, r.urgency && r.urgency !== "medium" ? `urg:${r.urgency}` : null, r.due_date ? `due:${r.due_date}` : null]
        .filter(Boolean)
        .join(" ");
      const more = r.truncated ? "  … (children below depth cap)" : "";
      return `${"    ".repeat(r.depth)}${box} ${r.id}  ${r.title}${meta ? `  (${meta})` : ""}${more}`;
    })
    .join("\n");
}
