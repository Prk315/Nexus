import { useEffect, useState, useMemo } from "react";
import { Archive, Check, Pencil, X, CalendarDays, GraduationCap } from "lucide-react";
import { getAllTasks, updateTask, toggleTask, deleteTask, getCourseAssignments, updateCourseAssignment } from "../lib/api";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent } from "../components/ui/dialog";
import { PriorityDot } from "../components/PriorityDot";
import { cn, daysUntil, deadlineLabel, deadlineVariant, PRIORITY_BADGE_CLASSES } from "../lib/utils";
import type { TaskWithContext, Priority, CourseAssignment } from "../types";

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
      <Input
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
          <Input
            type="date"
            value={form.due_date}
            onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">
          Time estimate (min) <span className="font-normal opacity-60">— default 10 min</span>
        </label>
        <Input
          type="number"
          min={1}
          placeholder="10"
          value={form.time_estimate}
          onChange={(e) => setForm((f) => ({ ...f, time_estimate: e.target.value }))}
        />
      </div>
      <div className="flex justify-end gap-2 mt-1">
        <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={loading}>Save</Button>
      </div>
    </form>
  );
}

function ReschedulePopover({
  onReschedule,
  onClose,
}: {
  onReschedule: (date: string) => void;
  onClose: () => void;
}) {
  const base = new Date().toISOString().slice(0, 10);
  const offset = (n: number) => {
    const d = new Date(base + "T12:00:00");
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const shortcuts = [
    { label: "Tomorrow",  date: offset(1) },
    { label: "In 3 days", date: offset(3) },
    { label: "Next week", date: offset(7) },
    { label: "In 2 weeks", date: offset(14) },
  ];

  const [custom, setCustom] = useState("");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-popover border border-border rounded-xl shadow-xl p-4 w-64 flex flex-col gap-3">
        <div className="text-sm font-medium text-foreground">Reschedule to…</div>
        <div className="flex flex-col gap-1">
          {shortcuts.map((s) => (
            <button
              key={s.label}
              onClick={() => onReschedule(s.date)}
              className="flex items-center justify-between px-3 py-1.5 text-sm rounded-md hover:bg-secondary transition-colors text-left"
            >
              <span>{s.label}</span>
              <span className="text-xs text-muted-foreground">{s.date}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Custom date</label>
          <div className="flex gap-2">
            <Input
              type="date"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="h-8 text-xs flex-1"
            />
            <Button size="sm" disabled={!custom} onClick={() => { if (custom) onReschedule(custom); }}>
              Set
            </Button>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

function BacklogTaskRow({
  task,
  onToggle,
  onEdit,
  onDelete,
  onReschedule,
}: {
  task: TaskWithContext;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReschedule: () => void;
}) {
  const days = task.due_date ? daysUntil(task.due_date) : null;

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

      {days !== null && (
        <Badge variant={deadlineVariant(days)} className="shrink-0 text-xs">
          {deadlineLabel(days)}
        </Badge>
      )}

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onReschedule}
          title="Reschedule"
          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-primary"
        >
          <CalendarDays className="h-3 w-3" />
        </button>
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

function PlanGroup({
  planTitle,
  tasks,
  onToggle,
  onEdit,
  onDelete,
  onReschedule,
}: {
  planTitle: string | null;
  tasks: TaskWithContext[];
  onToggle: (id: number) => void;
  onEdit: (task: TaskWithContext) => void;
  onDelete: (id: number) => void;
  onReschedule: (task: TaskWithContext) => void;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-medium text-foreground/80">{planTitle ?? "No plan"}</span>
        <span className="text-xs text-muted-foreground">({tasks.length})</span>
      </div>
      <div className="flex flex-col gap-0.5 pl-3 border-l-2 border-border">
        {tasks.map((t) => (
          <BacklogTaskRow
            key={t.id}
            task={t}
            onToggle={() => onToggle(t.id)}
            onEdit={() => onEdit(t)}
            onDelete={() => onDelete(t.id)}
            onReschedule={() => onReschedule(t)}
          />
        ))}
      </div>
    </div>
  );
}

function groupByPlan(list: TaskWithContext[]) {
  const map = new Map<string, { planTitle: string | null; tasks: TaskWithContext[] }>();
  for (const task of list) {
    const key = String(task.plan_id);
    if (!map.has(key)) map.set(key, { planTitle: task.plan_title, tasks: [] });
    map.get(key)!.tasks.push(task);
  }
  return Array.from(map.values());
}

function AssignmentRow({
  assignment,
  onMarkDone,
}: {
  assignment: CourseAssignment;
  onMarkDone: () => void;
}) {
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

      <button
        onClick={onMarkDone}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-0.5 rounded border border-indigo-400/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10"
      >
        Mark done
      </button>
    </div>
  );
}

function AssignmentCourseGroup({
  planTitle,
  assignments,
  onMarkDone,
}: {
  planTitle: string;
  assignments: CourseAssignment[];
  onMarkDone: (a: CourseAssignment) => void;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-medium text-foreground/80">{planTitle}</span>
        <span className="text-xs text-muted-foreground">({assignments.length})</span>
      </div>
      <div className="flex flex-col gap-0.5 pl-3 border-l-2 border-indigo-400/30">
        {assignments.map((a) => (
          <AssignmentRow key={a.id} assignment={a} onMarkDone={() => onMarkDone(a)} />
        ))}
      </div>
    </div>
  );
}

// Stable — computed once per module load, safe since date doesn't change while app is open.
const TODAY = new Date().toISOString().slice(0, 10);

function groupAssignmentsByCourse(list: CourseAssignment[]) {
  const map = new Map<string, CourseAssignment[]>();
  for (const a of list) {
    if (!map.has(a.plan_title)) map.set(a.plan_title, []);
    map.get(a.plan_title)!.push(a);
  }
  return Array.from(map.entries()).map(([planTitle, assignments]) => ({ planTitle, assignments }));
}

export function Backlog() {
  const [tasks, setTasks] = useState<TaskWithContext[]>([]);
  const [assignments, setAssignments] = useState<CourseAssignment[]>([]);
  const [editingTask, setEditingTask] = useState<TaskWithContext | null>(null);
  const [reschedulingTask, setReschedulingTask] = useState<TaskWithContext | null>(null);

  const load = () => Promise.all([getAllTasks(), getCourseAssignments()]).then(([t, a]) => {
    setTasks(t);
    setAssignments(a);
  });
  useEffect(() => { load(); }, []);

  const { overdue, unscheduled } = useMemo(() => {
    const open = tasks.filter((task) => !task.done);
    return {
      overdue: open
        .filter((task) => task.due_date !== null && task.due_date < TODAY)
        .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")),
      unscheduled: open
        .filter((task) => task.due_date === null)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    };
  }, [tasks]);

  const { overdueAssignments, unscheduledAssignments } = useMemo(() => {
    const open = assignments.filter((a) => a.status !== "done");
    return {
      overdueAssignments: open
        .filter((a) => a.due_date !== null && a.due_date < TODAY)
        .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")),
      unscheduledAssignments: open
        .filter((a) => a.due_date === null)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    };
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

  async function handleReschedule(date: string) {
    if (!reschedulingTask) return;
    await updateTask(reschedulingTask.id, {
      title: reschedulingTask.title,
      priority: reschedulingTask.priority,
      due_date: date,
      time_estimate: reschedulingTask.time_estimate,
    });
    setReschedulingTask(null);
    load();
  }

  async function handleMarkAssignmentDone(a: CourseAssignment) {
    await updateCourseAssignment(a.id, { ...a, status: "done" });
    load();
  }

  const isEmpty = overdue.length === 0 && unscheduled.length === 0 && overdueAssignments.length === 0 && unscheduledAssignments.length === 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Archive className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold text-foreground">Backlog</h1>
        {overdue.length > 0 && (
          <span className="inline-flex items-center justify-center rounded-full bg-rose-500 text-white text-xs font-bold min-w-[1.25rem] h-5 px-1.5">
            {overdue.length}
          </span>
        )}
      </div>

      {isEmpty && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Archive className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">All clear!</p>
          <p className="text-xs text-muted-foreground/60">No overdue or unscheduled tasks.</p>
        </div>
      )}

      {overdue.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-rose-500">Overdue</h2>
            <span className="text-xs text-muted-foreground">({overdue.length})</span>
          </div>
          <div className="flex flex-col gap-1">
            {groupByPlan(overdue).map((group) => (
              <PlanGroup
                key={String(group.tasks[0]?.plan_id)}
                planTitle={group.planTitle}
                tasks={group.tasks}
                onToggle={handleToggle}
                onEdit={setEditingTask}
                onDelete={handleDelete}
                onReschedule={setReschedulingTask}
              />
            ))}
          </div>
        </section>
      )}

      {unscheduled.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-foreground">Unscheduled</h2>
            <span className="text-xs text-muted-foreground">({unscheduled.length})</span>
          </div>
          <div className="flex flex-col gap-1">
            {groupByPlan(unscheduled).map((group) => (
              <PlanGroup
                key={String(group.tasks[0]?.plan_id)}
                planTitle={group.planTitle}
                tasks={group.tasks}
                onToggle={handleToggle}
                onEdit={setEditingTask}
                onDelete={handleDelete}
                onReschedule={setReschedulingTask}
              />
            ))}
          </div>
        </section>
      )}

      {(overdueAssignments.length > 0 || unscheduledAssignments.length > 0) && (
        <section className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 p-4">
          <div className="flex items-center gap-2 mb-4">
            <GraduationCap className="h-4 w-4 text-indigo-500 shrink-0" />
            <h2 className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Study</h2>
            <span className="text-xs text-indigo-500/70">
              ({overdueAssignments.length + unscheduledAssignments.length})
            </span>
          </div>

          {overdueAssignments.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-xs font-semibold text-rose-500">Overdue Assignments</h3>
                <span className="text-xs text-muted-foreground">({overdueAssignments.length})</span>
              </div>
              {groupAssignmentsByCourse(overdueAssignments).map((group) => (
                <AssignmentCourseGroup
                  key={group.planTitle}
                  planTitle={group.planTitle}
                  assignments={group.assignments}
                  onMarkDone={handleMarkAssignmentDone}
                />
              ))}
            </div>
          )}

          {unscheduledAssignments.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Unscheduled Assignments</h3>
                <span className="text-xs text-muted-foreground">({unscheduledAssignments.length})</span>
              </div>
              {groupAssignmentsByCourse(unscheduledAssignments).map((group) => (
                <AssignmentCourseGroup
                  key={group.planTitle}
                  planTitle={group.planTitle}
                  assignments={group.assignments}
                  onMarkDone={handleMarkAssignmentDone}
                />
              ))}
            </div>
          )}
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

      {reschedulingTask && (
        <ReschedulePopover
          onReschedule={handleReschedule}
          onClose={() => setReschedulingTask(null)}
        />
      )}
    </div>
  );
}
