import { Check, Pencil, X, CalendarDays, ChevronUp, ChevronDown, Clock } from "lucide-react";
import { Badge } from "../ui/badge";
import { PriorityDot } from "../PriorityDot";
import { cn, daysUntil, deadlineLabel, deadlineVariant } from "../../lib/utils";
import type { TaskWithContext } from "../../types";

export interface ReorderControls {
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
}

function estimateLabel(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${m}`;
}

export function TaskRow({ task, showContext = true, reorder, onToggle, onEdit, onDelete, onReschedule }: {
  task: TaskWithContext;
  showContext?: boolean;
  reorder?: ReorderControls;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReschedule: () => void;
}) {
  const days = task.due_date ? daysUntil(task.due_date) : null;
  const context = task.plan_title ?? (task.goal_title ? `→ ${task.goal_title}` : null);

  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 group hover:bg-secondary/50 transition-colors">
      <button
        onClick={onToggle}
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
          task.done ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary",
        )}
      >
        {task.done && <Check className="h-2.5 w-2.5" />}
      </button>

      <PriorityDot priority={task.priority} />

      <span className={cn("text-sm truncate", task.done && "line-through text-muted-foreground")}>
        {task.title}
      </span>

      {showContext && context && (
        <span className="text-xs text-muted-foreground/70 truncate shrink-0 max-w-[120px] hidden sm:inline">
          {context}
        </span>
      )}

      <div className="flex-1" />

      {task.time_estimate != null && (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
          <Clock className="h-2.5 w-2.5" />{estimateLabel(task.time_estimate)}
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
        <button onClick={onEdit} title="Edit" className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground">
          <Pencil className="h-3 w-3" />
        </button>
        <button onClick={onDelete} title="Delete" className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-destructive">
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
