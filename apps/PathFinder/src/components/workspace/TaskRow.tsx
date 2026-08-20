import {
  Check, Pencil, X, CalendarDays, ChevronUp, ChevronDown, Clock,
  ListTree, CalendarClock, Lock,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { PriorityDot } from "../PriorityDot";
import { UrgencyMeter } from "../UrgencyMeter";
import { cn, daysUntil, deadlineLabel, deadlineVariant } from "../../lib/utils";
import { formatMinutes, isFullTask, planningOf } from "../../lib/taskTree";
import type { TaskWithContext } from "../../types";

export interface ReorderControls {
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
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

export function TaskRow({
  task, showContext = true, planning, reorder, onToggle, onEdit, onDelete, onReschedule,
}: {
  task: TaskWithContext;
  showContext?: boolean;
  planning?: RowPlanning;
  reorder?: ReorderControls;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReschedule: () => void;
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

  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 group hover:bg-secondary/50 transition-colors">
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

      <span className={cn("text-sm truncate", task.done && "line-through text-muted-foreground")}>
        {task.title}
      </span>

      {hasBreakdown && (
        <span
          className="inline-flex items-center gap-0.5 shrink-0 text-[10px] text-muted-foreground tabular-nums"
          title={`${planning!.doneSubtasks} of ${planning!.subtaskCount} steps done`}
        >
          <ListTree className="h-2.5 w-2.5" />
          {planning!.doneSubtasks}/{planning!.subtaskCount}
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
      </div>
    </div>
  );
}
