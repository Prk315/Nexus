import { describe, it, expect } from "vitest";
import { groupOrderIds, mergeSubsetOrder, sortOrderWrites } from "./groupOrder";
import { reorderedIds } from "@nexus/core/pathfinder";

describe("groupOrderIds", () => {
  it("orders by sort_order then id, so the 0-ties every task starts with are deterministic", () => {
    const tasks = [
      { id: 5, sort_order: 0, plan: 1 },
      { id: 2, sort_order: 0, plan: 1 },
      { id: 9, sort_order: -1, plan: 1 },
      { id: 3, sort_order: 0, plan: 2 },
    ];
    expect(groupOrderIds(tasks, (t) => t.plan === 1)).toEqual([9, 2, 5]);
  });
});

describe("mergeSubsetOrder", () => {
  it("re-deals the visible rows into their own slots; hidden rows keep their index", () => {
    // Plan holds 1..6; the dashboard card shows only 2, 4, 6 (due today).
    const full = [1, 2, 3, 4, 5, 6];
    expect(mergeSubsetOrder(full, [6, 2, 4])).toEqual([1, 6, 3, 2, 5, 4]);
  });

  it("is the identity when the visible order did not change", () => {
    expect(mergeSubsetOrder([1, 2, 3, 4], [2, 4])).toEqual([1, 2, 3, 4]);
  });

  it("the bug it prevents: renumbering the visible rows alone interleaves them with hidden ones", () => {
    // What handing [6, 2, 4] straight to reorderTasks would do: 6→0, 2→1, 4→2
    // while 1, 3, 5 keep sort_orders 0, 2, 4 — so the plan's real order
    // becomes 1/6 (tie), 2, 3/4 (tie), 5 — the hidden rows are now between
    // the moved ones. The merge keeps every hidden row exactly where it was.
    const merged = mergeSubsetOrder([1, 2, 3, 4, 5, 6], [6, 2, 4])!;
    for (const hidden of [1, 3, 5]) {
      expect(merged.indexOf(hidden)).toBe([1, 2, 3, 4, 5, 6].indexOf(hidden));
    }
  });

  it("composes with the drop-slot math the grip uses", () => {
    const visible = [2, 4, 6];
    const moved = reorderedIds(visible, 2, 0)!; // drag 6 to the top
    expect(mergeSubsetOrder([1, 2, 3, 4, 5, 6], moved)).toEqual([1, 6, 3, 2, 5, 4]);
  });

  it("refuses inputs that disagree rather than guessing", () => {
    expect(mergeSubsetOrder([1, 2, 3], [2, 9])).toBeNull(); // 9 isn't in the group
    expect(mergeSubsetOrder([1, 2, 3], [2, 2])).toBeNull(); // duplicate
    expect(mergeSubsetOrder([1, 1, 2], [1])).toBeNull();
  });
});

describe("sortOrderWrites", () => {
  it("writes only rows whose sort_order changes", () => {
    const current = new Map([[1, 0], [6, 1], [3, 2], [2, 3], [5, 4], [4, 5]]);
    expect(sortOrderWrites([1, 2, 3, 6, 5, 4], current)).toEqual([
      { id: 2, sort_order: 1 },
      { id: 6, sort_order: 3 },
    ]);
  });

  it("writes everything the first time, when every task is tied at 0", () => {
    const current = new Map([[1, 0], [2, 0], [3, 0]]);
    expect(sortOrderWrites([3, 1, 2], current).map((w) => w.id)).toEqual([1, 2]);
    // 3 → 0 is already true; 1 → 1 and 2 → 2 are not.
  });

  it("a task missing from the current map is always written", () => {
    expect(sortOrderWrites([7], new Map())).toEqual([{ id: 7, sort_order: 0 }]);
  });
});
