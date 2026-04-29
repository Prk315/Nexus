import { useEffect, useState, useMemo } from "react";
import { CalendarClock, Check, Pencil, X, Plus, GraduationCap } from "lucide-react";
import { getAllTasks, createTask, updateTask, toggleTask, deleteTask, getCourseAssignments } from "../lib/api";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogClose } from "../components/ui/dialog";
import { PriorityDot } from "../components/PriorityDot";
import { cn, daysUntil, deadlineLabel, deadlineVariant, PRIORITY_BADGE_CLASSES } from "../lib/utils";
import type { TaskWithContext, Priority, CourseAssignment } from "../types";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function startOfWeek(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() - d.getDay());
  return isoDate(d);
}

function formatDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

function formatWeekLabel(weekStart: string, thisWeekStart: string): string {
  const diff = Math.round(
    (new Date(weekStart + "T12:00:00").getTime() -
      new Date(thisWeekStart + "T12:00:00").getTime()) /
      (7 * 24 * 60 * 60 * 1000)
  );
  if (diff === 0) return "This week";
  if (diff === 1) return "Next week";
  return `Week of ${new Date(weekStart + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

interface EditState { title: string; priority: Priority; due_date: string; time_estimate: string; }

function EditTaskDialog({
  task,
  onSave,
  onClose,
}: {
  task: TaskWithContext;
  onSave: (data: EditState) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<EditState>({
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
        <label className="text-xs text-muted-foreground">
          Time estimate (min) <span className="font-normal opacity-60">— default 10 min</span>
        </label>
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

interface AddState { title: string; priority: Priority; due_date: string; time_estimate: string; }

function AddTaskDialog({
  initialDate,
  onSave,
}: {
  initialDate: string;
  onSave: (data: AddState) => Promise<void>;
}) {
  const [form, setForm] = useState<AddState>({
    title: "",
    priority: "medium",
    due_date: initialDate,
    time_estimate: "",
  });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setLoading(true);
    try { await onSave(form); } finally { setLoading(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-2">
      <Input
        placeholder="Task title"
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        required
        autoFocus
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
        <label className="text-xs text-muted-foreground">
          Time estimate (min) <span className="font-normal opacity-60">— default 10 min</span>
        </label>
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

function PlannerTaskRow({
  task,
  onToggle,
  onEdit,
  onDelete,
}: {
  task: TaskWithContext;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 group hover:bg-secondary/50 transition-colors">
      <button
        onClick={onToggle}
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
          task.done
            ? "bg-primary border-primary text-primary-foreground"
            : "border-border hover:border-primary"
        )}
      >
        {task.done && <Check className="h-2.5 w-2.5" />}
      </button>

      <PriorityDot priority={task.priority} />

      <span className={cn("text-sm flex-1 truncate", task.done && "line-through text-muted-foreground")}>
        {task.title}
      </span>

      {task.plan_title && (
        <span className="text-xs text-muted-foreground shrink-0 hidden group-hover:inline">
          {task.plan_title}
        </span>
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

interface WeekGroup {
  weekStart: string;
  label: string;
  totalCount: number;
  days: { date: string; tasks: TaskWithContext[] }[];
}

function StudyAssignmentRow({ assignment }: { assignment: CourseAssignment }) {
  const days = assignment.due_date ? daysUntil(assignment.due_date) : null;
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 group hover:bg-secondary/50 transition-colors">
      <span className={cn("text-xs px-1.5 py-0.5 rounded border font-medium shrink-0", PRIORITY_BADGE_CLASSES[assignment.priority] ?? PRIORITY_BADGE_CLASSES.low)}>
        {assignment.assignment_type}
      </span>
      <span className="text-sm flex-1 truncate">{assignment.title}</span>
      <span className="text-xs text-muted-foreground shrink-0 hidden group-hover:inline">{assignment.plan_title}</span>
      {days !== null && (
        <Badge variant={deadlineVariant(days)} className="shrink-0 text-xs">
          {deadlineLabel(days)}
        </Badge>
      )}
    </div>
  );
}

interface StudyWeekGroup {
  weekStart: string;
  label: string;
  totalCount: number;
  days: { date: string; assignments: CourseAssignment[] }[];
}

// Stable today/thisWeekStart — computed once per module load, not per render.
// Today doesn't change while the app is open so this is safe.
const TODAY = isoDate(new Date());
const THIS_WEEK_START = startOfWeek(TODAY);

export function Planner() {
  const [tasks, setTasks] = useState<TaskWithContext[]>([]);
  const [assignments, setAssignments] = useState<CourseAssignment[]>([]);
  const [editingTask, setEditingTask] = useState<TaskWithContext | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState(() => addDays(TODAY, 1));

  const load = () => Promise.all([getAllTasks(), getCourseAssignments()]).then(([t, a]) => {
    setTasks(t);
    setAssignments(a);
  });
  useEffect(() => { load(); }, []);

  const weeks = useMemo<WeekGroup[]>(() => {
    const future = tasks.filter((task) => !task.done && task.due_date !== null && task.due_date > TODAY);

    const weekMap = new Map<string, Map<string, TaskWithContext[]>>();
    for (const task of future) {
      const ws = startOfWeek(task.due_date!);
      if (!weekMap.has(ws)) weekMap.set(ws, new Map());
      const dayMap = weekMap.get(ws)!;
      if (!dayMap.has(task.due_date!)) dayMap.set(task.due_date!, []);
      dayMap.get(task.due_date!)!.push(task);
    }

    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ws, dayMap]) => {
        const days = Array.from(dayMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, dayTasks]) => ({ date, tasks: dayTasks }));
        return {
          weekStart: ws,
          label: formatWeekLabel(ws, THIS_WEEK_START),
          totalCount: days.reduce((sum, d) => sum + d.tasks.length, 0),
          days,
        };
      });
  }, [tasks]);

  const studyWeeks = useMemo<StudyWeekGroup[]>(() => {
    const future = assignments.filter((a) => a.status !== "done" && a.due_date !== null && a.due_date > TODAY);

    const weekMap = new Map<string, Map<string, CourseAssignment[]>>();
    for (const a of future) {
      const ws = startOfWeek(a.due_date!);
      if (!weekMap.has(ws)) weekMap.set(ws, new Map());
      const dayMap = weekMap.get(ws)!;
      if (!dayMap.has(a.due_date!)) dayMap.set(a.due_date!, []);
      dayMap.get(a.due_date!)!.push(a);
    }

    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ws, dayMap]) => {
        const days = Array.from(dayMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, dayAssignments]) => ({ date, assignments: dayAssignments }));
        return {
          weekStart: ws,
          label: formatWeekLabel(ws, THIS_WEEK_START),
          totalCount: days.reduce((s, d) => s + d.assignments.length, 0),
          days,
        };
      });
  }, [assignments]);

  async function handleToggle(id: number) {
    await toggleTask(id);
    load();
  }

  async function handleDelete(id: number) {
    await deleteTask(id);
    load();
  }

  async function handleEdit(form: EditState) {
    if (!editingTask) return;
    await updateTask(editingTask.id, {
      title: form.title,
      priority: form.priority,
      due_date: form.due_date || null,
      time_estimate: form.time_estimate ? Number(form.time_estimate) : null,
    });
    setEditingTask(null);
    load();
  }

  async function handleAdd(form: AddState) {
    await createTask({
      plan_id: null,
      title: form.title,
      priority: form.priority,
      due_date: form.due_date || null,
      time_estimate: form.time_estimate ? Number(form.time_estimate) : null,
    });
    setAddOpen(false);
    load();
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarClock className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold text-foreground">Planner</h1>
        </div>
        <Button
          size="sm"
          onClick={() => { setAddDate(addDays(TODAY, 1)); setAddOpen(true); }}
        >
          <Plus className="h-3.5 w-3.5" />
          New Task
        </Button>
      </div>

      {weeks.length === 0 && studyWeeks.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <CalendarClock className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">Nothing planned ahead</p>
          <p className="text-xs text-muted-foreground/60">Add tasks with future due dates to see them here.</p>
        </div>
      )}

      {weeks.map((week) => (
        <section key={week.weekStart}>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-sm font-semibold text-foreground">{week.label}</h2>
            <span className="text-xs text-muted-foreground bg-secondary rounded-full px-2 py-0.5">
              {week.totalCount} {week.totalCount === 1 ? "task" : "tasks"}
            </span>
            <button
              onClick={() => { setAddDate(week.days[0]?.date ?? addDays(week.weekStart, 1)); setAddOpen(true); }}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
          </div>

          <div className="flex flex-col gap-4 pl-1">
            {week.days.map((day) => (
              <div key={day.date}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{formatDate(day.date)}</span>
                  <span className="text-xs text-muted-foreground/60">({day.tasks.length})</span>
                </div>
                <div className="flex flex-col gap-0.5 pl-3 border-l-2 border-border">
                  {day.tasks.map((task) => (
                    <PlannerTaskRow
                      key={task.id}
                      task={task}
                      onToggle={() => handleToggle(task.id)}
                      onEdit={() => setEditingTask(task)}
                      onDelete={() => handleDelete(task.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {studyWeeks.length > 0 && (
        <section className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 p-4">
          <div className="flex items-center gap-2 mb-4">
            <GraduationCap className="h-4 w-4 text-indigo-500 shrink-0" />
            <h2 className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Study</h2>
            <span className="text-xs text-indigo-500/70">
              ({studyWeeks.reduce((sum, w) => sum + w.totalCount, 0)})
            </span>
          </div>

          {studyWeeks.map((week) => (
            <div key={week.weekStart} className="mb-4 last:mb-0">
              <div className="flex items-center gap-3 mb-3">
                <h3 className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">{week.label}</h3>
                <span className="text-xs text-indigo-500/60 bg-indigo-500/10 rounded-full px-2 py-0.5">
                  {week.totalCount} assignments
                </span>
              </div>
              <div className="flex flex-col gap-3 pl-1">
                {week.days.map((day) => (
                  <div key={day.date}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-medium text-muted-foreground">{formatDate(day.date)}</span>
                      <span className="text-xs text-muted-foreground/60">({day.assignments.length})</span>
                    </div>
                    <div className="flex flex-col gap-0.5 pl-3 border-l-2 border-indigo-400/30">
                      {day.assignments.map((a) => (
                        <StudyAssignmentRow key={a.id} assignment={a} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {editingTask && (
        <Dialog open onOpenChange={(o) => { if (!o) setEditingTask(null); }}>
          <DialogContent title="Edit Task">
            <EditTaskDialog
              task={editingTask}
              onSave={handleEdit}
              onClose={() => setEditingTask(null)}
            />
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent title="New Task">
          <AddTaskDialog initialDate={addDate} onSave={handleAdd} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
