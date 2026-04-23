import { useEffect, useState, useMemo } from "react";
import { Plus, Pencil, Check, X } from "lucide-react";
import { getAllTasks, getPlans, createTask, updateTask, toggleTask, deleteTask, getGoals, getGoalGroups } from "../lib/api";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Dialog, DialogTrigger, DialogContent, DialogClose } from "../components/ui/dialog";
import { PriorityDot } from "../components/PriorityDot";
import { daysUntil, deadlineLabel, deadlineVariant, cn } from "../lib/utils";
import type { TaskWithContext, Plan, Priority, GoalGroup } from "../types";

const GROUP_COLORS: { name: string; bg: string; text: string; ring: string }[] = [
  { name: "slate",  bg: "bg-slate-500/15",  text: "text-slate-600 dark:text-slate-400",  ring: "ring-slate-400/60" },
  { name: "red",    bg: "bg-red-500/15",    text: "text-red-600 dark:text-red-400",      ring: "ring-red-400/60" },
  { name: "orange", bg: "bg-orange-500/15", text: "text-orange-600 dark:text-orange-400",ring: "ring-orange-400/60" },
  { name: "yellow", bg: "bg-yellow-400/15", text: "text-yellow-600 dark:text-yellow-400",ring: "ring-yellow-400/60" },
  { name: "green",  bg: "bg-green-500/15",  text: "text-green-600 dark:text-green-400",  ring: "ring-green-400/60" },
  { name: "teal",   bg: "bg-teal-500/15",   text: "text-teal-600 dark:text-teal-400",    ring: "ring-teal-400/60" },
  { name: "blue",   bg: "bg-blue-500/15",   text: "text-blue-600 dark:text-blue-400",    ring: "ring-blue-400/60" },
  { name: "purple", bg: "bg-purple-500/15", text: "text-purple-600 dark:text-purple-400",ring: "ring-purple-400/60" },
  { name: "pink",   bg: "bg-pink-500/15",   text: "text-pink-600 dark:text-pink-400",    ring: "ring-pink-400/60" },
];

function colorFor(name: string | null) {
  return GROUP_COLORS.find((c) => c.name === name) ?? GROUP_COLORS[0];
}

type FilterStatus = "all" | "open" | "done" | "overdue" | "today";
type SortKey = "priority" | "due_date" | "created";

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };


interface EditFormState { title: string; priority: Priority; due_date: string; time_estimate: string; }

function EditTaskDialog({ task, onSave, onClose }: {
  task: TaskWithContext;
  onSave: (data: EditFormState) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<EditFormState>({
    title: task.title,
    priority: task.priority,
    due_date: task.due_date ?? "",
    time_estimate: task.time_estimate != null ? String(task.time_estimate) : "",
  });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try { await onSave(form); } finally { setLoading(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-2">
      <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Priority</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.priority}
            onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as Priority }))}
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Due date</label>
          <Input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Time estimate (min) <span className="font-normal opacity-60">— default 10 min</span></label>
        <Input type="number" min={1} placeholder="10" value={form.time_estimate}
          onChange={(e) => setForm((f) => ({ ...f, time_estimate: e.target.value }))} />
      </div>
      <div className="flex justify-end gap-2 mt-1">
        <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={loading}>Save</Button>
      </div>
    </form>
  );
}

interface AddTaskFormState { plan_id: string; title: string; priority: Priority; due_date: string; time_estimate: string; }

function AddTaskDialog({ plans, onSave }: { plans: Plan[]; onSave: (data: AddTaskFormState) => Promise<void> }) {
  const [form, setForm] = useState<AddTaskFormState>({ plan_id: "", title: "", priority: "medium", due_date: new Date().toISOString().slice(0, 10), time_estimate: "" });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setLoading(true);
    try { await onSave(form); } finally { setLoading(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-2">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Plan (optional)</label>
        <select
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={form.plan_id}
          onChange={(e) => setForm((f) => ({ ...f, plan_id: e.target.value }))}
        >
          <option value="">No plan</option>
          {plans.filter((p) => p.status === "active").map((p) => (
            <option key={p.id} value={String(p.id)}>{p.title}</option>
          ))}
        </select>
      </div>
      <Input
        placeholder="Task title"
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        required
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Priority</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.priority}
            onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as Priority }))}
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Due date</label>
          <Input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Time estimate (min) <span className="font-normal opacity-60">— default 10 min</span></label>
        <Input type="number" min={1} placeholder="10" value={form.time_estimate}
          onChange={(e) => setForm((f) => ({ ...f, time_estimate: e.target.value }))} />
      </div>
      <div className="flex justify-end gap-2 mt-1">
        <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
        <Button type="submit" disabled={loading}>Add Task</Button>
      </div>
    </form>
  );
}

export function Tasks() {
  const [tasks, setTasks] = useState<TaskWithContext[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [groups, setGroups] = useState<GoalGroup[]>([]);
  const [goalGroupMap, setGoalGroupMap] = useState<Map<number, number>>(new Map());
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("open");
  const [filterPriority, setFilterPriority] = useState<Priority | "all">("all");
  const [filterPlan, setFilterPlan] = useState<string>("all");
  const [filterGroup, setFilterGroup] = useState<number | null>(null);
  const [sort, setSort] = useState<SortKey>("priority");
  const [search, setSearch] = useState("");
  const [editingTask, setEditingTask] = useState<TaskWithContext | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [groupByPlan, setGroupByPlan] = useState(false);

  const load = () => Promise.all([getAllTasks(), getPlans(), getGoals(), getGoalGroups()]).then(([t, p, goals, grps]) => {
    setTasks(t);
    setPlans(p);
    setGroups(grps);
    const map = new Map<number, number>();
    for (const g of goals) { if (g.group_id != null) map.set(g.id, g.group_id); }
    setGoalGroupMap(map);
  });
  useEffect(() => { load(); }, []);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const filtered = useMemo(() => {
    let result = [...tasks];

    // Status filter
    if (filterStatus === "open") result = result.filter((t) => !t.done);
    else if (filterStatus === "done") result = result.filter((t) => t.done);
    else if (filterStatus === "overdue") result = result.filter((t) => !t.done && t.due_date && new Date(t.due_date) < today);
    else if (filterStatus === "today") result = result.filter((t) => !t.done && t.due_date && daysUntil(t.due_date) === 0);

    // Priority filter
    if (filterPriority !== "all") result = result.filter((t) => t.priority === filterPriority);

    // Plan filter
    if (filterPlan !== "all") result = result.filter((t) => String(t.plan_id) === filterPlan);

    // Group filter
    if (filterGroup !== null) result = result.filter((t) => t.goal_id != null && goalGroupMap.get(t.goal_id) === filterGroup);

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((t) => t.title.toLowerCase().includes(q) || (t.plan_title ?? "").toLowerCase().includes(q));
    }

    // Sort
    result.sort((a, b) => {
      if (sort === "priority") return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (sort === "due_date") {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date.localeCompare(b.due_date);
      }
      return b.created_at.localeCompare(a.created_at);
    });

    return result;
  }, [tasks, filterStatus, filterPriority, filterPlan, filterGroup, goalGroupMap, sort, search]);

  // Group by plan
  const grouped = useMemo(() => {
    if (!groupByPlan) return null;
    const map = new Map<string, { planKey: string; planTitle: string | null; goalTitle: string | null; tasks: TaskWithContext[] }>();
    for (const t of filtered) {
      const key = String(t.plan_id);
      if (!map.has(key)) map.set(key, { planKey: key, planTitle: t.plan_title, goalTitle: t.goal_title, tasks: [] });
      map.get(key)!.tasks.push(t);
    }
    return Array.from(map.values());
  }, [filtered, groupByPlan]);

  async function handleToggle(id: number) {
    await toggleTask(id);
    load();
  }

  async function handleDelete(id: number) {
    await deleteTask(id);
    load();
  }

  async function handleEdit(form: EditFormState) {
    if (!editingTask) return;
    await updateTask(editingTask.id, {
      title: form.title, priority: form.priority, due_date: form.due_date || null,
      time_estimate: form.time_estimate ? Number(form.time_estimate) : null,
    });
    setEditingTask(null);
    load();
  }

  async function handleAdd(form: AddTaskFormState) {
    await createTask({
      plan_id: form.plan_id ? Number(form.plan_id) : null, title: form.title,
      priority: form.priority, due_date: form.due_date || null,
      time_estimate: form.time_estimate ? Number(form.time_estimate) : null,
    });
    setAddOpen(false);
    load();
  }

  const statusFilters: { id: FilterStatus; label: string }[] = [
    { id: "open", label: "Open" },
    { id: "done", label: "Done" },
    { id: "overdue", label: "Overdue" },
    { id: "today", label: "Today" },
    { id: "all", label: "All" },
  ];

  return (
    <div className="flex flex-col gap-5 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Tasks</h1>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-3.5 w-3.5" /> New Task</Button>
          </DialogTrigger>
          <DialogContent title="Add Task">
            <AddTaskDialog plans={plans} onSave={handleAdd} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1 border-b border-border pb-2">
          {statusFilters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilterStatus(f.id)}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                filterStatus === f.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Search tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-44 text-xs"
          />
          <select
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none"
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value as Priority | "all")}
          >
            <option value="all">All priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none"
            value={filterPlan}
            onChange={(e) => setFilterPlan(e.target.value)}
          >
            <option value="all">All plans</option>
            {plans.map((p) => <option key={p.id} value={String(p.id)}>{p.title}</option>)}
          </select>
          <select
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="priority">Sort: Priority</option>
            <option value="due_date">Sort: Due date</option>
            <option value="created">Sort: Created</option>
          </select>
          <button
            onClick={() => setGroupByPlan((v) => !v)}
            className={`px-2.5 h-8 text-xs rounded-md border transition-colors ${
              groupByPlan ? "border-primary text-primary bg-primary/5" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Group by plan
          </button>
          <span className="ml-auto text-xs text-muted-foreground">{filtered.length} tasks</span>
        </div>

        {/* Group filter pills */}
        {groups.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setFilterGroup(null)}
              className={cn(
                "px-2.5 py-0.5 text-xs rounded-full font-medium transition-colors ring-1",
                filterGroup === null
                  ? "bg-secondary text-foreground ring-border"
                  : "text-muted-foreground ring-transparent hover:text-foreground"
              )}
            >
              All groups
            </button>
            {groups.map((g) => {
              const c = colorFor(g.color);
              const active = filterGroup === g.id;
              return (
                <button
                  key={g.id}
                  onClick={() => setFilterGroup(active ? null : g.id)}
                  className={cn(
                    "px-2.5 py-0.5 text-xs rounded-full font-medium transition-colors ring-1",
                    active ? `${c.bg} ${c.text} ${c.ring}` : "text-muted-foreground ring-transparent hover:text-foreground"
                  )}
                >
                  {g.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Task list */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks match your filters.</p>
      ) : grouped ? (
        <div className="flex flex-col gap-4">
          {grouped.map((group) => (
            <div key={group.planKey}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-foreground">{group.planTitle ?? "No plan"}</span>
                {group.goalTitle && <span className="text-xs text-muted-foreground">· {group.goalTitle}</span>}
                <span className="text-xs text-muted-foreground">({group.tasks.length})</span>
              </div>
              <div className="flex flex-col gap-1 pl-2 border-l-2 border-border">
                {group.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} onToggle={() => handleToggle(t.id)} onEdit={() => setEditingTask(t)} onDelete={() => handleDelete(t.id)} showPlan={false} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {filtered.map((t) => (
            <TaskRow key={t.id} task={t} onToggle={() => handleToggle(t.id)} onEdit={() => setEditingTask(t)} onDelete={() => handleDelete(t.id)} showPlan />
          ))}
        </div>
      )}

      {/* Edit dialog */}
      {editingTask && (
        <Dialog open onOpenChange={(o) => { if (!o) setEditingTask(null); }}>
          <DialogContent title="Edit Task">
            <EditTaskDialog task={editingTask} onSave={handleEdit} onClose={() => setEditingTask(null)} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function TaskRow({ task, onToggle, onEdit, onDelete, showPlan }: {
  task: TaskWithContext;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  showPlan: boolean;
}) {
  const days = task.due_date ? daysUntil(task.due_date) : null;

  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 group hover:bg-secondary/50 transition-colors">
      <button
        onClick={onToggle}
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
          task.done ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary"
        }`}
      >
        {task.done && <Check className="h-2.5 w-2.5" />}
      </button>

      <PriorityDot priority={task.priority} />

      <span className={`text-sm flex-1 truncate ${task.done ? "line-through text-muted-foreground" : "text-foreground"}`}>
        {task.title}
      </span>

      {days !== null && !task.done && (
        <Badge variant={deadlineVariant(days)} className="shrink-0 text-xs">
          {deadlineLabel(days)}
        </Badge>
      )}

      {showPlan && (
        <span className="text-xs text-muted-foreground shrink-0 hidden group-hover:inline">{task.plan_title}</span>
      )}

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onEdit} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground">
          <Pencil className="h-3 w-3" />
        </button>
        <button onClick={onDelete} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-destructive">
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
