import { useEffect, useMemo, useState, useCallback } from "react";
import { Plus, Search, ListChecks } from "lucide-react";
import {
  getAllTasks, getPlans, createTask, updateTask, toggleTask, deleteTask,
  moveTask, reorderTasks,
} from "../../lib/api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Dialog, DialogContent } from "../ui/dialog";
import { cn } from "../../lib/utils";
import type { TaskWithContext, Plan, Priority } from "../../types";
import { TaskRow } from "./TaskRow";
import { EditTaskForm, AddTaskForm, ReschedulePopover, type TaskFormState } from "./TaskDialogs";

type GroupMode = "time" | "plan" | "goal" | "priority" | "status";

const GROUP_MODES: { id: GroupMode; label: string }[] = [
  { id: "time", label: "Time" },
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

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
const STATUS_ORDER = ["backlog", "todo", "next", "in_progress", "doing", "blocked", "review", "done"];

interface Bucket { key: string; label: string; accent?: string; tasks: TaskWithContext[]; }

function byDueThenPriority(a: TaskWithContext, b: TaskWithContext) {
  const ad = a.due_date ?? "9999-12-31";
  const bd = b.due_date ?? "9999-12-31";
  if (ad !== bd) return ad.localeCompare(bd);
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

export function TaskBoard({ selectedPlanId, selectedGoalId }: {
  selectedPlanId?: number | null;
  selectedGoalId?: number | null;
}) {
  const [tasks, setTasks] = useState<TaskWithContext[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [group, setGroup] = useState<GroupMode>("time");
  const [search, setSearch] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [planFilter, setPlanFilter] = useState<string>(""); // "" = all

  const [editing, setEditing] = useState<TaskWithContext | null>(null);
  const [adding, setAdding] = useState(false);
  const [rescheduling, setRescheduling] = useState<TaskWithContext | null>(null);

  const load = useCallback(
    () => Promise.all([getAllTasks(), getPlans()]).then(([t, p]) => { setTasks(t); setPlans(p); }),
    [],
  );
  useEffect(() => { load(); }, [load]);

  // Plans that hold tasks (exclude schedule/course containers).
  const taskPlans = useMemo(() => plans.filter((p) => !p.is_schedule && !p.is_course), [plans]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (!showDone && t.done) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      if (selectedPlanId != null && t.plan_id !== selectedPlanId) return false;
      if (selectedGoalId != null && t.goal_id !== selectedGoalId) return false;
      if (planFilter && String(t.plan_id) !== planFilter) return false;
      return true;
    });
  }, [tasks, search, showDone, planFilter, selectedPlanId, selectedGoalId]);

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

  // ── Mutations ──────────────────────────────────────────────────────────────
  const handleToggle = async (id: number) => { await toggleTask(id); load(); };
  const handleDelete = async (id: number) => { await deleteTask(id); load(); };

  const handleReschedule = async (date: string) => {
    if (!rescheduling) return;
    await updateTask(rescheduling.id, {
      title: rescheduling.title, priority: rescheduling.priority,
      due_date: date, time_estimate: rescheduling.time_estimate,
    });
    setRescheduling(null);
    load();
  };

  const saveEdit = async (form: TaskFormState) => {
    if (!editing) return;
    await updateTask(editing.id, {
      title: form.title.trim(),
      priority: form.priority,
      due_date: form.due_date || null,
      time_estimate: form.time_estimate ? Number(form.time_estimate) : null,
    });
    const newPlan = form.plan_id ? Number(form.plan_id) : null;
    if (newPlan !== editing.plan_id) await moveTask(editing.id, newPlan);
    setEditing(null);
    load();
  };

  const addTask = async (form: TaskFormState) => {
    await createTask({
      plan_id: form.plan_id ? Number(form.plan_id) : null,
      title: form.title.trim(),
      priority: form.priority,
      due_date: form.due_date || null,
      time_estimate: form.time_estimate ? Number(form.time_estimate) : null,
    });
    setAdding(false);
    load();
  };

  // Reorder within a plan bucket (only offered when group === "plan").
  const reorderWithin = async (bucketTasks: TaskWithContext[], index: number, dir: -1 | 1) => {
    const ids = bucketTasks.map((t) => t.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await reorderTasks(ids);
    load();
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

      {/* Groups */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-5">
        {buckets.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <ListChecks className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">No tasks here</p>
            <p className="text-xs text-muted-foreground/60">Adjust filters or add a task.</p>
          </div>
        ) : buckets.map((bkt) => (
          <section key={bkt.key}>
            <div className="flex items-center gap-2 mb-1.5">
              <h2 className={cn("text-sm font-semibold", bkt.accent ?? "text-foreground")}>{bkt.label}</h2>
              <span className="text-xs text-muted-foreground">({bkt.tasks.length})</span>
            </div>
            <div className="flex flex-col gap-0.5">
              {bkt.tasks.map((t, i) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  showContext={group !== "plan"}
                  reorder={group === "plan" && !t.done ? {
                    canUp: i > 0, canDown: i < bkt.tasks.length - 1,
                    onUp: () => reorderWithin(bkt.tasks, i, -1),
                    onDown: () => reorderWithin(bkt.tasks, i, 1),
                  } : undefined}
                  onToggle={() => handleToggle(t.id)}
                  onEdit={() => setEditing(t)}
                  onDelete={() => handleDelete(t.id)}
                  onReschedule={() => setRescheduling(t)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Dialogs */}
      {editing && (
        <Dialog open onOpenChange={(o) => { if (!o) setEditing(null); }}>
          <DialogContent title="Edit task">
            <EditTaskForm task={editing} plans={taskPlans} onSave={saveEdit} onClose={() => setEditing(null)} />
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
