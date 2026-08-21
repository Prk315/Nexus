import { cn, URGENCY_LABEL, URGENCY_LEVEL } from "../lib/utils";
import type { Urgency } from "../types";

/**
 * The urgency axis, drawn as three stacked segments with 3/2/1 filled.
 *
 * Sits next to `PriorityDot` (importance) in every task row. It reads by *shape*
 * — how many bars are lit — so it stays legible beside a coloured dot and does
 * not rely on hue to separate the two axes. See the note in lib/utils.ts.
 */
export function UrgencyMeter({ urgency, className }: { urgency: Urgency; className?: string }) {
  const level = URGENCY_LEVEL[urgency];
  return (
    <span
      className={cn("inline-flex items-end gap-[1px] shrink-0 h-2.5", className)}
      title={`Urgency: ${URGENCY_LABEL[urgency]}`}
      aria-label={`Urgency ${URGENCY_LABEL[urgency]}`}
    >
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "w-[2px] rounded-[1px] transition-colors",
            i === 1 && "h-1",
            i === 2 && "h-1.5",
            i === 3 && "h-2.5",
            i <= level ? "bg-amber-500" : "bg-muted-foreground/25",
          )}
        />
      ))}
    </span>
  );
}
