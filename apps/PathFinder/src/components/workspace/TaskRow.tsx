import { useEffect, useRef, useState } from "react";
import {
  Check, Pencil, X, CalendarDays, ChevronUp, ChevronDown, ChevronRight, Clock,
  ListTree, CalendarClock, Lock,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { PriorityDot } from "../PriorityDot";
import { UrgencyMeter } from "../UrgencyMeter";
import { cn, daysUntil, deadlineLabel, deadlineVariant } from "../../lib/utils";
import { formatMinutes, isFullTask, planningOf } from "../../lib/taskTree";
import { memberName, type TeamMember } from "../../lib/api";
import { TaskActionMenu, InlineEditText, contextMenuOpener, GripHandle, type TaskActionCallbacks } from "../common";
import type { TaskWithContext } from "../../types";

export interface ReorderControls {
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
}

/** Who a team task is for, and how to change it — only meaningful when `task.team_id` is set. */
export interface AssignmentControl {
  members: TeamMember[];
  value: string | null; // null = unassigned, "all" = everyone, else a member's uid
  onChange: (value: string | null) => void;
}

/**
 * What the row knows about a task's plan, when the board has computed it.
 * Optional so the drag overlay can render a bare task with no extra queries.
 */
export interface RowPlanning {
  /** Direct subtasks, and how many are complete. */
  subtaskCount: number;
  doneSubtasks: number;
  /** Effort rolled up from the breakdown. */
  estimateMin: number;
  /** Committed calendar minutes across the subtree. */
  scheduledMin: number;
  /** False when the task has no calendar time and so cannot be started. */
  workable: boolean;
}

/** Quick-schedule/due actions surfaced in the row's kebab menu — omitted items simply don't render (TaskActionMenu's own contract). */
export type RowQuickActions = Pick<
  TaskActionCallbacks,
  "onScheduleToday" | "onScheduleTomorrow" | "onDueToday" | "onDueTomorrow" | "onError"
>;

/** The delay before a single click on the title opens the planner — long enough for a second click of a double-click to arrive and cancel it. */
const TITLE_CLICK_OPEN_DELAY_MS = 220;

export function TaskRow({
  task, showContext = true, planning, reorder, assignment, onToggle, onEdit, onDelete, onReschedule,
  onRename, quickActions, depth = 0, expandable, dragHandle,
}: {
  task: TaskWithContext;
  showContext?: boolean;
  planning?: RowPlanning;
  reorder?: ReorderControls;
  assignment?: AssignmentControl;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReschedule: () => void;
  /** Commits an inline rename (double-click the title, or the kebab's "Rename"). Omit to disable renaming — e.g. the drag overlay's bare row. */
  onRename?: (title: string) => void;
  /** Present → the row gets a kebab (hover) and right-click menu with these items, Rename and Open (both wired to `onRename`/`onEdit` internally), and Delete (wired to `onDelete`). */
  quickActions?: RowQuickActions;
  /** Indentation level for a nested child row rendered under an expanded parent (0 = a normal board row). */
  depth?: number;
  /** Present when this task has children the board can expand inline. */
  expandable?: { expanded: boolean; onToggle: () => void };
  /** Pointerdown for a hover-revealed drag-to-reorder grip (child rows under
   *  an expanded parent — see ChildRows in TaskBoard). Absent on board-root
   *  rows, whose whole-row drag belongs to the bucket DndContext. */
  dragHandle?: (e: React.PointerEvent) => void;
}) {
  const days = task.due_date ? daysUntil(task.due_date) : null;
  const context = task.plan_title ?? (task.goal_title ? `→ ${task.goal_title}` : null);
  const hasBreakdown = (planning?.subtaskCount ?? 0) > 0;
  // Sparse kinds have no planning row, no lifecycle and nothing to schedule —
  // showing them an urgency meter and a scheduling lock would be noise on a row
  // that means "buy milk".
  const full = isFullTask(task);
  // Prefer the board's freshly-rolled-up figure (it reflects optimistic edits);
  // fall back to the trigger-maintained column when the tree wasn't loaded.
  const effortMin = planning?.estimateMin ?? task.aggregate_estimate ?? task.time_estimate ?? 0;

  // A broken-down task is completed by finishing its steps, not by ticking the
  // parent — the checkbox would otherwise disagree with the roll-up.
  const checkboxDisabled = hasBreakdown && !task.done;

  // ── Inline rename + click-to-open ────────────────────────────────────────
  // A single click on the title opens the planner; a double-click renames.
  // Both are native DOM events on the same span, so a double-click fires a
  // single click first — the timer below gives the second click a window to
  // arrive and cancel the pending open before it runs.
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const openTimer = useRef<number | null>(null);

  useEffect(() => () => { if (openTimer.current != null) window.clearTimeout(openTimer.current); }, []);

  const cancelPendingOpen = () => {
    if (openTimer.current != null) { window.clearTimeout(openTimer.current); openTimer.current = null; }
  };
  const handleTitleClick = (e: React.MouseEvent) => {
    if (e.detail > 1) return; // the second click of a double-click — dblclick handles it
    cancelPendingOpen();
    openTimer.current = window.setTimeout(() => { onEdit(); openTimer.current = null; }, TITLE_CLICK_OPEN_DELAY_MS);
  };

  // Gated on rename/quick-actions rather than always-on: the drag overlay's
  // bare ghost row passes neither, and a kebab offering only "Delete" (which
  // already has its own dedicated button) would be a dead-looking control on
  // a row that's mid-drag anyway.
  const showKebab = Boolean(quickActions || onRename);

  return (
    <div
      style={depth > 0 ? { marginLeft: depth * 18 } : undefined}
      onContextMenu={showKebab ? contextMenuOpener(setMenuOpen) : undefined}
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 group hover:bg-secondary/50 transition-colors"
    >
      {dragHandle && (
        <GripHandle
          onPointerDown={dragHandle}
          className="-ml-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        />
      )}
      <button
        onClick={onToggle}
        disabled={checkboxDisabled}
        title={checkboxDisabled ? "Finish its steps to complete this" : undefined}
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
          task.done ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary",
          checkboxDisabled && "opacity-50 cursor-default hover:border-border",
        )}
      >
        {task.done && <Check className="h-2.5 w-2.5" />}
      </button>

      {/* The two axes: colour for importance, fill-count for urgency. */}
      <PriorityDot priority={task.priority} />
      {full && <UrgencyMeter urgency={planningOf(task).urgency} />}

      {onRename ? (
        <span onClick={handleTitleClick} onDoubleClick={cancelPendingOpen} className="min-w-0">
          <InlineEditText
            value={task.title}
            onCommit={onRename}
            editing={renaming}
            onEditingChange={setRenaming}
            className={cn("text-sm truncate", task.done && "line-through text-muted-foreground")}
          />
        </span>
      ) : (
        <span className={cn("text-sm truncate", task.done && "line-through text-muted-foreground")}>
          {task.title}
        </span>
      )}

      {hasBreakdown && (
        <>
          {expandable && (
            <button
              onClick={(e) => { e.stopPropagation(); expandable.onToggle(); }}
              title={expandable.expanded ? "Collapse steps" : "Expand steps"}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            >
              {expandable.expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          )}
          <span
            className="inline-flex items-center gap-0.5 shrink-0 text-[10px] text-muted-foreground tabular-nums"
            title={`${planning!.doneSubtasks} of ${planning!.subtaskCount} steps done`}
          >
            <ListTree className="h-2.5 w-2.5" />
            {planning!.doneSubtasks}/{planning!.subtaskCount}
          </span>
        </>
      )}

      {/* Assignment — only a team task has anyone to assign, so the select
          itself is the "is this a team task" tell. Native <select> to match
          every other inline picker on this row/board rather than inventing a
          bespoke dropdown for one field. */}
      {task.team_id != null && assignment && (
        <select
          value={assignment.value ?? ""}
          onChange={(e) => assignment.onChange(e.target.value === "" ? null : e.target.value)}
          onClick={(e) => e.stopPropagation()}
          title="Assigned to"
          className="h-5 shrink-0 rounded border border-border/60 bg-transparent px-1 text-[10px] text-muted-foreground hover:border-border hover:text-foreground focus-visible:outline-none"
        >
          <option value="">Unassigned</option>
          <option value="all">All</option>
          {assignment.members.map((m) => (
            <option key={m.userId} value={m.userId}>{m.displayName}</option>
          ))}
        </select>
      )}
      {/* Read-only fallback — a plain indicator when nothing wired up an
          onChange (e.g. the drag overlay's bare row). */}
      {task.team_id != null && !assignment && (
        <span className="text-[10px] text-muted-foreground/70 shrink-0">
          {task.assigned_to == null ? "Unassigned" : task.assigned_to === "all" ? "All" : memberName(task.assigned_to)}
        </span>
      )}

      {showContext && context && (
        <span className="text-xs text-muted-foreground/70 truncate shrink-0 max-w-[120px] hidden sm:inline">
          {context}
        </span>
      )}

      <div className="flex-1" />

      {/* Scheduling coverage — the signal that a task is ready to be worked on. */}
      {full && planning && !task.done && (
        planning.scheduledMin > 0 ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[10px] shrink-0 tabular-nums",
              planning.scheduledMin >= planning.estimateMin ? "text-emerald-500" : "text-amber-500",
            )}
            title={`${formatMinutes(planning.scheduledMin)} of ${formatMinutes(planning.estimateMin)} scheduled`}
          >
            <CalendarClock className="h-2.5 w-2.5" />
            {formatMinutes(planning.scheduledMin)}
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-0.5 text-[10px] shrink-0 text-muted-foreground/40"
            title="No calendar time committed — schedule it before starting"
          >
            <Lock className="h-2.5 w-2.5" />
          </span>
        )
      )}

      {/*
        Effort. For a broken-down task this is the *aggregate* — the sum of its
        steps — not its own stale standalone guess. Zero means genuinely
        unestimated and is left blank rather than rendered as "0m".
      */}
      {effortMin > 0 && (
        <span
          className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0"
          title={hasBreakdown ? "Total effort, summed from the breakdown" : "Time required"}
        >
          <Clock className="h-2.5 w-2.5" />{formatMinutes(effortMin)}
        </span>
      )}

      {days !== null && (
        <Badge variant={deadlineVariant(days)} className="shrink-0 text-xs">
          {deadlineLabel(days)}
        </Badge>
      )}

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {reorder && (
          <div className="flex flex-col -my-1">
            <button
              onClick={reorder.onUp}
              disabled={!reorder.canUp}
              title="Move up"
              className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:hover:bg-transparent"
            >
              <ChevronUp className="h-3 w-3" />
            </button>
            <button
              onClick={reorder.onDown}
              disabled={!reorder.canDown}
              title="Move down"
              className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:hover:bg-transparent"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
        )}
        <button onClick={onReschedule} title="Reschedule" className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-primary">
          <CalendarDays className="h-3 w-3" />
        </button>
        <button onClick={onEdit} title="Plan this task" className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground">
          <Pencil className="h-3 w-3" />
        </button>
        <button onClick={onDelete} title="Delete" className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-destructive">
          <X className="h-3 w-3" />
        </button>
        {showKebab && (
          <TaskActionMenu
            task={task}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            className="h-5 w-5"
            callbacks={{
              ...quickActions,
              onRename: onRename ? () => setRenaming(true) : undefined,
              onOpen: onEdit,
              onDelete,
            }}
          />
        )}
      </div>
    </div>
  );
}
