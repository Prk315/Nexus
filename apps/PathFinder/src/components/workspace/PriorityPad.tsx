import { cn, PRIORITY_LABEL, URGENCY_LABEL } from "../../lib/utils";
import { AXIS, cellAdvice } from "../../lib/taskTree";
import type { Priority, Urgency } from "../../types";

/**
 * The importance x urgency pad: one click sets both axes.
 *
 * Deliberately a grid rather than two dropdowns. The point of adding urgency is
 * to make the *relationship* between the axes visible — "important but not
 * urgent" is a place on a map, and picking it off a map takes one gesture and no
 * reading. Two selects would store the same data and teach nothing.
 *
 * Rows are importance (high at the top, so the eye starts where the work
 * matters); columns are urgency (most urgent on the left, reading order).
 */
export function PriorityPad({ importance, urgency, onChange, className }: {
  importance: Priority;
  urgency: Urgency;
  onChange: (importance: Priority, urgency: Urgency) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-end gap-2">
        {/* Row axis label, rotated to sit alongside the grid. */}
        <div className="flex flex-col justify-between h-[132px] pb-5 text-[10px] font-medium text-muted-foreground/70">
          <span>High</span>
          <span>Med</span>
          <span>Low</span>
        </div>

        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-3 gap-1">
            {AXIS.map((imp) =>
              AXIS.map((urg) => {
                const selected = imp === importance && urg === urgency;
                const advice = cellAdvice(imp as Priority, urg as Urgency);
                // Corner cells carry the Eisenhower prescription; the soft middle
                // is genuinely ambiguous and gets no confident-sounding label.
                const isCorner = advice !== "";
                return (
                  <button
                    key={`${imp}:${urg}`}
                    type="button"
                    onClick={() => onChange(imp as Priority, urg as Urgency)}
                    aria-pressed={selected}
                    title={`${PRIORITY_LABEL[imp as Priority]} importance · ${URGENCY_LABEL[urg as Urgency]}${advice ? ` — ${advice}` : ""}`}
                    className={cn(
                      "h-10 w-[104px] rounded-md border text-[10px] font-medium leading-tight",
                      "flex items-center justify-center px-1 text-center transition-all",
                      selected
                        ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/40"
                        : isCorner
                          ? "border-border/70 text-muted-foreground hover:border-primary/40 hover:bg-secondary/60"
                          : "border-border/40 text-muted-foreground/50 hover:border-primary/30 hover:bg-secondary/40",
                    )}
                  >
                    {advice || "·"}
                  </button>
                );
              }),
            )}
          </div>

          <div className="grid grid-cols-3 gap-1 text-[10px] font-medium text-muted-foreground/70">
            <span className="text-center">Urgent</span>
            <span className="text-center">Soon</span>
            <span className="text-center">Whenever</span>
          </div>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground/60 pl-11">
        Rows: importance · Columns: urgency
      </p>
    </div>
  );
}
