// The week measured in hours rather than ticked boxes.
//
// WEEK COMPLETION next to this counts *items* — 28 of 32 tasks done. That says
// nothing about whether the week was actually full, or whether the hours you
// committed to are hours you spent. A week of thirty two-minute chores and a
// week of four all-day exams both read as "32 items".
//
// This is deliberately NOT broken down by goal. The goal -> plan -> task chain
// is unpopulated in this vault (no plan carries a goal_id), so a per-goal chart
// would be one giant "unassigned" bar pretending to be information. Committed
// and logged minutes need no linkage at all, which is why they can be drawn
// honestly today.

import { cn } from "../../lib/utils";
import { blockMinutes } from "../../lib/taskTree";
import type { CalBlock, TaskSession } from "../../types";

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/** "125" -> "2h5" — compact enough for a strip this size. */
function shortHours(min: number): string {
  const n = Math.max(0, Math.round(min));
  if (n === 0) return "0";
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m === 0 ? `${h}h` : `${h}h${m}`;
}

export interface DayTime {
  iso: string;
  /** Minutes of calendar blocks on this day (the commitment). */
  committed: number;
  /** Of which, minutes attached to a task rather than a bare event. */
  onTasks: number;
  /** Minutes actually logged as worked (pf_task_sessions). */
  logged: number;
}

/**
 * Reduces a week's blocks and sessions into per-day minutes.
 *
 * Pure, so the arithmetic is testable without rendering anything — the same
 * reason taskTree.ts and systems.ts are shaped this way.
 */
export function summariseWeek(
  days: string[],
  blocks: CalBlock[],
  sessions: TaskSession[],
): DayTime[] {
  const byDay = new Map<string, DayTime>(
    days.map((iso) => [iso, { iso, committed: 0, onTasks: 0, logged: 0 }]),
  );

  for (const b of blocks) {
    const d = byDay.get(b.date);
    if (!d) continue;                       // outside the visible week
    const mins = blockMinutes(b.start_time, b.end_time);
    d.committed += mins;
    if (b.task_id != null) d.onTasks += mins;
  }

  for (const s of sessions) {
    const d = byDay.get(s.date);
    if (d) d.logged += s.minutes;
  }

  return days.map((iso) => byDay.get(iso)!);
}

/**
 * A column per day: total height is the day's committed time, the darker fill
 * is what was actually logged against it.
 *
 * Bars are scaled to the busiest day in view, not to a fixed 24h. A fixed scale
 * makes every realistic week a row of stubs; a relative one shows the shape of
 * the week, which is the thing worth seeing.
 */
export function WeekTimeStrip({ days, today, blocks, sessions }: {
  days: string[];
  today: string;
  blocks: CalBlock[];
  sessions: TaskSession[];
}) {
  const perDay = summariseWeek(days, blocks, sessions);
  const committedTotal = perDay.reduce((s, d) => s + d.committed, 0);
  const taskTotal      = perDay.reduce((s, d) => s + d.onTasks, 0);
  const loggedTotal    = perDay.reduce((s, d) => s + d.logged, 0);

  // Nothing booked all week — say so rather than drawing seven empty stubs.
  if (committedTotal === 0 && loggedTotal === 0) {
    return (
      <div className="hidden lg:flex flex-col justify-center gap-1 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Time</span>
        <span className="text-[11px] text-muted-foreground/50 italic">Nothing booked this week</span>
      </div>
    );
  }

  const peak = Math.max(...perDay.map((d) => Math.max(d.committed, d.logged)), 1);

  return (
    <div className="hidden lg:flex items-end gap-2.5 shrink-0">
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Time</span>
        <span className="text-sm font-semibold tabular-nums text-foreground leading-none">
          {shortHours(committedTotal)}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground/60">
          {shortHours(taskTotal)} on tasks
        </span>
        <span
          className={cn(
            "text-[10px] tabular-nums",
            loggedTotal > 0 ? "text-emerald-500" : "text-muted-foreground/40",
          )}
          title="Minutes ticked off as actually worked"
        >
          {shortHours(loggedTotal)} logged
        </span>
      </div>

      <div className="flex items-end gap-1 h-11">
        {perDay.map((d, i) => {
          const isToday = d.iso === today;
          const past    = d.iso < today;
          const h       = Math.round((d.committed / peak) * 40);
          const fill    = d.committed > 0
            ? Math.min(100, Math.round((d.logged / d.committed) * 100))
            : 0;
          return (
            <div key={d.iso} className="flex flex-col items-center gap-0.5">
              <div
                className={cn(
                  "w-3 rounded-sm overflow-hidden flex flex-col justify-end transition-colors",
                  d.committed === 0 ? "bg-secondary/60" : "bg-primary/25",
                  isToday && "ring-1 ring-primary/50",
                )}
                style={{ height: Math.max(3, h) }}
                title={`${d.iso} — ${shortHours(d.committed)} booked${
                  d.onTasks ? `, ${shortHours(d.onTasks)} on tasks` : ""
                }${d.logged ? `, ${shortHours(d.logged)} logged` : ""}`}
              >
                {/*
                  Logged fills from the bottom. A day that is booked and fully
                  worked reads as a solid bar; booked-and-untouched reads hollow,
                  which is the contrast the whole strip exists to show.
                */}
                <div
                  className={cn("w-full transition-all", past || isToday ? "bg-emerald-500" : "bg-primary/60")}
                  style={{ height: `${fill}%` }}
                />
              </div>
              <span className={cn(
                "text-[9px] leading-none",
                isToday ? "text-foreground font-semibold" : "text-muted-foreground/50",
              )}>
                {DAY_LETTERS[i] ?? ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
