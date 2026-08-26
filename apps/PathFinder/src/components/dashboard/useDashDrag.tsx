// Drag-to-schedule for the dashboard: drag a task row (TodoList's
// DashTaskRow / StepRow, NowPanel's rows) onto the day-calendar rail to
// create a calendar block at the drop time.
//
// Modeled on useWeekInteractions' external-drag slice (same UX contract:
// 4px pointer threshold before anything becomes a drag, a floating
// title+duration chip following the pointer, a snapped block-shaped
// placement preview while over the calendar column, Escape / window blur /
// off-target release cancels) — but deliberately NOT importing the week
// hook itself: that hook carries the whole week grid's state machine
// (pan/move/resize/nest) and its column registry, and this page needs the
// ~100 focused lines of the external family only. The micro-store +
// useSyncExternalStore ghost pattern is reused verbatim so the 60fps
// pointermove stream re-renders exactly one leaf component.
//
// State machine (a ref, never React state):
//   idle --onTaskDragPointerDown (row body, left button, not on an
//          interactive child)--> pending
//   pending --moved < 4px, pointerup--> idle
//     (the browser's own click still reaches the row's handlers; sources
//      guard their click-to-open with consumeWasDrag, same contract as the
//      week grid's blocks.)
//   pending --moved >= 4px--> placing (ghost chip follows the pointer;
//     over the registered day-calendar column it also snaps a 5-min
//     placement preview sized to the payload's duration)
//   placing --pointerup over the column--> idle, onDrop(payload, dest)
//   placing --pointerup anywhere else--> idle, no commit
//   any --Escape / blur / pointercancel--> idle, no commit
//
// If the calendar rail is hidden or collapsed, DayCalendar is unmounted and
// nothing is registered — the gesture still runs (chip follows the pointer)
// but never finds a drop target, so release simply cancels. No error, by
// design.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "../../lib/utils";
// The Week grid's duration heuristic — imported from week/_shared (pure,
// React-free), NOT from useWeekInteractions.
import { externalDragDurationMin } from "../week/_shared";
import type { TaskWithContext } from "../../types";
import {
  DC_COLORS, DC_HOUR_PX, dcMinToPx, dcMinToTime, dcSnapDropStartMin, formatMinutes,
} from "./_shared";

const DASH_DRAG_THRESHOLD_PX = 4;

export interface DashDragPayload {
  taskId: number;
  title: string;
  /** Fixed for the whole gesture — resolved by the source row via
   *  `externalDragDurationMin` (week/_shared). */
  durationMin: number;
}

export interface DashDropDest {
  start: string; // "HH:MM"
  end: string;
}

/**
 * The payload a dashboard row hands the gesture. Duration comes from the
 * Week grid's heuristic, but where Week resolves true unscheduled minutes
 * from its coverage map, the dashboard holds no such map — for a task being
 * dragged onto today's calendar, "unscheduled minutes ≈ time_estimate" is
 * an acceptable stand-in, so the estimate feeds both arguments (the clamp
 * to 15–240min with a 30min default still applies either way).
 */
export function taskDragPayload(task: Pick<TaskWithContext, "id" | "title" | "time_estimate">): DashDragPayload {
  return {
    taskId: task.id,
    title: task.title,
    durationMin: externalDragDurationMin(task.time_estimate ?? 0, task.time_estimate),
  };
}

export interface DashGhostSnapshot {
  /** Raw pointer — the floating chip always follows this. */
  x: number; y: number;
  title: string;
  /** "45m" while off the calendar; "09:00–09:45" while the preview shows. */
  detail: string;
  /** The snapped placement preview, fixed-viewport coords — present only
   *  while hovering the registered day column. */
  cal: { top: number; left: number; width: number; height: number } | null;
}

/** What a drag SOURCE row needs — threaded to TodoList / NowPanel. */
export interface DashDragSource {
  onTaskDragPointerDown: (e: React.PointerEvent, payload: DashDragPayload) => void;
  /** True once, right after a real drag ended — lets a source row's
   *  click-to-open swallow the click the browser still fires after
   *  pointerup. Resets itself on read. */
  consumeWasDrag: () => boolean;
  /** The task mid-drag, so its source row can dim itself. */
  draggingTaskId: number | null;
}

/** What the drop TARGET needs — threaded to DayCalendar. */
export interface DashDropTarget {
  /** Register the day column (the tall event strip) and its scroll viewport
   *  (used to clip hit-testing to what's actually visible). Pass nulls on
   *  unmount. */
  registerCalendar: (col: HTMLElement | null, viewport: HTMLElement | null) => void;
}

interface Internal {
  mode: "pending" | "placing";
  pointerId: number;
  startX: number;
  startY: number;
  payload: DashDragPayload;
  /** Snapped start while over the column; null = not a valid drop. */
  curStartMin: number | null;
}

export function useDashDrag({ onDrop }: {
  onDrop: (payload: DashDragPayload, dest: DashDropDest) => void;
}) {
  const colRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const state = useRef<Internal | null>(null);
  const wasDragRef = useRef(false);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);

  // Ghost micro-store — the week hook's idiom.
  const listeners = useRef<Set<() => void>>(new Set());
  const snap = useRef<DashGhostSnapshot | null>(null);
  const setGhost = useCallback((g: DashGhostSnapshot | null) => {
    snap.current = g;
    listeners.current.forEach((fn) => fn());
  }, []);
  const subscribeGhost = useCallback((fn: () => void) => {
    listeners.current.add(fn);
    return () => { listeners.current.delete(fn); };
  }, []);
  const getGhostSnapshot = useCallback(() => snap.current, []);

  const registerCalendar = useCallback((col: HTMLElement | null, viewport: HTMLElement | null) => {
    colRef.current = col;
    viewportRef.current = viewport;
  }, []);

  const endGesture = useCallback(() => {
    state.current = null;
    setDraggingTaskId(null);
    setGhost(null);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("blur", onCancel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMove = useCallback((e: PointerEvent) => {
    const s = state.current;
    if (!s || e.pointerId !== s.pointerId) return;

    if (s.mode === "pending") {
      if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < DASH_DRAG_THRESHOLD_PX) return;
      s.mode = "placing";
      wasDragRef.current = true;
      setDraggingTaskId(s.payload.taskId);
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    }

    const dur = s.payload.durationMin;
    const col = colRef.current;
    const vp = viewportRef.current;

    // Over the calendar = inside the column's box AND inside the scroll
    // viewport's box — the tall column extends past what the rail actually
    // shows, and a "drop target" the user can't see isn't one.
    let over = false;
    let colRect: DOMRect | null = null;
    if (col && vp) {
      colRect = col.getBoundingClientRect();
      const vpRect = vp.getBoundingClientRect();
      over =
        e.clientX >= colRect.left && e.clientX < colRect.right &&
        e.clientY >= colRect.top && e.clientY < colRect.bottom &&
        e.clientX >= vpRect.left && e.clientX < vpRect.right &&
        e.clientY >= vpRect.top && e.clientY < vpRect.bottom;
    }

    if (!over || !colRect) {
      s.curStartMin = null;
      setGhost({
        x: e.clientX, y: e.clientY,
        title: s.payload.title,
        detail: formatMinutes(dur),
        cal: null,
      });
      return;
    }

    const startMin = dcSnapDropStartMin(e.clientY - colRect.top, dur);
    s.curStartMin = startMin;
    setGhost({
      x: e.clientX, y: e.clientY,
      title: s.payload.title,
      detail: `${dcMinToTime(startMin)}–${dcMinToTime(startMin + dur)}`,
      cal: {
        top: colRect.top + dcMinToPx(startMin),
        left: colRect.left,
        width: colRect.width,
        height: Math.max(12, (dur / 60) * DC_HOUR_PX),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setGhost]);

  const onUp = useCallback((e: PointerEvent) => {
    const s = state.current;
    if (!s || e.pointerId !== s.pointerId) return;
    if (s.mode === "placing" && s.curStartMin != null) {
      onDropRef.current(s.payload, {
        start: dcMinToTime(s.curStartMin),
        end: dcMinToTime(s.curStartMin + s.payload.durationMin),
      });
    }
    // pending under threshold: no-op — the row's own click still fires.
    endGesture();
  }, [endGesture]);

  const onCancel = useCallback(() => {
    if (state.current) endGesture();
  }, [endGesture]);

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && state.current) endGesture();
  }, [endGesture]);

  const onTaskDragPointerDown = useCallback((e: React.PointerEvent, payload: DashDragPayload) => {
    if (e.button !== 0 || state.current) return;
    // A stale `wasDrag` from a gesture that ended far from its source row
    // (no click ever fired there to consume it) must not swallow this
    // press's own click — clear it on every fresh pointerdown, the same fix
    // the week hook carries in onBlockPointerDown.
    wasDragRef.current = false;
    // Interactive children keep their own gestures: checkboxes, kebabs,
    // chevrons, inline-rename inputs, and the reorder grip (a button) must
    // never arm a calendar drag.
    const t = e.target as HTMLElement;
    if (t.closest("button, input, select, textarea, a, [data-no-drag]")) return;
    state.current = {
      mode: "pending", pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      payload, curStartMin: null,
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onCancel);
  }, [onMove, onUp, onCancel, onKey]);

  // Unmount mid-drag (navigating away): the window listeners are otherwise
  // only removed by a live pointer/key event — same guard the week hook has.
  useEffect(() => () => { if (state.current) endGesture(); }, [endGesture]);

  const consumeWasDrag = useCallback(() => {
    const v = wasDragRef.current;
    wasDragRef.current = false;
    return v;
  }, []);

  const source: DashDragSource = { onTaskDragPointerDown, consumeWasDrag, draggingTaskId };
  const target: DashDropTarget = { registerCalendar };

  return { source, target, subscribeGhost, getGhostSnapshot };
}

/** The ghost — standalone (module scope, stable identity) so only its own
 *  useSyncExternalStore subscription re-renders on pointer moves, exactly
 *  like the week grid's ExternalDragGhostLayer. Preview styled `blue`, the
 *  color the drop will commit with. */
export function DashDragGhostLayer({ subscribe, getSnapshot }: {
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => DashGhostSnapshot | null;
}) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!snap) return null;
  const clr = DC_COLORS.blue;
  return (
    <>
      {snap.cal && (
        <div
          style={{ position: "fixed", top: snap.cal.top, left: snap.cal.left, width: snap.cal.width, height: snap.cal.height, zIndex: 9997 }}
          className={cn(
            "pointer-events-none rounded border-2 border-dashed px-1 py-0.5 shadow-lg overflow-hidden",
            clr.bg, clr.border,
          )}
        >
          <p className={cn("text-[10px] font-semibold leading-tight truncate", clr.text)}>{snap.title}</p>
          <p className={cn("text-[9px] leading-tight opacity-80 tabular-nums", clr.text)}>{snap.detail}</p>
        </div>
      )}
      <div
        style={{ position: "fixed", top: snap.y + 14, left: snap.x + 14, zIndex: 9999 }}
        className="pointer-events-none max-w-[200px] rounded-md border border-border bg-card px-2 py-1 shadow-xl"
      >
        <p className="truncate text-[11px] font-semibold leading-tight text-foreground">{snap.title}</p>
        {/* Duration only while off the calendar — the preview already shows
            the snapped range once a column is hovered. */}
        {!snap.cal && <p className="text-[10px] leading-tight text-muted-foreground">{snap.detail}</p>}
      </div>
    </>
  );
}
