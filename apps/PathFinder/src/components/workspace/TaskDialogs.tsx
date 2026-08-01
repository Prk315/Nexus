import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import type { TaskWithContext, Priority, Plan } from "../../types";

export interface TaskFormState {
  title: string;
  priority: Priority;
  due_date: string;
  time_estimate: string;
  plan_id: string; // "" = no plan
}

function PlanSelect({ plans, value, onChange }: {
  plans: Plan[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">No plan</option>
      {plans.map((p) => (
        <option key={p.id} value={String(p.id)}>{p.title}</option>
      ))}
    </select>
  );
}

function TaskForm({ initial, plans, submitLabel, onSubmit, onClose }: {
  initial: TaskFormState;
  plans: Plan[];
  submitLabel: string;
  onSubmit: (data: TaskFormState) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<TaskFormState>(initial);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setLoading(true);
    try { await onSubmit(form); } finally { setLoading(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-2">
      <Input
        autoFocus
        placeholder="Task title"
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        required
      />
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Plan</label>
        <PlanSelect plans={plans} value={form.plan_id} onChange={(v) => setForm((f) => ({ ...f, plan_id: v }))} />
      </div>
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
        <Button type="submit" disabled={loading}>{submitLabel}</Button>
      </div>
    </form>
  );
}

export function EditTaskForm({ task, plans, onSave, onClose }: {
  task: TaskWithContext;
  plans: Plan[];
  onSave: (data: TaskFormState) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <TaskForm
      plans={plans}
      submitLabel="Save"
      onSubmit={onSave}
      onClose={onClose}
      initial={{
        title: task.title,
        priority: task.priority,
        due_date: task.due_date ?? "",
        time_estimate: task.time_estimate != null ? String(task.time_estimate) : "",
        plan_id: task.plan_id != null ? String(task.plan_id) : "",
      }}
    />
  );
}

export function AddTaskForm({ plans, defaultPlanId, defaultDue, onAdd, onClose }: {
  plans: Plan[];
  defaultPlanId?: number | null;
  defaultDue?: string;
  onAdd: (data: TaskFormState) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <TaskForm
      plans={plans}
      submitLabel="Add task"
      onSubmit={onAdd}
      onClose={onClose}
      initial={{
        title: "",
        priority: "medium",
        due_date: defaultDue ?? "",
        time_estimate: "",
        plan_id: defaultPlanId != null ? String(defaultPlanId) : "",
      }}
    />
  );
}

export function ReschedulePopover({ onReschedule, onClose }: {
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
    { label: "Tomorrow", date: offset(1) },
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
            <Input type="date" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-8 text-xs flex-1" />
            <Button size="sm" disabled={!custom} onClick={() => { if (custom) onReschedule(custom); }}>Set</Button>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}
