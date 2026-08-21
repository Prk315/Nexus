// Every week-view modal: the block editor plus the task/goal/plan/system editors.

import { useState } from "react";
import { X, Target, ListChecks, CheckSquare, Trash2, Repeat2, MapPin } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import type { Goal, Plan, TaskWithContext, SystemEntry, CalBlock } from "../../types";
import { BLOCK_COLORS, addHour } from "./_shared";
import type { BlockDraft } from "./_shared";
import type { CoverageCategoryOption } from "../../lib/api";

// ── Shared modal shell ────────────────────────────────────────────────────────

export function Modal({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl p-5 w-80 max-h-[85vh] overflow-y-auto flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

const inputCls  = "h-8 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-ring w-full";
const selectCls = inputCls;

// ── CalBlock modal ────────────────────────────────────────────────────────────

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];


function addBlockMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function defaultDaysOfWeek(dateStr: string): number[] {
  return [new Date(dateStr + "T12:00:00").getDay()];
}

function parseDaysOfWeek(s: string | null | undefined): number[] {
  if (!s) return [];
  return s.split(",").map(Number).filter((n) => !isNaN(n));
}

export function CalBlockModal({ initial, date, startTime, tasks, categories, onSave, onDelete, onClose }: {
  initial?: CalBlock; date: string; startTime: string;
  tasks: TaskWithContext[];
  categories: CoverageCategoryOption[];
  onSave: (d: BlockDraft) => void; onDelete?: () => void; onClose: () => void;
}) {
  const [form, setForm] = useState<BlockDraft>({
    title:           initial?.title       ?? "",
    start_time:      initial?.start_time  ?? startTime,
    end_time:        initial?.end_time    ?? addHour(startTime, 1),
    color:           initial?.color       ?? "blue",
    description:     initial?.description ?? "",
    location:        initial?.location    ?? "",
    is_recurring:    initial?.is_recurring ?? false,
    recurrence:      (initial?.recurrence as BlockDraft["recurrence"]) ?? "weekly",
    days_of_week:    initial?.days_of_week
                       ? parseDaysOfWeek(initial.days_of_week)
                       : defaultDaysOfWeek(date),
    series_end_date: initial?.series_end_date ?? "",
    task_id:         initial?.task_id ?? null,
    category:        initial?.category ?? null,
  });
  // True once the user has clicked a color swatch directly in this modal
  // session — after that, picking a category no longer overrides the color.
  // Not persisted: re-opening an old block treats its stored color as the
  // starting point, not as "explicitly chosen" for this edit.
  const [colorTouched, setColorTouched] = useState(false);

  function handleCategorySelect(name: string) {
    const cat = name ? categories.find((c) => c.name === name) : undefined;
    setForm((f) => ({
      ...f,
      category: name || null,
      color: !colorTouched && cat ? cat.color : f.color,
    }));
  }

  const openTasks = tasks.filter((t) => !t.done);

  function handleTaskSelect(rawId: string) {
    if (!rawId) { setForm((f) => ({ ...f, task_id: null })); return; }
    const id = Number(rawId);
    const task = openTasks.find((t) => t.id === id);
    if (!task) return;
    setForm((f) => ({
      ...f,
      task_id: id,
      title: task.title,
      ...(task.time_estimate ? { end_time: addBlockMinutes(f.start_time, task.time_estimate) } : {}),
    }));
  }

  const ok = form.title.trim() && form.start_time < form.end_time &&
    (!form.is_recurring || form.recurrence !== "weekly" || form.days_of_week.length > 0);

  function toggleDay(d: number) {
    setForm((prev) => ({
      ...prev,
      days_of_week: prev.days_of_week.includes(d)
        ? prev.days_of_week.filter((x) => x !== d)
        : [...prev.days_of_week, d].sort(),
    }));
  }

  const isEditingRecurring = initial?.is_recurring;

  return (
    <Modal title={
      isEditingRecurring ? "Edit recurring series" :
      initial            ? "Edit block" :
                           `New block — ${date}`
    } onClose={onClose}>
      <Field label="Link task (optional)">
        <select
          className={inputCls}
          value={form.task_id ?? ""}
          onChange={(e) => handleTaskSelect(e.target.value)}
        >
          <option value="">— none —</option>
          {openTasks.length === 0 && <option disabled value="">No open tasks</option>}
          {openTasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}{t.plan_title ? ` · ${t.plan_title}` : ""}{t.time_estimate ? ` (${t.time_estimate}min)` : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Title">
        <input autoFocus className={inputCls} placeholder="What are you doing?"
          value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && ok && onSave(form)} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Start">
          <input type="time" className={inputCls} value={form.start_time}
            onChange={(e) => {
              const newStart = e.target.value;
              const linkedTask = openTasks.find((t) => t.id === form.task_id);
              const newEnd = linkedTask?.time_estimate
                ? addBlockMinutes(newStart, linkedTask.time_estimate)
                : form.end_time;
              setForm({ ...form, start_time: newStart, end_time: newEnd });
            }} />
        </Field>
        <Field label="End">
          <input type="time" className={inputCls} value={form.end_time}
            onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
        </Field>
      </div>
      <Field label="Color">
        <div className="flex items-center gap-2 flex-wrap">
          {Object.entries(BLOCK_COLORS).map(([name, c]) => (
            <button key={name} onClick={() => { setColorTouched(true); setForm({ ...form, color: name }); }}
              className={cn("h-5 w-5 rounded-full transition-all", c.dot,
                form.color === name ? "ring-2 ring-offset-2 ring-ring scale-110" : "opacity-60 hover:opacity-100"
              )} />
          ))}
        </div>
      </Field>
      <Field label="Category (optional)">
        <select
          className={selectCls}
          value={form.category ?? ""}
          onChange={(e) => handleCategorySelect(e.target.value)}
        >
          <option value="">— none —</option>
          {categories.map((c) => (
            <option key={c.name} value={c.name}>{c.emoji} {c.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Location (optional)">
        <div className="relative">
          <MapPin className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input className={cn(inputCls, "pl-7")} placeholder="Room, address, link…"
            value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </div>
      </Field>
      <Field label="Description (optional)">
        <textarea className="rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring w-full resize-none"
          rows={2} placeholder="Notes, agenda…"
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>

      {/* Recurrence — only show toggle when creating; always show options when editing recurring */}
      {!isEditingRecurring && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setForm((p) => ({ ...p, is_recurring: !p.is_recurring }))}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors",
              form.is_recurring
                ? "bg-primary/10 border-primary/40 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <Repeat2 className="h-3.5 w-3.5" />
            Repeat
          </button>
        </div>
      )}

      {(form.is_recurring || isEditingRecurring) && (
        <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-secondary/30 p-2.5">
          <Field label="Frequency">
            <select className={selectCls} value={form.recurrence}
              onChange={(e) => setForm({ ...form, recurrence: e.target.value as BlockDraft["recurrence"] })}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly (pick days)</option>
              <option value="weekdays">Weekdays (Mon–Fri)</option>
              <option value="monthly">Monthly (same date)</option>
            </select>
          </Field>
          {form.recurrence === "weekly" && (
            <Field label="On">
              <div className="flex gap-1">
                {DAY_LABELS.map((label, i) => (
                  <button key={i} type="button" onClick={() => toggleDay(i)}
                    className={cn(
                      "h-7 w-8 rounded text-xs font-medium border transition-colors",
                      form.days_of_week.includes(i)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:border-foreground"
                    )}>
                    {label[0]}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Field label="End date (optional)">
            <input type="date" className={inputCls} value={form.series_end_date}
              onChange={(e) => setForm({ ...form, series_end_date: e.target.value })} />
          </Field>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button className="flex-1" disabled={!ok} onClick={() => onSave(form)}>
          {isEditingRecurring ? "Save series" : initial ? "Save" : form.is_recurring ? "Add recurring" : "Add block"}
        </Button>
        {onDelete && (
          <Button variant="destructive" size="sm" className="px-2" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </Modal>
  );
}

// ── Task modal ────────────────────────────────────────────────────────────────

export type TaskDraft = { title: string; priority: string; plan_id: string; due_date: string; done: boolean };

export function TaskModal({ initial, date, plans, onSave, onDelete, onClose }: {
  initial?: TaskWithContext; date: string; plans: Plan[];
  onSave: (d: TaskDraft) => void; onDelete?: () => void; onClose: () => void;
}) {
  const [form, setForm] = useState<TaskDraft>({
    title:    initial?.title    ?? "",
    priority: initial?.priority ?? "medium",
    plan_id:  String(initial?.plan_id ?? (plans[0]?.id ?? "")),
    due_date: initial?.due_date ?? date,
    done:     initial?.done     ?? false,
  });
  const ok = form.title.trim() && form.plan_id;
  return (
    <Modal title={initial ? "Edit Task" : `Add Task — ${date}`} onClose={onClose}>
      <Field label="Title">
        <input className={inputCls} value={form.title} autoFocus placeholder="Task title"
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && ok && onSave(form)} />
      </Field>
      <Field label="Priority">
        <select className={selectCls} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
      </Field>
      <Field label="Plan">
        <select className={selectCls} value={form.plan_id} onChange={(e) => setForm({ ...form, plan_id: e.target.value })}>
          {plans.filter(p => p.status === "active").map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </Field>
      <Field label="Due date">
        <input type="date" className={inputCls} value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
      </Field>
      <div className="flex gap-2 pt-1">
        <Button className="flex-1" disabled={!ok} onClick={() => onSave(form)}>{initial ? "Save" : "Add Task"}</Button>
        {onDelete && <Button variant="destructive" size="sm" className="px-2" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>}
      </div>
    </Modal>
  );
}

// ── Goal modal ────────────────────────────────────────────────────────────────

export type GoalDraft = { title: string; priority: string; deadline: string; status: string; description: string };

export function GoalModal({ initial, date, onSave, onDelete, onClose }: {
  initial?: Goal; date: string; onSave: (d: GoalDraft) => void; onDelete?: () => void; onClose: () => void;
}) {
  const [form, setForm] = useState<GoalDraft>({
    title: initial?.title ?? "", priority: initial?.priority ?? "medium",
    deadline: initial?.deadline ?? date, status: initial?.status ?? "active", description: initial?.description ?? "",
  });
  const ok = form.title.trim();
  return (
    <Modal title={initial ? "Edit Goal" : `Add Goal — ${date}`} onClose={onClose}>
      <Field label="Title"><input className={inputCls} value={form.title} autoFocus placeholder="Goal title"
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && ok && onSave(form)} /></Field>
      <Field label="Priority">
        <select className={selectCls} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
      </Field>
      <Field label="Deadline"><input type="date" className={inputCls} value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></Field>
      {initial && <Field label="Status">
        <select className={selectCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option value="active">Active</option><option value="completed">Completed</option><option value="archived">Archived</option>
        </select>
      </Field>}
      <div className="flex gap-2 pt-1">
        <Button className="flex-1" disabled={!ok} onClick={() => onSave(form)}>{initial ? "Save" : "Add Goal"}</Button>
        {onDelete && <Button variant="destructive" size="sm" className="px-2" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>}
      </div>
    </Modal>
  );
}

// ── Plan modal ────────────────────────────────────────────────────────────────

export type PlanDraft = { title: string; goal_id: string; deadline: string; status: string; description: string };

export function PlanModal({ initial, date, goals, onSave, onDelete, onClose }: {
  initial?: Plan; date: string; goals: Goal[];
  onSave: (d: PlanDraft) => void; onDelete?: () => void; onClose: () => void;
}) {
  const [form, setForm] = useState<PlanDraft>({
    title: initial?.title ?? "", goal_id: String(initial?.goal_id ?? ""),
    deadline: initial?.deadline ?? date, status: initial?.status ?? "active", description: initial?.description ?? "",
  });
  const ok = form.title.trim();
  return (
    <Modal title={initial ? "Edit Plan" : `Add Plan — ${date}`} onClose={onClose}>
      <Field label="Title"><input className={inputCls} value={form.title} autoFocus placeholder="Plan title"
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && ok && onSave(form)} /></Field>
      <Field label="Goal (optional)">
        <select className={selectCls} value={form.goal_id} onChange={(e) => setForm({ ...form, goal_id: e.target.value })}>
          <option value="">— none —</option>
          {goals.filter(g => g.status === "active").map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
        </select>
      </Field>
      <Field label="Deadline"><input type="date" className={inputCls} value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></Field>
      {initial && <Field label="Status">
        <select className={selectCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option value="active">Active</option><option value="completed">Completed</option>
        </select>
      </Field>}
      <div className="flex gap-2 pt-1">
        <Button className="flex-1" disabled={!ok} onClick={() => onSave(form)}>{initial ? "Save" : "Add Plan"}</Button>
        {onDelete && <Button variant="destructive" size="sm" className="px-2" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>}
      </div>
    </Modal>
  );
}

// ── System modal ──────────────────────────────────────────────────────────────

export type SystemDraft = { title: string; description: string; frequency: string; start_time: string; end_time: string };

export function SystemModal({ initial, onSave, onDelete, onClose }: {
  initial?: SystemEntry; onSave: (d: SystemDraft) => void; onDelete?: () => void; onClose: () => void;
}) {
  const [form, setForm] = useState<SystemDraft>({
    title:       initial?.title       ?? "",
    description: initial?.description ?? "",
    frequency:   initial?.frequency   ?? "daily",
    start_time:  initial?.start_time  ?? "",
    end_time:    initial?.end_time    ?? "",
  });
  const ok = form.title.trim();
  return (
    <Modal title={initial ? "Edit System" : "Add System"} onClose={onClose}>
      <Field label="Title"><input className={inputCls} value={form.title} autoFocus placeholder="System title"
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && ok && onSave(form)} /></Field>
      <Field label="Frequency">
        <select className={selectCls} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
          <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
        </select>
      </Field>
      <Field label="Scheduled time (optional)">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground/70">Start</span>
            <input type="time" className={inputCls} value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground/70">End</span>
            <input type="time" className={inputCls} value={form.end_time}
              onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
          </div>
        </div>
      </Field>
      <Field label="Description (optional)">
        <textarea className="rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring w-full resize-none" rows={2}
          value={form.description} placeholder="..." onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <div className="flex gap-2 pt-1">
        <Button className="flex-1" disabled={!ok} onClick={() => onSave(form)}>{initial ? "Save" : "Add System"}</Button>
        {onDelete && <Button variant="destructive" size="sm" className="px-2" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>}
      </div>
    </Modal>
  );
}

// ── Type picker ───────────────────────────────────────────────────────────────

type ItemType = "task" | "goal" | "plan";

export function TypePickerModal({ date, onPick, onClose }: {
  date: string; onPick: (t: ItemType) => void; onClose: () => void;
}) {
  return (
    <Modal title={`Add to ${date}`} onClose={onClose}>
      <p className="text-xs text-muted-foreground">What would you like to add?</p>
      <div className="flex flex-col gap-2">
        {([
          ["task", "Task",  CheckSquare, "A specific to-do with a due date"],
          ["goal", "Goal",  Target,      "A long-term objective with a deadline"],
          ["plan", "Plan",  ListChecks,  "A plan or project with a deadline"],
        ] as const).map(([type, label, Icon, desc]) => (
          <button key={type} onClick={() => onPick(type)}
            className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-secondary transition-colors text-left">
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

// ── Task popup chip ───────────────────────────────────────────────────────────

/** Minutes -> "1h30" for the task popup. */
