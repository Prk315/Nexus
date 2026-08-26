// Handle-initiated drag-to-reorder for one sibling group of task rows —
// shared by the dashboard's StepRow tree and the workspace board's expanded
// child rows. Hand-rolled on the week grid's pointer-state-machine idiom
// rather than dnd-kit: @dnd-kit/sortable isn't available in this workspace,
// and a pointer drag scoped to a grip handle sidesteps the nested-DndContext
// problem on TaskBoard (whose root rows already live inside a DndContext for
// bucket drops) while keeping every other click target on the row untouched.
//
// One hook instance per sibling group (a parent's direct children) — the
// spec is reorder-within-parent only, so scoping the gesture to the group
// makes cross-parent moves structurally impossible rather than merely
// rejected. All insertion math is pure and tested in lib/reorderDrag.ts.
//
// Gesture contract: pointerdown on the grip arms it; 4px of movement makes
// it a drag (below that, nothing happens — the grip has no click action
// anyway); while dragging, the source row dims and an insertion line renders
// in the hovered gap; Escape / window blur / pointercancel cancels;
// pointerup commits `onCommit(fullOrderedSiblingIds)` only when the order
// actually changed.

import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "../../lib/utils";
import { insertionIndexFromPointer, reorderedIds } from "../../lib/reorderDrag";

const REORDER_THRESHOLD_PX = 4;

export interface RowReorder {
  /** Ref callback for the wrapper element of the sibling at `id`. */
  registerRow: (id: number) => (el: HTMLElement | null) => void;
  /** Pointerdown handler for the sibling's grip handle. */
  handlePointerDown: (id: number) => (e: React.PointerEvent) => void;
  /** The sibling currently being dragged (dim it), or null. */
  draggingId: number | null;
  /** Insertion slot 0..ids.length while dragging, else null — render
   *  a `<ReorderIndicator/>` before the row at that index (or after the
   *  last row for slot ids.length). */
  insertion: number | null;
}

export function useRowReorder(
  ids: number[],
  onCommit: (orderedSiblingIds: number[]) => void,
): RowReorder {
  const rows = useRef<Map<number, HTMLElement>>(new Map());
  const refCallbacks = useRef<Map<number, (el: HTMLElement | null) => void>>(new Map());

  // Live copies for the window-level listeners (which outlive any one render).
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [insertion, setInsertion] = useState<number | null>(null);

  // The armed/active gesture — a ref, not state, so the 60fps pointermove
  // stream doesn't re-render anything until the insertion slot changes.
  const gesture = useRef<{
    id: number;
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
    slot: number | null;
  } | null>(null);

  const endGesture = useCallback(() => {
    gesture.current = null;
    setDraggingId(null);
    setInsertion(null);
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
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;

    if (!g.dragging) {
      if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < REORDER_THRESHOLD_PX) return;
      g.dragging = true;
      setDraggingId(g.id);
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    }

    // Measure the sibling wrappers fresh each move — cheap at group sizes
    // (a handful of rows) and immune to the expanded-subtree height changes
    // a cached snapshot would go stale on.
    const rects = idsRef.current.map((id) => {
      const el = rows.current.get(id);
      if (!el) return { top: Number.MAX_SAFE_INTEGER, height: 0 };
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height };
    });
    const slot = insertionIndexFromPointer(e.clientY, rects);
    if (slot !== g.slot) {
      g.slot = slot;
      setInsertion(slot);
    }
  }, []);

  const onUp = useCallback((e: PointerEvent) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    if (g.dragging && g.slot != null) {
      const from = idsRef.current.indexOf(g.id);
      const next = reorderedIds(idsRef.current, from, g.slot);
      if (next) onCommitRef.current(next);
    }
    endGesture();
  }, [endGesture]);

  const onCancel = useCallback(() => {
    if (gesture.current) endGesture();
  }, [endGesture]);

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && gesture.current) endGesture();
  }, [endGesture]);

  // Unmount mid-drag: the listeners above are only removed via a live
  // pointer/key event — clean up if the group disappears under the gesture.
  useEffect(() => () => { if (gesture.current) endGesture(); }, [endGesture]);

  const registerRow = useCallback((id: number) => {
    let cb = refCallbacks.current.get(id);
    if (!cb) {
      cb = (el: HTMLElement | null) => {
        if (el) rows.current.set(id, el);
        else rows.current.delete(id);
      };
      refCallbacks.current.set(id, cb);
    }
    return cb;
  }, []);

  const handlePointerDown = useCallback((id: number) => (e: React.PointerEvent) => {
    if (e.button !== 0 || gesture.current) return;
    // The grip is its own target — stop the row's other pointerdown
    // consumers (the dashboard's drag-to-calendar arms on the row body).
    e.stopPropagation();
    e.preventDefault();
    gesture.current = {
      id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      dragging: false, slot: null,
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onCancel);
  }, [onMove, onUp, onCancel, onKey]);

  return { registerRow, handlePointerDown, draggingId, insertion };
}

/** The grip. Hover-reveal is the caller's business (wrap in its row's
 *  group-hover opacity classes); this only owns the cursor + hit target. */
export function GripHandle({ onPointerDown, className }: {
  onPointerDown: (e: React.PointerEvent) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title="Drag to reorder"
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "shrink-0 flex items-center justify-center rounded p-0.5 cursor-grab active:cursor-grabbing touch-none",
        "text-muted-foreground/40 hover:text-foreground hover:bg-secondary transition-colors",
        className,
      )}
    >
      <GripVertical className="h-3 w-3" />
    </button>
  );
}

/** The insertion line — zero-height so revealing it never shifts the rows
 *  it sits between (the week ghost idiom: overlay, don't reflow). */
export function ReorderIndicator() {
  return (
    <div className="relative h-0 pointer-events-none z-10">
      <div className="absolute inset-x-1 -top-px h-0.5 rounded-full bg-primary" />
    </div>
  );
}
