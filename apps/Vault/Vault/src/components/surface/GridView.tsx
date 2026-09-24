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
import { isGrid, type Brick, type GridNode, type Path } from "./model";
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

  const focused = isFocusedGrid(focus, path);
  const view = viewFor(focus, path);
  const panZoom = grid.viewport === "pan-zoom";
  // Every child of this grid draws at the same effective scale, so the level of
  // detail is one decision per grid rather than one per brick.
  const detail = detailFor(effectiveZoom(focus, path));
  const extent = gridExtent(grid.cols, grid.rows);

  // Measured for culling. Zero until the observer fires, which visibleIndices
  // reads as "not measured yet" and keeps everything.
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
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
              style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
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
