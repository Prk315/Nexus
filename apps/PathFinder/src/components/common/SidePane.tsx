// Drag-resizable, collapsible side panes — one implementation for every
// sidebar in the app (the main nav, Workspace's navigator + systems rail, the
// Team page's navigator).
//
// The Dashboard's day-calendar rail predates this and keeps its own copy; it is
// the same gesture (window listeners, width read from the pointer's distance to
// the pane's outer edge) and could move onto this hook later.

import { useCallback, useRef, useState, type ComponentType, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { paneWidthFromPointer, parseStoredWidth } from "../../lib/paneLayout";

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* private mode: layout just doesn't persist */ }
}

export interface PaneWidthOpts { min: number; max: number; initial: number }

/**
 * A persisted pane width plus the pointerdown handler that drags it.
 *
 * Nothing is written to storage until pointerup — one write per gesture, not
 * sixty a second. Double-click resets (wired by the caller onto the handle).
 */
export function usePaneWidth(storageKey: string, side: "left" | "right", { min, max, initial }: PaneWidthOpts) {
  const [width, setWidth] = useState(() => parseStoredWidth(read(storageKey), min, max, initial));
  const paneRef = useRef<HTMLElement | null>(null);

  const startResize = useCallback((e: React.PointerEvent) => {
    const el = paneRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    // The OUTER edge stays put while dragging; the inner edge follows the pointer.
    const outer = side === "left" ? rect.left : rect.right;
    let last = rect.width;
    const onMove = (ev: PointerEvent) => {
      last = paneWidthFromPointer(side, outer, ev.clientX, min, max);
      setWidth(last);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      write(storageKey, String(Math.round(last)));
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [storageKey, side, min, max]);

  const reset = useCallback(() => { setWidth(initial); write(storageKey, String(initial)); }, [storageKey, initial]);

  return { width, paneRef, startResize, reset };
}

/** The 12px grab zone around a hairline, on a pane's inner edge. */
export function ResizeHandle({ onPointerDown, onDoubleClick, side, className }: {
  onPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick?: () => void;
  side: "left" | "right";
  className?: string;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      title="Drag to resize · double-click to reset"
      className={cn(
        "absolute top-0 bottom-0 z-20 w-3 cursor-col-resize touch-none group/resize flex justify-center",
        side === "left" ? "-right-1.5" : "-left-1.5",
        className,
      )}
    >
      <div className="w-px h-full bg-transparent transition-colors group-hover/resize:bg-primary group-active/resize:bg-primary" />
    </div>
  );
}

function readOpen(key: string): boolean {
  return read(key) !== "0";
}

/**
 * A side pane that can be dragged wider/narrower and collapsed to a slim strip.
 *
 * Collapsed, it leaves a 28px strip on ITS OWN edge carrying its icon and a
 * vertical label — the pane reopens from where it went, rather than from a
 * floating button parked over the content (which is what the Systems rail used
 * to do: its reopen button sat on top of the board's last rows).
 *
 * `children` receives `collapse` so a pane can offer its own close control in
 * its header.
 */
export function SidePane({ id, side, label, icon: Icon, min = 180, max = 480, initial, className, children }: {
  /** Storage namespace, e.g. "workspace-nav". */
  id: string;
  side: "left" | "right";
  label: string;
  icon: ComponentType<{ className?: string }>;
  min?: number;
  max?: number;
  initial: number;
  className?: string;
  children: (collapse: () => void) => ReactNode;
}) {
  const openKey = `pf-pane-${id}-open`;
  const [open, setOpen] = useState(() => readOpen(openKey));
  const { width, paneRef, startResize, reset } = usePaneWidth(`pf-pane-${id}-w`, side, { min, max, initial });

  const setOpenPersist = (v: boolean) => { setOpen(v); write(openKey, v ? "1" : "0"); };

  if (!open) {
    return (
      <button
        onClick={() => setOpenPersist(true)}
        title={`Show ${label}`}
        className={cn(
          "group/strip shrink-0 w-7 flex flex-col items-center gap-2 py-3 bg-card/40 text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors",
          side === "left" ? "border-r border-border" : "border-l border-border",
        )}
      >
        <Icon className="h-4 w-4" />
        <span className="text-[11px] font-medium tracking-wide [writing-mode:vertical-rl] rotate-180">{label}</span>
      </button>
    );
  }

  return (
    <aside
      ref={(el) => { paneRef.current = el; }}
      style={{ width }}
      className={cn(
        "relative shrink-0 min-h-0",
        side === "left" ? "border-r border-border" : "border-l border-border",
        className,
      )}
    >
      {children(() => setOpenPersist(false))}
      <ResizeHandle side={side} onPointerDown={startResize} onDoubleClick={reset} />
    </aside>
  );
}
