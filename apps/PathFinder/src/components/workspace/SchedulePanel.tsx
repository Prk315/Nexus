import { useMemo, useState } from "react";
import { CalendarClock, Repeat, Trash2, Plus } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn, formatDateShort } from "../../lib/utils";
import {
  addMinutesToTime, blockMinutes, flatten, formatMinutes,
  rollupCoverage, rollupEstimate, type TaskNode,
} from "../../lib/taskTree";
import type { CalBlock, TaskCoverage } from "../../types";

/**
 * Commit calendar time to a task — in pieces.
 *
 * The point of this panel is that scheduling is **not all-or-nothing**. A six-hour
 * task can have ninety minutes on Tuesday and two hours on Thursday and still be
 * three and a half hours short, and the bar at the top says exactly that. Nothing
 * here forces you to place the whole task before you can place any of it.
 *
 * Any step in the breakdown can be the target, so scheduling half a task really
 * means scheduling two of its five steps.
 */

const COLORS = ["blue", "emerald", "violet", "amber", "rose"] as const;
const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export function SchedulePanel({
  root, target, blocks, coverage, onTargetChange, onSchedule, onScheduleSeries, onUnschedule,
}: {
  root: TaskNode;
  /** The step being scheduled — defaults to the root task. */
  target: TaskNode;
  blocks: CalBlock[];
  coverage: Map<number, TaskCoverage>;
  onTargetChange: (id: number) => void;
  onSchedule: (v: { taskId: number; title: string; date: string; startTime: string; endTime: string; color: string }) => void;
  onScheduleSeries: (v: {
    taskId: number; title: string; startTime: string; endTime: string; color: string;
    recurrence: string; daysOfWeek: string | null; startDate: string; endDate: string | null;
  }) => void;
  onUnschedule: (v: { id: number; recurringId: number | null }) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const totalEstimate = rollupEstimate(root);
  const totalScheduled = rollupCoverage(root, coverage).scheduledMin;
  const remaining = Math.max(0, totalEstimate - totalScheduled);

  const targetEstimate = rollupEstimate(target);
  const targetScheduled = rollupCoverage(target, coverage).scheduledMin;
  const targetRemaining = Math.max(0, targetEstimate - targetScheduled);

  // Only leaves can hold a commitment — a parent is scheduled by scheduling its
  // steps, which is what makes the parent's coverage add up.
  const schedulable = useMemo(
    () => flatten(root).filter((n) => n.children.length === 0),
    [root],
  );

  const [mode, setMode] = useState<"once" | "series">("once");
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState("09:00");
  // Default the duration to what this step still needs, so the common case —
  // "put the rest of it somewhere" — is zero typing.
  const [duration, setDuration] = useState(String(targetRemaining || targetEstimate || 30));
  const [color, setColor] = useState<string>("blue");
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [seriesEnd, setSeriesEnd] = useState("");

  const durationMin = Math.max(5, Number(duration) || 30);
  const endTime = addMinutesToTime(startTime, durationMin);

  const submitOnce = () => {
    onSchedule({
      taskId: target.task.id, title: target.task.title,
      date, startTime, endTime, color,
    });
  };

  const submitSeries = () => {
    if (days.length === 0) return;
    onScheduleSeries({
      taskId: target.task.id, title: target.task.title,
      startTime, endTime, color,
      recurrence: "weekly",
      daysOfWeek: days.slice().sort().join(","),
      startDate: date,
      endDate: seriesEnd || null,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Coverage bar: the whole task, at a glance ── */}
      <div className="rounded-lg border border-border bg-secondary/30 p-3">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-xs font-medium text-foreground">Calendar commitment</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatMinutes(totalScheduled)} of {formatMinutes(totalEstimate)}
          </span>
        </div>
        <CoverageBar scheduled={totalScheduled} total={totalEstimate} />
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {remaining > 0
            ? <>{formatMinutes(remaining)} still needs a place in the week.</>
            : <span className="text-emerald-500">Fully scheduled.</span>}
        </p>
      </div>

      {/* ── Which step are we placing? ── */}
      {schedulable.length > 1 && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Step to schedule</label>
          <select
            value={target.task.id}
            onChange={(e) => onTargetChange(Number(e.target.value))}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {schedulable.map((n) => {
              const need = Math.max(0, rollupEstimate(n) - rollupCoverage(n, coverage).scheduledMin);
              return (
                <option key={n.task.id} value={n.task.id}>
                  {"— ".repeat(Math.max(0, n.depth - 1))}{n.task.title}
                  {need > 0 ? ` · ${formatMinutes(need)} left` : " · scheduled"}
                </option>
              );
            })}
          </select>
        </div>
      )}

      {/* ── Existing commitments ── */}
      {blocks.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Committed</span>
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto pr-1">
            {blocks.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5 text-xs"
              >
                {b.is_recurring
                  ? <Repeat className="h-3 w-3 shrink-0 text-violet-500" />
                  : <CalendarClock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                <span className="truncate flex-1 min-w-0">{b.title}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {b.is_recurring
                    ? `${describeDays(b.days_of_week)} ${b.start_time}`
                    : `${formatDateShort(b.date)} ${b.start_time}`}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground/70">
                  {formatMinutes(blockMinutes(b.start_time, b.end_time))}
                  {b.is_recurring && " ea."}
                </span>
                <button
                  type="button"
                  title={b.is_recurring ? "Remove the whole series" : "Remove this block"}
                  onClick={() => onUnschedule({ id: b.id, recurringId: b.recurring_id })}
                  className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-secondary"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Place a new commitment ── */}
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <div className="inline-flex self-start rounded-lg border border-border p-0.5">
          {(["once", "series"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                mode === m ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "once" ? "One block" : "Repeating"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-muted-foreground">
              {mode === "once" ? "Date" : "Starts"}
            </label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-muted-foreground">Start</label>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-muted-foreground">Minutes</label>
            <Input
              type="number" min={5} step={5} value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>

        {mode === "series" && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">Repeats on</label>
              <div className="flex gap-1">
                {DAY_LABELS.map((d, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setDays((s) => s.includes(i) ? s.filter((x) => x !== i) : [...s, i])}
                    className={cn(
                      "h-7 w-7 rounded-md border text-[11px] font-medium transition-colors",
                      days.includes(i)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40",
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">
                Until <span className="opacity-60">— leave empty for open-ended</span>
              </label>
              <Input type="date" value={seriesEnd} onChange={(e) => setSeriesEnd(e.target.value)} className="h-8 text-xs" />
            </div>
          </>
        )}

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Colour</span>
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={c}
              className={cn(
                "h-4 w-4 rounded-full border-2 transition-transform",
                color === c ? "border-foreground scale-110" : "border-transparent",
                c === "blue" && "bg-blue-500",
                c === "emerald" && "bg-emerald-500",
                c === "violet" && "bg-violet-500",
                c === "amber" && "bg-amber-500",
                c === "rose" && "bg-rose-500",
              )}
            />
          ))}
          <div className="flex-1" />
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {startTime}–{endTime}
          </span>
        </div>

        <Button
          size="sm"
          onClick={mode === "once" ? submitOnce : submitSeries}
          disabled={mode === "series" && days.length === 0}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          {mode === "once" ? "Add block" : "Add series"}
        </Button>

        {mode === "series" && (
          <p className="text-[10px] text-muted-foreground/70 leading-snug">
            A repeating commitment is how a step that is never finished in one sitting gets
            measured — set the step's completion to <em>sessions</em> and each occurrence you
            tick off counts toward the target.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Scheduled-vs-needed bar. Over-scheduling is shown as a distinct segment rather
 * than clipped at 100%: committing more time than you estimated is information,
 * not an error, and silently hiding it would make the estimate look right.
 */
function CoverageBar({ scheduled, total }: { scheduled: number; total: number }) {
  const denom = Math.max(total, scheduled, 1);
  const withinPct = Math.min(scheduled, total) / denom * 100;
  const overPct = Math.max(0, scheduled - total) / denom * 100;

  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary flex">
      <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${withinPct}%` }} />
      {overPct > 0 && (
        <div
          className="h-full bg-amber-500 transition-all duration-300"
          style={{ width: `${overPct}%` }}
          title="Scheduled beyond the estimate"
        />
      )}
    </div>
  );
}

function describeDays(daysOfWeek: string | null): string {
  if (!daysOfWeek) return "Daily";
  return daysOfWeek.split(",").map((d) => DAY_LABELS[Number(d)] ?? "?").join("");
}
