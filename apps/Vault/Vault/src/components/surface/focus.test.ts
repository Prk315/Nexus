import { describe, it, expect } from "vitest";
import {
  clampFocus,
  effectiveZoom,
  initialFocus,
  initialState,
  isFocusedGrid,
  keyToAction,
  neighbourIndex,
  reduce,
  reduceAll,
  viewFor,
  type Action,
  type SurfaceState,
} from "./focus";
import { clampView, contentRect, panBounds } from "./lod";
import {
  CELL_H,
  CELL_W,
  gridAt,
  MAX_GRID_DEPTH,
  type GridNode,
  type LeafNode,
  type Surface,
} from "./model";

function leaf(id: string, x: number, y: number, w = 1, h = 1): LeafNode {
  return { kind: "leaf", id, pos: { x, y, w, h }, renderer: "placeholder" };
}

/**
 *  root  6×6, pan-zoom
 *    [0] left   grid 2×4 at (0,0), scroll,   cols 1 rows 4 → [a 1×2]
 *    [1] right  grid 4×4 at (2,0), pan-zoom, cols 2 rows 4 → [b 2×1, c 2×1]
 *    [2] note   leaf 2×1 at (0,4)
 */
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
        {
          kind: "grid", id: "left", pos: { x: 0, y: 0, w: 2, h: 4 },
          viewport: "scroll", cols: 1, rows: 4, children: [leaf("a", 0, 0, 1, 2)],
        },
        {
          kind: "grid", id: "right", pos: { x: 2, y: 0, w: 4, h: 4 },
          viewport: "pan-zoom", cols: 2, rows: 4,
          children: [leaf("b", 0, 0, 2, 1), leaf("c", 0, 1, 2, 1)],
        },
        leaf("note", 0, 4, 2, 1),
      ],
    },
  };
}

const start = () => initialState(fixture());
const run = (actions: Action[], from: SurfaceState = start()) => reduceAll(from, actions);

describe("rule 1 — one level pans or zooms, the one with focus", () => {
  it("starts focused on the root surface with nothing selected", () => {
    const s = start();
    expect(s.focus.gridPath).toEqual([]);
    expect(s.focus.selection).toBeNull();
    expect(s.focus.mode).toBe("surface");
    expect(isFocusedGrid(s.focus, [])).toBe(true);
  });

  it("pans only the focused level and leaves every other level where it was", () => {
    // No viewport reported, so nothing is clamped — this is about routing.
    const s = run([{ type: "pan", dx: -100, dy: -40 }]);
    expect(viewFor(s.focus, [])).toMatchObject({ x: -100, y: -40 });
    // The nested containers have not moved.
    expect(viewFor(s.focus, [1])).toEqual({ x: 0, y: 0, zoom: 1 });

    // Focus the right container; now IT pans and the root does not.
    const inner = run([{ type: "focusGrid", path: [1] }, { type: "pan", dx: 25, dy: 5 }], s);
    expect(viewFor(inner.focus, [1])).toMatchObject({ x: 25, y: 5 });
    expect(viewFor(inner.focus, [])).toMatchObject({ x: -100, y: -40 });
  });

  it("refuses to pan or zoom a level that is not a pan-zoom viewport", () => {
    // `left` is a scroll container — the browser scrolls it, the surface does not.
    const s = run([{ type: "focusGrid", path: [0] }, { type: "pan", dx: 50, dy: 50 }]);
    expect(viewFor(s.focus, [0])).toEqual({ x: 0, y: 0, zoom: 1 });
    const z = reduce(s, { type: "zoom", factor: 2, ox: 0, oy: 0 });
    expect(viewFor(z.focus, [0]).zoom).toBe(1);
  });

  it("zooms about the cursor so the point under it stays put", () => {
    const s = run([{ type: "zoom", factor: 2, ox: 400, oy: 300 }]);
    const v = viewFor(s.focus, []);
    expect(v.zoom).toBe(2);
    // Content point p = (ox - x)/zoom must be unchanged at (400,300).
    expect((400 - v.x) / v.zoom).toBeCloseTo(400 - 0);
    expect(v.x).toBe(-400);
    expect(v.y).toBe(-300);
  });

  it("clamps zoom and reports nothing when it is already at the stop", () => {
    const outed = run(Array(40).fill({ type: "zoom", factor: 0.8, ox: 0, oy: 0 }));
    expect(viewFor(outed.focus, []).zoom).toBeGreaterThanOrEqual(0.15);
    const inned = run(Array(40).fill({ type: "zoom", factor: 1.25, ox: 0, oy: 0 }));
    expect(viewFor(inned.focus, []).zoom).toBeLessThanOrEqual(3);
  });

  it("multiplies ancestor zooms into a brick's effective scale", () => {
    const s = run([
      { type: "zoom", factor: 0.5, ox: 0, oy: 0 },      // root → 0.5
      { type: "focusGrid", path: [1] },
      { type: "zoom", factor: 0.5, ox: 0, oy: 0 },      // right → 0.5
    ]);
    expect(effectiveZoom(s.focus, [])).toBe(0.5);
    expect(effectiveZoom(s.focus, [1])).toBe(0.25);
  });

  // Root content spans cells (0,0)…(6,5) — the note leaf reaches y=5 — so the
  // pan box is that plus one cell on every side. Derived rather than written
  // out: hand-arithmetic here hid the margin's effect on the LEADING edge.
  const rootPan = () => panBounds(fixture().root)!;
  const VP = { w: 800, h: 600 };

  it("cannot pan past the outermost bricks once the viewport is known", () => {
    const b = rootPan();
    expect(b).toEqual({ x: -CELL_W, y: -CELL_H, w: 8 * CELL_W, h: 7 * CELL_H });

    const measured = run([{ type: "setViewport", path: [], ...VP }]);
    const far = reduce(measured, { type: "pan", dx: -99999, dy: -99999 });
    // Stopped where the content's trailing edge meets the window's.
    expect(viewFor(far.focus, [])).toMatchObject({
      x: VP.w - (b.x + b.w),
      y: VP.h - (b.y + b.h),
    });
    // And the other way: the leading edge, one cell out from the first brick.
    const back = reduce(far, { type: "pan", dx: 99999, dy: 99999 });
    expect(viewFor(back.focus, [])).toMatchObject({ x: -b.x, y: -b.y });
  });

  it("re-clamps on zoom, so the wheel cannot walk around the bound", () => {
    const b = rootPan();
    let s = run([{ type: "setViewport", path: [], ...VP }]);
    s = reduce(s, { type: "pan", dx: -99999, dy: -99999 });
    const pinned = viewFor(s.focus, []);
    // Zooming out shrinks the content, so the old offset is now out of bounds.
    s = reduce(s, { type: "zoom", factor: 0.5, ox: 0, oy: 0 });
    const after = viewFor(s.focus, []);
    expect(after.zoom).toBe(0.5);
    expect(after.x).toBeGreaterThan(pinned.x);
    expect(after.x).toBeCloseTo(VP.w - (b.x + b.w) * 0.5, 6);
  });

  it("re-clamps when the window resizes", () => {
    const b = rootPan();
    let s = run([{ type: "setViewport", path: [], ...VP }]);
    s = reduce(s, { type: "pan", dx: -99999, dy: 0 });
    expect(viewFor(s.focus, []).x).toBe(VP.w - (b.x + b.w));
    // A wider window has to give some of that back.
    s = reduce(s, { type: "setViewport", path: [], w: 1600, h: 600 });
    expect(viewFor(s.focus, []).x).toBe(1600 - (b.x + b.w));
  });

  it("ignores a repeated viewport report, by identity", () => {
    const s = run([{ type: "setViewport", path: [], ...VP }]);
    expect(reduce(s, { type: "setViewport", path: [], ...VP })).toBe(s);
  });

  it("zoom-to-fit frames the CONTENT, not the content plus its margin", () => {
    let s = run([{ type: "setViewport", path: [], ...VP }]);
    s = reduce(s, { type: "fit", path: [] });
    const v = viewFor(s.focus, []);
    // Content is 6 × 5 cells = 1920 × 1200; 800/1920 binds over 600/1200.
    expect(v.zoom).toBeCloseTo(VP.w / (6 * CELL_W), 6);
    // Every brick is on screen at that view.
    const content = contentRect(fixture().root)!;
    expect(content.w * v.zoom).toBeLessThanOrEqual(VP.w + 0.001);
    expect(content.h * v.zoom).toBeLessThanOrEqual(VP.h + 0.001);
    // And the fitted view is itself legal — fit must never land out of bounds.
    expect(clampView(v, rootPan(), VP)).toEqual(v);
  });

  it("resets only the focused level's view", () => {
    const s = run([
      { type: "pan", dx: -100, dy: 0 },
      { type: "focusGrid", path: [1] },
      { type: "pan", dx: 30, dy: 30 },
      { type: "resetView" },
    ]);
    expect(viewFor(s.focus, [1])).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(viewFor(s.focus, []).x).toBe(-100);
  });
});

describe("rule 1 — focus walks in and out one level at a time", () => {
  it("enters a container and then a leaf, and Escape walks all the way back", () => {
    let s = run([{ type: "selectChild", path: [], index: 1 }]);
    expect(s.focus.gridPath).toEqual([]);
    expect(s.focus.selection).toBe(1);

    s = reduce(s, { type: "enter" }); // into the right container
    expect(s.focus.gridPath).toEqual([1]);
    expect(s.focus.selection).toBe(0); // its top-left brick
    expect(s.focus.mode).toBe("surface");

    s = reduce(s, { type: "enter" }); // into the leaf
    expect(s.focus.mode).toBe("component");
    expect(s.focus.gridPath).toEqual([1]);

    s = reduce(s, { type: "escape" }); // out of the component
    expect(s.focus.mode).toBe("surface");
    expect(s.focus.selection).toBe(0); // still on the brick you left

    s = reduce(s, { type: "escape" }); // out of the container
    expect(s.focus.gridPath).toEqual([]);
    expect(s.focus.selection).toBe(1); // the container you were inside

    s = reduce(s, { type: "escape" }); // deselect at the top
    expect(s.focus.selection).toBeNull();

    s = reduce(s, { type: "escape" }); // nowhere left to go
    expect(s.focus.gridPath).toEqual([]);
    expect(s.focus.notice).toMatch(/top level/);
  });

  it("clicking a gap focuses that grid and drops the selection", () => {
    const s = run([
      { type: "enterChild", path: [], index: 1 },
      { type: "focusGrid", path: [1] },
    ]);
    expect(s.focus.gridPath).toEqual([1]);
    expect(s.focus.selection).toBeNull();
    expect(s.focus.mode).toBe("surface");
  });

  it("entering an empty container selects nothing rather than index 0", () => {
    const doc = fixture();
    (doc.root.children[1] as GridNode).children = [];
    const s = reduce(initialState(doc), { type: "enterChild", path: [], index: 1 });
    expect(s.focus.gridPath).toEqual([1]);
    expect(s.focus.selection).toBeNull();
  });

  it("enterChild on a leaf goes straight to component mode", () => {
    const s = run([{ type: "enterChild", path: [], index: 2 }]);
    expect(s.focus.mode).toBe("component");
    expect(s.focus.selection).toBe(2);
  });
});

describe("rule 2 — surface mode arrows select, Cmd+Shift moves and resizes", () => {
  it("selects the top-left brick first, not index 0", () => {
    const doc = fixture();
    // Insertion order deliberately disagrees with reading order.
    doc.root.children = [leaf("late", 4, 4), leaf("early", 0, 0)];
    const s = reduce(initialState(doc), { type: "move", dir: "right" });
    expect(s.focus.selection).toBe(1);
  });

  it("moves the selection geometrically, preferring straight over diagonal", () => {
    const children = [leaf("origin", 0, 0), leaf("right", 2, 0), leaf("far-up-right", 3, -0)];
    expect(neighbourIndex(children, 0, "right")).toBe(1);
    expect(neighbourIndex(children, 0, "left")).toBeNull();
    expect(neighbourIndex(children, 1, "left")).toBe(0);
  });

  it("says so when there is no brick that way", () => {
    const s = run([{ type: "selectChild", path: [], index: 0 }, { type: "move", dir: "left" }]);
    expect(s.focus.selection).toBe(0);
    expect(s.focus.notice).toMatch(/no brick/);
  });

  it("moves the focused brick one cell and refuses a move onto a sibling", () => {
    let s = run([{ type: "enterChild", path: [], index: 1 }]); // inside `right`, b selected
    expect(s.focus.selection).toBe(0);

    s = reduce(s, { type: "translate", dir: "down" }); // b onto c — refused
    expect(s.focus.notice).toMatch(/no room/);
    expect(gridAt(s.doc.root, [1])!.children[0].pos.y).toBe(0);

    s = reduce(s, { type: "move", dir: "down" }); // select c
    s = reduce(s, { type: "translate", dir: "down" }); // c into the empty row 2
    expect(gridAt(s.doc.root, [1])!.children[1].pos).toEqual({ x: 0, y: 2, w: 2, h: 1 });
    expect(s.focus.notice).toBeNull();
  });

  it("resizes the focused brick, right/down growing and left/up shrinking", () => {
    let s = run([{ type: "enterChild", path: [], index: 1 }, { type: "move", dir: "down" }]);
    s = reduce(s, { type: "resize", dir: "down" }); // c grows into row 2
    expect(gridAt(s.doc.root, [1])!.children[1].pos.h).toBe(2);
    s = reduce(s, { type: "resize", dir: "left" }); // narrower
    expect(gridAt(s.doc.root, [1])!.children[1].pos.w).toBe(1);
    s = reduce(s, { type: "resize", dir: "up" }); // shorter again
    expect(gridAt(s.doc.root, [1])!.children[1].pos.h).toBe(1);
  });

  it("does nothing on a grid action while a component has the keys", () => {
    const s = run([{ type: "enterChild", path: [], index: 2 }]); // component mode
    for (const a of [
      { type: "move", dir: "right" },
      { type: "translate", dir: "right" },
      { type: "resize", dir: "right" },
      { type: "addLeaf", id: "x" },
      { type: "addGrid", id: "y" },
    ] as Action[]) {
      expect(reduce(s, a)).toBe(s);
    }
  });

  it("`n` adds a placeholder leaf and selects it", () => {
    const s = run([{ type: "addLeaf", id: "leaf-1" }]);
    const root = s.doc.root;
    expect(root.children).toHaveLength(4);
    expect(root.children[3]).toMatchObject({ kind: "leaf", id: "leaf-1", renderer: "placeholder" });
    expect(s.focus.selection).toBe(3);
    expect(s.focus.mode).toBe("surface");
  });

  it("`g` adds a container, and the depth cap refuses the fourth level", () => {
    // Level 2 container into the root: allowed.
    let s = run([{ type: "addGrid", id: "g2" }]);
    expect(s.doc.root.children[3]).toMatchObject({ kind: "grid", id: "g2" });

    // Level 3 container inside it: allowed.
    s = reduce(s, { type: "enterChild", path: [], index: 3 });
    expect(s.focus.gridPath).toEqual([3]);
    s = reduce(s, { type: "addGrid", id: "g3" });
    expect(gridAt(s.doc.root, [3])!.children[0].id).toBe("g3");

    // Level 4: refused, with a reason, and nothing added.
    s = reduce(s, { type: "enterChild", path: [3], index: 0 });
    expect(s.focus.gridPath).toEqual([3, 0]);
    const before = s.doc;
    s = reduce(s, { type: "addGrid", id: "g4" });
    expect(s.doc).toBe(before);
    expect(s.focus.notice).toMatch(new RegExp(`${MAX_GRID_DEPTH} grid levels`));

    // A LEAF at the deepest level is still fine — the cap is on grids.
    s = reduce(s, { type: "addLeaf", id: "deep-leaf" });
    expect(gridAt(s.doc.root, [3, 0])!.children[0].id).toBe("deep-leaf");
  });
});

describe("rule 2 — key bindings", () => {
  const id = () => "fixed-id";

  it("gives every key but Escape to the component in component mode", () => {
    for (const key of ["ArrowRight", "Enter", "n", "g", "a", "0"]) {
      expect(keyToAction({ key }, "component", id)).toBeNull();
    }
    expect(keyToAction({ key: "Escape" }, "component", id)).toEqual({ type: "escape" });
  });

  it("maps the surface-mode bindings", () => {
    expect(keyToAction({ key: "ArrowUp" }, "surface", id)).toEqual({ type: "move", dir: "up" });
    expect(keyToAction({ key: "ArrowUp", metaKey: true, shiftKey: true }, "surface", id))
      .toEqual({ type: "translate", dir: "up" });
    expect(keyToAction({ key: "ArrowUp", metaKey: true, shiftKey: true, altKey: true }, "surface", id))
      .toEqual({ type: "resize", dir: "up" });
    expect(keyToAction({ key: "Enter" }, "surface", id)).toEqual({ type: "enter" });
    expect(keyToAction({ key: "n" }, "surface", id)).toEqual({ type: "addLeaf", id: "fixed-id" });
    expect(keyToAction({ key: "g" }, "surface", id)).toEqual({ type: "addGrid", id: "fixed-id" });
  });

  it("lets browser and app shortcuts through untouched", () => {
    // Cmd+S, Cmd+Z, a bare letter the surface does not bind.
    expect(keyToAction({ key: "s", metaKey: true }, "surface", id)).toBeNull();
    expect(keyToAction({ key: "z", metaKey: true }, "surface", id)).toBeNull();
    expect(keyToAction({ key: "k" }, "surface", id)).toBeNull();
    // Cmd+ArrowRight alone is not a surface binding either.
    expect(keyToAction({ key: "ArrowRight", metaKey: true }, "surface", id)).toBeNull();
  });
});

describe("a focus that no longer fits its document", () => {
  it("degrades to the nearest live ancestor instead of addressing a ghost", () => {
    const s = run([{ type: "enterChild", path: [], index: 1 }, { type: "move", dir: "down" }]);
    expect(s.focus.gridPath).toEqual([1]);
    expect(s.focus.selection).toBe(1);

    // The right container becomes a leaf under us (a reload, another client).
    const replaced: Surface = {
      v: 1,
      root: { ...s.doc.root, children: [s.doc.root.children[0], leaf("was-a-grid", 2, 0, 4, 4)] },
    };
    const next = reduce(s, { type: "setDoc", doc: replaced });
    expect(next.focus.gridPath).toEqual([]);
    expect(next.focus.selection).toBe(1);
    expect(next.focus.mode).toBe("surface");
  });

  it("drops a selection that is past the end of its grid", () => {
    const doc = fixture();
    const focus = {
      ...initialFocus(),
      selection: 7,
      mode: "component" as const,
    };
    const clamped = clampFocus(doc, focus);
    expect(clamped.selection).toBeNull();
    expect(clamped.mode).toBe("surface");
  });
});
