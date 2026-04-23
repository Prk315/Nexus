import { cn, PRIORITY_DOT } from "../lib/utils";
import type { Priority } from "../types";

export function PriorityDot({ priority, className }: { priority: Priority; className?: string }) {
  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full shrink-0", PRIORITY_DOT[priority], className)}
      title={priority}
    />
  );
}
