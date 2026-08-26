// Spec U3 Part B — extracted from TodoList's local version so a due date
// reads the same way on a Dashboard row and inside Week's task popup.

import { cn, daysUntil, formatDateShort } from "../../lib/utils";

/**
 * A due-date chip that says how urgent the date actually is.
 *
 * Overdue and today are the only two states worth colour: everything else is
 * a quiet grey date. Colouring every future date turns the list into
 * confetti and makes the two states that need attention stop standing out.
 */
export function DueChip({ due, today }: { due: string; today: string }) {
  const overdue = due < today;
  const isToday = due === today;
  if (!overdue && !isToday) {
    return (
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/50">
        {formatDateShort(due)}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1 py-px text-[10px] font-medium tabular-nums",
        overdue
          ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
          : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
      )}
    >
      {overdue ? `${daysUntil(due) * -1}d late` : "Today"}
    </span>
  );
}
