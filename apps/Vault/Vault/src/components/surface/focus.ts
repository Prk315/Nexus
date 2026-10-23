// The focus controller: the three rules from specs/surface.md as one pure
// reducer over (document, focus).
//
//   1. Exactly one grid level pans or zooms at a time — the one holding focus.
//      Ancestors and descendants are locked. Every grid keeps its OWN view, but
//      only the focused path's view can be changed, so a nested container keeps
//      where it was parked while you work a level up.
//
//   2. Surface mode vs component mode. In surface mode the keys belong to the
//      grid (arrows select, Cmd+Shift+arrows move, Cmd+Shift+Alt+arrows resize,
//      `n` and `g` add). In component mode every key except Escape belongs to
//      the component, and this reducer is not consulted at all.
//
//   3. Level of detail lives in lod.ts, driven by `effectiveZoom` here.
//
// The reducer owns the DOCUMENT as well as the focus, deliberately: "move the
// focused brick" is one atomic step that changes both, and splitting it across
// two reducers would make the selection and the layout disagree for a render.

import {
  addChild,
  canAddGrid,
  gridAt,
  isGrid,
  MAX_GRID_DEPTH,
  MAX_ZOOM,
  MIN_ZOOM,
  makeGrid,
  makeLeaf,
  moveChild,
  resizeChild,
  updateGrid,
  pathKey,
  type Brick,
  type GridNode,
  type Path,
  type Surface,
} from "./model";
import { clampView, contentRect, fitView, panBounds } from "./lod";

// Re-exported so callers keep one import for the view vocabulary; they are
// declared in model.ts so lod.ts can reach them without a cycle.
export { MIN_ZOOM, MAX_ZOOM };

export type Mode = "surface" | "component";
export type Dir = "left" | "right" | "up" | "down";

export interface View {
  /** Content translation in screen px, applied before `zoom`. */
  x: number;
  y: number;
  zoom: number;
}

export const DEFAULT_VIEW: View = { x: 0, y: 0, zoom: 1 };

export interface FocusState {
  /** Path to the focused GRID. `[]` is the root surface. */
  gridPath: Path;
  /** Index of the selected child within the focused grid, or null. */
  selection: number | null;
  mode: Mode;
  /** Per-grid pan/zoom, keyed by `pathKey`. Absent means DEFAULT_VIEW. */
  views: Record<string, View>;
  /**
   * Measured pixel size of each grid's viewport, keyed by `pathKey`.
   *
   * The reducer needs it because the pan clamp is "you cannot scroll the
   * content out of the window", which is a statement about the window. It is
   * reported by the DOM (a ResizeObserver in GridView) rather than computed,
   * and an absent or zero entry means "not measured yet" — in which case
   * nothing is clamped, so the first frame does not snap.
   */
  viewports: Record<string, { w: number; h: number }>;
  /**
   * Why the last action was refused (depth cap, no room, nothing selected).
   * Cleared by the next action that does something. The UI shows it; the tests
   * assert on it, which is the point — a silent refusal is indistinguishable
   * from a broken keybinding.
   */
  notice: string | null;
}

export interface SurfaceState {
  doc: Surface;
  focus: FocusState;
}

export type Action =
  /** Focus outward one level: component → surface → parent grid → deselect. */
  | { type: "escape" }
  /** Focus inward: into the selected container, or into the selected leaf. */
  | { type: "enter" }
  /** A click landed on a gap in the grid at `path`. */
  | { type: "focusGrid"; path: Path }
  /** A click landed on child `index` of the grid at `path`. */
  | { type: "selectChild"; path: Path; index: number }
  /** A click asked to go straight in (double click, or click inside a leaf). */
  | { type: "enterChild"; path: Path; index: number }
  /** Arrow: move the SELECTION to the nearest sibling in `dir`. */
  | { type: "move"; dir: Dir }
  /** Cmd+Shift+arrow: move the selected brick one cell in `dir`. */
  | { type: "translate"; dir: Dir }
  /** Cmd+Shift+Alt+arrow: grow (right/down) or shrink (left/up) the brick. */
  | { type: "resize"; dir: Dir }
  /** `n` */
  | { type: "addLeaf"; id: string; renderer?: string }
  /** `g` */
  | { type: "addGrid"; id: string }
  | { type: "pan"; dx: number; dy: number }
  /** Zoom the focused level about a point in its own viewport px. */
  | { type: "zoom"; factor: number; ox: number; oy: number }
  | { type: "resetView" }
  /** Zoom-to-fit the grid at `path` (default: the focused one). */
  | { type: "fit"; path?: Path }
  /** A grid's viewport was measured. Drives the pan clamp. */
  | { type: "setViewport"; path: Path; w: number; h: number }
  | { type: "setDoc"; doc: Surface };

export function initialFocus(): FocusState {
  return {
    gridPath: [],
    selection: null,
    mode: "surface",
    views: {},
    viewports: {},
    notice: null,
  };
}

export function initialState(doc: Surface): SurfaceState {
  return { doc, focus: initialFocus() };
}

export function viewFor(focus: FocusState, path: Path): View {
  return focus.views[pathKey(path)] ?? DEFAULT_VIEW;
}

export function viewportFor(focus: FocusState, path: Path): { w: number; h: number } {
  return focus.viewports[pathKey(path)] ?? { w: 0, h: 0 };
}

/**
 * Scale a brick at `path` is actually drawn at: the product of every ancestor
 * grid's zoom, including its own grid's.
 *
 * This is what level-of-detail is measured against, and it is why zooming the
 * root swaps the leaves of a nested container for cards even though that
 * container's own zoom never moved.
 */
export function effectiveZoom(focus: FocusState, path: Path): number {
  let z = 1;
  for (let i = 0; i <= path.length; i++) {
    z *= viewFor(focus, path.slice(0, i)).zoom;
  }
  return z;
}

/** Is the grid at `path` the one that pans and zooms right now? */
export function isFocusedGrid(focus: FocusState, path: Path): boolean {
  return pathKey(focus.gridPath) === pathKey(path);
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * The zoom below which zooming OUT may not go: the fit zoom, capped at 1.
 *
 * "Zoom-out stops at 100% visibility, never further than fit" (pf 1224):
 * past the point where every brick is on screen, further zoom-out only
 * shrinks the surface into the middle of the window — wasted space with
 * nothing left to reveal. Capped at 1 because small content fits long before
 * 100%, and a floor ABOVE 100% would forbid ever seeing it at natural size.
 *
 * MIN_ZOOM before the viewport is measured or when the grid is empty — there
 * is no fit to stop at, and clamping against a guess would jump later.
 */
function zoomFloor(grid: GridNode, viewport: { w: number; h: number }): number {
  const r = contentRect(grid);
  if (!r || viewport.w <= 0 || viewport.h <= 0) return MIN_ZOOM;
  return Math.max(MIN_ZOOM, Math.min(1, viewport.w / r.w, viewport.h / r.h));
}

function centerOf(b: Brick): { cx: number; cy: number } {
  return { cx: b.pos.x + b.pos.w / 2, cy: b.pos.y + b.pos.h / 2 };
}

/**
 * Nearest sibling in `dir`, by centre.
 *
 * Distance along the axis plus three times the perpendicular offset: a brick
 * directly to the right always beats one that is slightly right and far up,
 * which is what "arrow key" means to a hand. Ties break to the lower index so
 * the same layout always moves the same way.
 */
export function neighbourIndex(
  children: Brick[],
  from: number | null,
  dir: Dir
): number | null {
  if (children.length === 0) return null;
  if (from === null || !children[from]) {
    // Nothing selected yet: start at the top-left brick rather than index 0,
    // which is insertion order and has nothing to do with what you can see.
    let best = 0;
    children.forEach((c, i) => {
      const b = children[best];
      if (c.pos.y < b.pos.y || (c.pos.y === b.pos.y && c.pos.x < b.pos.x)) best = i;
    });
    return best;
  }
  const cur = centerOf(children[from]);
  const horizontal = dir === "left" || dir === "right";
  const sign = dir === "right" || dir === "down" ? 1 : -1;

  let best: number | null = null;
  let bestScore = Infinity;
  children.forEach((c, i) => {
    if (i === from) return;
    const { cx, cy } = centerOf(c);
    const along = horizontal ? (cx - cur.cx) * sign : (cy - cur.cy) * sign;
    if (along <= 0) return;
    const across = horizontal ? Math.abs(cy - cur.cy) : Math.abs(cx - cur.cx);
    const score = along + 3 * across;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

const DELTA: Record<Dir, { dx: number; dy: number }> = {
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
};

function withNotice(state: SurfaceState, notice: string): SurfaceState {
  if (state.focus.notice === notice) return state;
  return { ...state, focus: { ...state.focus, notice } };
}

function withFocus(state: SurfaceState, patch: Partial<FocusState>): SurfaceState {
  return { ...state, focus: { ...state.focus, notice: null, ...patch } };
}

/**
 * Re-seat a focus onto a document it may no longer fit — after a load, or a
 * doc replaced from outside. Walks the path down as far as it still resolves
 * and drops the rest, so a stale focus degrades to its nearest live ancestor
 * instead of addressing a brick that is gone.
 */
export function clampFocus(doc: Surface, focus: FocusState): FocusState {
  const path: Path = [];
  for (const i of focus.gridPath) {
    const next = gridAt(doc.root, [...path, i]);
    if (!next) break;
    path.push(i);
  }
  const grid = gridAt(doc.root, path)!;
  const selection =
    focus.selection !== null && grid.children[focus.selection] ? focus.selection : null;
  const mode: Mode = selection === null ? "surface" : focus.mode;
  return { ...focus, gridPath: path, selection, mode };
}

export function reduce(state: SurfaceState, action: Action): SurfaceState {
  const { doc, focus } = state;
  const grid = gridAt(doc.root, focus.gridPath);
  if (!grid) return withFocus(state, clampFocus(doc, focus));

  switch (action.type) {
    case "setDoc": {
      return { doc: action.doc, focus: clampFocus(action.doc, focus) };
    }

    case "escape": {
      // Component mode gives the keys back to the grid, keeping the brick
      // selected — you came out of it, you did not walk away from it.
      if (focus.mode === "component") return withFocus(state, { mode: "surface" });
      // Surface mode with a level above: focus the parent, selecting the
      // container you were just inside so a second Escape keeps walking out
      // along the same path you walked in.
      if (focus.gridPath.length > 0) {
        const index = focus.gridPath[focus.gridPath.length - 1];
        return withFocus(state, {
          gridPath: focus.gridPath.slice(0, -1),
          selection: index,
          mode: "surface",
        });
      }
      if (focus.selection !== null) return withFocus(state, { selection: null });
      return withNotice(state, "already at the top level");
    }

    case "enter": {
      if (focus.mode === "component") return state; // the component owns Enter
      if (focus.selection === null) return withNotice(state, "nothing selected");
      const child = grid.children[focus.selection];
      if (!child) return withNotice(state, "nothing selected");
      if (isGrid(child)) {
        const inner: Path = [...focus.gridPath, focus.selection];
        return withFocus(state, {
          gridPath: inner,
          selection: child.children.length ? neighbourIndex(child.children, null, "right") : null,
          mode: "surface",
        });
      }
      return withFocus(state, { mode: "component" });
    }

    case "focusGrid":
      return withFocus(state, {
        gridPath: action.path,
        selection: null,
        mode: "surface",
      });

    case "selectChild":
      return withFocus(state, {
        gridPath: action.path,
        selection: action.index,
        mode: "surface",
      });

    case "enterChild": {
      const selected = withFocus(state, {
        gridPath: action.path,
        selection: action.index,
        mode: "surface",
      });
      return reduce(selected, { type: "enter" });
    }

    case "move": {
      if (focus.mode !== "surface") return state;
      const next = neighbourIndex(grid.children, focus.selection, action.dir);
      if (next === null) return withNotice(state, "no brick that way");
      return withFocus(state, { selection: next });
    }

    case "translate":
    case "resize": {
      if (focus.mode !== "surface") return state;
      if (focus.selection === null) return withNotice(state, "nothing selected");
      const { dx, dy } = DELTA[action.dir];
      const index = focus.selection;
      const nextGrid =
        action.type === "translate"
          ? moveChild(grid, index, dx, dy)
          : resizeChild(grid, index, dx, dy);
      if (!nextGrid) {
        return withNotice(
          state,
          action.type === "translate" ? "no room that way" : "cannot resize that way"
        );
      }
      return {
        doc: { ...doc, root: updateGrid(doc.root, focus.gridPath, () => nextGrid) },
        focus: { ...focus, notice: null },
      };
    }

    case "addLeaf": {
      if (focus.mode !== "surface") return state;
      const { grid: nextGrid, index } = addChild(
        grid,
        (pos) => makeLeaf(action.id, pos, action.renderer ?? "placeholder"),
        1,
        1
      );
      return {
        doc: { ...doc, root: updateGrid(doc.root, focus.gridPath, () => nextGrid) },
        focus: { ...focus, selection: index, mode: "surface", notice: null },
      };
    }

    case "addGrid": {
      if (focus.mode !== "surface") return state;
      if (!canAddGrid(focus.gridPath)) {
        return withNotice(state, `depth cap: only ${MAX_GRID_DEPTH} grid levels`);
      }
      const { grid: nextGrid, index } = addChild(
        grid,
        (pos) => makeGrid(action.id, pos),
        2,
        2
      );
      return {
        doc: { ...doc, root: updateGrid(doc.root, focus.gridPath, () => nextGrid) },
        focus: { ...focus, selection: index, mode: "surface", notice: null },
      };
    }

    case "pan": {
      // Rule 1, enforced in one place: only the focused level moves, and only
      // when that level is a pan-zoom viewport. A "scroll" container is scrolled
      // by the browser and a "fixed" one does not move at all.
      if (grid.viewport !== "pan-zoom") return state;
      const cur = viewFor(focus, focus.gridPath);
      return setView(state, grid, focus.gridPath, {
        ...cur,
        x: cur.x + action.dx,
        y: cur.y + action.dy,
      });
    }

    case "zoom": {
      if (grid.viewport !== "pan-zoom") return state;
      const cur = viewFor(focus, focus.gridPath);
      // Zooming out stops at the fit floor — but never JUMPS to it: a view
      // already below the floor (the content grew under it) stays where it is
      // and simply cannot go further out. Zooming in is never floored.
      const floor =
        action.factor < 1
          ? Math.min(cur.zoom, zoomFloor(grid, viewportFor(focus, focus.gridPath)))
          : MIN_ZOOM;
      const zoom = Math.max(floor, clampZoom(cur.zoom * action.factor));
      if (zoom === cur.zoom) return state;
      // Keep the point under the cursor fixed: it is the difference between
      // zooming a document and zooming a coordinate system.
      const k = zoom / cur.zoom;
      return setView(state, grid, focus.gridPath, {
        zoom,
        x: action.ox - (action.ox - cur.x) * k,
        y: action.oy - (action.oy - cur.y) * k,
      });
    }

    case "resetView":
      return setView(state, grid, focus.gridPath, { ...DEFAULT_VIEW });

    case "fit": {
      const path = action.path ?? focus.gridPath;
      const target = gridAt(doc.root, path);
      if (!target) return state;
      // Fit the CONTENT, not the content plus its pan margin — opening a
      // surface with a cell of empty space framed on every side is the wasted
      // space, not the fix for it.
      const fitted = fitView(contentRect(target), viewportFor(focus, path));
      return withFocus(state, { views: { ...focus.views, [pathKey(path)]: fitted } });
    }

    case "setViewport": {
      const key = pathKey(action.path);
      const prev = focus.viewports[key];
      if (prev && prev.w === action.w && prev.h === action.h) return state;
      const viewports = { ...focus.viewports, [key]: { w: action.w, h: action.h } };
      // A resize can leave the current view outside the bounds — a window
      // widened past the content has to re-centre, or the surface sits against
      // one edge with dead space beside it.
      const target = gridAt(doc.root, action.path);
      const views = { ...focus.views };
      if (target && target.viewport === "pan-zoom") {
        const clamped = clampView(viewFor(focus, action.path), panBounds(target), {
          w: action.w,
          h: action.h,
        });
        views[key] = clamped;
      }
      return { ...state, focus: { ...focus, viewports, views } };
    }
  }
}

/**
 * Write one grid's view, held inside its pan bounds.
 *
 * Every view write goes through here — pan, zoom and reset alike — so the
 * clamp cannot be forgotten by whichever gesture is added next.
 */
function setView(
  state: SurfaceState,
  grid: GridNode,
  path: Path,
  next: View
): SurfaceState {
  const clamped = clampView(next, panBounds(grid), viewportFor(state.focus, path));
  return withFocus(state, {
    views: { ...state.focus.views, [pathKey(path)]: clamped },
  });
}

/** Fold a list of actions — what the tests read like, and a handy debug tool. */
export function reduceAll(state: SurfaceState, actions: Action[]): SurfaceState {
  return actions.reduce(reduce, state);
}

/**
 * Translate a keyboard event into an action, or null to let it through.
 *
 * Separated from the DOM so the key bindings themselves are testable, and so
 * the one rule that matters most is legible: in COMPONENT mode this returns
 * null for everything but Escape. A note being edited inside a leaf never loses
 * a keystroke to the surface.
 */
export interface KeyEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

const ARROWS: Record<string, Dir> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

export function keyToAction(
  e: KeyEvent,
  mode: Mode,
  newId: () => string
): Action | null {
  if (e.key === "Escape") return { type: "escape" };
  if (mode === "component") return null;

  const dir = ARROWS[e.key];
  if (dir) {
    const cmd = e.metaKey || e.ctrlKey;
    if (cmd && e.shiftKey && e.altKey) return { type: "resize", dir };
    if (cmd && e.shiftKey) return { type: "translate", dir };
    if (!cmd && !e.shiftKey && !e.altKey) return { type: "move", dir };
    return null;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === "Enter") return { type: "enter" };
  if (e.key === "n") return { type: "addLeaf", id: newId() };
  if (e.key === "g") return { type: "addGrid", id: newId() };
  if (e.key === "0") return { type: "resetView" };
  if (e.key === "f") return { type: "fit" };
  return null;
}
