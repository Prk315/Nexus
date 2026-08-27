// Pure math for drag reordering: which slot a pointer is over, and the sibling
// order that results. React-free on purpose, same as filter / tree — every
// decision about WHERE a drop lands is here, where vitest can reach it, and the
// interaction shell is somewhere else.
//
// Lives in nexus-core rather than in PathFinder because Vault's kanban board
// needs the identical calculation for reordering cards in a column. Copying
// ~50 lines of slot arithmetic would have been easy and wrong: two copies of a
// drop rule disagree about the edges (the no-op slots either side of the
// dragged row are exactly the kind of thing one copy gets right and the other
// does not), and only one of them would have had the tests.
//
// Consumers today: PathFinder's RowReorder (dashboard StepRow tree, workspace
// TaskBoard child rows) and Vault's PfBoardView.

export interface RowRect {
  top: number;
  height: number;
}

/**
 * Which insertion slot the pointer is over, given the sibling rows' vertical
 * geometry (in the same coordinate space as `pointerY` — clientY vs.
 * getBoundingClientRect in practice).
 *
 * Slots number 0..rects.length: slot i means "insert before the row currently
 * at index i", and rects.length means "after the last row". The rule is the
 * usual list-drag one: the pointer belongs to the first row whose MIDPOINT is
 * still below it — above every midpoint is slot 0, below every midpoint is
 * slot n. A rect's height includes anything rendered inside the row's wrapper
 * (an expanded subtree, a quick-add input), which is exactly right: dropping
 * "after" a row means after everything it visually owns.
 */
export function insertionIndexFromPointer(pointerY: number, rects: RowRect[]): number {
  for (let i = 0; i < rects.length; i++) {
    const mid = rects[i].top + rects[i].height / 2;
    if (pointerY < mid) return i;
  }
  return rects.length;
}

/**
 * The full sibling id list after moving the item at `fromIndex` into
 * insertion slot `slot` (a slot in the ORIGINAL list, per
 * `insertionIndexFromPointer`). Returns `null` when the move is a no-op —
 * dropping a row into the gap directly above or below itself changes
 * nothing, and callers use `null` to skip the write entirely.
 *
 * The result is the complete ordered sibling list, which is exactly what
 * `reorderTasks(orderedIds)` requires (it assigns sort_order = index over
 * precisely the ids passed).
 */
export function reorderedIds(ids: number[], fromIndex: number, slot: number): number[] | null {
  if (fromIndex < 0 || fromIndex >= ids.length) return null;
  if (slot < 0 || slot > ids.length) return null;
  // The two slots adjacent to the dragged row leave the order unchanged.
  if (slot === fromIndex || slot === fromIndex + 1) return null;

  const next = ids.slice();
  const [moved] = next.splice(fromIndex, 1);
  // Removing the item shifts every later slot down by one.
  next.splice(slot > fromIndex ? slot - 1 : slot, 0, moved);
  return next;
}
