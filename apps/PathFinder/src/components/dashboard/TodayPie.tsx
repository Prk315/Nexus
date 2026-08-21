// The day's time ring: done / planned / free, with a hoverable breakdown.

import { useEffect, useState, useRef } from "react";
import { cn } from "../../lib/utils";
import { PieItem, fmtMin } from "./_shared";

export function TodayPie({ doneMin, pendingMin, freeMin, capTotal, items }: {
  doneMin: number; pendingMin: number; freeMin: number; capTotal: number;
  items: PieItem[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const SIZE   = 68;
  const STROKE = 10;
  const r      = (SIZE - STROKE) / 2;
  const cx     = SIZE / 2;
  const cy     = SIZE / 2;
  const circ   = 2 * Math.PI * r;

  const doneFrac    = capTotal > 0 ? doneMin    / capTotal : 0;
  const pendingFrac = capTotal > 0 ? pendingMin / capTotal : 0;
  const freeFrac    = capTotal > 0 ? freeMin    / capTotal : 1;

  const segments: { frac: number; color: string; cumOffset: number }[] = [];
  let cum = 0;
  for (const [frac, color] of [
    [doneFrac,    "#10b981"          ] as const,
    [pendingFrac, "#6366f1"          ] as const,
    [freeFrac,    "hsl(var(--muted))"] as const,
  ]) {
    if (frac > 0.0005) segments.push({ frac, color, cumOffset: cum });
    cum += frac;
  }

  const doneWorkPct = (doneMin + pendingMin) > 0
    ? Math.round((doneMin / (doneMin + pendingMin)) * 100) : 0;

  const maxItemMin = items.reduce((m, i) => Math.max(m, i.minutes), 1);

  return (
    <div ref={containerRef} className="relative flex items-center gap-3 shrink-0">
      {/* Donut + legend */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Click to see schedule breakdown"
        className="relative shrink-0 hover:opacity-80 transition-opacity focus:outline-none"
        style={{ width: SIZE, height: SIZE }}
      >
        <svg width={SIZE} height={SIZE}>
          <circle cx={cx} cy={cy} r={r} fill="none"
            stroke="hsl(var(--muted))" strokeWidth={STROKE} />
          {segments.map((seg, i) => (
            <circle
              key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={seg.color} strokeWidth={STROKE}
              strokeDasharray={`${seg.frac * circ} ${circ}`}
              strokeDashoffset={-(seg.cumOffset * circ)}
              style={{ transform: "rotate(-90deg)", transformOrigin: `${cx}px ${cy}px` }}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-[11px] font-bold tabular-nums leading-none">{doneWorkPct}%</span>
        </div>
      </button>

      <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full shrink-0 bg-emerald-500" />
          <span>{fmtMin(doneMin)} done</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full shrink-0 bg-indigo-500" />
          <span>{fmtMin(pendingMin)} planned</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full shrink-0 bg-muted-foreground/25" />
          <span>{fmtMin(Math.max(0, freeMin))} free</span>
        </div>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 w-80 rounded-lg border border-border bg-popover shadow-xl">
          <div className="px-3 pt-3 pb-2 border-b border-border">
            <p className="text-xs font-semibold text-foreground">Today's schedule</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">16-hour basis · timed tasks use actual duration</p>
          </div>

          {items.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground italic">Nothing scheduled today.</p>
          ) : (
            <div className="flex flex-col gap-0 max-h-72 overflow-y-auto px-3 py-2">
              {items.map((item) => {
                const barPct = Math.round((item.minutes / maxItemMin) * 100);
                return (
                  <div key={`${item.kind}-${item.id}`} className="py-1.5 border-b border-border/40 last:border-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn(
                        "flex-1 text-xs truncate",
                        item.done ? "line-through text-muted-foreground" : "text-foreground"
                      )}>
                        {item.label}
                      </span>
                      <span className={cn(
                        "text-[10px] font-medium shrink-0 px-1.5 py-0.5 rounded",
                        item.done
                          ? "bg-emerald-500/15 text-emerald-600"
                          : item.kind === "goal"
                            ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                            : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                      )}>
                        {fmtMin(item.minutes)}
                      </span>
                    </div>
                    {item.subtitle && (
                      <p className="text-[10px] text-muted-foreground/60 mb-1">{item.subtitle}</p>
                    )}
                    <div className="h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all",
                          item.done ? "bg-emerald-500" : item.kind === "goal" ? "bg-yellow-400" : "bg-indigo-400"
                        )}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="px-3 py-2 border-t border-border flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              {fmtMin(doneMin + pendingMin)} planned of 16h
            </span>
            <span className="text-[10px] font-medium text-foreground">
              {Math.round(((doneMin + pendingMin) / capTotal) * 100)}% of day used
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
