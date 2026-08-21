import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { URGENCY_LABEL } from "../../lib/utils";
import { planningOf } from "../../lib/taskTree";
import type { TaskWithContext, Priority, Urgency, Plan, TaskType } from "../../types";

export interface TaskFormState {
  title: string;
  /** The importance axis. */
  priority: Priority;
  /** The urgency axis — its complement. Together they place the task on the matrix. */
  urgency: Urgency;
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
          <label className="text-xs text-muted-foreground">Importance</label>
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
          <label className="text-xs text-muted-foreground">Urgency</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.urgency}
            onChange={(e) => setForm((f) => ({ ...f, urgency: e.target.value as Urgency }))}
          >
            {(["high", "medium", "low"] as Urgency[]).map((u) => (
              <option key={u} value={u}>{URGENCY_LABEL[u]}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Due date</label>
        <Input
          type="date"
          value={form.due_date}
          onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
        />
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
        urgency: planningOf(task).urgency,
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
        urgency: "medium",
        due_date: defaultDue ?? "",
        time_estimate: "",
        plan_id: defaultPlanId != null ? String(defaultPlanId) : "",
      }}
    />
  );
}

/**
 * The attributes that belong to a sparse subtype, and only to it.
 *
 * Two or three fields each — that sparseness is the whole point of the ISA
 * split. A reminder gets a bell and a lead time; it does not get a lifecycle, a
 * breakdown tree or a completion mode, because none of those mean anything for
 * "remember to call the dentist".
 */
export function SubtypeFields({ type, value, onChange }: {
  type: Exclude<TaskType, "task">;
  value: Record<string, any>;
  onChange: (patch: Record<string, any>) => void;
}) {
  const field = (label: string, node: React.ReactNode) => (
    <div className="flex flex-col gap-1 flex-1 min-w-[120px]">
      <label className="text-xs text-muted-foreground">{label}</label>
      {node}
    </div>
  );

  const numeric = (v: string) => (v.trim() === "" ? null : Math.max(0, Number(v) || 0));

  return (
    <div className="flex flex-wrap gap-2 rounded-lg border border-border p-3">
      <span className="w-full text-[11px] font-medium text-muted-foreground capitalize">
        {type} details
      </span>

      {type === "reminder" && (
        <>
          {field("Remind at", (
            <Input
              type="datetime-local"
              // Stored as timestamptz; the input wants a local "YYYY-MM-DDTHH:mm".
              value={value.remind_at ? String(value.remind_at).slice(0, 16) : ""}
              onChange={(e) => onChange({ remind_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
            />
          ))}
          {field("Lead (min)", (
            <Input
              type="number" min={0} placeholder="0"
              value={value.lead_minutes ?? ""}
              onChange={(e) => onChange({ lead_minutes: numeric(e.target.value) })}
            />
          ))}
        </>
      )}

      {type === "chore" && (
        <>
          {field("Area", (
            <Input
              placeholder="kitchen, bathroom…"
              value={value.area ?? ""}
              onChange={(e) => onChange({ area: e.target.value || null })}
            />
          ))}
          {/*
            `rotation_days` is deliberately no longer edited here. Recurrence is
            Systems' job — a chore that comes back is a system with
            `frequency: 'interval'`, which already has streaks and a due rule.
            Two recurrence engines would drift. The column still exists because
            deployed code reads it; it gets dropped after this ships.
          */}
          <p className="w-full text-[10px] text-muted-foreground/70 leading-snug">
            Should this come back on its own? Use <strong className="font-medium">Make recurring</strong> —
            repeating work lives in Systems, which tracks streaks and when it's next due.
          </p>
        </>
      )}

      {type === "shopping" && (
        <>
          {field("Quantity", (
            <Input
              placeholder="2 × 500g"
              value={value.quantity ?? ""}
              onChange={(e) => onChange({ quantity: e.target.value || null })}
            />
          ))}
          {field("Store", (
            <Input
              placeholder="Netto"
              value={value.store ?? ""}
              onChange={(e) => onChange({ store: e.target.value || null })}
            />
          ))}
        </>
      )}
    </div>
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
