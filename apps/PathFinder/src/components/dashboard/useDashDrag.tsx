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

//
// Quick drags (849) — the same gesture has two more kinds of target, both
// registered through `zoneRef` and resolved by the pure rules in
// lib/dashDrop.ts:
//   - every OTHER plan card: drop → move the task to that plan;
//   - the drop tray that appears at the bottom of the screen while a drag is
//     live: Today / Tomorrow / Next week / No date / Done.
// The calendar wins if the pointer is over it; then the tray (it floats above
// everything); then the plan cards. A zone whose rule says "this drop changes
// nothing" (its own card, the date it already has, Done on a task with open
// steps) never lights up, so a drop that would do nothing never looks like
// it did something.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CalendarArrowUp, CalendarClock, CalendarX, CheckCircle2, Sun } from "lucide-react";
import { cn } from "../../lib/utils";
// The Week grid's duration heuristic — imported from week/_shared (pure,
// React-free), NOT from useWeekInteractions.
import { externalDragDurationMin } from "../week/_shared";
import type { TaskWithContext } from "../../types";
import {
  DC_COLORS, DC_HOUR_PX, dcMinToPx, dcMinToTime, dcSnapDropStartMin, formatMinutes,
} from "./_shared";
import {
  dropTrayZones, zoneAction,
  type DashDropTask, type DashZone, type DashZoneAction,
} from "../../lib/dashDrop";

const DASH_DRAG_THRESHOLD_PX = 4;

export interface DashDragPayload extends DashDropTask {
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
export function taskDragPayload(
  task: Pick<TaskWithContext, "id" | "title" | "time_estimate" | "plan_id" | "parent_id" | "done" | "due_date">,
  opts: { hasKids?: boolean } = {},
): DashDragPayload {
  return {
    taskId: task.id,
    title: task.title,
    durationMin: externalDragDurationMin(task.time_estimate ?? 0, task.time_estimate),
    planId: task.plan_id,
    isRoot: task.parent_id == null,
    done: task.done,
    dueDate: task.due_date,
    hasKids: opts.hasKids ?? false,
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
  /** The whole payload mid-drag (null when idle) — the drop tray reads it to
   *  dim chips that would do nothing for THIS task. */
  dragging: DashDragPayload | null;
  /** Ref callback registering an element as a quick-drop zone under `key`.
   *  Call it every render (it returns a cached callback per key and just
   *  refreshes the zone's data). */
  zoneRef: (key: string, zone: DashZone) => (el: HTMLElement | null) => void;
  /** The zone key the pointer is over AND whose drop would do something. */
  hoverZone: string | null;
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
  /** The quick-drop zone under the pointer, when its drop does something. */
  zone: { key: string; action: DashZoneAction } | null;
}

interface ZoneEntry { el: HTMLElement | null; zone: DashZone }

/** Is the point inside `el`'s box — and, when `el` sits in a scrolled
 *  container marked `data-dash-scroll`, inside that container's visible box
 *  too? A plan card scrolled out of view still has a rect (overlapping the
 *  welcome header above it), and a target the user can't see isn't one. */
function hit(el: HTMLElement, x: number, y: number): boolean {
  const r = el.getBoundingClientRect();
  if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return false;
  const clip = el.parentElement?.closest<HTMLElement>("[data-dash-scroll]");
  if (!clip) return true;
  const c = clip.getBoundingClientRect();
  return x >= c.left && x < c.right && y >= c.top && y < c.bottom;
}

function findZone(
  zones: Map<string, ZoneEntry>, x: number, y: number, payload: DashDragPayload,
): Internal["zone"] {
  // The tray floats above the page, so it is tested before the plan cards
  // that may lie underneath it.
  const entries = [...zones.entries()].sort(
    ([, a], [, b]) => Number(a.zone.kind === "plan") - Number(b.zone.kind === "plan"),
  );
  for (const [key, { el, zone }] of entries) {
    if (!el || !hit(el, x, y)) continue;
    const action = zoneAction(payload, zone);
    // The first box under the pointer decides: a no-op card must not let the
    // drop fall through to whatever is behind it.
    return action ? { key, action } : null;
  }
  return null;
}

export function useDashDrag({ onDrop, onZoneDrop }: {
  onDrop: (payload: DashDragPayload, dest: DashDropDest) => void;
  /** A drop on a quick zone (plan card / drop tray) whose rule allowed it. */
  onZoneDrop?: (payload: DashDragPayload, action: DashZoneAction) => void;
}) {
  const colRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const state = useRef<Internal | null>(null);
  const wasDragRef = useRef(false);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const onZoneDropRef = useRef(onZoneDrop);
  onZoneDropRef.current = onZoneDrop;

  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [dragging, setDragging] = useState<DashDragPayload | null>(null);
  const [hoverZone, setHoverZone] = useState<string | null>(null);

  // Zone registry. Ref callbacks are cached per key so React doesn't detach
  // and re-attach every zone on every render; the zone DATA (a card's label,
  // say) is refreshed on each `zoneRef` call instead.
  const zones = useRef<Map<string, ZoneEntry>>(new Map());
  const zoneCallbacks = useRef<Map<string, (el: HTMLElement | null) => void>>(new Map());
  const zoneRef = useCallback((key: string, zone: DashZone) => {
    const entry = zones.current.get(key);
    if (entry) entry.zone = zone;
    else zones.current.set(key, { el: null, zone });
    let cb = zoneCallbacks.current.get(key);
    if (!cb) {
      cb = (el: HTMLElement | null) => {
        const e = zones.current.get(key);
        if (e) e.el = el;
      };
      zoneCallbacks.current.set(key, cb);
    }
    return cb;
  }, []);


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
    setDragging(null);
    setHoverZone(null);
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
      setDragging(s.payload);
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
      const zone = findZone(zones.current, e.clientX, e.clientY, s.payload);
      if ((zone?.key ?? null) !== (s.zone?.key ?? null)) setHoverZone(zone?.key ?? null);
      s.zone = zone;
      setGhost({
        x: e.clientX, y: e.clientY,
        title: s.payload.title,
        // Over a quick zone the chip says what the drop will do.
        detail: zone ? zone.action.label : formatMinutes(dur),
        cal: null,
      });
      return;
    }

    if (s.zone) { s.zone = null; setHoverZone(null); }
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
    } else if (s.mode === "placing" && s.zone) {
      onZoneDropRef.current?.(s.payload, s.zone.action);
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
      payload, curStartMin: null, zone: null,
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

  const source: DashDragSource = {
    onTaskDragPointerDown, consumeWasDrag, draggingTaskId, dragging, zoneRef, hoverZone,
  };
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

const TRAY_ICONS: Record<string, typeof Sun> = {
  "due:today": Sun,
  "due:tomorrow": CalendarArrowUp,
  "due:next-week": CalendarClock,
  "due:none": CalendarX,
  done: CheckCircle2,
};

/**
 * The quick-drop tray: five chips that appear at the bottom of the screen
 * only while a task is being dragged, and vanish with the gesture. Fixed and
 * `pointer-events-none` — the gesture hit-tests by rect through window
 * listeners, so the tray never needs to receive an event, and it can never
 * swallow a click when no drag is live.
 *
 * A chip whose drop would do nothing for THIS task (its current due date,
 * Done on a task with open steps) renders dimmed and never lights up.
 */
export function DashDropTray({ drag, today }: { drag: DashDragSource; today: string }) {
  const payload = drag.dragging;
  if (!payload) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[9996] flex justify-center px-4"
      aria-hidden
    >
      <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-xl border border-border bg-popover/95 p-1.5 shadow-xl backdrop-blur">
        {dropTrayZones(today).map(({ key, zone }) => {
          const Icon = TRAY_ICONS[key] ?? CalendarClock;
          const live = zoneAction(payload, zone) != null;
          const hot = drag.hoverZone === key;
          return (
            <div
              key={key}
              ref={drag.zoneRef(key, zone)}
              className={cn(
                "flex min-w-[84px] flex-col items-center gap-0.5 rounded-lg border px-3 py-2 text-xs transition-colors",
                !live && "opacity-35",
                hot
                  ? zone.kind === "done"
                    ? "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "border-primary bg-primary/10 text-foreground"
                  : "border-dashed border-border text-muted-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {zone.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
