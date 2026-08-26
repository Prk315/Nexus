import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { Plus, Search, ListChecks, AlertTriangle, ListTree } from "lucide-react";
import {
  useTasks, usePlans, useToggleTask, useDeleteTask, useUpdateTask,
  useRescheduleTask, useMoveTask, useCreateTask, useReorderTasks,
  useSetKanbanStatus, useSetPriority, useSetAssignee,
} from "../../hooks/useTasks";
import { useTaskScheduling, useSetTaskMatrix, useSetTaskStage } from "../../hooks/useTaskPlanning";
import { qk } from "../../lib/queryClient";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Dialog, DialogContent } from "../ui/dialog";
import { cn, STAGE_LABEL, STAGE_ORDER, STAGE_HINT } from "../../lib/utils";
import {
  AXIS, buildForest, cellAdvice, cellKey, parseCellKey, flatten,
  rollupEstimate, rollupCoverage, isWorkable, isFullTask, planningOf,
  type TaskNode,
} from "../../lib/taskTree";
import type { TaskWithContext, Priority, Urgency, TaskStage } from "../../types";
import { TaskRow, type RowPlanning } from "./TaskRow";
import {
  AddTaskForm, EditTaskForm, ReschedulePopover, SubtypeFields, type TaskFormState,
} from "./TaskDialogs";
import { getTaskSubtype, saveTaskSubtype, getTeamMembers, type TeamMember } from "../../lib/api";
import { TaskPlanner } from "./TaskPlanner";
import { StudySection } from "./StudySection";

/**
 * What board this is. Personal is the default everywhere except the Team
 * page — `pages/Workspace.tsx` never passes this, so it keeps seeing exactly
 * the tasks/plans it always did (`team_id == null`).
 */
export type TaskBoardScope = { kind: "personal" } | { kind: "team"; teamId: string };

type GroupMode = "time" | "matrix" | "stage" | "plan" | "goal" | "priority" | "status";

const GROUP_MODES: { id: GroupMode; label: string }[] = [
  { id: "time", label: "Time" },
  { id: "matrix", label: "Matrix" },
  { id: "stage", label: "Stage" },
  { id: "plan", label: "Plan" },
  { id: "goal", label: "Goal" },
  { id: "priority", label: "Priority" },
  { id: "status", label: "Status" },
];

const TODAY = new Date().toISOString().slice(0, 10);

function weekEnd(): string {
  const d = new Date(TODAY + "T12:00:00");
  const daysToSun = (7 - d.getDay()) % 7;
  d.setDate(d.getDate() + daysToSun);
  return d.toISOString().slice(0, 10);
}
const WEEK_END = weekEnd();

// A representative due date for the "Later" time bucket (a week past week-end).
function laterDate(): string {
  const d = new Date(WEEK_END + "T12:00:00");
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}
const LATER_DATE = laterDate();

// Which lenses support cross-bucket dragging, and how a drop is interpreted.
const DND_LENSES = new Set<GroupMode>(["time", "matrix", "stage", "plan", "priority", "status"]);

// The bucket key a task currently lives in, for a given lens (mirrors `buckets`).
function bucketKeyForTask(t: TaskWithContext, group: GroupMode): string {
  if (group === "time") {
    if (t.due_date == null) return "unscheduled";
    if (t.due_date < TODAY) return "overdue";
    if (t.due_date === TODAY) return "today";
    if (t.due_date <= WEEK_END) return "week";
    return "later";
  }
  if (group === "matrix") return cellKey(t.priority, planningOf(t).urgency);
  if (group === "stage") return planningOf(t).stage;
  if (group === "plan") return String(t.plan_id);
  if (group === "priority") return t.priority;
  if (group === "status") return t.kanban_status || "backlog";
  return "";
}

// ── Drag-and-drop wrappers (whole-row drag; distance constraint keeps buttons clickable) ──

function DraggableRow({ id, children }: { id: number; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn("cursor-grab active:cursor-grabbing rounded-md", isDragging && "opacity-40")}
    >
      {children}
    </div>
  );
}

function DroppableSection({ id, isSource, disabled, children }: {
  id: string; isSource: boolean; disabled?: boolean; children: React.ReactNode;
}) {
  const { setNodeRef, isOver, active } = useDroppable({ id, disabled });
  // Highlight only when a drag is in flight and this isn't the task's own bucket.
  const armed = active != null && !isSource && !disabled;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg transition-colors",
        armed && "outline-dashed outline-1 outline-border/60",
        isOver && armed && "outline-primary/70 bg-primary/5",
      )}
    >
      {children}
    </div>
  );
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
const STATUS_ORDER = ["backlog", "todo", "next", "in_progress", "doing", "blocked", "review", "done"];

interface Bucket { key: string; label: string; accent?: string; tasks: TaskWithContext[]; }

function byDueThenPriority(a: TaskWithContext, b: TaskWithContext) {
  const ad = a.due_date ?? "9999-12-31";
  const bd = b.due_date ?? "9999-12-31";
  if (ad !== bd) return ad.localeCompare(bd);
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

export function TaskBoard({ selectedPlanId, selectedGoalId, reloadSignal, scope = { kind: "personal" } }: {
  selectedPlanId?: number | null;
  selectedGoalId?: number | null;
  reloadSignal?: number;
  scope?: TaskBoardScope;
}) {
  const { data: tasks = [] } = useTasks();
  const { data: plans = [] } = usePlans();
  const { data: coverage = new Map() } = useTaskScheduling();
  const teamId = scope.kind === "team" ? scope.teamId : null;

  // Team members, for the assignment control — fetched once per team, not
  // per row. Empty on the personal board, where nothing renders it.
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  useEffect(() => {
    if (!teamId) { setTeamMembers([]); return; }
    let live = true;
    getTeamMembers(teamId).then((m) => { if (live) setTeamMembers(m); }).catch(() => {});
    return () => { live = false; };
  }, [teamId]);
  const [group, setGroup] = useState<GroupMode>("time");
  const [search, setSearch] = useState("");
  const [showDone, setShowDone] = useState(false);
  // Subtasks are steps *inside* a task, not board items. Showing them by default
  // would flood the board with fragments the moment anything is broken down.
  const [showSteps, setShowSteps] = useState(false);
  const [planFilter, setPlanFilter] = useState<string>(""); // "" = all

  // Editing splits by subtype: a full task opens the three-step planner, a sparse
  // kind opens the small form. Handing a shopping item a breakdown tree and a
  // lifecycle rail would be the single-wide-table mistake all over again.
  const [planning, setPlanning] = useState<number | null>(null);
  const [editingSimple, setEditingSimple] = useState<TaskWithContext | null>(null);
  const [adding, setAdding] = useState(false);
  const [rescheduling, setRescheduling] = useState<TaskWithContext | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);

  // Sibling rails (Navigator, Systems) still mutate via direct api calls and bump
  // `reloadSignal`; refresh our cached reads when that happens (skip the initial mount).
  const qc = useQueryClient();
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    qc.invalidateQueries({ queryKey: qk.tasks });
    qc.invalidateQueries({ queryKey: qk.plans });
  }, [reloadSignal, qc]);

  // Plans that hold tasks (exclude schedule/course containers), scoped the
  // same way tasks are — a personal board must not offer a team's plan in the
  // "move to plan" / "new task" pickers, and vice versa.
  const taskPlans = useMemo(
    () => plans.filter((p) => !p.is_schedule && !p.is_course && (teamId ? p.team_id === teamId : p.team_id == null)),
    [plans, teamId],
  );

  // Mutation hooks — each optimistically patches the tasks cache (see useTasks.ts).
  const toggle = useToggleTask();
  const del = useDeleteTask();
  const update = useUpdateTask();
  const reschedule = useRescheduleTask();
  const move = useMoveTask(plans);
  const create = useCreateTask();
  const reorder = useReorderTasks();
  const setStatus = useSetKanbanStatus();
  const setPriority = useSetPriority();
  const setMatrix = useSetTaskMatrix();
  const setStage = useSetTaskStage();
  const setAssignee = useSetAssignee();

  // ── Breakdown-aware facts, computed once per task list ──────────────────────
  // The forest is built from every task (not the filtered view) so a parent's
  // roll-up stays correct even when its steps are hidden or filtered out.
  const nodesById = useMemo(() => {
    const map = new Map<number, TaskNode>();
    for (const root of buildForest(tasks)) {
      for (const n of flatten(root)) map.set(n.task.id, n);
    }
    return map;
  }, [tasks]);

  const planningFor = (t: TaskWithContext): RowPlanning | undefined => {
    const node = nodesById.get(t.id);
    if (!node) return undefined;
    return {
      subtaskCount: node.children.length,
      doneSubtasks: node.children.filter((c) => c.task.done).length,
      estimateMin: rollupEstimate(node),
      scheduledMin: rollupCoverage(node, coverage).scheduledMin,
      workable: isWorkable(node, coverage),
    };
  };

  // ── Drag and drop ────────────────────────────────────────────────────────────
  // Drag a task onto another bucket to act on it — the action depends on the lens:
  //   time → reschedule · matrix → set both axes · stage → advance lifecycle
  //   plan → move plan · priority → set priority · status → set status.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [dragId, setDragId] = useState<number | null>(null);
  const dndOn = DND_LENSES.has(group);
  const draggingTask = dragId != null ? tasks.find((t) => t.id === dragId) ?? null : null;

  const onDragStart = (e: DragStartEvent) => { setGateError(null); setDragId(Number(e.active.id)); };
  const onDragEnd = async (e: DragEndEvent) => {
    setDragId(null);
    const { active, over } = e;
    if (!over) return;
    const task = tasks.find((t) => t.id === Number(active.id));
    if (!task) return;
    const target = String(over.id);
    if (target === bucketKeyForTask(task, group)) return; // dropped in its own bucket

    if (group === "time") {
      if (target === "today") reschedule.mutate({ task, due_date: TODAY });
      else if (target === "week") reschedule.mutate({ task, due_date: WEEK_END });
      else if (target === "later") reschedule.mutate({ task, due_date: LATER_DATE });
      else if (target === "unscheduled") reschedule.mutate({ task, due_date: null });
      // overdue / done are not valid drop destinations — ignore.
    } else if (group === "matrix") {
      const cell = parseCellKey(target);
      if (cell) setMatrix.mutate({ id: task.id, importance: cell.importance, urgency: cell.urgency });
    } else if (group === "stage") {
      // The gate lives in setTaskStage and rejects `active` for unscheduled work.
      // Surface the refusal — a drag that silently snaps back reads as a bug.
      try {
        await setStage.mutateAsync({ id: task.id, stage: target as TaskStage });
      } catch (err) {
        setGateError(typeof err === "string" ? err : "Could not change stage.");
      }
    } else if (group === "plan") {
      move.mutate({ id: task.id, planId: target === "null" ? null : Number(target) });
    } else if (group === "priority") {
      if (target === "high" || target === "medium" || target === "low")
        setPriority.mutate({ task, priority: target });
    } else if (group === "status") {
      setStatus.mutate({ id: task.id, status: target });
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (!showDone && t.done) return false;
      if (!showSteps && t.parent_id != null) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      if (selectedPlanId != null && t.plan_id !== selectedPlanId) return false;
      if (selectedGoalId != null && t.goal_id !== selectedGoalId) return false;
      if (planFilter && String(t.plan_id) !== planFilter) return false;
      if (teamId ? t.team_id !== teamId : t.team_id != null) return false;
      return true;
    });
  }, [tasks, search, showDone, showSteps, planFilter, selectedPlanId, selectedGoalId, teamId]);

  const buckets = useMemo<Bucket[]>(() => {
    const open = filtered.filter((t) => !t.done);
    const done = filtered.filter((t) => t.done);

    if (group === "time") {
      const b: Record<string, TaskWithContext[]> = { overdue: [], today: [], week: [], later: [], unscheduled: [] };
      for (const t of open) {
        if (t.due_date == null) b.unscheduled.push(t);
        else if (t.due_date < TODAY) b.overdue.push(t);
        else if (t.due_date === TODAY) b.today.push(t);
        else if (t.due_date <= WEEK_END) b.week.push(t);
        else b.later.push(t);
      }
      const out: Bucket[] = [
        { key: "overdue", label: "Overdue", accent: "text-rose-500", tasks: b.overdue.sort(byDueThenPriority) },
        { key: "today", label: "Today", accent: "text-emerald-500", tasks: b.today.sort(byDueThenPriority) },
        { key: "week", label: "This week", tasks: b.week.sort(byDueThenPriority) },
        { key: "later", label: "Later", accent: "text-muted-foreground", tasks: b.later.sort(byDueThenPriority) },
        { key: "unscheduled", label: "Unscheduled", accent: "text-muted-foreground", tasks: b.unscheduled.sort(byDueThenPriority) },
      ].filter((x) => x.tasks.length > 0);
      if (showDone && done.length) out.push({ key: "done", label: "Completed", accent: "text-muted-foreground", tasks: done.sort(byDueThenPriority) });
      return out;
    }

    if (group === "matrix") {
      // Every cell is emitted, empty or not — an empty quadrant is the useful
      // signal ("nothing is urgent-and-important"), and a grid with holes in it
      // would not read as a matrix.
      // Only full tasks sit on the matrix — the sparse kinds have no urgency
      // axis, and scattering shopping items across nine cells would be noise.
      const all = (showDone ? [...open, ...done] : open).filter(isFullTask);
      return AXIS.flatMap((imp) =>
        AXIS.map((urg) => ({
          key: cellKey(imp as Priority, urg as Urgency),
          label: cellAdvice(imp as Priority, urg as Urgency),
          tasks: all
            .filter((t) => t.priority === imp && planningOf(t).urgency === urg)
            .sort(byDueThenPriority),
        })),
      );
    }

    if (group === "stage") {
      // Likewise: only the `task` subtype has a lifecycle to be grouped by.
      const all = [...open, ...(showDone ? done : [])].filter(isFullTask);
      return STAGE_ORDER.map((s) => ({
        key: s,
        label: STAGE_LABEL[s],
        tasks: all.filter((t) => planningOf(t).stage === s).sort(byDueThenPriority),
      })).filter((x) => x.tasks.length > 0 || x.key !== "done");
    }

    if (group === "priority") {
      const order: Priority[] = ["high", "medium", "low"];
      const labels: Record<Priority, string> = { high: "High priority", medium: "Medium priority", low: "Low priority" };
      return order
        .map((p) => ({ key: p, label: labels[p], tasks: [...open, ...done].filter((t) => t.priority === p).sort((a, bb) => Number(a.done) - Number(bb.done) || byDueThenPriority(a, bb)) }))
        .filter((x) => x.tasks.length > 0);
    }

    if (group === "status") {
      const all = [...open, ...done];
      const keys = Array.from(new Set(all.map((t) => t.kanban_status || "backlog")));
      keys.sort((a, bb) => {
        const ia = STATUS_ORDER.indexOf(a), ib = STATUS_ORDER.indexOf(bb);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
      return keys
        .map((k) => ({ key: k, label: k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), tasks: all.filter((t) => (t.kanban_status || "backlog") === k).sort(byDueThenPriority) }))
        .filter((x) => x.tasks.length > 0);
    }

    // plan | goal
    const keyOf = (t: TaskWithContext) => group === "plan" ? String(t.plan_id) : String(t.goal_id);
    const labelOf = (t: TaskWithContext) => group === "plan" ? (t.plan_title ?? "No plan") : (t.goal_title ?? "No goal");
    const map = new Map<string, Bucket>();
    const all = [...open, ...done];
    for (const t of all) {
      const k = keyOf(t);
      if (!map.has(k)) map.set(k, { key: k, label: labelOf(t), tasks: [] });
      map.get(k)!.tasks.push(t);
    }
    const arr = Array.from(map.values());
    // Within a plan group, order by sort_order (enables reordering); otherwise by due/priority.
    for (const bkt of arr) {
      bkt.tasks.sort(group === "plan"
        ? (a, bb) => Number(a.done) - Number(bb.done) || (a.sort_order - bb.sort_order)
        : (a, bb) => Number(a.done) - Number(bb.done) || byDueThenPriority(a, bb));
    }
    arr.sort((a, bb) => (a.key === "null" ? 1 : bb.key === "null" ? -1 : a.label.localeCompare(bb.label)));
    return arr;
  }, [filtered, group, showDone]);

  const totalShown = filtered.length;

  // ── Mutations (optimistic; UI updates before the network round-trip) ─────────
  const handleToggle = (id: number) => toggle.mutate(id);
  const handleDelete = (id: number) => del.mutate(id);

  const handleReschedule = (date: string) => {
    if (!rescheduling) return;
    reschedule.mutate({ task: rescheduling, due_date: date });
    setRescheduling(null);
  };

  const addTask = async (form: TaskFormState) => {
    await create.mutateAsync({
      plan_id: form.plan_id ? Number(form.plan_id) : null,
      title: form.title.trim(),
      priority: form.priority,
      urgency: form.urgency,
      due_date: form.due_date || null,
      time_estimate: form.time_estimate ? Number(form.time_estimate) : null,
      team_id: teamId,
    });
    setAdding(false);
  };

  // Reorder within a plan bucket (only offered when group === "plan").
  const reorderWithin = (bucketTasks: TaskWithContext[], index: number, dir: -1 | 1) => {
    const ids = bucketTasks.map((t) => t.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    reorder.mutate(ids);
  };

  const renderRow = (t: TaskWithContext, extra?: { reorder?: Parameters<typeof TaskRow>[0]["reorder"] }) => (
    <TaskRow
      task={t}
      showContext={group !== "plan"}
      planning={planningFor(t)}
      reorder={extra?.reorder}
      assignment={teamId ? {
        members: teamMembers,
        value: t.assigned_to,
        onChange: (assigned_to) => setAssignee.mutate({ id: t.id, assigned_to }),
      } : undefined}
      onToggle={() => handleToggle(t.id)}
      onEdit={() => isFullTask(t) ? setPlanning(t.id) : setEditingSimple(t)}
      onDelete={() => handleDelete(t.id)}
      onReschedule={() => setRescheduling(t)}
    />
  );

  const saveSimpleEdit = async (form: TaskFormState) => {
    if (!editingSimple) return;
    update.mutate({
      id: editingSimple.id,
      title: form.title.trim(),
      priority: form.priority,
      due_date: form.due_date || null,
      time_estimate: form.time_estimate ? Number(form.time_estimate) : null,
    });
    const newPlan = form.plan_id ? Number(form.plan_id) : null;
    if (newPlan !== editingSimple.plan_id) move.mutate({ id: editingSimple.id, planId: newPlan });
    setEditingSimple(null);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header / controls */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 mr-1">
          <ListChecks className="h-5 w-5 text-emerald-500" />
          <h1 className="text-lg font-semibold text-foreground">Tasks</h1>
          <span className="text-xs text-muted-foreground">({totalShown})</span>
        </div>

        <div className="inline-flex rounded-lg border border-border p-0.5">
          {GROUP_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setGroup(m.id)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                group === m.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="h-8 w-44 pl-7 text-xs"
          />
        </div>

        {selectedPlanId == null && (
          <select
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">All plans</option>
            {taskPlans.map((p) => <option key={p.id} value={String(p.id)}>{p.title}</option>)}
          </select>
        )}

        <button
          onClick={() => setShowSteps((v) => !v)}
          title="Show subtasks as board items as well as inside their parent"
          className={cn(
            "h-8 px-2.5 text-xs font-medium rounded-md border transition-colors inline-flex items-center gap-1",
            showSteps ? "border-primary/40 text-primary bg-primary/5" : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          <ListTree className="h-3 w-3" />
          Steps
        </button>

        <button
          onClick={() => setShowDone((v) => !v)}
          className={cn(
            "h-8 px-2.5 text-xs font-medium rounded-md border transition-colors",
            showDone ? "border-primary/40 text-primary bg-primary/5" : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {showDone ? "Hide done" : "Show done"}
        </button>

        <div className="flex-1" />

        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4 mr-1" /> Task
        </Button>
      </div>

      {gateError && (
        <div className="shrink-0 flex items-start gap-2 mx-4 mt-2 rounded-lg border border-amber-400/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{gateError}</span>
          <button onClick={() => setGateError(null)} className="shrink-0 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Groups */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          {group === "matrix" ? (
            <MatrixGrid
              buckets={buckets}
              draggingTask={draggingTask}
              renderRow={renderRow}
              dndOn={dndOn}
            />
          ) : (
            <div className="flex flex-col gap-5">
              {buckets.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
                  <ListChecks className="h-10 w-10 text-muted-foreground/30" />
                  <p className="text-sm font-medium text-muted-foreground">No tasks here</p>
                  <p className="text-xs text-muted-foreground/60">Adjust filters or add a task.</p>
                </div>
              ) : buckets.map((bkt) => {
                const body = (
                  <section>
                    <div className="flex items-center gap-2 mb-1.5">
                      <h2 className={cn("text-sm font-semibold", bkt.accent ?? "text-foreground")}>{bkt.label}</h2>
                      <span className="text-xs text-muted-foreground">({bkt.tasks.length})</span>
                      {group === "stage" && (
                        <span className="text-[11px] text-muted-foreground/60">
                          {STAGE_HINT[bkt.key as TaskStage]}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5 min-h-[2px]">
                      {bkt.tasks.map((t, i) => {
                        const row = renderRow(t, {
                          reorder: group === "plan" && !t.done ? {
                            canUp: i > 0, canDown: i < bkt.tasks.length - 1,
                            onUp: () => reorderWithin(bkt.tasks, i, -1),
                            onDown: () => reorderWithin(bkt.tasks, i, 1),
                          } : undefined,
                        });
                        return dndOn && !t.done
                          ? <DraggableRow key={t.id} id={t.id}>{row}</DraggableRow>
                          : <div key={t.id}>{row}</div>;
                      })}
                    </div>
                  </section>
                );
                return dndOn ? (
                  <DroppableSection
                    key={bkt.key}
                    id={bkt.key}
                    isSource={draggingTask ? bucketKeyForTask(draggingTask, group) === bkt.key : false}
                  >
                    {body}
                  </DroppableSection>
                ) : (
                  <div key={bkt.key}>{body}</div>
                );
              })}

              <StudySection />
            </div>
          )}

          <DragOverlay dropAnimation={null}>
            {draggingTask ? (
              <div className="rounded-md border border-primary/40 bg-background shadow-lg opacity-95">
                <TaskRow task={draggingTask} showContext onToggle={() => {}} onEdit={() => {}} onDelete={() => {}} onReschedule={() => {}} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Dialogs */}
      {planning != null && (
        <TaskPlanner rootId={planning} onClose={() => setPlanning(null)} />
      )}
      {editingSimple && (
        <Dialog open onOpenChange={(o) => { if (!o) setEditingSimple(null); }}>
          <DialogContent title={`Edit ${editingSimple.task_type}`}>
            <SparseSubtypeEditor task={editingSimple} />
            <EditTaskForm
              task={editingSimple}
              plans={taskPlans}
              onSave={saveSimpleEdit}
              onClose={() => setEditingSimple(null)}
            />
          </DialogContent>
        </Dialog>
      )}
      {adding && (
        <Dialog open onOpenChange={(o) => { if (!o) setAdding(false); }}>
          <DialogContent title="New task">
            <AddTaskForm
              plans={taskPlans}
              defaultPlanId={selectedPlanId ?? (planFilter ? Number(planFilter) : null)}
              onAdd={addTask}
              onClose={() => setAdding(false)}
            />
          </DialogContent>
        </Dialog>
      )}
      {rescheduling && (
        <ReschedulePopover onReschedule={handleReschedule} onClose={() => setRescheduling(null)} />
      )}
    </div>
  );
}

/**
 * Loads and saves the subtype attributes of a sparse task.
 *
 * Kept separate from `EditTaskForm` because it writes to a different relation:
 * the form patches the supertype, this upserts the subtype row. Saving on blur
 * rather than on submit means the two don't have to be transactional — each
 * lands independently, and a failure in one doesn't silently discard the other.
 */
function SparseSubtypeEditor({ task }: { task: TaskWithContext }) {
  const type = task.task_type as Exclude<typeof task.task_type, "task">;
  const [attrs, setAttrs] = useState<Record<string, any>>({});

  useEffect(() => {
    let live = true;
    getTaskSubtype(task.id, type).then((r) => { if (live) setAttrs(r ?? {}); }).catch(() => {});
    return () => { live = false; };
  }, [task.id, type]);

  return (
    <div
      className="mb-3"
      onBlur={() => { saveTaskSubtype(task.id, type, attrs).catch(() => {}); }}
    >
      <SubtypeFields
        type={type}
        value={attrs}
        onChange={(patch) => setAttrs((a) => ({ ...a, ...patch }))}
      />
    </div>
  );
}

/**
 * The importance x urgency board.
 *
 * Laid out as an actual 3x3 grid rather than nine stacked lists, because the
 * whole value of the second axis is spatial: you see at a glance that the
 * urgent-and-important cell is overloaded while the important-but-not-urgent one
 * — the cell that actually moves goals — is empty. Dragging a task between cells
 * sets both axes in one write.
 */
function MatrixGrid({ buckets, draggingTask, renderRow, dndOn }: {
  buckets: Bucket[];
  draggingTask: TaskWithContext | null;
  renderRow: (t: TaskWithContext) => React.ReactNode;
  dndOn: boolean;
}) {
  const byKey = new Map(buckets.map((b) => [b.key, b]));

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[auto_repeat(3,minmax(0,1fr))] gap-2">
        <div />
        {["Urgent", "Soon", "Whenever"].map((label) => (
          <div key={label} className="text-center text-[11px] font-medium text-muted-foreground pb-0.5">
            {label}
          </div>
        ))}

        {AXIS.map((imp) => (
          <div key={imp} className="contents">
            <div className="flex items-center justify-end pr-1">
              <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                {imp === "high" ? "Important" : imp === "medium" ? "Medium" : "Minor"}
              </span>
            </div>

            {AXIS.map((urg) => {
              const key = cellKey(imp as Priority, urg as Urgency);
              const bkt = byKey.get(key);
              const advice = cellAdvice(imp as Priority, urg as Urgency);
              const isSource = draggingTask
                ? draggingTask.priority === imp && planningOf(draggingTask).urgency === urg
                : false;

              const cell = (
                <div
                  className={cn(
                    "min-h-[104px] rounded-lg border p-2 flex flex-col gap-1",
                    imp === "high" && urg === "high" && "border-rose-400/40 bg-rose-500/[0.03]",
                    imp === "high" && urg === "low" && "border-emerald-400/40 bg-emerald-500/[0.03]",
                    !(imp === "high" && (urg === "high" || urg === "low")) && "border-border/60",
                  )}
                >
                  <div className="flex items-baseline gap-1.5 mb-0.5">
                    {advice && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                        {advice}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                      {bkt?.tasks.length ?? 0}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {(bkt?.tasks ?? []).map((t) =>
                      dndOn && !t.done
                        ? <DraggableRow key={t.id} id={t.id}>{renderRow(t)}</DraggableRow>
                        : <div key={t.id}>{renderRow(t)}</div>,
                    )}
                  </div>
                </div>
              );

              return dndOn
                ? <DroppableSection key={key} id={key} isSource={isSource}>{cell}</DroppableSection>
                : <div key={key}>{cell}</div>;
            })}
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground/60">
        Drag a task to a cell to set its importance and urgency together.
      </p>
    </div>
  );
}
