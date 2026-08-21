// The dashboard's task list: grouped cards, the row, and the today-centred unfold.

import { useState, useMemo } from "react";
import { CalendarClock, CheckCircle, CheckSquare, Check, ChevronDown, ChevronRight, Plus, X, Clock, BookOpen } from "lucide-react";
import { daysUntil, cn, formatDateShort } from "../../lib/utils";
import { blockMinutes, planningOf, isFullTask } from "../../lib/taskTree";
import { UrgencyMeter } from "../UrgencyMeter";
import type { Plan, TaskWithContext, CalBlock, CourseAssignment } from "../../types";
import { todayDate } from "./_shared";
import { formatMinutes } from "./_shared";

export function TimeEstimateBadge({ min, className }: { min: number | null; className?: string }) {
  if (!min) return null;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground shrink-0", className)}>
      <Clock className="h-2.5 w-2.5" />
      {formatMinutes(min)}
    </span>
  );
}

export function TimeEstimateInput({ value, onChange, onBlur, className }: {
  value: string; onChange: (v: string) => void; onBlur: () => void; className?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
      placeholder="e.g. 30m, 1h"
      className={cn("h-7 w-20 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40", className)}
    />
  );
}

// ── Quick Cards ───────────────────────────────────────────────────────────────

// ── Top Goals ─────────────────────────────────────────────────────────────────

// ── Dashboard task row ───────────────────────────────────────────────────────

/** Left accent bar per importance — scannable down a column in a way a dot isn't. */
const PRIORITY_BAR: Record<string, string> = {
  high: "bg-rose-500",
  medium: "bg-amber-400",
  low: "bg-slate-400/50",
};

/**
 * A due-date chip that says how urgent the date actually is.
 *
 * Overdue and today are the only two states worth colour: everything else is a
 * quiet grey date. Colouring every future date turns the list into confetti and
 * makes the two states that need attention stop standing out.
 */
function DueChip({ due, today }: { due: string; today: string }) {
  const overdue = due < today;
  const isToday = due === today;
  if (!overdue && !isToday) {
    return (
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/50">
        {formatDateShort(due)}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1 py-px text-[10px] font-medium tabular-nums",
        overdue
          ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
          : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
      )}
    >
      {overdue ? `${daysUntil(due) * -1}d late` : "Today"}
    </span>
  );
}

/**
 * One task on the dashboard.
 *
 * Rewritten from a bare dot-and-title line for three reasons the old row got
 * wrong: its checkbox rendered no tick at all (so completing a task gave no
 * feedback), nothing showed a due date or an estimate on a *today*-focused
 * screen, and the hover affordances were driven by React state, re-rendering the
 * whole list on every mouse move. Hover is now pure CSS via `group/task`.
 *
 * Steps expand inline — a breakdown you can't see from the dashboard may as well
 * not exist, and the whole point of the recursive model is that today's work is
 * usually a step, not a whole task.
 */
function DashTaskRow({
  task, steps, today, expanded, blocksByTask, workedBlockIds,
  onToggleExpand, onToggle, onEdit, onDelete,
}: {
  task: TaskWithContext;
  /** Direct subtasks. Named `steps`, not `children` — that prop name is React's. */
  steps: TaskWithContext[];
  today: string;
  expanded: boolean;
  /** Today's calendar blocks, keyed by the task they commit time to. */
  blocksByTask: Map<number, CalBlock[]>;
  /** Block ids already ticked as worked, so the overview can show what's done. */
  workedBlockIds: Set<number>;
  onToggleExpand: () => void;
  onToggle: (id: number) => void;
  onEdit: () => void;
  onDelete: (id: number) => void;
}) {
  const doneKids = steps.filter((c) => c.done).length;
  const hasKids = steps.length > 0;
  const effort = task.aggregate_estimate || task.time_estimate || 0;
  const plan = planningOf(task);

  return (
    <div className="flex flex-col">
      <div className="group/task flex items-center gap-2 rounded-md pr-1 py-1 hover:bg-secondary/50 transition-colors">
        {/* Importance as a left accent bar. */}
        <span className={cn("w-0.5 self-stretch rounded-full shrink-0", PRIORITY_BAR[task.priority] ?? PRIORITY_BAR.medium)} />

        <button
          onClick={() => onToggle(task.id)}
          disabled={hasKids}
          title={hasKids ? "Finish its steps to complete this" : "Mark done"}
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
            "border-border hover:border-primary hover:bg-primary/10",
            hasKids && "opacity-40 cursor-default hover:bg-transparent hover:border-border",
          )}
        >
          <Check className="h-2.5 w-2.5 opacity-0 group-hover/task:opacity-40 transition-opacity" />
        </button>

        {isFullTask(task) && <UrgencyMeter urgency={plan.urgency} />}

        {/*
          With steps, clicking the title unfolds — that is the gesture people
          reach for, and the planner is still one click away inside. Without
          steps there is nothing to unfold, so the click opens the planner.
        */}
        <button
          onClick={hasKids ? onToggleExpand : onEdit}
          className="flex-1 min-w-0 text-left text-sm truncate hover:text-primary transition-colors"
          title={hasKids ? (expanded ? "Collapse" : "Show steps and today's plan") : task.title}
        >
          {task.title}
        </button>

        {/* Steps — click to reveal them inline. */}
        {hasKids && (
          <button
            onClick={onToggleExpand}
            title={`${doneKids} of ${steps.length} steps done`}
            className="shrink-0 inline-flex items-center gap-1 rounded px-1 py-px text-[10px] tabular-nums text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
            {doneKids}/{steps.length}
          </button>
        )}

        {effort > 0 && <TimeEstimateBadge min={effort} />}
        {task.due_date && <DueChip due={task.due_date} today={today} />}

        <button
          onClick={() => onDelete(task.id)}
          title="Delete"
          className="shrink-0 p-0.5 rounded text-muted-foreground opacity-0 group-hover/task:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {expanded && hasKids && (
        <StepOverview
          steps={steps}
          today={today}
          effortMin={effort}
          doneKids={doneKids}
          blocksByTask={blocksByTask}
          workedBlockIds={workedBlockIds}
          onToggle={onToggle}
          onPlan={onEdit}
        />
      )}
    </div>
  );
}

/**
 * The unfolded view of a broken-down task.
 *
 * Answers two questions the collapsed row can't: how much of this is actually
 * done, and — the one that matters on a dashboard — *what am I supposed to do
 * about it today*. Steps with calendar time today are lifted into their own
 * section at the top with their times; everything else sits below as context.
 *
 * A breakdown that only lists steps is a worse version of the planner. The point
 * of showing it here is the intersection with today.
 */
function StepOverview({
  steps, today, effortMin, doneKids, blocksByTask, workedBlockIds, onToggle, onPlan,
}: {
  steps: TaskWithContext[];
  today: string;
  effortMin: number;
  doneKids: number;
  blocksByTask: Map<number, CalBlock[]>;
  workedBlockIds: Set<number>;
  onToggle: (id: number) => void;
  onPlan: () => void;
}) {
  // Done steps are split out rather than lumped into "remaining" — a completed
  // step listed under that heading reads as outstanding work at a glance, which
  // is the opposite of what it is.
  const scheduledToday = steps.filter((c) => !c.done && (blocksByTask.get(c.id)?.length ?? 0) > 0);
  const scheduledIds = new Set(scheduledToday.map((c) => c.id));
  const remaining = steps.filter((c) => !c.done && !scheduledIds.has(c.id));
  const completed = steps.filter((c) => c.done);
  const pct = steps.length === 0 ? 0 : Math.round((doneKids / steps.length) * 100);

  const todayMinutes = scheduledToday.reduce(
    (sum, c) => sum + (blocksByTask.get(c.id) ?? []).reduce(
      (m, b) => m + blockMinutes(b.start_time, b.end_time), 0),
    0,
  );

  const stepRow = (c: TaskWithContext, blocks: CalBlock[]) => {
    const worked = blocks.length > 0 && blocks.every((b) => workedBlockIds.has(b.id));
    return (
      <div key={c.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-secondary/50 transition-colors">
        <button
          onClick={() => onToggle(c.id)}
          className={cn(
            "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
            c.done ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary",
          )}
        >
          {c.done && <Check className="h-2 w-2" />}
        </button>
        <span className={cn("flex-1 min-w-0 truncate text-xs", c.done && "line-through text-muted-foreground")}>
          {c.title}
        </span>
        {blocks.map((b) => (
          <span
            key={b.id}
            className={cn(
              "shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-px text-[10px] tabular-nums",
              worked ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                     : "bg-blue-500/15 text-blue-600 dark:text-blue-400",
            )}
            title={worked ? "Worked" : `Scheduled ${b.start_time}–${b.end_time}`}
          >
            <CalendarClock className="h-2.5 w-2.5" />{b.start_time}
          </span>
        ))}
        {c.time_estimate ? (
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
            {formatMinutes(c.time_estimate)}
          </span>
        ) : null}
        {c.due_date && <DueChip due={c.due_date} today={today} />}
      </div>
    );
  };

  return (
    <div className="mt-1 ml-1 flex flex-col gap-2 rounded-lg border border-border/60 bg-secondary/20 p-2">
      {/* Summary strip */}
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
          <div
            className={cn("h-full rounded-full transition-all", pct === 100 ? "bg-emerald-500" : "bg-primary")}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {doneKids}/{steps.length} steps
        </span>
        {effortMin > 0 && (
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
            {formatMinutes(effortMin)} total
          </span>
        )}
        <button
          onClick={onPlan}
          className="shrink-0 rounded border border-border px-1.5 py-px text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          Plan
        </button>
      </div>

      {/* Today */}
      {scheduledToday.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-1.5 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              Today
            </span>
            <span className="text-[10px] tabular-nums text-muted-foreground/60">
              {formatMinutes(todayMinutes)} booked
            </span>
          </div>
          {scheduledToday.map((c) => stepRow(c, blocksByTask.get(c.id) ?? []))}
        </div>
      ) : (
        <p className="px-1 text-[10px] text-muted-foreground/60">
          Nothing from this task is on today's calendar.
        </p>
      )}

      {/* Not scheduled today, still to do */}
      {remaining.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50">
            Not scheduled
          </span>
          {remaining.map((c) => stepRow(c, []))}
        </div>
      )}

      {/* Finished */}
      {completed.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/40">
            Done
          </span>
          {completed.map((c) => stepRow(c, []))}
        </div>
      )}
    </div>
  );
}

export function TodoList({
  tasks, allTasks, plans, courseAssignments, blocksByTask, workedBlockIds, onToggleTask, onCreateTask, onDeleteTask, onUpdateTask, onToggleAssignment,
}: {
  /** Top-level tasks to list — already filtered to today. */
  tasks: TaskWithContext[];
  /**
   * Every task, used ONLY to resolve a parent's steps.
   *
   * `tasks` arrives filtered to today, and a step usually has no due date at
   * all — so building the child map from it found nothing, `hasKids` was false,
   * and clicking a broken-down task opened the edit form instead of unfolding.
   * The rows shown stay filtered; only the lookup is global.
   */
  allTasks: TaskWithContext[];
  plans: Plan[];
  courseAssignments: CourseAssignment[];
  blocksByTask: Map<number, CalBlock[]>;
  workedBlockIds: Set<number>;
  onToggleTask: (id: number) => void;
  onCreateTask: (payload: { plan_id?: number | null; title: string; priority?: string; due_date?: string | null; category?: string | null }) => void;
  onDeleteTask: (id: number) => void;
  onUpdateTask: (id: number, payload: { title: string; priority: string; due_date?: string | null; category?: string | null }) => void;
  onToggleAssignment: (ca: CourseAssignment) => void;
}) {
  const [tasksCollapsed, setTasksCollapsed] = useState(false);
  const [studyCollapsed, setStudyCollapsed] = useState(false);
  const [collapsedPlans, setCollapsedPlans] = useState<Set<number | null>>(new Set());

  // Create form state
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPlanId, setNewPlanId] = useState<number | null>(null);
  const [newPriority, setNewPriority] = useState("medium");
  const [newDueDate, setNewDueDate] = useState("");
  const [newCategory, setNewCategory] = useState<string>("");

  // Inline edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPriority, setEditPriority] = useState("medium");
  const [editDueDate, setEditDueDate] = useState("");
  const [editCategory, setEditCategory] = useState<string>("");

  // Which tasks have their steps revealed. Hover affordances are pure CSS now
  // (see DashTaskRow's group/task), so no mouse-move state lives here.
  const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set());
  const toggleTaskExpand = (id: number) =>
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const activePlans = plans.filter((p) => p.status === "active");

  const submitCreate = () => {
    const title = newTitle.trim();
    if (!title) return;
    // A quick task belongs to a category, not a plan — the two are exclusive.
    onCreateTask({
      plan_id: newCategory ? null : newPlanId ?? null,
      title,
      priority: newPriority,
      due_date: newDueDate || null,
      category: newCategory || null,
    });
    setNewTitle(""); setNewPlanId(null); setNewPriority("medium"); setNewDueDate(""); setNewCategory("");
    setShowAdd(false);
  };

  const startEdit = (task: TaskWithContext) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditPriority(task.priority);
    setEditDueDate(task.due_date ?? "");
    setEditCategory(task.category ?? "");
  };

  const submitEdit = (id: number) => {
    const title = editTitle.trim();
    if (!title) { setEditingId(null); return; }
    onUpdateTask(id, { title, priority: editPriority, due_date: editDueDate || null, category: editCategory || null });
    setEditingId(null);
  };

  // Quick tasks (reminder / chore / shopping) are captured on the phone via
  // Nexus Local and are not project work — they now live in the sidebar rail,
  // one panel per category. Leaving them here meant a shopping list competed for
  // attention with the day's actual tasks.
  //
  // Steps live inside their parent row, not beside it. Without this filter a
  // task broken into five steps would occupy six lines on the dashboard, and
  // planning a task more carefully would make the day look busier.
  const childrenByParent = useMemo(() => {
    const m = new Map<number, TaskWithContext[]>();
    for (const t of allTasks) {
      if (t.parent_id == null) continue;
      const b = m.get(t.parent_id);
      if (b) b.push(t); else m.set(t.parent_id, [t]);
    }
    for (const list of m.values()) list.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    return m;
  }, [allTasks]);

  const open = useMemo(() => {
    const p = { high: 0, medium: 1, low: 2 } as Record<string, number>;
    return [...tasks]
      .filter((t) => !t.done && t.parent_id == null && t.category == null)
      // Overdue first, then by importance — the dashboard's job is to surface
      // what is slipping, and a high-priority task due next month should not
      // outrank one that was due yesterday.
      .sort((a, b) => {
        const aLate = a.due_date != null && a.due_date < todayDate() ? 0 : 1;
        const bLate = b.due_date != null && b.due_date < todayDate() ? 0 : 1;
        if (aLate !== bLate) return aLate - bLate;
        return (p[a.priority] ?? 1) - (p[b.priority] ?? 1);
      });
  }, [tasks]);

  // Group open tasks by plan. Quick tasks (category set) group under their
  // category instead — a shopping list under "No plan" reads as clutter, not
  // as a list. Category groups use negative pseudo-ids so they can share the
  // collapse mechanism without colliding with real plan ids.
  const byPlan = useMemo(() => {
    const map = new Map<number | null, { planTitle: string | null; goalTitle: string | null; tasks: TaskWithContext[] }>();
    for (const t of open) {
      const key = t.plan_id;
      if (!map.has(key)) {
        map.set(key, { planTitle: t.plan_title, goalTitle: t.goal_title, tasks: [] });
      }
      map.get(key)!.tasks.push(t);
    }
    // Unplanned work last; named plans keep their natural order otherwise.
    return Array.from(map.entries()).sort(([a], [b]) =>
      (a == null ? 1 : 0) - (b == null ? 1 : 0));
  }, [open]);

  const togglePlan = (planId: number | null) => {
    setCollapsedPlans((prev) => {
      const next = new Set(prev);
      if (next.has(planId)) next.delete(planId); else next.add(planId);
      return next;
    });
  };

  const SectionHeader = ({ icon, label, collapsed, onToggle }: {
    icon: import("react").ReactNode; label: string; collapsed: boolean; onToggle: () => void;
  }) => (
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors w-fit"
    >
      {icon}
      {label}
      {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">

      {/* ── Tasks section ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <SectionHeader
            icon={<CheckSquare className="h-3.5 w-3.5" />}
            label={`Tasks${open.length > 0 ? ` (${open.length})` : ""}`}
            collapsed={tasksCollapsed}
            onToggle={() => setTasksCollapsed((v) => !v)}
          />
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Inline create form */}
        {showAdd && (
          <div className="flex flex-col gap-2 p-2 rounded-md border border-border bg-muted/30">
            <input
              autoFocus
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); if (e.key === "Escape") setShowAdd(false); }}
              placeholder="Task title…"
              className="text-sm bg-transparent border-none outline-none placeholder:text-muted-foreground/50 w-full"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="text-xs bg-input border border-border rounded px-1.5 py-0.5 outline-none"
              >
                <option value="">Task</option>
                <option value="reminder">Reminder</option>
                <option value="chore">Chore</option>
                <option value="shopping">Shopping</option>
              </select>
              {/* Quick tasks don't belong to plans; hide the picker to say so. */}
              {!newCategory && (
                <select
                  value={newPlanId ?? ""}
                  onChange={(e) => setNewPlanId(e.target.value ? Number(e.target.value) : null)}
                  className="text-xs bg-input border border-border rounded px-1.5 py-0.5 outline-none max-w-32"
                >
                  <option value="">No plan</option>
                  {activePlans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              )}
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value)}
                className="text-xs bg-input border border-border rounded px-1.5 py-0.5 outline-none"
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="text-xs bg-input border border-border rounded px-1.5 py-0.5 outline-none"
              />
              <button
                onClick={submitCreate}
                disabled={!newTitle.trim()}
                className="ml-auto text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded disabled:opacity-40 hover:bg-primary/90 transition-colors"
              >
                Add
              </button>
              <button onClick={() => setShowAdd(false)} className="text-xs text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </div>
          </div>
        )}

        {!tasksCollapsed && (
          open.length === 0 ? (
            tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground/60 italic">
                Nothing due today — check Backlog for overdue tasks
              </p>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-green-500 shrink-0" /> All tasks done!
              </div>
            )
          ) : (
            /*
              A grid of group cards, not one long column.
              Each group holds a handful of short titles ("retinol", "mælk"), so a
              full-width row spent ~1000px of horizontal space on ~80px of text and
              pushed everything else below the fold. Cards let the groups sit
              side by side and make each one a scannable unit.
              `items-start` keeps a 2-task card from stretching to match a 6-task
              one — equal-height cards would just reintroduce the empty space.
            */
            <div className="grid gap-2.5 items-start auto-rows-min [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
              {byPlan.map(([planId, group]) => {
                const isPlanCollapsed = collapsedPlans.has(planId);
                return (
                  <div key={planId} className="flex flex-col gap-0.5 rounded-lg border border-border/60 bg-card/40 p-2">
                    {/* Plan group header */}
                    <button
                      onClick={() => togglePlan(planId)}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full min-w-0"
                    >
                      {isPlanCollapsed ? <ChevronRight className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
                      <span className="font-medium truncate" title={[group.planTitle ?? "No plan", group.goalTitle].filter(Boolean).join(" · ")}>{group.planTitle ?? "No plan"}</span>
                      <span className="opacity-50 shrink-0">({group.tasks.length})</span>
                    </button>

                    {!isPlanCollapsed && (
                      <div className="flex flex-col gap-0.5">
                        {group.tasks.map((task) => {
                          const isEditing = editingId === task.id;
                          if (!isEditing) {
                            return (
                              <DashTaskRow
                                key={task.id}
                                task={task}
                                steps={childrenByParent.get(task.id) ?? []}
                                today={todayDate()}
                                expanded={expandedTasks.has(task.id)}
                                blocksByTask={blocksByTask}
                                workedBlockIds={workedBlockIds}
                                onToggleExpand={() => toggleTaskExpand(task.id)}
                                onToggle={onToggleTask}
                                onEdit={() => startEdit(task)}
                                onDelete={onDeleteTask}
                              />
                            );
                          }
                          return (
                            <div key={task.id} className="flex items-start gap-2 py-0.5">
                              <div className="flex-1 min-w-0">
                                {isEditing ? (
                                  <div className="flex flex-col gap-1">
                                    <input
                                      autoFocus
                                      value={editTitle}
                                      onChange={(e) => setEditTitle(e.target.value)}
                                      onKeyDown={(e) => { if (e.key === "Enter") submitEdit(task.id); if (e.key === "Escape") setEditingId(null); }}
                                      onBlur={() => submitEdit(task.id)}
                                      className="text-sm bg-input border border-border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-ring w-full"
                                    />
                                    <div className="flex gap-1.5 items-center">
                                      <select
                                        value={editCategory}
                                        onChange={(e) => setEditCategory(e.target.value)}
                                        className="text-xs bg-input border border-border rounded px-1 py-0.5 outline-none"
                                      >
                                        <option value="">Task</option>
                                        <option value="reminder">Reminder</option>
                                        <option value="chore">Chore</option>
                                        <option value="shopping">Shopping</option>
                                      </select>
                                      <select
                                        value={editPriority}
                                        onChange={(e) => setEditPriority(e.target.value)}
                                        className="text-xs bg-input border border-border rounded px-1 py-0.5 outline-none"
                                      >
                                        <option value="high">High</option>
                                        <option value="medium">Medium</option>
                                        <option value="low">Low</option>
                                      </select>
                                      <input
                                        type="date"
                                        value={editDueDate}
                                        onChange={(e) => setEditDueDate(e.target.value)}
                                        className="text-xs bg-input border border-border rounded px-1 py-0.5 outline-none"
                                      />
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* ── Study section ── */}
      {courseAssignments.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionHeader
            icon={<BookOpen className="h-3.5 w-3.5" />}
            label={`Study (${courseAssignments.length})`}
            collapsed={studyCollapsed}
            onToggle={() => setStudyCollapsed((v) => !v)}
          />
          {!studyCollapsed && (
            <div className="flex flex-col gap-1">
              {courseAssignments.map((ca) => {
                const done = ca.status === "done";
                return (
                  <div key={ca.id} className="flex items-start gap-2 py-0.5">
                    <button
                      onClick={() => onToggleAssignment(ca)}
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                        done ? "bg-primary border-primary" : "border-border hover:border-primary"
                      )}
                    >
                      {done && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className={cn("text-sm truncate block", done && "line-through text-muted-foreground")}>
                        {ca.title}
                      </span>
                      <p className="text-xs text-muted-foreground truncate">{ca.plan_title}</p>
                    </div>
                    {ca.start_time && (
                      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{ca.start_time}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
