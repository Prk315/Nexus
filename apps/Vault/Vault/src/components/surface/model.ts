// The Surface grammar: four words, two node kinds.
//
//   container  = GridNode          a brick with its own grid and a viewport mode
//   component  = LeafNode          a viewer for an existing node type
//   attribute  = LeafNode inside a leaf's `attributes` grid
//   surface    = the root GridNode (viewport "pan-zoom", no parent)
//
// Everything in this file is pure. The tree is immutable: every operation
// returns a new tree (or `null` for "refused"), which is what lets the focus
// reducer in focus.ts be a pure function of (state, action) and therefore
// testable without a DOM.
//
// ⚠️ Nothing here generates an id or reads a clock. `addLeaf`/`addGrid` take
// the id from the caller for exactly that reason — a reducer that calls
// crypto.randomUUID() is not a reducer you can assert on.

export type Viewport = "fixed" | "scroll" | "pan-zoom";

/** Integer cells of the PARENT grid. Never pixels. */
export interface Pos {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridNode {
  kind: "grid";
  id: string;
  pos: Pos;
  viewport: Viewport;
  cols: number;
  rows: number;
  children: Brick[];
}

export interface LeafNode {
  kind: "leaf";
  id: string;
  pos: Pos;
  /** Key into the renderer registry (see renderers.tsx). */
  renderer: string;
  /** A vault node id. Content lives THERE, never in the surface JSON. */
  nodeRef?: string;
  /** Small inline state (a placeholder's label, a viewer's scroll offset). */
  state?: unknown;
  /** Sub-components bound to this component — an outline beside a reader. */
  attributes?: GridNode;
}

export type Brick = GridNode | LeafNode;

export interface Surface {
  v: 1;
  root: GridNode;
}

// ── Absolute cell geometry ───────────────────────────────────────────────────
// One cell is the same number of pixels everywhere at zoom 1; zoom is applied
// as a CSS transform on the focused grid's content, so these never change.

export const CELL_W = 320;
export const CELL_H = 240;
export const GAP = 12;

/** Three grid levels. Root is level 1. */
export const MAX_GRID_DEPTH = 3;

export function isGrid(b: Brick): b is GridNode {
  return b.kind === "grid";
}
export function isLeaf(b: Brick): b is LeafNode {
  return b.kind === "leaf";
}

// ── Paths ────────────────────────────────────────────────────────────────────
// A path is the list of child indices from the root. `[]` is the root grid
// itself; `[1, 0]` is root.children[1].children[0].
//
// Note what a path deliberately cannot address: a brick inside a leaf's
// `attributes` grid. Attributes render, but they are not focus targets in this
// prototype — giving them addresses would make every path element a tagged
// union, and the focus rules in the spec are written about grid levels.

export type Path = number[];

/** Stable key for a path, for the per-level view map. Root is "". */
export function pathKey(path: Path): string {
  return path.join(".");
}

export function pathEq(a: Path, b: Path): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function isAncestorPath(maybeAncestor: Path, path: Path): boolean {
  return (
    maybeAncestor.length < path.length &&
    maybeAncestor.every((v, i) => v === path[i])
  );
}

/** The brick at `path`, or null when the path does not resolve. `[]` = root. */
export function brickAt(root: GridNode, path: Path): Brick | null {
  let cur: Brick = root;
  for (const i of path) {
    if (!isGrid(cur)) return null;
    // Both annotations are load-bearing. Without them TypeScript follows
    // `cur`'s narrowing back into its own assignment and gives up with TS7022
    // ("referenced directly or indirectly in its own initializer") — the type
    // is fine, the inference is circular.
    const here: GridNode = cur;
    const next: Brick | undefined = here.children[i];
    if (!next) return null;
    cur = next;
  }
  return cur;
}

/** The brick at `path`, but only when it is a grid. */
export function gridAt(root: GridNode, path: Path): GridNode | null {
  const b = brickAt(root, path);
  return b && isGrid(b) ? b : null;
}

/**
 * Replace the brick at `path` with `fn`'s result, structurally sharing every
 * branch the path does not touch.
 *
 * Returns the original tree unchanged when the path does not resolve — a
 * refused edit and a no-op edit are the same thing to the caller, and throwing
 * here would turn a stale click into a crash.
 */
export function updateBrick(
  root: GridNode,
  path: Path,
  fn: (b: Brick) => Brick
): GridNode {
  if (path.length === 0) {
    const next = fn(root);
    return isGrid(next) ? next : root;
  }
  const [head, ...rest] = path;
  const child = root.children[head];
  if (!child) return root;

  let nextChild: Brick | null;
  if (rest.length === 0) {
    nextChild = fn(child);
  } else {
    if (!isGrid(child)) return root;
    nextChild = updateBrick(child, rest, fn);
  }
  if (nextChild === child) return root;

  const children = root.children.slice();
  children[head] = nextChild;
  return { ...root, children };
}

/** Shorthand for editing a grid in place. No-op when `path` is not a grid. */
export function updateGrid(
  root: GridNode,
  path: Path,
  fn: (g: GridNode) => GridNode | null
): GridNode {
  return updateBrick(root, path, (b) => {
    if (!isGrid(b)) return b;
    return fn(b) ?? b;
  });
}

// ── Depth ────────────────────────────────────────────────────────────────────

/** Level of the grid addressed by `path`. Root (`[]`) is 1. */
export function gridLevel(path: Path): number {
  return path.length + 1;
}

/**
 * May a container be added INSIDE the grid at `path`?
 *
 * The new container would sit at `gridLevel(path) + 1`, so the answer is no
 * once the focused grid is itself at the cap. This is the whole depth rule and
 * it is enforced in one place: the reducer asks this and refuses.
 */
export function canAddGrid(path: Path): boolean {
  return gridLevel(path) < MAX_GRID_DEPTH;
}

/**
 * Deepest grid level actually present in the tree. A leaf-only root is 1.
 *
 * A leaf is not a level — only grids are — but a leaf's `attributes` grid is,
 * and it counts against the same cap. A container of attributes is still a
 * container, and the reason for the cap (you can only hold so many nested
 * coordinate systems in your head) does not care which field it hangs off.
 */
export function maxGridDepth(grid: GridNode, level = 1): number {
  let deepest = level;
  for (const child of grid.children) {
    if (isGrid(child)) {
      deepest = Math.max(deepest, maxGridDepth(child, level + 1));
    } else if (child.attributes) {
      deepest = Math.max(deepest, maxGridDepth(child.attributes, level + 1));
    }
  }
  return deepest;
}

// ── Layout arithmetic ────────────────────────────────────────────────────────

export function overlaps(a: Pos, b: Pos): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

function inBounds(grid: GridNode, pos: Pos): boolean {
  return (
    pos.x >= 0 &&
    pos.y >= 0 &&
    pos.w >= 1 &&
    pos.h >= 1 &&
    pos.x + pos.w <= grid.cols &&
    pos.y + pos.h <= grid.rows
  );
}

/** Would `pos` at `index` collide with any sibling, or leave the grid? */
export function placementOk(grid: GridNode, index: number, pos: Pos): boolean {
  if (!inBounds(grid, pos)) return false;
  return grid.children.every(
    (c, i) => i === index || !overlaps(pos, c.pos)
  );
}

/**
 * Move a child by whole cells. Returns null when the move would leave the grid
 * or land on a sibling — refusing rather than clamping, because a clamp makes
 * the same keypress mean two different things depending on where you are.
 */
export function moveChild(
  grid: GridNode,
  index: number,
  dx: number,
  dy: number
): GridNode | null {
  const child = grid.children[index];
  if (!child) return null;
  const pos: Pos = { ...child.pos, x: child.pos.x + dx, y: child.pos.y + dy };
  if (!placementOk(grid, index, pos)) return null;
  const children = grid.children.slice();
  children[index] = { ...child, pos } as Brick;
  return { ...grid, children };
}

/** Resize a child by whole cells, anchored at its top-left. */
export function resizeChild(
  grid: GridNode,
  index: number,
  dw: number,
  dh: number
): GridNode | null {
  const child = grid.children[index];
  if (!child) return null;
  const pos: Pos = { ...child.pos, w: child.pos.w + dw, h: child.pos.h + dh };
  if (!placementOk(grid, index, pos)) return null;
  const children = grid.children.slice();
  children[index] = { ...child, pos } as Brick;
  return { ...grid, children };
}

/**
 * First free w×h slot, scanning row-major.
 *
 * Returns `rows` too: when nothing fits inside the current extent the grid
 * grows DOWNWARD by exactly the height needed and the slot is the first cell of
 * the new band. Growing is the one place the extent changes on its own — move
 * and resize refuse instead, so "the grid got bigger" is always traceable to an
 * add.
 */
export function findFreeCell(
  grid: GridNode,
  w: number,
  h: number
): { x: number; y: number; rows: number } {
  for (let y = 0; y + h <= grid.rows; y++) {
    for (let x = 0; x + w <= grid.cols; x++) {
      const pos: Pos = { x, y, w, h };
      if (grid.children.every((c) => !overlaps(pos, c.pos))) {
        return { x, y, rows: grid.rows };
      }
    }
  }
  return { x: 0, y: grid.rows, rows: grid.rows + h };
}

/** Append a brick into the first free slot, growing the grid if it must. */
export function addChild(
  grid: GridNode,
  make: (pos: Pos) => Brick,
  w: number,
  h: number
): { grid: GridNode; index: number } {
  const slot = findFreeCell(grid, Math.min(w, grid.cols), h);
  const pos: Pos = { x: slot.x, y: slot.y, w: Math.min(w, grid.cols), h };
  const child = make(pos);
  return {
    grid: { ...grid, rows: slot.rows, children: [...grid.children, child] },
    index: grid.children.length,
  };
}

// ── Factories ────────────────────────────────────────────────────────────────

export function makeLeaf(id: string, pos: Pos, renderer = "placeholder"): LeafNode {
  return { kind: "leaf", id, pos, renderer, state: { name: "New brick" } };
}

export function makeGrid(id: string, pos: Pos): GridNode {
  return {
    kind: "grid",
    id,
    pos,
    viewport: "fixed",
    cols: Math.max(1, pos.w),
    rows: Math.max(1, pos.h),
    children: [],
  };
}

export function emptySurface(id = "root"): Surface {
  return {
    v: 1,
    root: {
      kind: "grid",
      id,
      pos: { x: 0, y: 0, w: 6, h: 4 },
      viewport: "pan-zoom",
      cols: 6,
      rows: 4,
      children: [],
    },
  };
}

// ── The stored content shape ─────────────────────────────────────────────────
//
// A Surface node's `vault_content.data` is one of:
//
//   ""                                          → seed from the demo fixture
//   {"v":1,"source":"/surface-proto/demo.json"}  → pointer, fetch and seed
//   {"v":1,"root":{…}}                           → the surface itself
//
// The pointer form exists so the lead can seed a node with a one-line row
// before any real layout has been authored, and so this branch needs no SQL.
// Anything else is reported rather than repaired: silently replacing content we
// cannot parse is how a document gets eaten (see lib/noteSchemaGuard.ts, which
// is the same argument for notes).

export const DEMO_FIXTURE = "/surface-proto/demo.json";

export type SurfaceContent =
  | { kind: "empty" }
  | { kind: "pointer"; source: string }
  | { kind: "surface"; surface: Surface }
  | { kind: "invalid"; reason: string };

function validPos(v: any): v is Pos {
  return (
    v &&
    typeof v === "object" &&
    ["x", "y", "w", "h"].every((k) => Number.isFinite(v[k]))
  );
}

/**
 * `containerLevel` is the level of the GRID this brick sits in — 0 for the
 * root, which therefore validates as level 1.
 *
 * Only grids consume a level. A leaf inside a level-3 grid is fine; what is not
 * fine is that leaf carrying an `attributes` grid, since that grid would be the
 * fourth. Counting leaves as levels was the first version of this and it made
 * the cap depend on how deeply a brick happened to be drawn rather than on how
 * many coordinate systems were nested.
 */
function validBrick(v: any, containerLevel: number): string | null {
  if (!v || typeof v !== "object") return "brick is not an object";
  if (typeof v.id !== "string" || !v.id) return "brick has no id";
  if (!validPos(v.pos)) return `brick ${v.id} has no valid pos`;
  if (v.kind === "leaf") {
    if (typeof v.renderer !== "string") return `leaf ${v.id} has no renderer`;
    // The attributes grid is a grid level of its own, sitting beside the leaf
    // rather than below it: same container level, so it is capped like any
    // sibling container would be.
    if (v.attributes) return validBrick(v.attributes, containerLevel);
    return null;
  }
  if (v.kind !== "grid") return `brick ${v.id} has unknown kind ${v.kind}`;
  const level = containerLevel + 1;
  if (level > MAX_GRID_DEPTH) {
    return `grid ${v.id} is at level ${level}, past the cap of ${MAX_GRID_DEPTH}`;
  }
  if (!Number.isFinite(v.cols) || !Number.isFinite(v.rows)) {
    return `grid ${v.id} has no extent`;
  }
  if (!Array.isArray(v.children)) return `grid ${v.id} has no children array`;
  for (const c of v.children) {
    const err = validBrick(c, level);
    if (err) return err;
  }
  return null;
}

export function validateSurface(v: any): string | null {
  if (!v || typeof v !== "object") return "content is not an object";
  if (v.v !== 1) return `unknown surface version ${v.v}`;
  if (!v.root) return "surface has no root";
  if (v.root.kind !== "grid") return "surface root is not a grid";
  return validBrick(v.root, 0);
}

export function parseSurfaceContent(raw: string): SurfaceContent {
  if (!raw || !raw.trim()) return { kind: "empty" };
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "invalid", reason: "content is not JSON" };
  }
  if (parsed && typeof parsed.source === "string" && !parsed.root) {
    return { kind: "pointer", source: parsed.source };
  }
  const err = validateSurface(parsed);
  if (err) return { kind: "invalid", reason: err };
  return { kind: "surface", surface: parsed as Surface };
}

export function serializeSurface(s: Surface): string {
  return JSON.stringify({ v: 1, root: s.root });
}
