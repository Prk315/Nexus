import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addChild,
  brickAt,
  canAddGrid,
  findFreeCell,
  gridAt,
  gridLevel,
  makeGrid,
  makeLeaf,
  MAX_GRID_DEPTH,
  maxGridDepth,
  moveChild,
  overlaps,
  parseSurfaceContent,
  pathKey,
  placementOk,
  resizeChild,
  serializeSurface,
  updateGrid,
  validateSurface,
  type GridNode,
  type LeafNode,
  type Surface,
} from "./model";

function leaf(id: string, x: number, y: number, w = 1, h = 1): LeafNode {
  return { kind: "leaf", id, pos: { x, y, w, h }, renderer: "placeholder" };
}

function grid(id: string, pos: [number, number, number, number], children: any[] = []): GridNode {
  const [x, y, w, h] = pos;
  return {
    kind: "grid",
    id,
    pos: { x, y, w, h },
    viewport: "fixed",
    cols: w,
    rows: h,
    children,
  };
}

/** root(6×4) → [ left grid(2×4) → [a], right grid(4×4) → [b, c], note leaf ] */
function fixture(): Surface {
  return {
    v: 1,
    root: {
      kind: "grid",
      id: "root",
      pos: { x: 0, y: 0, w: 6, h: 6 },
      viewport: "pan-zoom",
      cols: 6,
      rows: 6,
      children: [
        { ...grid("left", [0, 0, 2, 4], [leaf("a", 0, 0, 1, 2)]), cols: 1, rows: 4 },
        { ...grid("right", [2, 0, 4, 4], [leaf("b", 0, 0, 2, 1), leaf("c", 0, 1, 2, 1)]), cols: 2, rows: 4 },
        leaf("note", 0, 4, 2, 1),
      ],
    },
  };
}

describe("paths", () => {
  it("resolves the root with an empty path", () => {
    const s = fixture();
    expect(brickAt(s.root, [])).toBe(s.root);
    expect(pathKey([])).toBe("");
  });

  it("resolves nested children and returns null for a dead path", () => {
    const s = fixture();
    expect(brickAt(s.root, [1, 0])?.id).toBe("b");
    expect(brickAt(s.root, [9])).toBeNull();
    // A leaf has no children, so descending through one does not resolve.
    expect(brickAt(s.root, [2, 0])).toBeNull();
    // gridAt refuses a path that lands on a leaf even though brickAt finds it.
    expect(brickAt(s.root, [2])?.id).toBe("note");
    expect(gridAt(s.root, [2])).toBeNull();
  });

  it("structurally shares the branches an update does not touch", () => {
    const s = fixture();
    const next = updateGrid(s.root, [1], (g) => ({ ...g, cols: 3 }));
    expect(gridAt(next, [1])!.cols).toBe(3);
    // The untouched sibling is the SAME object, not a copy.
    expect(next.children[0]).toBe(s.root.children[0]);
    expect(next).not.toBe(s.root);
  });
});

describe("depth cap", () => {
  it("counts the root as level 1", () => {
    expect(gridLevel([])).toBe(1);
    expect(gridLevel([1])).toBe(2);
    expect(gridLevel([1, 0])).toBe(3);
  });

  it("allows a container in the root and one level down, never a third", () => {
    expect(canAddGrid([])).toBe(true); // new grid would be level 2
    expect(canAddGrid([1])).toBe(true); // level 3
    expect(canAddGrid([1, 0])).toBe(false); // level 4 — refused
    expect(canAddGrid([1, 0, 2])).toBe(false);
  });

  it("measures the depth actually present in a tree", () => {
    const s = fixture();
    expect(maxGridDepth(s.root)).toBe(2);
    const deeper = updateGrid(s.root, [1], (g) => ({
      ...g,
      children: [...g.children, grid("inner", [0, 2, 2, 1])],
    }));
    expect(maxGridDepth(deeper)).toBe(3);
    expect(maxGridDepth(deeper)).toBeLessThanOrEqual(MAX_GRID_DEPTH);
  });

  it("does not spend a level on a leaf", () => {
    // root(1) → grid(2) → grid(3) → leaf. The leaf is not a fourth level.
    const s = {
      v: 1,
      root: {
        ...grid("root", [0, 0, 4, 4], [
          grid("l2", [0, 0, 2, 2], [grid("l3", [0, 0, 1, 1], [leaf("deep", 0, 0)])]),
        ]),
        viewport: "pan-zoom",
      },
    };
    expect(validateSurface(s)).toBeNull();
  });

  it("counts a leaf's attributes grid against the same cap", () => {
    const withAttrs = (leafLevelContainer: GridNode): any => ({
      v: 1,
      root: { ...grid("root", [0, 0, 4, 4], [leafLevelContainer]), viewport: "pan-zoom" },
    });
    // Leaf inside the level-2 container → its attributes grid is level 3: fine.
    const ok = withAttrs(
      grid("l2", [0, 0, 2, 2], [{ ...leaf("r", 0, 0), attributes: grid("attrs", [0, 0, 1, 1], [leaf("outline", 0, 0)]) }])
    );
    expect(validateSurface(ok)).toBeNull();
    // Leaf inside a level-3 container → its attributes grid would be the fourth.
    const tooDeep = withAttrs(
      grid("l2", [0, 0, 2, 2], [
        grid("l3", [0, 0, 1, 1], [{ ...leaf("r", 0, 0), attributes: grid("attrs", [0, 0, 1, 1]) }]),
      ])
    );
    expect(validateSurface(tooDeep)).toMatch(/attrs .* level 4/);
    expect(maxGridDepth((tooDeep as Surface).root)).toBe(4);
  });

  it("rejects stored content that is already past the cap", () => {
    const tooDeep: Surface = {
      v: 1,
      root: {
        ...grid("root", [0, 0, 4, 4], [grid("l2", [0, 0, 2, 2], [grid("l3", [0, 0, 1, 1], [grid("l4", [0, 0, 1, 1])])])]),
        viewport: "pan-zoom",
      },
    };
    const err = validateSurface(tooDeep);
    expect(err).toMatch(/l4/);
    expect(err).toMatch(/level 4/);
  });
});

describe("placement", () => {
  it("detects overlap but not mere adjacency", () => {
    expect(overlaps({ x: 0, y: 0, w: 2, h: 1 }, { x: 1, y: 0, w: 2, h: 1 })).toBe(true);
    expect(overlaps({ x: 0, y: 0, w: 2, h: 1 }, { x: 2, y: 0, w: 2, h: 1 })).toBe(false);
    expect(overlaps({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 1, w: 1, h: 1 })).toBe(false);
  });

  it("refuses a placement outside the grid extent", () => {
    const g = gridAt(fixture().root, [1])!; // cols 2, rows 4
    expect(placementOk(g, 0, { x: 0, y: 0, w: 2, h: 1 })).toBe(true);
    expect(placementOk(g, 0, { x: 1, y: 0, w: 2, h: 1 })).toBe(false); // x+w > cols
    expect(placementOk(g, 0, { x: -1, y: 0, w: 1, h: 1 })).toBe(false);
    expect(placementOk(g, 0, { x: 0, y: 0, w: 1, h: 0 })).toBe(false); // zero height
  });

  it("moves a child and refuses a move onto a sibling", () => {
    const g = gridAt(fixture().root, [1])!; // b at y0, c at y1
    expect(moveChild(g, 0, 0, 1)).toBeNull(); // b down onto c
    expect(moveChild(g, 0, 0, -1)).toBeNull(); // b up out of the grid
    const moved = moveChild(g, 1, 0, 1); // c down into the free row 2
    expect(moved!.children[1].pos).toEqual({ x: 0, y: 2, w: 2, h: 1 });
    // The original is untouched.
    expect(g.children[1].pos.y).toBe(1);
  });

  it("resizes from the top-left and refuses a collision", () => {
    const g = gridAt(fixture().root, [1])!;
    expect(resizeChild(g, 0, 0, 1)).toBeNull(); // b grows down into c
    const shrunk = resizeChild(g, 0, -1, 0);
    expect(shrunk!.children[0].pos).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    // Never below one cell.
    expect(resizeChild(shrunk!, 0, -1, 0)).toBeNull();
  });
});

describe("adding bricks", () => {
  it("finds the first free cell row-major", () => {
    const g = gridAt(fixture().root, [1])!; // 2×4, rows 0 and 1 taken
    expect(findFreeCell(g, 1, 1)).toEqual({ x: 0, y: 2, rows: 4 });
  });

  it("grows the grid downward when nothing fits", () => {
    const full = grid("f", [0, 0, 1, 1], [leaf("only", 0, 0, 1, 1)]);
    expect(findFreeCell(full, 1, 1)).toEqual({ x: 0, y: 1, rows: 2 });
    const { grid: grown, index } = addChild(full, (pos) => makeLeaf("new", pos), 1, 1);
    expect(index).toBe(1);
    expect(grown.rows).toBe(2);
    expect(grown.children[1].pos).toEqual({ x: 0, y: 1, w: 1, h: 1 });
  });

  it("clips a brick wider than the grid rather than placing it out of bounds", () => {
    const narrow = grid("n", [0, 0, 1, 4]);
    const { grid: next } = addChild(narrow, (pos) => makeGrid("g", pos), 2, 2);
    expect(next.children[0].pos.w).toBe(1);
  });
});

describe("stored content shape", () => {
  it("reads an empty row as empty", () => {
    expect(parseSurfaceContent("")).toEqual({ kind: "empty" });
    expect(parseSurfaceContent("   ")).toEqual({ kind: "empty" });
  });

  it("reads the pointer form the lead can seed a node with", () => {
    const raw = JSON.stringify({ v: 1, source: "/surface-proto/demo.json" });
    expect(parseSurfaceContent(raw)).toEqual({
      kind: "pointer",
      source: "/surface-proto/demo.json",
    });
  });

  it("round-trips a surface", () => {
    const s = fixture();
    const parsed = parseSurfaceContent(serializeSurface(s));
    expect(parsed.kind).toBe("surface");
    expect((parsed as any).surface).toEqual(s);
  });

  it("reports rather than repairs content it cannot read", () => {
    expect(parseSurfaceContent("not json").kind).toBe("invalid");
    expect(parseSurfaceContent(JSON.stringify({ v: 2, root: {} })).kind).toBe("invalid");
    expect(parseSurfaceContent(JSON.stringify({ v: 1 })).kind).toBe("invalid");
    const noRenderer = { v: 1, root: { ...grid("r", [0, 0, 1, 1], [{ kind: "leaf", id: "x", pos: { x: 0, y: 0, w: 1, h: 1 } }]) } };
    expect(parseSurfaceContent(JSON.stringify(noRenderer)).kind).toBe("invalid");
  });
});

describe("the shipped demo fixture", () => {
  // The fixture is what a Surface node shows before the lead seeds one, so a
  // typo in it is a blank editor with a console error and no test to blame.
  const raw = readFileSync(
    resolve(__dirname, "../../../public/surface-proto/demo.json"),
    "utf8"
  );

  it("parses as a surface", () => {
    const parsed = parseSurfaceContent(raw);
    expect(parsed.kind === "invalid" ? parsed.reason : null).toBeNull();
    expect(parsed.kind).toBe("surface");
  });

  it("reproduces the scenario the spec describes", () => {
    const { root } = JSON.parse(raw) as Surface;
    expect(root.viewport).toBe("pan-zoom");

    const left = root.children[0] as GridNode;
    expect(left.kind).toBe("grid");
    expect(left.viewport).toBe("scroll");
    expect(left.cols).toBe(1); // one column
    // Its content is taller than its slot, which is what makes it scroll.
    expect(left.rows).toBeGreaterThan(left.pos.h);
    const reader = left.children[0] as LeafNode;
    expect(reader.renderer).toBe("reader");
    expect(reader.attributes!.children).toHaveLength(2); // outline + highlights

    const right = root.children[1] as GridNode;
    expect(right.viewport).toBe("pan-zoom");
    expect(right.children.map((c) => (c as LeafNode).renderer)).toEqual(["canvas", "canvas"]);
    // Two 2×1 bricks, stacked.
    expect(right.children.map((c) => c.pos)).toEqual([
      { x: 0, y: 0, w: 2, h: 1 },
      { x: 0, y: 1, w: 2, h: 1 },
    ]);

    expect((root.children[2] as LeafNode).renderer).toBe("note");
  });

  it("stays inside the depth cap", () => {
    expect(maxGridDepth((JSON.parse(raw) as Surface).root)).toBeLessThanOrEqual(MAX_GRID_DEPTH);
  });
});
