// "What should I work on right now?"
//
// Every signal this needs already existed after the task rework — calendar
// commitments, importance x urgency, due dates, the scheduling gate, logged
// sessions — but they lived on the Workspace board, which is not where the day
// is spent. None of it paid off until the dashboard could answer this question.
//
// The ranking is in lib/nextUp.ts, pure and tested. This file only renders it.

import { CalendarClock, Check, AlertTriangle, Target, Play, Users } from "lucide-react";
import { cn } from "../../lib/utils";
import { formatMinutes, planningOf, isFullTask } from "../../lib/taskTree";
import { UrgencyMeter } from "../UrgencyMeter";
import { PriorityDot } from "../PriorityDot";
import { memberName } from "../../lib/api";
import type { NextUpItem, NextUpKind } from "../../lib/nextUp";
import type { TaskWithContext } from "../../types";

/**
 * Colour carries the *kind* of reason, not the priority.
 *
 * Emerald means "this is happening now", amber "you owe this time", rose
 * "overdue". Reusing the priority palette here would put two different meanings
 * on the same colours in one row — the task's own importance dot already says
 * that.
 */
const KIND_STYLE: Record<NextUpKind, { chip: string; icon: typeof CalendarClock }> = {
  now:       { chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", icon: Play },
  next:      { chip: "bg-blue-500/15 text-blue-600 dark:text-blue-400",          icon: CalendarClock },
  overdue:   { chip: "bg-rose-500/15 text-rose-600 dark:text-rose-400",          icon: AlertTriangle },
  today:     { chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400",       icon: CalendarClock },
  unblocked: { chip: "bg-secondary text-muted-foreground",                       icon: Target },
};

export function NowPanel({ items, blockedCount, onOpen, onLogSession, onScheduleHint }: {
  items: NextUpItem[];
  /** Due or overdue with nothing booked — what the scheduling gate is holding back. */
  blockedCount: number;
  onOpen: (task: TaskWithContext) => void;
  onLogSession: (item: NextUpItem) => void;
  onScheduleHint: () => void;
}) {
  if (items.length === 0 && blockedCount === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        <span className="text-xs text-muted-foreground">Nothing demanding attention right now.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-secondary/20 p-2">
      <div className="flex items-baseline gap-2 px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          Work on now
        </span>
        {blockedCount > 0 && (
          <button
            onClick={onScheduleHint}
            title="Due or overdue with no calendar time — the gate is holding these back"
            className="text-[10px] text-amber-600 dark:text-amber-400 hover:underline"
          >
            {blockedCount} need{blockedCount === 1 ? "s" : ""} scheduling
          </button>
        )}
      </div>

      {items.map((item) => {
        const { task, kind, reason, minutes } = item;
        const style = KIND_STYLE[kind];
        const Icon = style.icon;
        return (
          <div
            key={task.id}
            className={cn(
              "group flex items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-secondary/60",
              kind === "now" && "bg-emerald-500/[0.06] ring-1 ring-emerald-400/30",
            )}
          >
            <PriorityDot priority={task.priority} />
            {isFullTask(task) && <UrgencyMeter urgency={planningOf(task).urgency} />}

            <button
              onClick={() => onOpen(task)}
              className="flex-1 min-w-0 text-left truncate text-sm hover:text-primary transition-colors"
              title={task.title}
            >
              {task.title}
            </button>

            {task.team_id != null && (
              <span
                className="shrink-0 inline-flex items-center text-muted-foreground/50"
                title={task.assigned_to != null && task.assigned_to !== "all"
                  ? `Team task · ${memberName(task.assigned_to)}` : "Team task · everyone"}
              >
                <Users className="h-2.5 w-2.5" />
              </span>
            )}

            {/* What it's for — only meaningful once a task points at a goal. */}
            {task.goal_title && (
              <span className="hidden xl:inline shrink-0 max-w-[110px] truncate text-[10px] text-muted-foreground/60">
                {task.goal_title}
              </span>
            )}

            <span className={cn(
              "shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px] font-medium",
              style.chip,
            )}>
              <Icon className="h-2.5 w-2.5" />
              {reason}
            </span>

            {/*
              Only offer "done" where there is a block to tick. Logging a session
              against nothing is how the ledger fills with times that were never
              committed — the measure stops meaning anything.
            */}
            {item.block && (
              <button
                onClick={() => onLogSession(item)}
                title={`Log ${minutes ? formatMinutes(minutes) : "this"} as worked`}
                className="shrink-0 rounded border border-border px-1.5 py-px text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-emerald-600 hover:border-emerald-400/50 transition-all"
              >
                Worked
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
