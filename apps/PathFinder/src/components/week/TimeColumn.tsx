// One day's timed column, and the all-day task chip with its popup card.

import { useEffect, useState, useCallback, useRef } from "react";
import { Check, RefreshCw, Repeat2, MapPin, GraduationCap, CalendarOff, CalendarRange, Eye, EyeOff } from "lucide-react";
import { cn, layoutCalItems, URGENCY_LABEL, STAGE_LABEL, STAGE_CLASSES } from "../../lib/utils";
import { planningOf, isFullTask } from "../../lib/taskTree";
import { isSystemScheduledOn } from "../../lib/systems";
import { UrgencyMeter } from "../../components/UrgencyMeter";
import type { TaskWithContext, SystemEntry, CalBlock, CourseAssignment, ScheduleEntry, TaskSession } from "../../types";
import { BLOCK_COLORS, GRID_END_MIN, HOURS, HOUR_PX, HOUR_START, fmtWeekMinutes, minutesToPx, pxToTime, timeToMinutes, toISO } from "./_shared";
import type { Span } from "@nexus/core/coverage";
import type { ActualDay } from "../../lib/actual";
import type { CoverageCategoryOption } from "../../lib/api";
import { ActualOverlay, SleepBand } from "./overlays";

export function TaskPopupChip({ t, parentTitle, scheduledMin, hasSteps, onToggle, onEdit }: {
  t: TaskWithContext;
  /** Set when this is a step of a larger task — shown so it isn't an orphan line. */
  parentTitle?: string | null;
  /** Committed calendar minutes across the task's subtree, all time. */
  scheduledMin: number;
  /** True when the task is broken down — completing it means completing its steps. */
  hasSteps?: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const chipRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const chip = t.done
    ? "bg-emerald-500/15 border-emerald-400/40"
    : t.priority === "high"    ? "bg-red-500/10 border-red-400/40"
    : t.priority === "medium"  ? "bg-amber-500/10 border-amber-400/40"
    :                            "bg-blue-500/10 border-blue-400/40";
  const check = t.done
    ? "bg-emerald-500 border-emerald-500"
    : t.priority === "high"    ? "border-red-400 hover:bg-red-400/20"
    : t.priority === "medium"  ? "border-amber-400 hover:bg-amber-400/20"
    :                            "border-blue-400 hover:bg-blue-400/20";

  const priorityLabel: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };
  const priorityColor: Record<string, string> = { high: "text-red-500", medium: "text-amber-500", low: "text-blue-500" };

  // close on outside click
  useEffect(() => {
    if (!pos) return;
    function down(e: MouseEvent) {
      const t = e.target as Node;
      if (!chipRef.current?.contains(t) && !cardRef.current?.contains(t)) {
        setPos(null);
      }
    }
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [pos]);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (pos) { setPos(null); return; }
    const r = chipRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 224) });
  }

  return (
    <>
      <div
        ref={chipRef}
        onClick={toggle}
        className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer transition-colors select-none", chip)}
      >
        <button
          onClick={(e) => { e.stopPropagation(); if (!hasSteps) onToggle(); }}
          disabled={hasSteps}
          title={hasSteps ? "Finish its steps to complete this" : undefined}
          className={cn(
            "flex h-3 w-3 shrink-0 items-center justify-center rounded border transition-colors",
            check,
            hasSteps && "opacity-40 cursor-default",
          )}
        >
          {t.done && <Check className="h-2 w-2 text-white" />}
        </button>
        {isFullTask(t) && <UrgencyMeter urgency={planningOf(t).urgency} />}
        <span className={cn("text-[11px] truncate flex-1", t.done ? "line-through text-muted-foreground" : "text-foreground")}>
          {parentTitle && <span className="opacity-50">{parentTitle} › </span>}
          {t.title}
        </span>
        {/*
          Due here, but no time committed anywhere. This is the one fact a weekly
          overview can tell you that a task list can't, and it is the same
          predicate the board's stage gate uses — so the two views agree.
        */}
        {!t.done && isFullTask(t) && scheduledMin === 0 && (
          <CalendarOff className="h-2.5 w-2.5 shrink-0 text-amber-500" />
        )}
      </div>

      {pos && (
        <div
          ref={cardRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
          className="w-56 rounded-xl border border-border bg-card shadow-2xl p-3 flex flex-col gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <p className={cn("text-xs font-semibold leading-snug", t.done ? "line-through text-muted-foreground" : "text-foreground")}>
            {t.title}
          </p>

          <div className="flex flex-col gap-0.5">
            {t.plan_title && <p className="text-[11px] text-muted-foreground truncate">Plan: {t.plan_title}</p>}
            {t.goal_title && <p className="text-[11px] text-muted-foreground truncate">Goal: {t.goal_title}</p>}
          </div>

          <div className="flex items-center gap-2">
            <span className={cn("text-[11px] font-medium", priorityColor[t.priority] ?? "text-muted-foreground")}>
              {priorityLabel[t.priority] ?? t.priority} priority
            </span>
            {isFullTask(t) && (
              <span className="text-[11px] text-muted-foreground">
                · {URGENCY_LABEL[planningOf(t).urgency]}
              </span>
            )}
            {t.done && <span className="text-[11px] font-medium text-emerald-500 ml-auto">✓ Done</span>}
          </div>

          {isFullTask(t) && (
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className={cn("rounded-full border px-1.5 py-px font-medium", STAGE_CLASSES[planningOf(t).stage])}>
                {STAGE_LABEL[planningOf(t).stage]}
              </span>
              <span className={cn("tabular-nums", scheduledMin === 0 ? "text-amber-500" : "text-muted-foreground")}>
                {scheduledMin === 0
                  ? "No time booked"
                  : `${fmtWeekMinutes(scheduledMin)} booked${t.aggregate_estimate ? ` of ${fmtWeekMinutes(t.aggregate_estimate)}` : ""}`}
              </span>
            </div>
          )}

          <div className="flex gap-2 pt-1 border-t border-border">
            <button
              onClick={(e) => { e.stopPropagation(); if (!hasSteps) { onToggle(); setPos(null); } }}
              disabled={hasSteps}
              title={hasSteps ? "Finish its steps to complete this" : undefined}
              className="flex-1 text-[11px] py-1 rounded-md border border-border hover:bg-secondary transition-colors text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {hasSteps ? "Has steps" : t.done ? "Mark undone" : "Mark done"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setPos(null); onEdit(); }}
              className="flex-1 text-[11px] py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Edit
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Time column ───────────────────────────────────────────────────────────────

export function TimeColumn({ date, isToday, blocks, systems, courseAssignments, scheduleEntries, actual, sleepSpans, categories, sessionsByBlock, onClickSlot, onClickBlock, onToggleWorked }: {
  date: Date; isToday: boolean;
  blocks: CalBlock[];
  systems: SystemEntry[];
  courseAssignments: CourseAssignment[];
  scheduleEntries: ScheduleEntry[];
  actual?: ActualDay;
  /** Always-on sleep band spans for this day — independent of `actual`/the Actual toggle. */
  sleepSpans?: Span[];
  /** For the block-label emoji prefix; empty array renders blocks with no prefix. */
  categories: CoverageCategoryOption[];
  /** Sessions already logged, keyed by the occurrence's cal_block_id. */
  sessionsByBlock: Map<number, TaskSession>;
  onClickSlot: (date: string, time: string) => void;
  onClickBlock: (b: CalBlock) => void;
  onToggleWorked: (b: CalBlock) => void;
}) {
  const iso = toISO(date);
  const colRef = useRef<HTMLDivElement>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const toggleHidden = useCallback((id: string) => {
    setHiddenIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);

  function handleClick(e: React.MouseEvent) {
    if (!colRef.current) return;
    const rect = colRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const time = pxToTime(y, HOURS.length * HOUR_PX);
    onClickSlot(iso, time);
  }

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowPx = minutesToPx(nowMin);
  // GRID_END_MIN (midnight), not HOUR_END * 60 (23:00) — see the comment on
  // GRID_END_MIN. With the old bound the now-line silently vanished for the
  // whole 23:00-24:00 hour.
  const showNow = isToday && nowMin >= HOUR_START * 60 && nowMin <= GRID_END_MIN;

  return (
    <div className={cn("flex-1 min-w-0 border-r border-border relative", isToday && "bg-primary/[0.03]")}>
      {/* Time grid */}
      <div
        ref={colRef}
        className="relative flex-1 cursor-crosshair"
        style={{ height: HOURS.length * HOUR_PX }}
        onClick={handleClick}
      >
        {/* Hour lines */}
        {HOURS.map((h, i) => (
          <div key={h} className="absolute left-0 right-0 border-t border-border/30"
            style={{ top: i * HOUR_PX }} />
        ))}
        {/* Half-hour lines */}
        {HOURS.slice(0, -1).map((h, i) => (
          <div key={`${h}h`} className="absolute left-0 right-0 border-t border-border/10 border-dashed"
            style={{ top: i * HOUR_PX + HOUR_PX / 2 }} />
        ))}

        {/* Sleep band — ALWAYS on, independent of the Actual toggle */}
        {sleepSpans && sleepSpans.length > 0 && <SleepBand spans={sleepSpans} iso={iso} />}

        {/* Actual-day overlay (screen/training) — behind everything else, purely visual */}
        {actual && <ActualOverlay actual={actual} iso={iso} />}

        {/* Current time indicator */}
        {showNow && (
          <div className="absolute left-0 right-0 z-10 flex items-center pointer-events-none"
            style={{ top: nowPx }}>
            <div className="h-2 w-2 rounded-full bg-primary shrink-0 -ml-1" />
            <div className="flex-1 border-t-2 border-primary" />
          </div>
        )}

        {/* All timed events — unified overlap layout */}
        {(() => {
          const timedSys = systems.filter((s) => s.start_time && isSystemScheduledOn(s, iso));
          const timedCAs = courseAssignments.filter((a) => a.start_time);
          const timedSEs = scheduleEntries.filter((e) => e.start_time);

          type WkEvt =
            | { kind: "sys"; startMin: number; endMin: number; s: SystemEntry }
            | { kind: "ca";  startMin: number; endMin: number; a: CourseAssignment }
            | { kind: "blk"; startMin: number; endMin: number; b: CalBlock }
            | { kind: "se";  startMin: number; endMin: number; e: ScheduleEntry };

          const evts: WkEvt[] = [
            ...timedSys.map((s) => ({
              kind: "sys" as const,
              startMin: timeToMinutes(s.start_time!),
              endMin:   s.end_time ? timeToMinutes(s.end_time) : timeToMinutes(s.start_time!) + 60,
              s,
            })),
            ...timedCAs.map((a) => ({
              kind: "ca" as const,
              startMin: timeToMinutes(a.start_time!),
              endMin:   a.end_time ? timeToMinutes(a.end_time) : timeToMinutes(a.start_time!) + 60,
              a,
            })),
            ...blocks.map((b) => ({
              kind: "blk" as const,
              startMin: timeToMinutes(b.start_time),
              endMin:   timeToMinutes(b.end_time),
              b,
            })),
            ...timedSEs.map((e) => ({
              kind: "se" as const,
              startMin: timeToMinutes(e.start_time!),
              endMin:   e.end_time ? timeToMinutes(e.end_time) : timeToMinutes(e.start_time!) + 60,
              e,
            })),
          ];

          return layoutCalItems(evts).map(({ item, col, totalCols }) => {
            const top    = minutesToPx(item.startMin);
            const height = Math.max(20, minutesToPx(item.endMin) - top);
            const left   = `calc(${(col / totalCols) * 100}% + 1px)`;
            const right  = `calc(${((totalCols - col - 1) / totalCols) * 100}% + 1px)`;

            if (item.kind === "sys") {
              const { s } = item;
              const sysId = `sys-${s.id}-${iso}`;
              const sysHidden = hiddenIds.has(sysId);
              return (
                <div key={`sys-${s.id}`}
                  className={cn("absolute rounded border px-1.5 py-0.5 overflow-hidden bg-emerald-500/15 border-emerald-400/40 group", sysHidden && "opacity-15")}
                  style={{ top, height, left, right }}
                >
                  <button
                    className={cn("absolute top-0.5 right-0.5 z-10 p-0.5 rounded transition-opacity", sysHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                    onClick={(e) => { e.stopPropagation(); toggleHidden(sysId); }}
                  >
                    {sysHidden ? <EyeOff className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" /> : <Eye className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />}
                  </button>
                  <div className="flex items-center gap-1">
                    <RefreshCw className="h-2.5 w-2.5 shrink-0 text-emerald-600 dark:text-emerald-400 opacity-70" />
                    <p className="text-[11px] font-semibold leading-tight truncate text-emerald-700 dark:text-emerald-300">{s.title}</p>
                  </div>
                  {height > 30 && (
                    <p className="text-[10px] leading-tight opacity-70 text-emerald-700 dark:text-emerald-300">
                      {s.start_time}{s.end_time ? `–${s.end_time}` : ""}
                    </p>
                  )}
                </div>
              );
            }

            if (item.kind === "ca") {
              const { a } = item;
              const isTheory = a.assignment_type === "theory";
              const caBg   = isTheory ? "bg-orange-500/15 border-orange-400/40" : "bg-indigo-500/15 border-indigo-400/40";
              const caTxt  = isTheory ? "text-orange-700 dark:text-orange-300"  : "text-indigo-700 dark:text-indigo-300";
              const caIcon = isTheory ? "text-orange-600 dark:text-orange-400"  : "text-indigo-600 dark:text-indigo-400";
              const caId = `ca-${a.id}-${iso}`;
              const caHidden = hiddenIds.has(caId);
              return (
                <div key={`ca-${a.id}`}
                  className={cn("absolute rounded border px-1.5 py-0.5 overflow-hidden group", caBg, caHidden && "opacity-15")}
                  style={{ top, height, left, right }}
                >
                  <button
                    className={cn("absolute top-0.5 right-0.5 z-10 p-0.5 rounded transition-opacity", caHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                    onClick={(e) => { e.stopPropagation(); toggleHidden(caId); }}
                  >
                    {caHidden ? <EyeOff className={cn("h-3.5 w-3.5", caIcon)} /> : <Eye className={cn("h-3.5 w-3.5", caIcon)} />}
                  </button>
                  <div className="flex items-center gap-1">
                    <GraduationCap className={cn("h-2.5 w-2.5 shrink-0 opacity-70", caIcon)} />
                    <p className={cn("text-[11px] font-semibold leading-tight truncate", caTxt)}>{a.title}</p>
                  </div>
                  {height > 30 && (
                    <p className={cn("text-[10px] leading-tight opacity-70", caTxt)}>
                      {a.start_time}{a.end_time ? `–${a.end_time}` : ""}
                    </p>
                  )}
                  {height > 46 && (
                    <p className={cn("text-[10px] leading-tight opacity-60 truncate", caTxt)}>{a.plan_title}</p>
                  )}
                </div>
              );
            }

            if (item.kind === "se") {
              const { e } = item;
              const clr = BLOCK_COLORS[e.color] ?? BLOCK_COLORS.teal;
              const seId = `se-${e.id}-${e.date}`;
              const seHidden = hiddenIds.has(seId);
              return (
                <div key={`se-${e.id}-${e.date}`}
                  className={cn("absolute rounded border px-1.5 py-0.5 overflow-hidden group", clr.bg, clr.border, seHidden && "opacity-15")}
                  style={{ top, height, left, right }}
                >
                  <button
                    className={cn("absolute top-0.5 right-0.5 z-10 p-0.5 rounded transition-opacity", seHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                    onClick={(ev) => { ev.stopPropagation(); toggleHidden(seId); }}
                  >
                    {seHidden ? <EyeOff className={cn("h-3.5 w-3.5", clr.text)} /> : <Eye className={cn("h-3.5 w-3.5", clr.text)} />}
                  </button>
                  <div className="flex items-center gap-1">
                    <CalendarRange className={cn("h-2.5 w-2.5 shrink-0 opacity-70", clr.text)} />
                    <p className={cn("text-[11px] font-semibold leading-tight truncate", clr.text)}>{e.title}</p>
                  </div>
                  {height > 30 && (
                    <p className={cn("text-[10px] leading-tight opacity-70", clr.text)}>
                      {e.start_time}{e.end_time ? `–${e.end_time}` : ""}
                    </p>
                  )}
                  {height > 46 && e.location && (
                    <div className={cn("flex items-center gap-0.5 mt-0.5", clr.text)}>
                      <MapPin className="h-2.5 w-2.5 shrink-0 opacity-70" />
                      <p className="text-[10px] leading-tight opacity-70 truncate">{e.location}</p>
                    </div>
                  )}
                  {height > 58 && (
                    <p className={cn("text-[10px] leading-tight opacity-60 truncate", clr.text)}>{e.plan_title}</p>
                  )}
                </div>
              );
            }

            // cal block
            const { b } = item;
            const clr = BLOCK_COLORS[b.color] ?? BLOCK_COLORS.blue;
            const cbId = `cb-${b.recurring_id ?? b.id}-${b.date}`;
            const cbHidden = hiddenIds.has(cbId);
            // A block committed to a task can be worked off right here: ticking
            // it logs a session against this occurrence, which is what advances
            // sessions- and time-mode completion. Untickable blocks (no task)
            // show nothing, so the calendar is unchanged for everything else.
            const worked = b.task_id != null && sessionsByBlock.has(b.id);
            return (
              <div key={`${b.is_recurring ? "r" : "b"}-${b.recurring_id ?? b.id}-${b.date}`}
                className={cn("absolute rounded border px-1.5 py-0.5 cursor-pointer overflow-hidden group", clr.bg, clr.border, cbHidden && "opacity-15", worked && "ring-1 ring-emerald-400/60")}
                style={{ top, height, left, right }}
                onClick={(e) => { e.stopPropagation(); onClickBlock(b); }}
              >
                <button
                  className={cn("absolute top-0.5 right-0.5 z-10 p-0.5 rounded transition-opacity", cbHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                  onClick={(e) => { e.stopPropagation(); toggleHidden(cbId); }}
                >
                  {cbHidden ? <EyeOff className={cn("h-3.5 w-3.5", clr.text)} /> : <Eye className={cn("h-3.5 w-3.5", clr.text)} />}
                </button>
                <div className="flex items-center gap-1">
                  {b.task_id != null && (
                    <button
                      title={worked ? "Worked — click to undo" : "Mark this block as worked"}
                      onClick={(e) => { e.stopPropagation(); onToggleWorked(b); }}
                      className={cn(
                        "flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] border transition-colors",
                        worked
                          ? "bg-emerald-500 border-emerald-500 text-white"
                          : cn("border-current opacity-50 hover:opacity-100", clr.text),
                      )}
                    >
                      {worked && <Check className="h-2 w-2" />}
                    </button>
                  )}
                  {b.is_recurring && <Repeat2 className={cn("h-2.5 w-2.5 shrink-0 opacity-70", clr.text)} />}
                  <p className={cn("text-[11px] font-semibold leading-tight truncate", clr.text, worked && "line-through opacity-70")}>
                    {b.category && categories.find((c) => c.name === b.category)?.emoji
                      ? `${categories.find((c) => c.name === b.category)!.emoji} `
                      : ""}
                    {b.title}
                  </p>
                </div>
                {height > 30 && (
                  <p className={cn("text-[10px] leading-tight opacity-70", clr.text)}>{b.start_time}–{b.end_time}</p>
                )}
                {height > 46 && b.location && (
                  <div className={cn("flex items-center gap-0.5 mt-0.5", clr.text)}>
                    <MapPin className="h-2.5 w-2.5 shrink-0 opacity-70" />
                    <p className="text-[10px] leading-tight opacity-70 truncate">{b.location}</p>
                  </div>
                )}
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}
