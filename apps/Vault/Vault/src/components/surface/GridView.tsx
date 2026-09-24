// A container brick: cells, gaps, children, the focus ring, and — only when it
// is the focused level — pan and zoom.
//
// Rule 1 lives here as one conditional: the wheel listener is attached ONLY on
// the focused grid, and only when that grid's viewport is "pan-zoom". An
// ancestor cannot move because it has no listener; a descendant cannot move
// because a wheel over it bubbles UP to the focused ancestor. There is no
// "locked" flag to keep in sync — being unfocused is the lock.
//
// The listener is native rather than React's `onWheel` because it calls
// preventDefault: React attaches wheel at the root container as a passive
// listener, where preventDefault does nothing and warns. It is attached to this
// grid's own element, never to window.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { VaultGraph } from "../../types";
import {
  effectiveZoom,
  isFocusedGrid,
  viewFor,
  type Action,
  type FocusState,
} from "./focus";
import { cellRect, describeSize, detailFor, gridExtent, visibleIndices } from "./lod";
import { CELL_H, CELL_W, isGrid, type Brick, type GridNode, type Path, type Pos } from "./model";
import { LeafView } from "./LeafView";
import { leafName } from "./renderers";

/** How fast a trackpad pinch (ctrl+wheel) and a modifier-wheel zoom. */
const ZOOM_RATE = 0.01;

function brickLabel(brick: Brick, graph?: VaultGraph): string {
  return isGrid(brick) ? brick.id : leafName(brick, graph);
}

function brickMeta(brick: Brick): string {
  const kind = isGrid(brick) ? `container · ${brick.viewport}` : brick.renderer;
  return `${kind} · ${describeSize(brick.pos)}`;
}

/**
 * The cell rhythm, drawn ONLY on the footprint a brick actually occupies.
 *
 * There is no grid pattern on the surface itself and none on a container's
 * empty space: an infinite ruled background advertises cells nobody has used,
 * which is the visual form of wasted space. A container's cells are visible
 * because its children sit on them; a component's cells are visible because it
 * draws its own divisions. Nothing else is ruled.
 *
 * Returns undefined for a 1×1 brick — it is exactly one cell, and its own
 * border already says so.
 */
function cellLines(pos: Pos): React.CSSProperties | undefined {
  if (pos.w <= 1 && pos.h <= 1) return undefined;
  const layers: string[] = [];
  if (pos.w > 1) {
    layers.push(
      `repeating-linear-gradient(to right, transparent 0 ${CELL_W - 1}px, var(--border-faint) ${CELL_W - 1}px ${CELL_W}px)`
    );
  }
  if (pos.h > 1) {
    layers.push(
      `repeating-linear-gradient(to bottom, transparent 0 ${CELL_H - 1}px, var(--border-faint) ${CELL_H - 1}px ${CELL_H}px)`
    );
  }
  return { backgroundImage: layers.join(",") };
}

export function GridView({
  grid,
  path,
  focus,
  dispatch,
  graph,
}: {
  grid: GridNode;
  path: Path;
  focus: FocusState;
  dispatch: (a: Action) => void;
  graph?: VaultGraph;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // The ResizeObserver is installed once, so it must not close over the first
  // render's `dispatch`/`path`. Refs keep the effect's dependency list empty
  // without letting it report a stale path after a tree edit renumbers one.
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const pathRef = useRef(path);
  pathRef.current = path;

  const focused = isFocusedGrid(focus, path);
  const view = viewFor(focus, path);
  const panZoom = grid.viewport === "pan-zoom";
  // Every child of this grid draws at the same effective scale, so the level of
  // detail is one decision per grid rather than one per brick.
  const detail = detailFor(effectiveZoom(focus, path));
  const extent = gridExtent(grid.cols, grid.rows);

  // Measured for culling AND for the pan clamp, which is a statement about the
  // window and so cannot be computed from the document. Zero until the observer
  // fires, which both visibleIndices and clampView read as "not measured yet".
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const report = (w: number, h: number) => {
      setSize({ w, h });
      dispatchRef.current({ type: "setViewport", path: pathRef.current, w, h });
    };
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      report(r.width, r.height);
    });
    ro.observe(el);
    report(el.clientWidth, el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || !focused || !panZoom) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const r = el!.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        dispatch({
          type: "zoom",
          factor: Math.exp(-e.deltaY * ZOOM_RATE),
          ox: e.clientX - r.left,
          oy: e.clientY - r.top,
        });
      } else {
        dispatch({ type: "pan", dx: -e.deltaX, dy: -e.deltaY });
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [focused, panZoom, dispatch]);

  const visible = visibleIndices(grid.children, panZoom ? view : { x: 0, y: 0, zoom: 1 }, size);

  return (
    <div
      ref={hostRef}
      className={`surface-grid is-${grid.viewport}${focused ? " is-focused" : ""}`}
      // A pointerdown that reaches here landed on a GAP: every brick stops
      // propagation. Innermost wins, so clicking a gap inside a nested
      // container focuses that container rather than the root.
      onPointerDown={(e) => {
        e.stopPropagation();
        dispatch({ type: "focusGrid", path });
      }}
    >
      <div
        className="surface-grid-content"
        style={{
          width: extent.w,
          height: extent.h,
          ...(panZoom
            ? {
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
                transformOrigin: "0 0",
              }
            : null),
        }}
      >
        {visible.map((i) => {
          const child = grid.children[i];
          const rect = cellRect(child.pos);
          const selected = focused && focus.selection === i;
          const inComponent = selected && focus.mode === "component";
          return (
            <div
              key={child.id}
              className={`surface-brick${selected ? " is-selected" : ""}${
                inComponent ? " is-component" : ""
              }`}
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                // A container's cells are drawn by the children standing on
                // them, so only a component rules its own footprint.
                ...(isGrid(child) ? null : cellLines(child.pos)),
              }}
            >
              {/* The title bar is the brick's handle: it selects without
                  entering, so a mouse can put focus on a container in order to
                  move it rather than only in order to go inside it. */}
              <div
                className="surface-brick-bar"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "selectChild", path, index: i });
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "enterChild", path, index: i });
                }}
                title={`${brickLabel(child, graph)} — ${brickMeta(child)}`}
              >
                <span className="surface-brick-glyph">{isGrid(child) ? "▦" : "▪"}</span>
                <span className="surface-brick-name">{brickLabel(child, graph)}</span>
                <span className="surface-brick-meta">{brickMeta(child)}</span>
              </div>
              <div className="surface-brick-body">
                {isGrid(child) ? (
                  <GridView
                    grid={child}
                    path={[...path, i]}
                    focus={focus}
                    dispatch={dispatch}
                    graph={graph}
                  />
                ) : (
                  <LeafView
                    leaf={child}
                    detail={detail}
                    active={inComponent}
                    graph={graph}
                    onEnter={() => dispatch({ type: "enterChild", path, index: i })}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
