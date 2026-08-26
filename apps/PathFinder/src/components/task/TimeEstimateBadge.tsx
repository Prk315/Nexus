// Spec U3 Part B — moved out of TodoList.tsx so an estimate reads the same
// way everywhere it appears. `TodoList.tsx` keeps a re-export so WelcomeBox's
// `import { TimeEstimateBadge } from "./TodoList"` keeps resolving.
//
// Formatting deliberately stays `dashboard/_shared`'s `formatMinutes`
// ("1h 30m"), not `lib/taskTree`'s same-named helper ("1h30") — the two
// diverged before this file existed, and every existing call site (Dashboard
// rows, WelcomeBox) already renders the spaced form. Moving the component
// must not silently reformat what's on screen.

import { Clock } from "lucide-react";
import { cn } from "../../lib/utils";
import { formatMinutes } from "../dashboard/_shared";

export function TimeEstimateBadge({ min, className }: { min: number | null; className?: string }) {
  if (!min) return null;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground shrink-0", className)}>
      <Clock className="h-2.5 w-2.5" />
      {formatMinutes(min)}
    </span>
  );
}
