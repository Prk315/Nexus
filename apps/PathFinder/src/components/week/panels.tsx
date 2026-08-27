// The surrounding panels: systems bar, header completion strip, left plans rail, right task/deadline rail.

import { useState } from "react";
import { ChevronRight, ChevronDown, Plus, Check, Target, ListChecks, CheckSquare, RefreshCw, Flame, Flag, GraduationCap, Users } from "lucide-react";
import { getCaSubtasks, toggleCaSubtask, memberName } from "../../lib/api";
import { cn } from "../../lib/utils";
import { isDue } from "../../components/workspace/systemForms";
import { PRIORITY_CHIP_CHECK } from "../task/taskVisual";
import { TaskActionMenu, InlineEditText, contextMenuOpener } from "../common";
import type { Goal, Plan, TaskWithContext, SystemEntry, WeekItems, Deadline, CourseAssignment, CaSubtask } from "../../types";
import { DAY_NAMES, toISO } from "./_shared";
import type { WeekInteractions, ExternalDragPayload } from "./useWeekInteractions";

// ── Systems bar ───────────────────────────────────────────────────────────────

export function SystemsBar({ systems, onMarkDone, onAdd, onEdit }: {
  systems: SystemEntry[]; onMarkDone: (id: number) => void; onAdd: () => void; onEdit: (s: SystemEntry) => void;
}) {
  return (
    <div className="shrink-0 border-t border-border bg-card px-4 py-2 flex items-center gap-2 overflow-x-auto">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 flex items-center gap-1">
        <RefreshCw className="h-3 w-3" /> Systems
      </span>
      <div className="w-px h-4 bg-border shrink-0" />
      {systems.length === 0 && <span className="text-xs text-muted-foreground italic">No systems yet.</span>}
      {systems.map((sys) => {
        const due = isDue(sys);
        return (
          <div key={sys.id} className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 border text-xs shrink-0",
            due ? "border-orange-400/50 bg-orange-400/10 text-foreground" : "border-border bg-secondary/50 text-muted-foreground")}>
            <button onClick={() => onEdit(sys)} className="flex items-center gap-1.5 hover:opacity-80">
              <span className="truncate max-w-[80px]">{sys.title}</span>
              {sys.streak_count > 1 && <span className="flex items-center gap-0.5 text-orange-500"><Flame className="h-3 w-3" />{sys.streak_count}</span>}
              <span className="text-muted-foreground/60 text-[10px]">{sys.frequency[0].toUpperCase()}</span>
            </button>
            {due && (
              <button onClick={() => onMarkDone(sys.id)}
                className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/20 hover:bg-primary/40 transition-colors">
                <Check className="h-2.5 w-2.5 text-primary" />
              </button>
            )}
          </div>
        );
      })}
      <button onClick={onAdd} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0">
        <Plus className="h-3.5 w-3.5" /> Add
      </button>
    </div>
  );
}

// ── Header panel (completion rate + daily indicators) ─────────────────────────

export function HeaderPanel({ items, today, days, view }: {
  items: WeekItems; today: string; days: Date[]; view: "week" | "month";
}) {
  const tasks    = items.tasks;
  const cas      = items.course_assignments;
  const sessions = items.training_sessions;

  // Per-day "free day" toggle — stored in localStorage
  const [freeDays, setFreeDays] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("free_days");
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch { return new Set(); }
  });

  function toggleFreeDay(iso: string) {
    setFreeDays((prev) => {
      const next = new Set(prev);
      next.has(iso) ? next.delete(iso) : next.add(iso);
      localStorage.setItem("free_days", JSON.stringify([...next]));
      return next;
    });
  }

  const total = tasks.length + cas.length + sessions.length;
  const done  = tasks.filter((t) => t.done).length
              + cas.filter((a) => a.status === "done").length
              + sessions.filter((s) => s.completed).length;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="shrink-0 border-b border-border bg-card/50 px-5 py-3 flex items-center gap-6">

      {/* Weekly / monthly completion rate */}
      <div className="flex flex-col gap-1.5 w-44 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            {view === "month" ? "Month" : "Week"} completion
          </span>
          <span className="text-sm font-bold text-foreground tabular-nums">{pct}%</span>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500",
              pct === 100 ? "bg-emerald-500" : "bg-primary"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground">{done} of {total} tasks done</span>
      </div>

      {/* Daily progress bars — week view only */}
      {view === "week" && (
        <>
          <div className="w-px h-10 bg-border shrink-0" />
          <div className="flex items-end gap-2.5">
            {days.map((day) => {
              const iso      = toISO(day);
              const dayTasks     = tasks.filter((t) => t.due_date === iso);
              const dayCAs       = cas.filter((a) => a.due_date === iso);
              const daySessions  = sessions.filter((s) => s.scheduled_date === iso);
              const dayDone  = dayTasks.filter((t) => t.done).length
                             + dayCAs.filter((a) => a.status === "done").length
                             + daySessions.filter((s) => s.completed).length;
              const dayTotal = dayTasks.length + dayCAs.length + daySessions.length;
              const dayPct   = dayTotal > 0 ? dayDone / dayTotal : 0;
              const isToday  = iso === today;
              const isPast   = iso < today && !isToday;
              const isEmpty  = dayTotal === 0;
              const isFree   = isEmpty && freeDays.has(iso);

              const barColor =
                isFree                    ? "bg-emerald-500"
                : dayDone === dayTotal && dayTotal > 0 ? "bg-emerald-500"
                : isPast                  ? "bg-amber-500"
                :                          "bg-primary";

              return (
                <div key={iso} className="flex flex-col items-center gap-1">
                  <span className={cn(
                    "text-[10px] font-medium",
                    isToday ? "text-primary font-bold" : "text-muted-foreground"
                  )}>
                    {DAY_NAMES[day.getDay()]}
                  </span>

                  {/* Bar — clickable only when empty */}
                  <div
                    className={cn(
                      "relative w-5 h-9 bg-secondary rounded-full overflow-hidden flex flex-col-reverse",
                      isEmpty && "cursor-pointer hover:bg-secondary/60 transition-colors"
                    )}
                    onClick={() => isEmpty && toggleFreeDay(iso)}
                    title={isEmpty ? (isFree ? "Click to unmark" : "Click to mark as free day") : undefined}
                  >
                    {(dayTotal > 0 || isFree) && (
                      <div
                        className={cn("rounded-full transition-all duration-500", barColor)}
                        style={{ height: isFree ? "100%" : `${dayPct * 100}%` }}
                      />
                    )}
                  </div>

                  <span className="text-[9px] text-muted-foreground tabular-nums leading-none">
                    {isFree ? "free" : dayTotal > 0 ? `${dayDone}/${dayTotal}` : "·"}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Left panel (goals, plans, weekly focus) ────────────────────────────────────

export function LeftPanel({ goals, plans, weekNote, onNoteChange, onEditGoal, onEditPlan }: {
  goals: Goal[]; plans: Plan[]; weekNote: string;
  onNoteChange: (v: string) => void;
  onEditGoal: (g: Goal) => void; onEditPlan: (p: Plan) => void;
}) {
  const activeGoals = goals.filter((g) => g.status === "active");
  const activePlans = plans.filter((p) => p.status === "active" && !p.is_lifestyle && !p.is_course && !p.is_schedule);

  return (
    <div className="w-52 shrink-0 border-r border-border bg-card/40 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">

        <section className="flex flex-col gap-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Focus this week</p>
          <textarea
            className="w-full text-xs text-foreground bg-secondary/40 border border-border/60 rounded-md px-2.5 py-2 outline-none focus:ring-1 focus:ring-ring resize-none placeholder:text-muted-foreground/50"
            rows={4}
            placeholder="What matters most this week…"
            value={weekNote}
            onChange={(e) => onNoteChange(e.target.value)}
          />
        </section>

        {activeGoals.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Target className="h-3 w-3" /> Goals
            </p>
            {activeGoals.map((g) => {
              const pct = g.task_count > 0 ? Math.round((g.done_count / g.task_count) * 100) : 0;
              return (
                <button key={g.id} onClick={() => onEditGoal(g)}
                  className="flex flex-col gap-1 p-2 rounded-md border border-border/50 hover:bg-secondary/60 transition-colors text-left w-full">
                  <span className="text-xs font-medium text-foreground leading-tight truncate w-full">{g.title}</span>
                  <div className="flex items-center gap-2 w-full">
                    <div className="flex-1 h-1 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{g.done_count}/{g.task_count}</span>
                  </div>
                </button>
              );
            })}
          </section>
        )}

        {activePlans.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <ListChecks className="h-3 w-3" /> Plans
            </p>
            {activePlans.map((p) => {
              const pct = p.task_count > 0 ? Math.round((p.done_count / p.task_count) * 100) : 0;
              return (
                <button key={p.id} onClick={() => onEditPlan(p)}
                  className="flex flex-col gap-1 p-2 rounded-md border border-border/50 hover:bg-secondary/60 transition-colors text-left w-full">
                  <span className="text-xs font-medium text-foreground leading-tight truncate w-full">{p.title}</span>
                  <div className="flex items-center gap-2 w-full">
                    <div className="flex-1 h-1 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-primary/70 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{p.done_count}/{p.task_count}</span>
                  </div>
                </button>
              );
            })}
          </section>
        )}

        {activeGoals.length === 0 && activePlans.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No active goals or plans.</p>
        )}
      </div>
    </div>
  );
}

// ── Right panel (deadlines, reminders, assignments) ───────────────────────────

// ── Assignment section with expandable subtasks ───────────────────────────────

export function AssignmentSection({ assignments, onToggle, daysTag }: {
  assignments: CourseAssignment[];
  onToggle: (a: CourseAssignment) => void;
  daysTag: (iso: string | null) => React.ReactNode;
}) {
  const [expanded,    setExpanded]    = useState<Set<number>>(new Set());
  const [subtasksMap, setSubtasksMap] = useState<Map<number, CaSubtask[]>>(new Map());

  async function handleExpand(id: number) {
    const next = new Set(expanded);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      if (!subtasksMap.has(id)) {
        const subs = await getCaSubtasks(id);
        setSubtasksMap((prev) => new Map(prev).set(id, subs));
      }
    }
    setExpanded(next);
  }

  async function handleToggleSub(assignmentId: number, subtaskId: number) {
    const updated = await toggleCaSubtask(subtaskId);
    setSubtasksMap((prev) => {
      const next = new Map(prev);
      next.set(assignmentId, (prev.get(assignmentId) ?? []).map((s) => s.id === updated.id ? updated : s));
      return next;
    });
  }

  const pending = assignments.filter((a) => a.status !== "done");
  const done    = assignments.filter((a) => a.status === "done");

  function renderRow(a: CourseAssignment, isDone: boolean) {
    const isOpen  = expanded.has(a.id);
    const subs    = subtasksMap.get(a.id) ?? [];
    return (
      <div key={a.id} className={cn("flex flex-col gap-1", isDone && "opacity-40")}>
        <div className="flex items-start gap-1.5 min-w-0">
          {/* Expand chevron */}
          <button
            onClick={() => handleExpand(a.id)}
            className="shrink-0 mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            {isOpen
              ? <ChevronDown className="h-3 w-3" />
              : <ChevronRight className="h-3 w-3" />}
          </button>

          {/* Done toggle */}
          <button
            onClick={() => onToggle(a)}
            className={cn(
              "h-3.5 w-3.5 shrink-0 rounded-sm border flex items-center justify-center transition-colors mt-0.5",
              isDone
                ? "border-emerald-400 bg-emerald-400/30"
                : "border-indigo-400 hover:bg-indigo-400/20"
            )}
          >
            {isDone && <Check className="h-2 w-2 text-emerald-600" />}
          </button>

          <div className="flex-1 min-w-0">
            <p className={cn("text-xs leading-tight truncate", isDone ? "line-through text-muted-foreground" : "text-foreground")}>{a.title}</p>
            <p className="text-[10px] text-muted-foreground truncate">{a.plan_title}</p>
          </div>
          {daysTag(a.due_date ?? null)}
        </div>

        {/* Subtasks */}
        {isOpen && (
          <div className="ml-6 flex flex-col gap-1">
            {subs.length === 0 && (
              <p className="text-[10px] text-muted-foreground italic">No subtasks.</p>
            )}
            {subs.map((s) => (
              <div key={s.id} className="flex items-center gap-1.5 min-w-0">
                <button
                  onClick={() => handleToggleSub(a.id, s.id)}
                  className={cn(
                    "h-3 w-3 shrink-0 rounded-sm border flex items-center justify-center transition-colors",
                    s.done ? "border-emerald-400 bg-emerald-400/30" : "border-border hover:border-indigo-400"
                  )}
                >
                  {s.done && <Check className="h-1.5 w-1.5 text-emerald-600" />}
                </button>
                <span className={cn("text-[11px] leading-tight truncate", s.done ? "line-through text-muted-foreground" : "text-foreground")}>
                  {s.title}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-1.5">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
        <GraduationCap className="h-3 w-3" /> Assignments
      </p>
      {pending.map((a) => renderRow(a, false))}
      {done.map((a) => renderRow(a, true))}
    </section>
  );
}

// ── Right panel task row ─────────────────────────────────────────────────────
//
// A drag source (U3 Part A) AND a quick-action target, which is the one
// wrinkle here: the row's own `onPointerDown` arms drag-to-schedule, so both
// the inline-rename hit area and the kebab trigger stop that event from
// bubbling — otherwise clicking either would start a phantom drag.

function RightPanelTaskRow({ t, isDraggingThis, interactions, dragPayload, daysTag, onToggle, onRename, onOpen, onScheduleDone, onError }: {
  t: TaskWithContext;
  isDraggingThis: boolean;
  interactions: WeekInteractions;
  dragPayload: ExternalDragPayload;
  daysTag: React.ReactNode;
  onToggle: () => void;
  onRename: (title: string) => void;
  onOpen: () => void;
  onScheduleDone: () => void;
  onError: (message: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      onPointerDown={(e) => interactions.onExternalDragPointerDown(e, dragPayload)}
      onContextMenu={contextMenuOpener(setMenuOpen)}
      className={cn(
        "group flex items-center gap-2 min-w-0 cursor-grab transition-opacity",
        isDraggingThis && "opacity-30",
      )}
    >
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onToggle}
        className={cn(
          "h-3.5 w-3.5 shrink-0 rounded-sm border flex items-center justify-center transition-colors",
          PRIORITY_CHIP_CHECK[t.priority] ?? PRIORITY_CHIP_CHECK.low,
        )}
      />
      <InlineEditText
        value={t.title}
        onCommit={onRename}
        editing={renaming}
        onEditingChange={setRenaming}
        className="flex-1 min-w-0 text-xs text-foreground leading-tight truncate"
      />
      {t.team_id != null && (
        <Users
          className="h-2.5 w-2.5 shrink-0 text-muted-foreground/50"
          aria-label={t.assigned_to != null && t.assigned_to !== "all" ? `Team task · ${memberName(t.assigned_to)}` : "Team task · everyone"}
        />
      )}
      {daysTag}
      <div onPointerDown={(e) => e.stopPropagation()} className="opacity-0 group-hover:opacity-100 transition-opacity">
        <TaskActionMenu
          task={t}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          className="h-5 w-5"
          callbacks={{
            onScheduleToday: onScheduleDone,
            onScheduleTomorrow: onScheduleDone,
            onDueToday: onScheduleDone,
            onDueTomorrow: onScheduleDone,
            onRename: () => setRenaming(true),
            onOpen,
            onError,
          }}
        />
      </div>
    </div>
  );
}

// ── Right panel ───────────────────────────────────────────────────────────────

export function RightPanel({
  tasks, deadlines, courseAssignments, today, interactions, getDragPayload,
  onToggleTask, onToggleDeadline, onToggleAssignment,
  onRenameTask, onOpenTask, onQuickActionDone, onQuickActionError,
}: {
  tasks: TaskWithContext[]; deadlines: Deadline[]; courseAssignments: CourseAssignment[];
  today: string;
  /** U3 Part A — desktop only (RightPanel is never rendered on mobile, so
   *  this is required rather than optional, unlike TaskPopupChip's). */
  interactions: WeekInteractions;
  /** Computed by the caller (Week.tsx): needs the full task tree + coverage
   *  map to run the duration heuristic, neither of which RightPanel has. */
  getDragPayload: (task: TaskWithContext) => ExternalDragPayload;
  onToggleTask: (id: number) => void; onToggleDeadline: (id: number) => void; onToggleAssignment: (a: CourseAssignment) => void;
  /** Quick-action kebab (TaskActionMenu): rename, open, and schedule/due shortcuts. */
  onRenameTask: (id: number, title: string) => void;
  onOpenTask: (t: TaskWithContext) => void;
  onQuickActionDone: () => void;
  onQuickActionError: (message: string) => void;
}) {
  const upcomingDL = deadlines.filter((d) => !d.done).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const doneDL     = deadlines.filter((d) => d.done);

  function daysTag(iso: string | null) {
    if (!iso) return null;
    const diff = Math.round((new Date(iso + "T12:00:00").getTime() - new Date(today + "T12:00:00").getTime()) / 86400000);
    if (diff < 0) return <span className="text-[10px] text-red-500 shrink-0">{Math.abs(diff)}d late</span>;
    if (diff === 0) return <span className="text-[10px] text-amber-500 shrink-0">today</span>;
    if (diff === 1) return <span className="text-[10px] text-amber-500 shrink-0">tmrw</span>;
    return <span className="text-[10px] text-muted-foreground shrink-0">{diff}d</span>;
  }

  const pendingTasks = tasks.filter((t) => !t.done).sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });
  const doneTasks = tasks.filter((t) => t.done);

  return (
    <div className="w-52 shrink-0 border-l border-border bg-card/40 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">

        {/* Tasks */}
        <section className="flex flex-col gap-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <CheckSquare className="h-3 w-3" /> Tasks
          </p>
          {pendingTasks.length === 0 && doneTasks.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No tasks this week.</p>
          )}
          {pendingTasks.map((t) => (
            <RightPanelTaskRow
              key={t.id}
              t={t}
              isDraggingThis={interactions.externalDraggingTaskId === t.id}
              interactions={interactions}
              dragPayload={getDragPayload(t)}
              daysTag={daysTag(t.due_date ?? null)}
              onToggle={() => onToggleTask(t.id)}
              onRename={(title) => onRenameTask(t.id, title)}
              onOpen={() => onOpenTask(t)}
              onScheduleDone={onQuickActionDone}
              onError={onQuickActionError}
            />
          ))}
          {doneTasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 min-w-0 opacity-40">
              <button
                onClick={() => onToggleTask(t.id)}
                className="h-3.5 w-3.5 shrink-0 rounded-sm border border-emerald-400 bg-emerald-400/30 flex items-center justify-center"
              >
                <Check className="h-2 w-2 text-emerald-600" />
              </button>
              <span className="flex-1 text-xs line-through text-muted-foreground leading-tight truncate">{t.title}</span>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Flag className="h-3 w-3" /> Deadlines
          </p>
          {upcomingDL.length === 0 && doneDL.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No deadlines.</p>
          )}
          {upcomingDL.map((d) => (
            <div key={d.id} className="flex items-center gap-2 min-w-0">
              <button onClick={() => onToggleDeadline(d.id)}
                className="h-3.5 w-3.5 shrink-0 rounded-sm border border-red-400 flex items-center justify-center hover:bg-red-400/20 transition-colors" />
              <span className="flex-1 text-xs text-foreground leading-tight truncate">{d.title}</span>
              {daysTag(d.due_date)}
            </div>
          ))}
          {doneDL.map((d) => (
            <div key={d.id} className="flex items-center gap-2 min-w-0 opacity-40">
              <button onClick={() => onToggleDeadline(d.id)}
                className="h-3.5 w-3.5 shrink-0 rounded-sm border border-emerald-400 bg-emerald-400/30 flex items-center justify-center">
                <Check className="h-2 w-2 text-emerald-600" />
              </button>
              <span className="flex-1 text-xs line-through text-muted-foreground leading-tight truncate">{d.title}</span>
            </div>
          ))}
        </section>

        {courseAssignments.length > 0 && (
          <AssignmentSection
            assignments={courseAssignments}
            onToggle={onToggleAssignment}
            daysTag={daysTag}
          />
        )}
      </div>
    </div>
  );
}

// ── Month View ────────────────────────────────────────────────────────────────

