import { describe, it, expect } from "vitest";
import { insertionIndexFromPointer, reorderedIds, type RowRect } from "./reorder";

// Three stacked 30px rows starting at y=100: [100,130), [130,160), [160,190).
// Midpoints at 115, 145, 175.
const rows: RowRect[] = [
  { top: 100, height: 30 },
  { top: 130, height: 30 },
  { top: 160, height: 30 },
];

describe("insertionIndexFromPointer", () => {
  it("above every row → slot 0", () => {
    expect(insertionIndexFromPointer(50, rows)).toBe(0);
  });

  it("below every row → slot n", () => {
    expect(insertionIndexFromPointer(500, rows)).toBe(3);
  });

  it("upper half of a row inserts before it, lower half after", () => {
    expect(insertionIndexFromPointer(110, rows)).toBe(0); // above row 0's midpoint
    expect(insertionIndexFromPointer(120, rows)).toBe(1); // below row 0's midpoint
    expect(insertionIndexFromPointer(140, rows)).toBe(1);
    expect(insertionIndexFromPointer(150, rows)).toBe(2);
  });

  it("a pointer exactly ON a midpoint counts as below it (slot after)", () => {
    expect(insertionIndexFromPointer(115, rows)).toBe(1);
  });

  it("a tall row (expanded subtree) keeps midpoint semantics over its whole box", () => {
    const withSubtree: RowRect[] = [
      { top: 0, height: 20 },
      { top: 20, height: 200 }, // row + its expanded children
      { top: 220, height: 20 },
    ];
    expect(insertionIndexFromPointer(100, withSubtree)).toBe(1); // above tall row's midpoint (120)
    expect(insertionIndexFromPointer(150, withSubtree)).toBe(2); // below it
  });

  it("no rows → slot 0", () => {
    expect(insertionIndexFromPointer(42, [])).toBe(0);
  });
});

describe("reorderedIds", () => {
  const ids = [10, 20, 30, 40];

  it("dropping into the gap above or below itself is a no-op", () => {
    expect(reorderedIds(ids, 1, 1)).toBeNull();
    expect(reorderedIds(ids, 1, 2)).toBeNull();
    expect(reorderedIds(ids, 0, 0)).toBeNull();
    expect(reorderedIds(ids, 3, 4)).toBeNull();
  });

  it("moves an item down (slot counted with the item still present)", () => {
    expect(reorderedIds(ids, 0, 3)).toEqual([20, 30, 10, 40]);
    expect(reorderedIds(ids, 0, 4)).toEqual([20, 30, 40, 10]);
  });

  it("moves an item up", () => {
    expect(reorderedIds(ids, 3, 0)).toEqual([40, 10, 20, 30]);
    expect(reorderedIds(ids, 2, 1)).toEqual([10, 30, 20, 40]);
  });

  it("returns the COMPLETE sibling list, never a subset", () => {
    const out = reorderedIds(ids, 1, 4)!;
    expect([...out].sort((a, b) => a - b)).toEqual([10, 20, 30, 40]);
  });

  it("rejects out-of-range indices", () => {
    expect(reorderedIds(ids, -1, 0)).toBeNull();
    expect(reorderedIds(ids, 4, 0)).toBeNull();
    expect(reorderedIds(ids, 0, 5)).toBeNull();
    expect(reorderedIds(ids, 0, -1)).toBeNull();
  });

  it("single-element list can never reorder", () => {
    expect(reorderedIds([7], 0, 0)).toBeNull();
    expect(reorderedIds([7], 0, 1)).toBeNull();
  });

  it("does not mutate the input", () => {
    const input = [1, 2, 3];
    reorderedIds(input, 0, 3);
    expect(input).toEqual([1, 2, 3]);
  });
});
