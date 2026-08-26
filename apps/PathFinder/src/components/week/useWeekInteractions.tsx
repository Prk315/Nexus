// Desktop-only pointer interactions for the week grid's calendar blocks:
// move, resize, nest-by-drag, unnest-by-drag, and pan-on-empty-background
// (spec U2 §2-3) — PLUS (spec U3 Part A) drag-to-schedule: dragging a task
// from an external source (RightPanel's rows, the all-day TaskPopupChip)
// onto the grid creates a calendar block linked to it. Mobile never
// constructs or receives this — TimeColumn's `interactions` prop stays
// `undefined` there, and every new code path in TimeColumn/CalBlockCard is
// additive behind that prop, so mobile is byte-for-byte unaffected.
//
// The external-drag family is a SEPARATE entry point (`onExternalDragPointerDown`,
// called from outside the grid entirely) but shares the same state machine,
// pointer-threshold gesture and window-level move/up listeners as U2's block
// drag — see "pending-external" / "placing" below. It reuses `findDropTarget`'s
// dwell-to-nest logic verbatim (so "virtual recurring occurrences never
// nest" falls out for free — they're already excluded there) and
// `clampChildSpan` for the commit math, same as a block move.
//
// A 4px movement threshold separates "click" (unchanged existing behaviour —
// open a block, create one at a clicked cell) from "drag". Below the
// threshold, this file does nothing: the block's own onClick / the column's
// original click-to-create math still runs, untouched.
//
// ── State machine (one gesture at a time, tracked in a ref — not React
//    state, so a 60fps pointermove stream doesn't thrash re-renders) ──
//
//   idle
//     --pointerdown on empty background--> pending-bg
//     --pointerdown on a draggable block's body--> pending-block
//     --pointerdown on a leaf block's resize handle--> pending-resize
//
//   pending-* --moved < 4px, pointerup--> idle
//     (background: onClickSlot fires, exactly the old click-to-create math.
//      block/resize: nothing fires here — the browser's own click event on
//      the block still reaches its existing onClick handler unmolested.)
//
//   pending-bg    --moved >= 4px--> panning   (native-scroll-style drag)
//   pending-block --moved >= 4px--> moving    (ghost follows, may nest/detach)
//   pending-resize--moved >= 4px--> resizing  (ghost follows, one edge only)
//
//   panning/moving/resizing --pointerup--> idle
//     panning: no commit, it was just scrolling.
//     moving/resizing: onCommitBlock(block, patch) — the resolved patch
//       (times, possibly `date`, possibly `parent_block_id`) is computed
//       here; the caller (Week.tsx) just applies it optimistically and
//       calls the API, mirroring every other handler in that file.
//
//   -- U3 Part A: drag-to-schedule, started OUTSIDE the grid ---------------
//
//   idle --onExternalDragPointerDown (RightPanel row / TaskPopupChip)--> pending-external
//
//   pending-external --moved < 4px, pointerup--> idle
//     (the source's own click still fires natively — same "browser still
//      delivers the click, we just don't act on it" contract as pending-
//      block/pending-resize above.)
//
//   pending-external --moved >= 4px--> placing (ghost follows the pointer;
//     over a registered day column it ALSO snaps a block-shaped preview into
//     the grid at 5-minute slots, and dwelling 300ms over an existing block
//     rings it exactly like a block move's nest detection)
//
//   placing --pointerup, pointer over a valid grid column--> idle,
//     onExternalDrop(payload, dest) — dest.parentBlockId set when the drop
//     resolved onto a dwell-ringed target (times clamped via
//     clampChildSpan), else a top-level block at the snapped time.
//   placing --pointerup, pointer NOT over any grid column--> idle, no commit
//     ("drop outside the grid: cancel, nothing created").
//
//   any active mode --Escape / pointercancel--> idle, no commit.
//
// Ghost geometry is published through a tiny external store
// (subscribeGhost/getGhostSnapshot, read via useSyncExternalStore in the
// standalone <DragGhostLayer/> below) specifically so the high-frequency
// pointermove stream re-renders only that one component, not the whole Week
// page. `draggingId`/`dropTargetId` change far less often — only when the
// hovered block changes — so those go through ordinary React state.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "../../lib/utils";
import { wouldCreateCalBlockCycle } from "../../lib/api";
import type { CalBlock } from "../../types";
import {
  BLOCK_COLORS, GRID_END_MIN, HOUR_START, HOURS, clampChildSpan, fmtWeekMinutes, minToHHMM,
  minutesToPx, pxToMinutes, pxToTime, snapMinutes, timeToMinutes,
} from "./_shared";

const DRAG_THRESHOLD_PX = 4;
const NEST_HOVER_MS = 300;
const DETACH_MARGIN_PX = 12;
const MIN_DURATION_MIN = 10;
const EDGE_ZONE_PX = 40;
const AUTOSCROLL_PX_PER_TICK = 14;

export type DragCommitPatch = {
  start_time?: string;
  end_time?: string;
  date?: string;
  parent_block_id?: number | null;
};

export interface GhostSnapshot {
  top: number; left: number; width: number; height: number;
  label: string; color: string; willNest: boolean; willDetach: boolean;
  targetTitle: string | null;
}

/** What dragging a task onto the grid would create — computed by the caller
 *  (Week.tsx, spec U3 Part A's duration heuristic: `clamp(unscheduledMinutes
 *  (task) || time_estimate || 30, 15, 240)`) since this hook has no access to
 *  the task tree or coverage map. Fixed for the whole gesture: there's no
 *  resize handle on a not-yet-created block. */
export interface ExternalDragPayload {
  taskId: number;
  title: string;
  durationMin: number;
}

/** Where an external drag resolved on drop. */
export interface ExternalDropDest {
  date: string;
  startTime: string;
  endTime: string;
  /** Set when the drop landed on a dwell-ringed existing block. */
  parentBlockId: number | null;
}

/** Ghost for an in-flight external (task -> grid) drag — see the file header. */
export interface ExternalGhostSnapshot {
  /** Raw pointer position — the floating "title + duration" badge always
   *  follows this, on or off the grid. */
  x: number; y: number;
  title: string;
  /** Duration text while off the grid ("45m"); the snapped time range
   *  ("09:00–09:45") once a valid column is hovered — the grid preview below
   *  already shows the range, so the floating badge doesn't repeat it. */
  detail: string;
  /** Present only while hovering a registered day column — the snapped
   *  block-shaped drop preview, in the same fixed-viewport coordinates the
   *  block-move ghost uses. */
  grid: { top: number; left: number; width: number; height: number } | null;
  willNest: boolean;
  targetTitle: string | null;
}

export interface WeekInteractions {
  registerColumn: (iso: string, el: HTMLDivElement | null) => void;
  onBackgroundPointerDown: (e: React.PointerEvent, iso: string) => void;
  onBlockPointerDown: (e: React.PointerEvent, block: CalBlock, iso: string) => void;
  onResizePointerDown: (e: React.PointerEvent, block: CalBlock, edge: "top" | "bottom", iso: string) => void;
  /** Entry point for U3 Part A's drag family — called from a pointerdown on
   *  an external source (a RightPanel task row, an all-day TaskPopupChip),
   *  which lives outside the grid's own DOM entirely. */
  onExternalDragPointerDown: (e: React.PointerEvent, payload: ExternalDragPayload) => void;
  /** True once, right after a real drag ends — lets the block's own onClick
   *  swallow the click the browser still fires after pointerup, without a
   *  React re-render round-trip. Resets itself on read. */
  consumeWasDrag: () => boolean;
  isDraggable: (block: CalBlock) => boolean;
  isDropTarget: (blockId: number) => boolean;
  draggingId: number | null;
  /** id of the task currently being external-dragged, so its own source row
   *  can dim itself — null the rest of the time. */
  externalDraggingTaskId: number | null;
  subscribeGhost: (fn: () => void) => () => void;
  getGhostSnapshot: () => GhostSnapshot | null;
  subscribeExternalGhost: (fn: () => void) => () => void;
  getExternalGhostSnapshot: () => ExternalGhostSnapshot | null;
}

interface Args {
  hourPx: number;
  calBlocks: CalBlock[];
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onClickSlot: (date: string, time: string) => void;
  onCommitBlock: (block: CalBlock, patch: DragCommitPatch) => void;
  /** U3 Part A's commit path — called once, on a successful drop. */
  onExternalDrop: (payload: ExternalDragPayload, dest: ExternalDropDest) => void;
}

type Mode =
  | "idle" | "pending-bg" | "pending-block" | "pending-resize" | "panning" | "moving" | "resizing"
  | "pending-external" | "placing";

interface Internal {
  mode: Mode;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  iso: string;
  block?: CalBlock;
  edge?: "top" | "bottom";
  originStartMin: number;
  originEndMin: number;
  originDate: string;
  originScrollTop: number;
  /** Minutes between the block's own start and the pointer's grab point,
   *  captured at pointerdown — a move keeps this offset constant so the
   *  block moves WITH the cursor instead of snapping its top edge to it
   *  (grabbing mid-card and having the card jump to start under the
   *  pointer reads as broken; every mainstream calendar preserves the
   *  grab offset instead). Resize is unaffected — its handle IS the edge. */
  grabOffsetMin: number;
  curStartMin: number;
  curEndMin: number;
  curDate: string;
  hoverTargetId: number | null;
  hoverSince: number | null;
  willNest: boolean;
  willDetach: boolean;
  parentAtStart: CalBlock | null;
  /** Set only for "pending-external"/"placing" — see ExternalDragPayload. */
  externalPayload?: ExternalDragPayload;
}

export function useWeekInteractions({
  hourPx, calBlocks, scrollContainerRef, onClickSlot, onCommitBlock, onExternalDrop,
}: Args): { interactions: WeekInteractions } {
  const columns = useRef<Map<string, HTMLDivElement>>(new Map());
  const state = useRef<Internal | null>(null);
  const wasDragRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const blocksById = useRef<Map<number, CalBlock>>(new Map());

  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [externalDraggingTaskId, setExternalDraggingTaskId] = useState<number | null>(null);

  // Ghost micro-store — see file header.
  const ghostListeners = useRef<Set<() => void>>(new Set());
  const ghostSnap = useRef<GhostSnapshot | null>(null);
  const setGhost = useCallback((g: GhostSnapshot | null) => {
    ghostSnap.current = g;
    ghostListeners.current.forEach((fn) => fn());
  }, []);
  const subscribeGhost = useCallback((fn: () => void) => {
    ghostListeners.current.add(fn);
    return () => { ghostListeners.current.delete(fn); };
  }, []);
  const getGhostSnapshot = useCallback(() => ghostSnap.current, []);

  // Second, parallel micro-store for the external-drag ghost (U3 Part A) —
  // kept separate from the block-move ghost above rather than folded into
  // one wider snapshot type, because the two have almost no shared shape
  // (this one tracks the raw pointer position too, for the always-visible
  // floating badge) and separating them means DragGhostLayer's existing
  // render logic doesn't grow a branch for a case it can never hit.
  const externalGhostListeners = useRef<Set<() => void>>(new Set());
  const externalGhostSnap = useRef<ExternalGhostSnapshot | null>(null);
  const setExternalGhost = useCallback((g: ExternalGhostSnapshot | null) => {
    externalGhostSnap.current = g;
    externalGhostListeners.current.forEach((fn) => fn());
  }, []);
  const subscribeExternalGhost = useCallback((fn: () => void) => {
    externalGhostListeners.current.add(fn);
    return () => { externalGhostListeners.current.delete(fn); };
  }, []);
  const getExternalGhostSnapshot = useCallback(() => externalGhostSnap.current, []);

  const registerColumn = useCallback((iso: string, el: HTMLDivElement | null) => {
    if (el) columns.current.set(iso, el); else columns.current.delete(iso);
  }, []);

  useEffect(() => {
    blocksById.current = new Map(calBlocks.map((b) => [b.id, b]));
  }, [calBlocks]);

  // Virtual recurring occurrences carry a negative id and never nest/move —
  // matches U1's "recurring blocks never nest" rule and spec U2 §2's
  // "not draggable: virtual recurring occurrences".
  const isDraggable = useCallback((block: CalBlock) => block.id > 0, []);

  function columnAtX(clientX: number): string | null {
    let best: string | null = null;
    let bestDx = Infinity;
    for (const [iso, el] of columns.current) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right) return iso;
      const dx = clientX < r.left ? r.left - clientX : clientX - r.right;
      if (dx < bestDx) { bestDx = dx; best = iso; }
    }
    return best;
  }

  function geometryOf(iso: string): { top: number; height: number; left: number; width: number } | null {
    const el = columns.current.get(iso);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, height: r.height, left: r.left, width: r.width };
  }

  /** Strict version of `columnAtX` — no nearest-column fallback. Used by the
   *  external drag (U3 Part A) to tell "hovering a real grid cell" (snap +
   *  show the drop preview) apart from "still over the source panel /
   *  sidebar / anywhere else" (just follow the pointer, no preview) — the
   *  fallback in `columnAtX` exists for a gesture that's already IN the
   *  grid (a block drag can't leave its own column strip sideways without
   *  still being "over the grid" vertically); an external drag starts
   *  outside the grid entirely and must be able to tell it hasn't arrived. */
  function columnUnderPointer(clientX: number, clientY: number): string | null {
    for (const [iso, el] of columns.current) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom) return iso;
    }
    return null;
  }

  function releasePointerListeners() {
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerUp);
  }

  function endGesture() {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    state.current = null;
    lastPointerRef.current = null;
    setDraggingId(null);
    setDropTargetId(null);
    setGhost(null);
    setExternalDraggingTaskId(null);
    setExternalGhost(null);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  // ── Auto-scroll while a block drag sits in the container's top/bottom
  //    edge zone (spec §2 "overflow container auto-scrolls"). ──
  function autoScrollTick() {
    const s = state.current;
    const container = scrollContainerRef.current;
    const p = lastPointerRef.current;
    if (!s || !container || !p || (s.mode !== "moving" && s.mode !== "resizing")) {
      rafRef.current = null;
      return;
    }
    const rect = container.getBoundingClientRect();
    if (p.y < rect.top + EDGE_ZONE_PX) {
      container.scrollTop = Math.max(0, container.scrollTop - AUTOSCROLL_PX_PER_TICK);
    } else if (p.y > rect.bottom - EDGE_ZONE_PX) {
      container.scrollTop += AUTOSCROLL_PX_PER_TICK;
    }
    rafRef.current = requestAnimationFrame(autoScrollTick);
  }
  function ensureAutoScrollLoop() {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(autoScrollTick);
  }

  // ── Candidate nest target under the pointer: same day, time-overlap, not
  //    itself/its own descendant, not virtual. Ties go to the shortest
  //    span — the more specific card under the cursor when several overlap. ──
  // `draggedId` accepts `null` for an external drag (U3 Part A): there's no
  // existing block to exclude by id, and `wouldCreateCalBlockCycle`'s own
  // `draggedId: number | null` parameter already treats null the same way
  // createCalBlock's own cycle check does for a brand-new block.
  function findDropTarget(iso: string, minute: number, draggedId: number | null): CalBlock | null {
    let best: CalBlock | null = null;
    let bestDur = Infinity;
    for (const b of calBlocks) {
      if (b.date !== iso || b.id === draggedId || b.id <= 0) continue;
      const s = timeToMinutes(b.start_time), e = timeToMinutes(b.end_time);
      if (minute < s || minute > e) continue;
      if (wouldCreateCalBlockCycle(calBlocks, draggedId, b.id)) continue;
      const dur = e - s;
      if (dur < bestDur) { bestDur = dur; best = b; }
    }
    return best;
  }

  const onWindowPointerMove = useCallback((e: PointerEvent) => {
    const s = state.current;
    if (!s || e.pointerId !== s.pointerId) return;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };

    const dist = Math.hypot(e.clientX - s.startClientX, e.clientY - s.startClientY);

    if (s.mode === "pending-bg" || s.mode === "pending-block" || s.mode === "pending-resize" || s.mode === "pending-external") {
      if (dist < DRAG_THRESHOLD_PX) return;
      s.mode = s.mode === "pending-bg" ? "panning"
        : s.mode === "pending-block" ? "moving"
        : s.mode === "pending-resize" ? "resizing"
        : "placing";
      wasDragRef.current = true;
      document.body.style.userSelect = "none";
      if (s.mode === "panning") {
        document.body.style.cursor = "grabbing";
      } else if (s.mode === "placing") {
        document.body.style.cursor = "grabbing";
        setExternalDraggingTaskId(s.externalPayload!.taskId);
      } else {
        document.body.style.cursor = s.mode === "resizing" ? "ns-resize" : "grabbing";
        setDraggingId(s.block!.id);
        ensureAutoScrollLoop();
      }
    }

    if (s.mode === "panning") {
      const container = scrollContainerRef.current;
      if (container) container.scrollTop = s.originScrollTop - (e.clientY - s.startClientY);
      return;
    }

    if (s.mode === "moving" && s.block) {
      const targetIso = columnAtX(e.clientX) ?? s.iso;
      const geo = geometryOf(targetIso);
      if (!geo) return;
      const relY = e.clientY - geo.top;
      const rawMinute = pxToMinutes(relY, hourPx) - s.grabOffsetMin;
      const durMin = s.originEndMin - s.originStartMin;
      let startMin = snapMinutes(rawMinute, 5);
      startMin = Math.max(HOUR_START * 60, Math.min(GRID_END_MIN - durMin, startMin));
      const endMin = startMin + durMin;

      s.curDate = targetIso;
      s.curStartMin = startMin;
      s.curEndMin = endMin;

      // Child drags: while inside the original parent's rendered box (+
      // margin), this is a within-parent time adjustment, never a nest
      // search. Once the pointer clears the parent's box by more than
      // DETACH_MARGIN_PX (or leaves its day entirely) it behaves exactly
      // like a top-level drag — spec §2 "detaches ... ghost turns top-level".
      let willDetach = false;
      if (s.parentAtStart) {
        if (targetIso !== s.parentAtStart.date) {
          willDetach = true;
        } else {
          const pStart = timeToMinutes(s.parentAtStart.start_time);
          const pEnd = timeToMinutes(s.parentAtStart.end_time);
          const pTop = geo.top + minutesToPx(pStart, hourPx);
          const pBottom = geo.top + minutesToPx(pEnd, hourPx);
          willDetach = e.clientY < pTop - DETACH_MARGIN_PX || e.clientY > pBottom + DETACH_MARGIN_PX;
        }
      }

      let hoverTarget: CalBlock | null = null;
      const eligibleForNest = !s.parentAtStart || willDetach;
      if (eligibleForNest) {
        hoverTarget = findDropTarget(targetIso, (startMin + endMin) / 2, s.block.id);
      }

      const now = performance.now();
      if ((hoverTarget?.id ?? null) !== s.hoverTargetId) {
        s.hoverTargetId = hoverTarget?.id ?? null;
        s.hoverSince = hoverTarget ? now : null;
        s.willNest = false;
      } else if (hoverTarget && s.hoverSince != null && now - s.hoverSince >= NEST_HOVER_MS) {
        s.willNest = true;
      }
      if (!hoverTarget) s.willNest = false;
      s.willDetach = willDetach;

      setDropTargetId((prev) => {
        const next = s.willNest ? s.hoverTargetId : null;
        return prev === next ? prev : next;
      });

      const top = geo.top + minutesToPx(startMin, hourPx);
      const height = Math.max(1, minutesToPx(endMin, hourPx) - minutesToPx(startMin, hourPx));
      setGhost({
        top, left: geo.left, width: geo.width, height,
        label: `${minToHHMM(startMin)}–${minToHHMM(endMin)}`,
        color: s.block.color,
        willNest: s.willNest,
        willDetach: s.willDetach && !!s.parentAtStart,
        targetTitle: s.willNest && hoverTarget ? hoverTarget.title : null,
      });
      return;
    }

    if (s.mode === "resizing" && s.block) {
      const geo = geometryOf(s.iso);
      if (!geo) return;
      const relY = e.clientY - geo.top;
      const rawMinute = snapMinutes(pxToMinutes(relY, hourPx), 5);
      let startMin = s.originStartMin, endMin = s.originEndMin;
      if (s.edge === "top") {
        startMin = Math.max(HOUR_START * 60, Math.min(endMin - MIN_DURATION_MIN, rawMinute));
      } else {
        endMin = Math.min(GRID_END_MIN, Math.max(startMin + MIN_DURATION_MIN, rawMinute));
      }
      s.curStartMin = startMin;
      s.curEndMin = endMin;

      const top = geo.top + minutesToPx(startMin, hourPx);
      const height = Math.max(1, minutesToPx(endMin, hourPx) - minutesToPx(startMin, hourPx));
      setGhost({
        top, left: geo.left, width: geo.width, height,
        label: `${minToHHMM(startMin)}–${minToHHMM(endMin)}`,
        color: s.block.color, willNest: false, willDetach: false, targetTitle: null,
      });
      return;
    }

    // U3 Part A — external drag (task -> grid). Unlike a block move, this
    // gesture can be hovering ANYWHERE (it starts outside the grid), so the
    // first question every move is "are we even over a registered day
    // column right now" (columnUnderPointer's strict bounds check) — off the
    // grid, only the floating pointer-following badge updates; on it, this
    // mirrors "moving"'s own snap + dwell-to-nest math (fixed duration, no
    // grab offset — there's no existing card to preserve the grab point of).
    if (s.mode === "placing" && s.externalPayload) {
      const durationMin = s.externalPayload.durationMin;
      const hoveredIso = columnUnderPointer(e.clientX, e.clientY);

      if (!hoveredIso) {
        s.curDate = "";
        s.hoverTargetId = null;
        s.hoverSince = null;
        s.willNest = false;
        setDropTargetId((prev) => (prev === null ? prev : null));
        setExternalGhost({
          x: e.clientX, y: e.clientY,
          title: s.externalPayload.title,
          detail: fmtWeekMinutes(durationMin),
          grid: null, willNest: false, targetTitle: null,
        });
        return;
      }

      const geo = geometryOf(hoveredIso);
      if (!geo) return;
      const relY = e.clientY - geo.top;
      const rawMinute = pxToMinutes(relY, hourPx);
      let startMin = snapMinutes(rawMinute, 5);
      startMin = Math.max(HOUR_START * 60, Math.min(GRID_END_MIN - durationMin, startMin));
      const endMin = startMin + durationMin;

      s.curDate = hoveredIso;
      s.curStartMin = startMin;
      s.curEndMin = endMin;

      const hoverTarget = findDropTarget(hoveredIso, (startMin + endMin) / 2, null);
      const now = performance.now();
      if ((hoverTarget?.id ?? null) !== s.hoverTargetId) {
        s.hoverTargetId = hoverTarget?.id ?? null;
        s.hoverSince = hoverTarget ? now : null;
        s.willNest = false;
      } else if (hoverTarget && s.hoverSince != null && now - s.hoverSince >= NEST_HOVER_MS) {
        s.willNest = true;
      }
      if (!hoverTarget) s.willNest = false;

      setDropTargetId((prev) => {
        const next = s.willNest ? s.hoverTargetId : null;
        return prev === next ? prev : next;
      });

      const top = geo.top + minutesToPx(startMin, hourPx);
      const height = Math.max(1, minutesToPx(endMin, hourPx) - minutesToPx(startMin, hourPx));
      setExternalGhost({
        x: e.clientX, y: e.clientY,
        title: s.externalPayload.title,
        detail: `${minToHHMM(startMin)}–${minToHHMM(endMin)}`,
        grid: { top, left: geo.left, width: geo.width, height },
        willNest: s.willNest,
        targetTitle: s.willNest && hoverTarget ? hoverTarget.title : null,
      });
    }
  }, [hourPx, calBlocks, scrollContainerRef, setGhost, setExternalGhost]);

  const onWindowPointerUp = useCallback((e: PointerEvent) => {
    const s = state.current;
    if (!s || e.pointerId !== s.pointerId) return;

    if (s.mode === "moving" && s.block) {
      const patch: DragCommitPatch = {};
      if (s.willNest && s.hoverTargetId != null) {
        const target = blocksById.current.get(s.hoverTargetId);
        if (target) {
          const clamped = clampChildSpan(minToHHMM(s.curStartMin), minToHHMM(s.curEndMin), target);
          patch.start_time = clamped.start;
          patch.end_time = clamped.end;
          patch.date = target.date;
          patch.parent_block_id = target.id;
        }
      } else if (s.parentAtStart && s.willDetach) {
        patch.start_time = minToHHMM(s.curStartMin);
        patch.end_time = minToHHMM(s.curEndMin);
        patch.date = s.curDate;
        patch.parent_block_id = null;
      } else if (s.parentAtStart && !s.willDetach) {
        const clamped = clampChildSpan(minToHHMM(s.curStartMin), minToHHMM(s.curEndMin), s.parentAtStart);
        patch.start_time = clamped.start;
        patch.end_time = clamped.end;
      } else {
        patch.start_time = minToHHMM(s.curStartMin);
        patch.end_time = minToHHMM(s.curEndMin);
        if (s.curDate !== s.originDate) patch.date = s.curDate;
      }
      onCommitBlock(s.block, patch);
    } else if (s.mode === "resizing" && s.block) {
      if (s.curStartMin !== s.originStartMin || s.curEndMin !== s.originEndMin) {
        onCommitBlock(s.block, { start_time: minToHHMM(s.curStartMin), end_time: minToHHMM(s.curEndMin) });
      }
    } else if (s.mode === "pending-bg") {
      // Below threshold — a plain click on empty background. Same math the
      // pre-U2 onClick handler used, just reached from pointerup instead.
      const geo = geometryOf(s.iso);
      if (geo) {
        const relY = e.clientY - geo.top;
        const time = pxToTime(relY, HOURS.length * hourPx, hourPx);
        onClickSlot(s.iso, time);
      }
    } else if (s.mode === "placing" && s.externalPayload) {
      // U3 Part A commit. `s.curDate` is the "" sentinel whenever the
      // pointer never entered a registered grid column this gesture — same
      // "cancel, nothing created" contract as Escape/blur, just reached via
      // a plain drop instead. `willNest` reuses the exact same dwell state
      // "moving"'s own nest commit reads above.
      if (s.curDate) {
        if (s.willNest && s.hoverTargetId != null) {
          const target = blocksById.current.get(s.hoverTargetId);
          if (target) {
            const clamped = clampChildSpan(minToHHMM(s.curStartMin), minToHHMM(s.curEndMin), target);
            onExternalDrop(s.externalPayload, {
              date: target.date, startTime: clamped.start, endTime: clamped.end, parentBlockId: target.id,
            });
          }
        } else {
          onExternalDrop(s.externalPayload, {
            date: s.curDate, startTime: minToHHMM(s.curStartMin), endTime: minToHHMM(s.curEndMin), parentBlockId: null,
          });
        }
      }
    }
    // pending-block / pending-resize / pending-external under threshold:
    // intentionally a no-op — the browser's own click event still reaches
    // the source's existing onClick handler, unmolested.

    releasePointerListeners();
    endGesture();
  }, [hourPx, onClickSlot, onCommitBlock, onExternalDrop]);

  useEffect(() => {
    function cancelActiveGesture() {
      if (!state.current || state.current.mode === "idle") return;
      releasePointerListeners();
      endGesture();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      cancelActiveGesture();
    }
    // Without setPointerCapture, releasing the button outside the browser
    // window (or Cmd-Tabbing away) mid-drag may never deliver a pointerup —
    // the gesture would sit armed with body cursor/userSelect overridden
    // until Escape. Window blur is the reliable signal for both cases:
    // cancel, don't commit, same as Escape.
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", cancelActiveGesture);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", cancelActiveGesture);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unmount mid-drag: the window-level pointermove/pointerup/pointercancel
  // listeners above are only ever removed by onWindowPointerUp or the
  // Escape handler — both reached through a live pointer event. If Week.tsx
  // itself unmounts while a gesture is active (mode !== "idle"), neither
  // fires, so without this the listeners (closing over this render's
  // calBlocks/onCommitBlock/etc.), the auto-scroll rAF loop, and the
  // document.body cursor/userSelect override would all leak past the
  // component's lifetime — a stray pointerup arriving after unmount could
  // still invoke onCommitBlock against stale props.
  useEffect(() => {
    return () => {
      releasePointerListeners();
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function beginGesture(e: React.PointerEvent, mode: Mode, iso: string, block?: CalBlock, edge?: "top" | "bottom") {
    wasDragRef.current = false;
    const container = scrollContainerRef.current;
    const originStartMin = block ? timeToMinutes(block.start_time) : 0;
    let grabOffsetMin = 0;
    if (block && mode === "pending-block") {
      const geo = geometryOf(iso);
      if (geo) grabOffsetMin = pxToMinutes(e.clientY - geo.top, hourPx) - originStartMin;
    }
    state.current = {
      mode, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, iso, block, edge,
      originStartMin,
      originEndMin: block ? timeToMinutes(block.end_time) : 0,
      originDate: block ? block.date : iso,
      originScrollTop: container ? container.scrollTop : 0,
      curStartMin: originStartMin,
      curEndMin: block ? timeToMinutes(block.end_time) : 0,
      curDate: block ? block.date : iso,
      hoverTargetId: null, hoverSince: null, willNest: false, willDetach: false,
      parentAtStart: block?.parent_block_id != null ? (blocksById.current.get(block.parent_block_id) ?? null) : null,
      grabOffsetMin,
    };
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerUp);
  }

  const onBackgroundPointerDown = useCallback((e: React.PointerEvent, iso: string) => {
    if (e.button !== 0) return;
    beginGesture(e, "pending-bg", iso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onWindowPointerMove, onWindowPointerUp]);

  const onBlockPointerDown = useCallback((e: React.PointerEvent, block: CalBlock, iso: string) => {
    if (e.button !== 0) return;
    if (!isDraggable(block)) {
      // Non-draggable (virtual recurring) block: no gesture starts, but any
      // `wasDragRef` left over TRUE from an unrelated drag elsewhere must
      // still be cleared here. That flag is only ever consumed by a block's
      // own onClick (see consumeWasDrag's caller in TimeColumn) — if the
      // PRECEDING drag ended far from where it started, the browser never
      // fires a click on that original block at all (mousedown/mouseup
      // targets differ), so nothing ever reads the flag back to false. Left
      // uncleared, it would wrongly swallow the very next click on ANY
      // block — including this recurring one, whose pointerdown used to be
      // a complete no-op — making it silently fail to open once.
      wasDragRef.current = false;
      return;
    }
    beginGesture(e, "pending-block", iso, block);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onWindowPointerMove, onWindowPointerUp, isDraggable]);

  const onResizePointerDown = useCallback((e: React.PointerEvent, block: CalBlock, edge: "top" | "bottom", iso: string) => {
    if (e.button !== 0 || !isDraggable(block)) return;
    beginGesture(e, "pending-resize", iso, block, edge);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onWindowPointerMove, onWindowPointerUp, isDraggable]);

  // U3 Part A's entry point — deliberately NOT routed through `beginGesture`
  // above: that helper's signature (iso, block?, edge?) is shaped around a
  // gesture that starts ON a grid element, and an external drag starts
  // outside the grid's DOM entirely (a RightPanel row, an all-day chip) with
  // no iso/block to give it yet — both are discovered on the first move that
  // lands over a registered column (`columnUnderPointer`, above).
  function beginExternalGesture(e: React.PointerEvent, payload: ExternalDragPayload) {
    wasDragRef.current = false;
    state.current = {
      mode: "pending-external",
      pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY,
      iso: "", // unknown until a column is hovered
      originStartMin: 0, originEndMin: 0, originDate: "",
      originScrollTop: 0,
      curStartMin: 0, curEndMin: 0,
      // "" is the sentinel `onWindowPointerUp` reads as "never entered a
      // valid grid column this gesture" — see its "placing" branch.
      curDate: "",
      hoverTargetId: null, hoverSince: null, willNest: false, willDetach: false,
      parentAtStart: null,
      grabOffsetMin: 0,
      externalPayload: payload,
    };
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerUp);
  }

  const onExternalDragPointerDown = useCallback((e: React.PointerEvent, payload: ExternalDragPayload) => {
    if (e.button !== 0) return;
    beginExternalGesture(e, payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onWindowPointerMove, onWindowPointerUp]);

  const consumeWasDrag = useCallback(() => {
    const v = wasDragRef.current;
    wasDragRef.current = false;
    return v;
  }, []);

  const isDropTarget = useCallback((blockId: number) => dropTargetId === blockId, [dropTargetId]);

  const interactions: WeekInteractions = {
    registerColumn, onBackgroundPointerDown, onBlockPointerDown, onResizePointerDown,
    onExternalDragPointerDown,
    consumeWasDrag, isDraggable, isDropTarget, draggingId, externalDraggingTaskId,
    subscribeGhost, getGhostSnapshot, subscribeExternalGhost, getExternalGhostSnapshot,
  };

  return { interactions };
}

/** Standalone (module-scope, stable identity) so re-invoking the hook above
 *  on every Week.tsx render never remounts this — only its internal
 *  useSyncExternalStore subscription re-renders, on ghost updates alone. */
export function DragGhostLayer({ subscribe, getSnapshot }: {
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => GhostSnapshot | null;
}) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!snap) return null;
  const clr = BLOCK_COLORS[snap.color] ?? BLOCK_COLORS.blue;
  return (
    <div
      style={{ position: "fixed", top: snap.top, left: snap.left, width: snap.width, height: snap.height, zIndex: 9998 }}
      className={cn(
        "pointer-events-none rounded border-2 border-dashed px-1.5 py-0.5 shadow-lg overflow-hidden",
        clr.bg, clr.border, snap.willNest && "ring-2 ring-primary",
      )}
    >
      <p className={cn("text-[11px] font-semibold leading-tight", clr.text)}>{snap.label}</p>
      {snap.willNest && snap.targetTitle && (
        <p className={cn("text-[10px] leading-tight opacity-80 truncate", clr.text)}>→ inside {snap.targetTitle}</p>
      )}
      {snap.willDetach && <p className={cn("text-[10px] leading-tight opacity-80", clr.text)}>detach</p>}
    </div>
  );
}

/** U3 Part A's ghost — standalone for the same reason as `DragGhostLayer`
 *  above. Renders up to two pieces: a snapped block-shaped drop preview
 *  (only while hovering a real grid column) and a floating title+duration
 *  badge that follows the raw pointer at all times, including off the grid
 *  — "drag a task and see where it's going to land, wherever the pointer
 *  currently is" (spec: "show a ghost near the pointer"). Always styled
 *  `blue` — the create-modal's own default color for a new block, and this
 *  ghost previews a block that doesn't exist yet, so there's no block color
 *  of its own to read. */
export function ExternalDragGhostLayer({ subscribe, getSnapshot }: {
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => ExternalGhostSnapshot | null;
}) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!snap) return null;
  const clr = BLOCK_COLORS.blue;
  return (
    <>
      {snap.grid && (
        <div
          style={{ position: "fixed", top: snap.grid.top, left: snap.grid.left, width: snap.grid.width, height: snap.grid.height, zIndex: 9997 }}
          className={cn(
            "pointer-events-none rounded border-2 border-dashed px-1.5 py-0.5 shadow-lg overflow-hidden",
            clr.bg, clr.border, snap.willNest && "ring-2 ring-primary",
          )}
        >
          <p className={cn("text-[11px] font-semibold leading-tight truncate", clr.text)}>{snap.title}</p>
          <p className={cn("text-[10px] leading-tight opacity-80", clr.text)}>{snap.detail}</p>
          {snap.willNest && snap.targetTitle && (
            <p className={cn("text-[10px] leading-tight opacity-80 truncate", clr.text)}>→ inside {snap.targetTitle}</p>
          )}
        </div>
      )}
      <div
        style={{ position: "fixed", top: snap.y + 14, left: snap.x + 14, zIndex: 9999 }}
        className="pointer-events-none max-w-[200px] rounded-md border border-border bg-card px-2 py-1 shadow-xl"
      >
        <p className="truncate text-[11px] font-semibold leading-tight text-foreground">{snap.title}</p>
        {/* Duration only shown here while off the grid — once a column is
            hovered the drop preview above already shows the snapped range,
            and repeating it in the floating badge would just be noise. */}
        {!snap.grid && <p className="text-[10px] leading-tight text-muted-foreground">{snap.detail}</p>}
      </div>
    </>
  );
}
