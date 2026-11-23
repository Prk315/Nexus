// A small icon button whose look says what it does.
//
// The Workspace's row actions were all the same grey glyph on the same grey
// hover — Complete, Archive, Edit and Delete side by side, indistinguishable
// until you read the tooltip, and Delete one click from gone. Tone gives each
// role its own colour, and `confirm` makes a destructive one take two clicks:
// the first arms it (solid red, "Delete?"), the second commits, and it disarms
// itself after three seconds or when the pointer leaves.
//
// Two clicks rather than `window.confirm()`: that is a silent no-op in iOS
// WKWebView (see CLAUDE.md, Vault's ConfirmDialog note), so a confirm-gated
// delete would simply stop working on the phone.

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export type IconActionTone = "neutral" | "primary" | "positive" | "warning" | "danger";

const TONE: Record<IconActionTone, string> = {
  neutral:  "text-muted-foreground hover:text-foreground hover:bg-secondary",
  primary:  "text-primary hover:bg-primary/10",
  positive: "text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 dark:hover:text-emerald-400",
  warning:  "text-muted-foreground hover:text-amber-600 hover:bg-amber-500/10 dark:hover:text-amber-400",
  danger:   "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
};

export function IconAction({ title, onClick, tone = "neutral", confirm, size = "sm", className, children }: {
  title: string;
  onClick: () => void;
  tone?: IconActionTone;
  /** Label shown while armed; presence makes the action two-click. */
  confirm?: string;
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      type="button"
      title={armed ? `Click again: ${title}` : title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        if (confirm && !armed) { setArmed(true); return; }
        setArmed(false);
        onClick();
      }}
      onMouseLeave={() => setArmed(false)}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1 rounded transition-colors",
        size === "md" ? "h-6 min-w-6 px-1" : "h-5 min-w-5 px-0.5",
        armed ? "bg-destructive text-white px-1.5" : TONE[tone],
        className,
      )}
    >
      {children}
      {armed && <span className="text-[10px] font-medium">{confirm}</span>}
    </button>
  );
}
