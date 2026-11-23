import type { CSSProperties } from "react";
import { Bell, Check } from "lucide-react";
import { cn } from "../../lib/utils";
import { reminderStatus, type CalReminder, type ReminderStatus } from "../../lib/reminders";

/**
 * Colour by status, from the same `reminderStatus` the sidebar badge uses — so
 * a reminder that reads "soon" on the badge is amber on the calendar too.
 */
const STATUS: Record<ReminderStatus | "done", string> = {
  done: "bg-secondary/60 border-border text-muted-foreground",
  due: "bg-red-500/15 border-red-400/60 text-red-700 dark:text-red-300",
  soon: "bg-amber-500/15 border-amber-400/60 text-amber-700 dark:text-amber-300",
  scheduled: "bg-rose-500/10 border-rose-300/50 text-rose-700 dark:text-rose-300",
  unscheduled: "bg-rose-500/10 border-rose-300/50 text-rose-700 dark:text-rose-300",
};

export function reminderTone(r: CalReminder, now: number): string {
  return r.done ? STATUS.done : STATUS[reminderStatus(r, now)];
}

function leadLabel(min: number | null): string {
  if (!min) return "";
  return min >= 1440 ? ` · heads-up ${Math.round(min / 1440)} d` : ` · heads-up ${min} min`;
}

/**
 * A timed reminder in the Week / Day grid. A reminder is a POINT in time, so
 * this is a marker anchored at its minute — a left rule and one line — not a
 * block claiming a duration.
 */
export function ReminderMarker({ reminder, style, now, onOpen, onToggle }: {
  reminder: CalReminder;
  style: CSSProperties;
  now: number;
  onOpen: (r: CalReminder) => void;
  onToggle: (r: CalReminder) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onOpen(reminder); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(reminder); } }}
      // A press on empty grid creates a block; this is not empty grid.
      onPointerDown={(e) => e.stopPropagation()}
      title={`Reminder ${reminder.time}${leadLabel(reminder.lead_minutes)} — ${reminder.title}`}
      className={cn(
        "absolute rounded-r border border-l-[3px] px-1 flex items-center gap-1 overflow-hidden cursor-pointer hover:brightness-110 z-20",
        reminderTone(reminder, now),
      )}
      style={style}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle(reminder); }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-pressed={reminder.done}
        title={reminder.done ? "Mark not done" : "Mark done"}
        className={cn(
          "h-3 w-3 shrink-0 rounded-full border flex items-center justify-center",
          reminder.done ? "border-muted-foreground bg-muted-foreground" : "border-current opacity-70 hover:opacity-100",
        )}
      >
        {reminder.done && <Check className="h-2 w-2 text-white" strokeWidth={3} />}
      </button>
      <Bell className="h-2.5 w-2.5 shrink-0 opacity-70" />
      <span className="text-[10px] tabular-nums opacity-80 shrink-0">{reminder.time}</span>
      <span className={cn("text-[11px] font-medium truncate", reminder.done && "line-through")}>{reminder.title}</span>
    </div>
  );
}
