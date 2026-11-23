// Reordering a FILTERED view of a group without disturbing the rest of it.
//
// `pf_tasks.sort_order` is one global order per task, not one per view, and
// `reorderTasks` assigns `sort_order = index` over exactly the ids it is
// handed. A dashboard plan card shows only the plan's tasks due TODAY; a
// workspace bucket hides done tasks and whatever the search box filters out.
// Handing either visible list to reorderTasks renumbers those rows 0..n-1 and
// drops them into the middle of every hidden sibling still sitting at its old
// value — a reorder in one view silently scrambles the order every other view
// of that plan reads.
//
// The fix is to reorder the COMPLETE group and touch only the slots the visible
// rows occupy: hidden rows keep their positions exactly, the visible rows are
// re-dealt into the visible rows' slots in their new order. Pure and
// React-free so the rule is tested rather than trusted.

export interface OrderedTask {
  id: number;
  sort_order: number;
}

/**
 * The ids of every task matching `inGroup`, in the order every manually
 * sorted view reads: sort_order, then id. The id tie-break matters — most
 * tasks still sit at the default sort_order 0, and without a deterministic
 * tie-break two views of the same group can disagree about it.
 */
export function groupOrderIds<T extends OrderedTask>(tasks: readonly T[], inGroup: (t: T) => boolean): number[] {
  return tasks
    .filter(inGroup)
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
    .map((t) => t.id);
}

/**
 * The complete group's new order after the visible subset was reordered to
 * `subsetOrdered`. Every slot in `fullIds` that holds a subset member is
 * refilled, left to right, with `subsetOrdered`; every other id keeps its
 * index. Returns null when the inputs disagree (a visible id missing from the
 * group, or a duplicate) — the caller then skips the write rather than
 * guessing, because a guessed order is a scrambled one.
 */
export function mergeSubsetOrder(fullIds: readonly number[], subsetOrdered: readonly number[]): number[] | null {
  const subset = new Set(subsetOrdered);
  if (subset.size !== subsetOrdered.length) return null;
  const full = new Set(fullIds);
  if (full.size !== fullIds.length) return null;
  for (const id of subset) if (!full.has(id)) return null;

  let next = 0;
  return fullIds.map((id) => (subset.has(id) ? subsetOrdered[next++] : id));
}

/**
 * The writes needed to make `orderedIds` true, given each task's CURRENT
 * sort_order: only rows whose value changes. With most tasks at the default 0
 * the first reorder of a group still writes nearly all of it, but every later
 * one writes the handful of rows that actually moved.
 */
export function sortOrderWrites(
  orderedIds: readonly number[],
  current: ReadonlyMap<number, number>,
): { id: number; sort_order: number }[] {
  const out: { id: number; sort_order: number }[] = [];
  orderedIds.forEach((id, index) => {
    if (current.get(id) !== index) out.push({ id, sort_order: index });
  });
  return out;
}
