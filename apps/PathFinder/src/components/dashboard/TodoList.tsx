// The dashboard's task list: grouped cards, the row, and the recursive
// today-centred unfold.

import { Fragment, useMemo, useRef, useState } from "react";
import {
  CalendarClock, CheckCircle, CheckSquare, Check, ChevronDown, ChevronRight,
  CornerDownRight, Plus, X, BookOpen, Users,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { blockMinutes, flatten, planningOf, isFullTask, subtreeNode } from "../../lib/taskTree";
import type { TaskNode } from "../../lib/taskTree";
import { UrgencyMeter } from "../UrgencyMeter";
import { PRIORITY_BAR } from "../task/taskVisual";
import { DueChip } from "../task/DueChip";
import { TimeEstimateBadge } from "../task/TimeEstimateBadge";
import { memberName, reorderTasks } from "../../lib/api";
import {
  TaskActionMenu, InlineEditText, contextMenuOpener,
  useRowReorder, GripHandle, ReorderIndicator,
} from "../common";
import type { TaskActionCallbacks } from "../common";
import type { Plan, TaskWithContext, CalBlock, CourseAssignment } from "../../types";
import { formatMinutes, todayDate } from "./_shared";
import { taskDragPayload, type DashDragSource } from "./useDashDrag";

// A quiet marker for team tasks — a tiny Users glyph, plus who it's for once
// it's narrowed to a specific member. Unassigned/"all" reads as "the whole
// team", so it gets no name suffix.
function TeamMark({ task }: { task: Pick<TaskWithContext, "team_id" | "assigned_to"> }) {
  if (task.team_id == null) return null;
  const named = task.assigned_to != null && task.assigned_to !== "all";
  return (
    <span
      className="shrink-0 inline-flex items-center gap-0.5 text-muted-foreground/50"
      title={named ? `Team task · ${memberName(task.assigned_to!)}` : "Team task · everyone"}
    >
      <Users className="h-2.5 w-2.5" />
    </span>
  );
}

// Re-exported so WelcomeBox's `import { TimeEstimateBadge } from "./TodoList"`
// keeps resolving after the component moved to components/task/ (spec U3
// Part B — the shared task-visual vocabulary).
export { TimeEstimateBadge };

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

// ── Dashboard task row ───────────────────────────────────────────────────────
//
// PRIORITY_BAR and DueChip now live in components/task/ (spec U3 Part B —
// the shared task-visual vocabulary).

/** Everything a row-level TaskActionMenu needs to do its job, shared by every
 * task surface on the dashboard (top-level rows, nested steps, Now panel). */
export interface TaskRowActions {
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onRename: (id: number, title: string) => void;
  onOpenPlanner: (id: number) => void;
  /** Called after a schedule/due quick-action succeeds — the caller reloads
   * whatever state that action touched (calendar blocks, due dates, …). */
  onReload: () => void;
  onError: (message: string) => void;
}

function rowActionCallbacks(actions: Pick<TaskRowActions, "onReload" | "onError">, extra: {
  onRename: () => void; onOpen: () => void; onDelete: () => void;
}): TaskActionCallbacks {
  return {
    onScheduleToday: () => actions.onReload(),
    onScheduleTomorrow: () => actions.onReload(),
    onDueToday: () => actions.onReload(),
    onDueTomorrow: () => actions.onReload(),
    onRename: extra.onRename,
    onOpen: extra.onOpen,
    onDelete: extra.onDelete,
    onError: actions.onError,
  };
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
 * The expand chevron is a fixed-width leading slot next to the checkbox — its
 * own click target, distinct from the checkbox and from the title. The title
 * itself opens the planner on a single click; a fast second click (the start of
 * a double-click) cancels that and hands off to inline rename instead. The
 * single-click action is deliberately delayed rather than fired immediately:
 * TaskPlanner is a full-screen dialog, so once it's open a genuine second
 * physical click can never land back on this row to trigger a double-click.
 */
function DashTaskRow({
  task, steps, today, expanded, actions, onToggleExpand, drag,
}: {
  task: TaskWithContext;
  /** Direct subtasks. Named `steps`, not `children` — that prop name is React's. */
  steps: TaskWithContext[];
  today: string;
  expanded: boolean;
  actions: TaskRowActions;
  onToggleExpand: () => void;
  /** Present → the row body can be dragged onto the day calendar. */
  drag?: DashDragSource;
}) {
  const doneKids = steps.filter((c) => c.done).length;
  const hasKids = steps.length > 0;
  const effort = task.aggregate_estimate || task.time_estimate || 0;
  const plan = planningOf(task);

  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const openTimer = useRef<number | null>(null);

  const scheduleOpen = () => {
    // The click the browser fires right after a drag-to-calendar's pointerup
    // must not open the planner — same swallow contract as the week grid.
    if (drag?.consumeWasDrag()) return;
    if (openTimer.current != null) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      actions.onOpenPlanner(task.id);
    }, 220);
  };
  const cancelOpen = () => {
    if (openTimer.current != null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };

  return (
    <div className="flex flex-col">
      {/*
        Density pass (spec U3 Part C): first glance is priority bar, checkbox,
        title, due chip — everything a scan of the list needs. Urgency,
        estimate and step count are real but secondary, so they're demoted
        into one subdued cluster (smaller, muted, grouped right, opacity-60
        rising to 100 on row hover) rather than hidden outright — hover-only
        data is lost data on a laptop trackpad, and touch has no hover at all.
      */}
      <div
        className={cn(
          "group/task flex items-center gap-2 rounded-md pr-1 py-1 hover:bg-secondary/50 transition-colors",
          drag?.draggingTaskId === task.id && "opacity-40",
        )}
        onContextMenu={contextMenuOpener(setMenuOpen)}
        // Drag the row body onto the day calendar to schedule it. Below the
        // 4px threshold this is inert and every click target works as before;
        // interactive children are excluded inside the hook.
        onPointerDown={drag ? (e) => drag.onTaskDragPointerDown(e, taskDragPayload(task)) : undefined}
      >
        {/* Importance as a left accent bar. */}
        <span className={cn("w-0.5 self-stretch rounded-full shrink-0", PRIORITY_BAR[task.priority] ?? PRIORITY_BAR.medium)} />

        <button
          onClick={() => actions.onToggle(task.id)}
          disabled={hasKids}
          title={hasKids ? "Finish its steps to complete this" : task.done ? "Mark not done" : "Mark done"}
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
            task.done
              ? "bg-primary border-primary text-primary-foreground"
              : "border-border hover:border-primary hover:bg-primary/10",
            hasKids && "opacity-40 cursor-default hover:bg-transparent hover:border-border",
          )}
        >
          <Check className={cn("h-2.5 w-2.5 transition-opacity", task.done ? "opacity-100" : "opacity-0 group-hover/task:opacity-40")} />
        </button>

        {/* Fold control — a fixed slot even when empty, so titles across rows
            stay aligned (BreakdownTree's idiom). Distinct from the checkbox and
            from the title's own click target. */}
        <button
          onClick={() => hasKids && onToggleExpand()}
          title={hasKids ? (expanded ? "Collapse" : "Show steps") : undefined}
          className={cn(
            "h-3.5 w-3.5 shrink-0 flex items-center justify-center rounded text-muted-foreground transition-colors",
            hasKids ? "hover:bg-secondary hover:text-foreground" : "opacity-0 pointer-events-none",
          )}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>

        <div
          className="flex-1 min-w-0"
          onClick={scheduleOpen}
          onDoubleClick={cancelOpen}
        >
          <InlineEditText
            value={task.title}
            editing={renaming}
            onEditingChange={setRenaming}
            onCommit={(v) => actions.onRename(task.id, v)}
            className="block text-left text-sm truncate hover:text-primary transition-colors cursor-pointer"
            inputClassName="text-sm w-full"
          />
        </div>

        {/* Meta cluster — subdued, grouped right; brightens on row hover. */}
        <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground opacity-60 transition-opacity group-hover/task:opacity-100">
          {isFullTask(task) && <UrgencyMeter urgency={plan.urgency} />}

          {hasKids && (
            <button
              onClick={onToggleExpand}
              title={`${doneKids} of ${steps.length} steps done`}
              className="shrink-0 inline-flex items-center gap-1 rounded px-1 py-px text-[10px] tabular-nums hover:bg-secondary hover:text-foreground transition-colors"
            >
              {doneKids}/{steps.length}
            </button>
          )}

          {effort > 0 && <TimeEstimateBadge min={effort} />}
          <TeamMark task={task} />
        </div>

        {task.due_date && <DueChip due={task.due_date} today={today} />}

        <div className="shrink-0 opacity-0 group-hover/task:opacity-100 focus-within:opacity-100 transition-opacity">
          <TaskActionMenu
            task={task}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            callbacks={rowActionCallbacks(actions, {
              onRename: () => setRenaming(true),
              onOpen: () => actions.onOpenPlanner(task.id),
              onDelete: () => actions.onDelete(task.id),
            })}
          />
        </div>
      </div>
    </div>
  );
}

/** Minimal, always-focused input for adding a step under a given parent — Enter
 * commits and immediately reopens for the next one, Escape or an empty blur
 * closes it. Lighter than BreakdownTree's `NewRowInput` (no per-field extras),
 * same keyboard idiom. */
function QuickAddStep({ depth, onCommit, onDone }: {
  /** The DEPTH THE NEW STEP WILL HAVE (parent depth + 1), matching StepRow's indent scale. */
  depth: number;
  onCommit: (title: string) => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  // Enter clears the input to accept another step; committing again on the
  // blur that follows would resubmit the same (now-empty) value, so this
  // guard makes blur a no-op once Enter has already handled it.
  const committed = useRef(false);

  return (
    // +42 = the old chevron offset (22) plus the reorder grip slot step rows
    // now carry (~20px), keeping the input aligned under sibling titles.
    <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: `${(depth - 1) * 18 + 42}px` }}>
      <Plus className="h-3 w-3 shrink-0 text-muted-foreground/40" />
      <input
        autoFocus
        value={value}
        placeholder="Step title — Enter for another, Esc to finish"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const v = value.trim();
            if (!v) { committed.current = true; onDone(); return; }
            onCommit(v);
            setValue("");
          }
          if (e.key === "Escape") { committed.current = true; onDone(); }
        }}
        onBlur={() => {
          if (committed.current) return;
          const v = value.trim();
          if (v) onCommit(v);
          onDone();
        }}
        className="flex-1 min-w-0 bg-transparent border-b border-primary/40 text-xs outline-none py-0.5 placeholder:text-muted-foreground/40"
      />
    </div>
  );
}

interface StepTreeCtx {
  today: string;
  blocksByTask: Map<number, CalBlock[]>;
  workedBlockIds: Set<number>;
  actions: TaskRowActions;
  collapsed: Set<number>;
  onToggleCollapse: (id: number) => void;
  composingUnder: number | null;
  setComposingUnder: (id: number | null) => void;
  onAddSubtask: (parentId: number, title: string) => void;
  /** Commits a new sibling order (the COMPLETE ordered id list of one
   *  parent's children) and refreshes. */
  onReorderSteps: (orderedSiblingIds: number[]) => void;
  /** Present → step rows can be dragged onto the day calendar. */
  drag?: DashDragSource;
}

/**
 * One sibling group of the step tree — a parent's direct children, plus the
 * drag-to-reorder gesture scoped to exactly that group (so a step can never
 * be dragged into a different parent; re-parenting stays the planner's job).
 * The wrapper div registered per row is the row PLUS its expanded subtree,
 * so the insertion line lands after everything a row visually owns.
 */
function StepChildren({ nodes, ctx }: { nodes: TaskNode[]; ctx: StepTreeCtx }) {
  const reorder = useRowReorder(nodes.map((n) => n.task.id), ctx.onReorderSteps);
  return (
    <>
      {nodes.map((node, i) => (
        <Fragment key={node.task.id}>
          {reorder.insertion === i && <ReorderIndicator />}
          <div
            ref={reorder.registerRow(node.task.id)}
            className={cn(reorder.draggingId === node.task.id && "opacity-40")}
          >
            <StepRow node={node} ctx={ctx} dragHandle={reorder.handlePointerDown(node.task.id)} />
          </div>
        </Fragment>
      ))}
      {reorder.insertion === nodes.length && <ReorderIndicator />}
    </>
  );
}

/** One step's row, recursing into its own children. Mirrors BreakdownTree's
 * indent idiom exactly ((depth-1)*18px) so the two recursive task trees in
 * this app read the same way. */
function StepRow({ node, ctx, dragHandle }: {
  node: TaskNode;
  ctx: StepTreeCtx;
  /** Grip pointerdown from the enclosing StepChildren's reorder gesture. */
  dragHandle?: (e: React.PointerEvent) => void;
}) {
  const t = node.task;
  const hasChildren = node.children.length > 0;
  const isCollapsed = ctx.collapsed.has(t.id);
  const blocks = ctx.blocksByTask.get(t.id) ?? [];
  const worked = blocks.length > 0 && blocks.every((b) => ctx.workedBlockIds.has(b.id));
  const effort = t.aggregate_estimate || t.time_estimate || 0;

  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          "group flex items-center gap-1.5 rounded-md px-1 py-1 hover:bg-secondary/50 transition-colors",
          ctx.drag?.draggingTaskId === t.id && "opacity-40",
        )}
        style={{ paddingLeft: `${(node.depth - 1) * 18}px` }}
        onContextMenu={contextMenuOpener(setMenuOpen)}
        // Row-body drag schedules the step onto the day calendar; the grip
        // below owns reordering (its own pointerdown stops propagation).
        onPointerDown={ctx.drag ? (e) => ctx.drag!.onTaskDragPointerDown(e, taskDragPayload(t)) : undefined}
      >
        {dragHandle && (
          <GripHandle
            onPointerDown={dragHandle}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 -ml-0.5"
          />
        )}
        <button
          type="button"
          onClick={() => hasChildren && ctx.onToggleCollapse(t.id)}
          className={cn(
            "h-3.5 w-3.5 shrink-0 flex items-center justify-center rounded text-muted-foreground transition-colors",
            hasChildren ? "hover:bg-secondary hover:text-foreground" : "opacity-0 pointer-events-none",
          )}
        >
          {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        <button
          onClick={() => ctx.actions.onToggle(t.id)}
          disabled={hasChildren}
          title={hasChildren ? "Finish its steps to complete this" : t.done ? "Mark not done" : "Mark done"}
          className={cn(
            "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
            t.done ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary",
            hasChildren && "opacity-60 cursor-default",
          )}
        >
          {t.done && <Check className="h-2 w-2" />}
        </button>

        <InlineEditText
          value={t.title}
          editing={renaming}
          onEditingChange={setRenaming}
          onCommit={(v) => ctx.actions.onRename(t.id, v)}
          className={cn("flex-1 min-w-0 truncate text-xs cursor-text", t.done && "line-through text-muted-foreground")}
          inputClassName="text-xs"
        />

        <TeamMark task={t} />

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

        {effort > 0 && (
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
            {formatMinutes(effort)}
          </span>
        )}

        {t.due_date && <DueChip due={t.due_date} today={ctx.today} />}

        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            title="Add sub-step"
            onClick={() => ctx.setComposingUnder(t.id)}
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            <CornerDownRight className="h-3 w-3" />
          </button>
          <TaskActionMenu
            task={t}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            callbacks={rowActionCallbacks(ctx.actions, {
              onRename: () => setRenaming(true),
              onOpen: () => ctx.actions.onOpenPlanner(t.id),
              onDelete: () => ctx.actions.onDelete(t.id),
            })}
          />
        </div>
      </div>

      {!isCollapsed && node.children.length > 0 && (
        <StepChildren nodes={node.children} ctx={ctx} />
      )}

      {ctx.composingUnder === t.id && (
        <QuickAddStep
          depth={node.depth + 1}
          onCommit={(title) => ctx.onAddSubtask(t.id, title)}
          onDone={() => ctx.setComposingUnder(null)}
        />
      )}
    </div>
  );
}

/**
 * The unfolded view of a broken-down task — now a real recursive tree instead
 * of one flat list, so a step's own steps are visible instead of silently
 * absorbed into "not scheduled". Spans the full grid width (see the call
 * site) so a deep breakdown has somewhere to put its indentation.
 *
 * The summary strip still counts only direct children (what "steps" has
 * always meant on this card), plus a today-booked total gathered from the
 * WHOLE subtree — a grandchild scheduled today should still show up here even
 * though it no longer gets its own "Today" section.
 */
function TaskExpandPanel({
  root, today, blocksByTask, workedBlockIds, actions, onAddSubtask, drag,
}: {
  root: TaskNode;
  today: string;
  blocksByTask: Map<number, CalBlock[]>;
  workedBlockIds: Set<number>;
  actions: TaskRowActions;
  onAddSubtask: (parentId: number, title: string) => void;
  drag?: DashDragSource;
}) {
  const steps = root.children;
  const doneKids = steps.filter((n) => n.task.done).length;
  const pct = steps.length === 0 ? 0 : Math.round((doneKids / steps.length) * 100);
  const effortMin = root.task.aggregate_estimate || root.task.time_estimate || 0;

  const todayMinutes = useMemo(() => flatten(root)
    .filter((n) => n.task.id !== root.task.id)
    .reduce((sum, n) => sum + (blocksByTask.get(n.task.id) ?? [])
      .reduce((m, b) => m + blockMinutes(b.start_time, b.end_time), 0), 0),
  [root, blocksByTask]);

  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [composingUnder, setComposingUnder] = useState<number | null>(null);

  const ctx: StepTreeCtx = {
    today, blocksByTask, workedBlockIds, actions,
    collapsed,
    onToggleCollapse: (id) => setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    }),
    composingUnder, setComposingUnder,
    onAddSubtask,
    // Dashboard holds no React Query cache — plain API call, then the page's
    // own reload picks up the new sort_order (the spec'd commit contract).
    onReorderSteps: async (orderedSiblingIds) => {
      await reorderTasks(orderedSiblingIds);
      actions.onReload();
    },
    drag,
  };

  const composingAtRoot = composingUnder === root.task.id;

  return (
    <div className="mt-1 flex flex-col gap-2 rounded-lg border border-border/60 bg-secondary/20 p-2">
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
        {todayMinutes > 0 && (
          <span className="shrink-0 text-[10px] tabular-nums text-emerald-600 dark:text-emerald-400">
            {formatMinutes(todayMinutes)} booked today
          </span>
        )}
        <button
          onClick={() => actions.onOpenPlanner(root.task.id)}
          className="shrink-0 rounded border border-border px-1.5 py-px text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          Plan
        </button>
      </div>

      {steps.length === 0 ? (
        <p className="px-1 text-[10px] text-muted-foreground/60">No steps yet.</p>
      ) : (
        <div className="flex flex-col gap-0.5">
          <StepChildren nodes={steps} ctx={ctx} />
        </div>
      )}

      {composingAtRoot ? (
        <QuickAddStep
          depth={1}
          onCommit={(title) => onAddSubtask(root.task.id, title)}
          onDone={() => setComposingUnder(null)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setComposingUnder(root.task.id)}
          className="self-start inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
        >
          <Plus className="h-3 w-3" /> Add step
        </button>
      )}
    </div>
  );
}

export function TodoList({
  tasks, allTasks, plans, courseAssignments, blocksByTask, workedBlockIds,
  onToggleTask, onCreateTask, onDeleteTask, onRenameTask, onAddSubtask, onOpenPlanner,
  onReload, onToggleAssignment, notice, onDismissNotice, onError, drag,
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
  onRenameTask: (id: number, title: string) => void;
  onAddSubtask: (parentId: number, title: string) => void;
  onOpenPlanner: (id: number) => void;
  /** Refetches whatever a schedule/due quick-action or a step add touched. */
  onReload: () => void;
  onToggleAssignment: (ca: CourseAssignment) => void;
  /** A dismissible error surfaced from any row's TaskActionMenu (e.g. "no free slot"). */
  notice: string | null;
  onDismissNotice: () => void;
  onError: (message: string) => void;
  /** Dashboard's drag-to-calendar source handle — rows become draggable onto
   *  the day rail when present. */
  drag?: DashDragSource;
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

  // Which tasks have their steps revealed. Hover affordances are pure CSS now
  // (see DashTaskRow's group/task), so no mouse-move state lives here.
  const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set());
  const toggleTaskExpand = (id: number) =>
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const rowActions: TaskRowActions = {
    onToggle: onToggleTask,
    onDelete: onDeleteTask,
    onRename: onRenameTask,
    onOpenPlanner,
    onReload,
    onError,
  };

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

      {notice && (
        <div className="flex items-center gap-2 rounded-md border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          <span className="flex-1 min-w-0">{notice}</span>
          <button
            onClick={onDismissNotice}
            title="Dismiss"
            className="shrink-0 rounded p-0.5 hover:bg-amber-500/20 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

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

              An expanded task's tree breaks out of its plan-card and becomes its
              OWN grid item spanning every column (`grid-column: 1 / -1`) — a deep
              breakdown needs width a 280px card can't give it, and nesting it
              inside the card would clip. That only works because it's a direct
              child of THIS grid, not of the flex-column card.
            */
            <div className="grid gap-2.5 items-start auto-rows-min [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
              {byPlan.flatMap(([planId, group]) => {
                const isPlanCollapsed = collapsedPlans.has(planId);
                const expandedInGroup = isPlanCollapsed ? [] : group.tasks.filter((t) => expandedTasks.has(t.id));

                const card = (
                  <div key={`plan-${planId}`} className="flex flex-col gap-0.5 rounded-lg border border-border/60 bg-card/40 p-2">
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
                        {group.tasks.map((task) => (
                          <DashTaskRow
                            key={task.id}
                            task={task}
                            steps={childrenByParent.get(task.id) ?? []}
                            today={todayDate()}
                            expanded={expandedTasks.has(task.id)}
                            actions={rowActions}
                            onToggleExpand={() => toggleTaskExpand(task.id)}
                            drag={drag}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );

                const expansions = expandedInGroup.map((task) => {
                  const root = subtreeNode(allTasks, task.id);
                  if (!root) return null;
                  return (
                    <div key={`expand-${task.id}`} style={{ gridColumn: "1 / -1" }}>
                      <TaskExpandPanel
                        root={root}
                        today={todayDate()}
                        blocksByTask={blocksByTask}
                        workedBlockIds={workedBlockIds}
                        actions={rowActions}
                        onAddSubtask={onAddSubtask}
                        drag={drag}
                      />
                    </div>
                  );
                }).filter(Boolean);

                return [card, ...expansions];
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
