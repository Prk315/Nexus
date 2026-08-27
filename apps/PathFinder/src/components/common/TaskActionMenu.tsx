// The shared task quick-action menu: schedule/due-date shortcuts, rename,
// open, delete. One implementation so every task surface (Dashboard,
// Workspace, Week) gets the same actions instead of each row growing its own
// bespoke button cluster.
//
// Every item is opt-in via `callbacks` — a row that has no delete affordance
// (e.g. a read-only context) simply omits `onDelete` and the item doesn't
// render. `onScheduleToday`/`onScheduleTomorrow`/`onDueToday`/`onDueTomorrow`
// double as BOTH "does this item render" and "what do I do after the
// orchestrator succeeds" (the menu calls `scheduleTaskOn`/`setTaskDue`
// itself — the caller doesn't have to import quickActions.ts at all, only
// react to the result, typically by refetching).

import { useState } from "react";
import type { MouseEvent } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CalendarClock, CalendarPlus, ExternalLink, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { scheduleTaskOn, setTaskDue } from "../../lib/api/quickActions";
import type { QuickScheduleTask } from "../../lib/api/quickActions";

export type { QuickScheduleDay } from "../../lib/api/quickActions";

/** The subset of a task TaskActionMenu needs — any real Task/TaskWithContext satisfies this structurally. */
export type TaskActionTask = QuickScheduleTask;

export interface TaskActionCallbacks {
  /** Present → renders "Schedule today". Called with the created block after scheduleTaskOn succeeds. */
  onScheduleToday?: (day: "today") => void;
  /** Present → renders "Schedule tomorrow". */
  onScheduleTomorrow?: (day: "tomorrow") => void;
  /** Present → renders "Due today". Called after setTaskDue succeeds. */
  onDueToday?: (day: "today") => void;
  /** Present → renders "Due tomorrow". */
  onDueTomorrow?: (day: "tomorrow") => void;
  /** Present → renders "Rename". The row wires this to activate its own InlineEditText. */
  onRename?: () => void;
  /** Present → renders "Open" (inspector/planner navigation). */
  onOpen?: () => void;
  /** Present → renders "Delete" (destructive styling). */
  onDelete?: () => void | Promise<void>;
  /** Surfaces a user-readable failure from an async item (e.g. "no free slot"). */
  onError?: (message: string) => void;
}

export interface TaskActionMenuProps {
  task: TaskActionTask;
  callbacks: TaskActionCallbacks;
  /**
   * Controlled open state. Pass both this and `onOpenChange` to drive the
   * menu from outside (see `contextMenuOpener` below) — omit both for a
   * plain kebab trigger with its own internal state.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Extra classes on the kebab trigger button. */
  className?: string;
}

const ITEM_CLASS = cn(
  "relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5",
  "text-xs text-foreground outline-none",
  "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
);

const DESTRUCTIVE_ITEM_CLASS = cn(
  "relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5",
  "text-xs text-destructive outline-none",
  "hover:bg-destructive/10 focus:bg-destructive/10",
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
);

/**
 * Wires a row's `onContextMenu` (right-click) to open this SAME dropdown, in
 * controlled mode.
 *
 * This is deliberately NOT a cursor-anchored context menu — true pointer
 * positioning needs Radix's separate `@radix-ui/react-context-menu`
 * primitive, which isn't a dependency here, and pulling it in for one row
 * action would mean two menu implementations (two sets of item styling, two
 * a11y trees) for what is otherwise the identical list of actions. Right-click
 * instead opens the ordinary popper-anchored dropdown — anchored to the
 * kebab trigger's position, not the pointer's — which is a real, fully
 * keyboard-navigable menu. Wire it like:
 *
 *   const [menuOpen, setMenuOpen] = useState(false);
 *   <div onContextMenu={contextMenuOpener(setMenuOpen)}>
 *     <TaskActionMenu task={t} callbacks={cb} open={menuOpen} onOpenChange={setMenuOpen} />
 *   </div>
 */
export function contextMenuOpener(setOpen: (open: boolean) => void) {
  return (e: MouseEvent) => {
    e.preventDefault();
    setOpen(true);
  };
}

export function TaskActionMenu({ task, callbacks, open, onOpenChange, className }: TaskActionMenuProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const isControlled = open !== undefined;
  const menuOpen = isControlled ? open : internalOpen;
  const setMenuOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const runAsync = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      callbacks.onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  };

  const showSchedule = Boolean(callbacks.onScheduleToday || callbacks.onScheduleTomorrow);
  const showDue = Boolean(callbacks.onDueToday || callbacks.onDueTomorrow);
  const showRenameOrOpen = Boolean(callbacks.onRename || callbacks.onOpen);
  const showDelete = Boolean(callbacks.onDelete);

  if (!showSchedule && !showDue && !showRenameOrOpen && !showDelete) return null;

  return (
    <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title="Task actions"
          className={cn("h-6 w-6 shrink-0", className)}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "z-50 min-w-[180px] rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-1",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            "data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          {showSchedule && (
            <>
              {callbacks.onScheduleToday && (
                <DropdownMenu.Item
                  disabled={busy}
                  className={ITEM_CLASS}
                  onSelect={(e) => {
                    e.preventDefault();
                    void runAsync(async () => {
                      await scheduleTaskOn(task, "today");
                      callbacks.onScheduleToday?.("today");
                    });
                  }}
                >
                  <CalendarClock className="h-3.5 w-3.5" /> Schedule today
                </DropdownMenu.Item>
              )}
              {callbacks.onScheduleTomorrow && (
                <DropdownMenu.Item
                  disabled={busy}
                  className={ITEM_CLASS}
                  onSelect={(e) => {
                    e.preventDefault();
                    void runAsync(async () => {
                      await scheduleTaskOn(task, "tomorrow");
                      callbacks.onScheduleTomorrow?.("tomorrow");
                    });
                  }}
                >
                  <CalendarClock className="h-3.5 w-3.5" /> Schedule tomorrow
                </DropdownMenu.Item>
              )}
            </>
          )}

          {showDue && (
            <>
              {showSchedule && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
              {callbacks.onDueToday && (
                <DropdownMenu.Item
                  disabled={busy}
                  className={ITEM_CLASS}
                  onSelect={(e) => {
                    e.preventDefault();
                    void runAsync(async () => {
                      await setTaskDue(task.id, "today");
                      callbacks.onDueToday?.("today");
                    });
                  }}
                >
                  <CalendarPlus className="h-3.5 w-3.5" /> Due today
                </DropdownMenu.Item>
              )}
              {callbacks.onDueTomorrow && (
                <DropdownMenu.Item
                  disabled={busy}
                  className={ITEM_CLASS}
                  onSelect={(e) => {
                    e.preventDefault();
                    void runAsync(async () => {
                      await setTaskDue(task.id, "tomorrow");
                      callbacks.onDueTomorrow?.("tomorrow");
                    });
                  }}
                >
                  <CalendarPlus className="h-3.5 w-3.5" /> Due tomorrow
                </DropdownMenu.Item>
              )}
            </>
          )}

          {showRenameOrOpen && (
            <>
              {(showSchedule || showDue) && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
              {callbacks.onRename && (
                <DropdownMenu.Item
                  disabled={busy}
                  className={ITEM_CLASS}
                  onSelect={() => callbacks.onRename?.()}
                >
                  <Pencil className="h-3.5 w-3.5" /> Rename
                </DropdownMenu.Item>
              )}
              {callbacks.onOpen && (
                <DropdownMenu.Item
                  disabled={busy}
                  className={ITEM_CLASS}
                  onSelect={() => callbacks.onOpen?.()}
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </DropdownMenu.Item>
              )}
            </>
          )}

          {showDelete && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item
                disabled={busy}
                className={DESTRUCTIVE_ITEM_CLASS}
                onSelect={() => { void callbacks.onDelete?.(); }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
