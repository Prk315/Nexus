import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  ChevronLeft, ChevronRight, ChevronDown, Plus, X, Check, Target, ListChecks,
  CheckSquare, RefreshCw, Flame, Trash2, Repeat2, MapPin, Flag, Bell, GraduationCap,
  PanelLeft, PanelRight, PanelBottom, PanelTop,
} from "lucide-react";
import {
  getWeekItems, getGoals, getPlans, getSystems,
  createTask, updateTask, deleteTask, toggleTask,
  createGoal, updateGoal, deleteGoal,
  createPlan, updatePlan, deletePlan,
  createSystem, updateSystem, deleteSystem, markSystemDone,
  getCalBlocks, createCalBlock, updateCalBlock, deleteCalBlock,
  createRecurringCalBlock, updateRecurringCalBlock, deleteRecurringCalBlock,
  getDeadlines, getReminders, toggleDeadline, toggleReminder, updateCourseAssignment,
  getCaSubtasks, toggleCaSubtask,
} from "../lib/api";
import { Button } from "../components/ui/button";
import { cn, layoutCalItems } from "../lib/utils";
import { isDue } from "./Systems";
import type { Goal, Plan, TaskWithContext, SystemEntry, WeekItems, CalBlock, Deadline, Reminder, CourseAssignment, CaSubtask } from "../types";

// ── Date helpers ──────────────────────────────────────────────────────────────

function weekStart(from: Date): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayISO() { return toISO(new Date()); }

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Returns true if the system should appear on the given ISO date
function systemScheduledFor(sys: import("../types").SystemEntry, iso: string): boolean {
  if (sys.frequency === "daily") return true;
  if (sys.frequency === "weekly") {
    const days = sys.days_of_week ? sys.days_of_week.split(",").map(Number) : [];
    if (days.length === 0) return true;
    return days.includes(new Date(iso + "T12:00:00").getDay());
  }
  return false; // monthly: not shown in time grid
}
const MONTHS    = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Time grid constants ───────────────────────────────────────────────────────

const HOUR_START = 5;
const HOUR_END   = 23;
const HOURS      = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
const HOUR_PX    = 56; // pixels per hour

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}
function minutesToPx(min: number): number {
  return ((min - HOUR_START * 60) / 60) * HOUR_PX;
}
function pxToTime(px: number, containerHeight: number): string {
  const clamped = Math.max(0, Math.min(px, containerHeight));
  const totalMin = HOUR_START * 60 + (clamped / HOUR_PX) * 60;
  const rounded  = Math.round(totalMin / 30) * 30;
  const h = Math.min(HOUR_END, Math.floor(rounded / 60));
  const m = rounded % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function addHour(t: string, h: number): string {
  const min = Math.min(HOUR_END * 60, timeToMinutes(t) + h * 60);
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const BLOCK_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  blue:    { bg: "bg-blue-500/20",    border: "border-blue-400/50",    text: "text-blue-700 dark:text-blue-300",    dot: "bg-blue-500" },
  indigo:  { bg: "bg-indigo-500/20",  border: "border-indigo-400/50",  text: "text-indigo-700 dark:text-indigo-300",  dot: "bg-indigo-500" },
  violet:  { bg: "bg-violet-500/20",  border: "border-violet-400/50",  text: "text-violet-700 dark:text-violet-300",  dot: "bg-violet-500" },
  purple:  { bg: "bg-purple-500/20",  border: "border-purple-400/50",  text: "text-purple-700 dark:text-purple-300",  dot: "bg-purple-500" },
  pink:    { bg: "bg-pink-500/20",    border: "border-pink-400/50",    text: "text-pink-700 dark:text-pink-300",    dot: "bg-pink-500" },
  rose:    { bg: "bg-rose-500/20",    border: "border-rose-400/50",    text: "text-rose-700 dark:text-rose-300",    dot: "bg-rose-500" },
  red:     { bg: "bg-red-500/20",     border: "border-red-400/50",     text: "text-red-700 dark:text-red-300",     dot: "bg-red-500" },
  orange:  { bg: "bg-orange-500/20",  border: "border-orange-400/50",  text: "text-orange-700 dark:text-orange-300",  dot: "bg-orange-500" },
  amber:   { bg: "bg-amber-500/20",   border: "border-amber-400/50",   text: "text-amber-700 dark:text-amber-300",   dot: "bg-amber-500" },
  yellow:  { bg: "bg-yellow-500/20",  border: "border-yellow-400/50",  text: "text-yellow-700 dark:text-yellow-300",  dot: "bg-yellow-500" },
  green:   { bg: "bg-green-500/20",   border: "border-green-400/50",   text: "text-green-700 dark:text-green-300",   dot: "bg-green-500" },
  emerald: { bg: "bg-emerald-500/20", border: "border-emerald-400/50", text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  teal:    { bg: "bg-teal-500/20",    border: "border-teal-400/50",    text: "text-teal-700 dark:text-teal-300",    dot: "bg-teal-500" },
  cyan:    { bg: "bg-cyan-500/20",    border: "border-cyan-400/50",    text: "text-cyan-700 dark:text-cyan-300",    dot: "bg-cyan-500" },
  slate:   { bg: "bg-slate-500/20",   border: "border-slate-400/50",   text: "text-slate-600 dark:text-slate-300",   dot: "bg-slate-400" },
};

// ── Shared modal shell ────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: {
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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

type BlockDraft = {
  title: string; start_time: string; end_time: string; color: string;
  description: string; location: string;
  is_recurring: boolean;
  recurrence: "daily" | "weekly" | "weekdays" | "monthly";
  days_of_week: number[];
  series_end_date: string;
};

function defaultDaysOfWeek(dateStr: string): number[] {
  return [new Date(dateStr + "T12:00:00").getDay()];
}

function parseDaysOfWeek(s: string | null | undefined): number[] {
  if (!s) return [];
  return s.split(",").map(Number).filter((n) => !isNaN(n));
}

function CalBlockModal({ initial, date, startTime, onSave, onDelete, onClose }: {
  initial?: CalBlock; date: string; startTime: string;
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
  });

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
      <Field label="Title">
        <input autoFocus className={inputCls} placeholder="What are you doing?"
          value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && ok && onSave(form)} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Start">
          <input type="time" className={inputCls} value={form.start_time}
            onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
        </Field>
        <Field label="End">
          <input type="time" className={inputCls} value={form.end_time}
            onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
        </Field>
      </div>
      <Field label="Color">
        <div className="flex items-center gap-2 flex-wrap">
          {Object.entries(BLOCK_COLORS).map(([name, c]) => (
            <button key={name} onClick={() => setForm({ ...form, color: name })}
              className={cn("h-5 w-5 rounded-full transition-all", c.dot,
                form.color === name ? "ring-2 ring-offset-2 ring-ring scale-110" : "opacity-60 hover:opacity-100"
              )} />
          ))}
        </div>
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

type TaskDraft = { title: string; priority: string; plan_id: string; due_date: string; done: boolean };

function TaskModal({ initial, date, plans, onSave, onDelete, onClose }: {
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

type GoalDraft = { title: string; priority: string; deadline: string; status: string; description: string };

function GoalModal({ initial, date, onSave, onDelete, onClose }: {
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

type PlanDraft = { title: string; goal_id: string; deadline: string; status: string; description: string };

function PlanModal({ initial, date, goals, onSave, onDelete, onClose }: {
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

type SystemDraft = { title: string; description: string; frequency: string; start_time: string; end_time: string };

function SystemModal({ initial, onSave, onDelete, onClose }: {
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

function TypePickerModal({ date, onPick, onClose }: {
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

function TaskPopupChip({ t, onToggle, onEdit }: {
  t: TaskWithContext;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const chipRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const chip = t.done
    ? "bg-emerald-500/15 border-emerald-400/40"
    : t.priority === "high"    ? "bg-red-500/10 border-red-400/40"
    : t.priority === "medium"  ? "bg-amber-500/10 border-amber-400/40"
    :                            "bg-blue-500/10 border-blue-400/40";
  const check = t.done
    ? "bg-emerald-500 border-emerald-500"
    : t.priority === "high"    ? "border-red-400 hover:bg-red-400/20"
    : t.priority === "medium"  ? "border-amber-400 hover:bg-amber-400/20"
    :                            "border-blue-400 hover:bg-blue-400/20";

  const priorityLabel: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };
  const priorityColor: Record<string, string> = { high: "text-red-500", medium: "text-amber-500", low: "text-blue-500" };

  // close on outside click
  useEffect(() => {
    if (!pos) return;
    function down(e: MouseEvent) {
      const t = e.target as Node;
      if (!chipRef.current?.contains(t) && !cardRef.current?.contains(t)) {
        setPos(null);
      }
    }
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [pos]);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (pos) { setPos(null); return; }
    const r = chipRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 224) });
  }

  return (
    <>
      <div
        ref={chipRef}
        onClick={toggle}
        className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer transition-colors select-none", chip)}
      >
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className={cn("flex h-3 w-3 shrink-0 items-center justify-center rounded border transition-colors", check)}
        >
          {t.done && <Check className="h-2 w-2 text-white" />}
        </button>
        <span className={cn("text-[11px] truncate flex-1", t.done ? "line-through text-muted-foreground" : "text-foreground")}>
          {t.title}
        </span>
      </div>

      {pos && (
        <div
          ref={cardRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
          className="w-56 rounded-xl border border-border bg-card shadow-2xl p-3 flex flex-col gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <p className={cn("text-xs font-semibold leading-snug", t.done ? "line-through text-muted-foreground" : "text-foreground")}>
            {t.title}
          </p>

          <div className="flex flex-col gap-0.5">
            {t.plan_title && <p className="text-[11px] text-muted-foreground truncate">Plan: {t.plan_title}</p>}
            {t.goal_title && <p className="text-[11px] text-muted-foreground truncate">Goal: {t.goal_title}</p>}
          </div>

          <div className="flex items-center gap-2">
            <span className={cn("text-[11px] font-medium", priorityColor[t.priority] ?? "text-muted-foreground")}>
              {priorityLabel[t.priority] ?? t.priority} priority
            </span>
            {t.done && <span className="text-[11px] font-medium text-emerald-500 ml-auto">✓ Done</span>}
          </div>

          <div className="flex gap-2 pt-1 border-t border-border">
            <button
              onClick={(e) => { e.stopPropagation(); onToggle(); setPos(null); }}
              className="flex-1 text-[11px] py-1 rounded-md border border-border hover:bg-secondary transition-colors text-foreground"
            >
              {t.done ? "Mark undone" : "Mark done"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setPos(null); onEdit(); }}
              className="flex-1 text-[11px] py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Edit
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Time column ───────────────────────────────────────────────────────────────

function TimeColumn({ date, isToday, blocks, systems, courseAssignments, onClickSlot, onClickBlock }: {
  date: Date; isToday: boolean;
  blocks: CalBlock[];
  systems: SystemEntry[];
  courseAssignments: CourseAssignment[];
  onClickSlot: (date: string, time: string) => void;
  onClickBlock: (b: CalBlock) => void;
}) {
  const iso = toISO(date);
  const colRef = useRef<HTMLDivElement>(null);

  function handleClick(e: React.MouseEvent) {
    if (!colRef.current) return;
    const rect = colRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const time = pxToTime(y, HOURS.length * HOUR_PX);
    onClickSlot(iso, time);
  }

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowPx = minutesToPx(nowMin);
  const showNow = isToday && nowMin >= HOUR_START * 60 && nowMin <= HOUR_END * 60;

  return (
    <div className={cn("flex-1 min-w-0 border-r border-border relative", isToday && "bg-primary/[0.03]")}>
      {/* Time grid */}
      <div
        ref={colRef}
        className="relative flex-1 cursor-crosshair"
        style={{ height: HOURS.length * HOUR_PX }}
        onClick={handleClick}
      >
        {/* Hour lines */}
        {HOURS.map((h, i) => (
          <div key={h} className="absolute left-0 right-0 border-t border-border/30"
            style={{ top: i * HOUR_PX }} />
        ))}
        {/* Half-hour lines */}
        {HOURS.slice(0, -1).map((h, i) => (
          <div key={`${h}h`} className="absolute left-0 right-0 border-t border-border/10 border-dashed"
            style={{ top: i * HOUR_PX + HOUR_PX / 2 }} />
        ))}

        {/* Current time indicator */}
        {showNow && (
          <div className="absolute left-0 right-0 z-10 flex items-center pointer-events-none"
            style={{ top: nowPx }}>
            <div className="h-2 w-2 rounded-full bg-primary shrink-0 -ml-1" />
            <div className="flex-1 border-t-2 border-primary" />
          </div>
        )}

        {/* All timed events — unified overlap layout */}
        {(() => {
          const timedSys = systems.filter((s) => s.start_time && systemScheduledFor(s, iso));
          const timedCAs = courseAssignments.filter((a) => a.start_time);

          type WkEvt =
            | { kind: "sys"; startMin: number; endMin: number; s: SystemEntry }
            | { kind: "ca";  startMin: number; endMin: number; a: CourseAssignment }
            | { kind: "blk"; startMin: number; endMin: number; b: CalBlock };

          const evts: WkEvt[] = [
            ...timedSys.map((s) => ({
              kind: "sys" as const,
              startMin: timeToMinutes(s.start_time!),
              endMin:   s.end_time ? timeToMinutes(s.end_time) : timeToMinutes(s.start_time!) + 60,
              s,
            })),
            ...timedCAs.map((a) => ({
              kind: "ca" as const,
              startMin: timeToMinutes(a.start_time!),
              endMin:   a.end_time ? timeToMinutes(a.end_time) : timeToMinutes(a.start_time!) + 60,
              a,
            })),
            ...blocks.map((b) => ({
              kind: "blk" as const,
              startMin: timeToMinutes(b.start_time),
              endMin:   timeToMinutes(b.end_time),
              b,
            })),
          ];

          return layoutCalItems(evts).map(({ item, col, totalCols }) => {
            const top    = minutesToPx(item.startMin);
            const height = Math.max(20, minutesToPx(item.endMin) - top);
            const left   = `calc(${(col / totalCols) * 100}% + 1px)`;
            const right  = `calc(${((totalCols - col - 1) / totalCols) * 100}% + 1px)`;

            if (item.kind === "sys") {
              const { s } = item;
              return (
                <div key={`sys-${s.id}`}
                  className="absolute rounded border px-1.5 py-0.5 overflow-hidden bg-emerald-500/15 border-emerald-400/40 pointer-events-none"
                  style={{ top, height, left, right }}
                >
                  <div className="flex items-center gap-1">
                    <RefreshCw className="h-2.5 w-2.5 shrink-0 text-emerald-600 dark:text-emerald-400 opacity-70" />
                    <p className="text-[11px] font-semibold leading-tight truncate text-emerald-700 dark:text-emerald-300">{s.title}</p>
                  </div>
                  {height > 30 && (
                    <p className="text-[10px] leading-tight opacity-70 text-emerald-700 dark:text-emerald-300">
                      {s.start_time}{s.end_time ? `–${s.end_time}` : ""}
                    </p>
                  )}
                </div>
              );
            }

            if (item.kind === "ca") {
              const { a } = item;
              const isTheory = a.assignment_type === "theory";
              const caBg   = isTheory ? "bg-orange-500/15 border-orange-400/40" : "bg-indigo-500/15 border-indigo-400/40";
              const caTxt  = isTheory ? "text-orange-700 dark:text-orange-300"  : "text-indigo-700 dark:text-indigo-300";
              const caIcon = isTheory ? "text-orange-600 dark:text-orange-400"  : "text-indigo-600 dark:text-indigo-400";
              return (
                <div key={`ca-${a.id}`}
                  className={cn("absolute rounded border px-1.5 py-0.5 overflow-hidden pointer-events-none", caBg)}
                  style={{ top, height, left, right }}
                >
                  <div className="flex items-center gap-1">
                    <GraduationCap className={cn("h-2.5 w-2.5 shrink-0 opacity-70", caIcon)} />
                    <p className={cn("text-[11px] font-semibold leading-tight truncate", caTxt)}>{a.title}</p>
                  </div>
                  {height > 30 && (
                    <p className={cn("text-[10px] leading-tight opacity-70", caTxt)}>
                      {a.start_time}{a.end_time ? `–${a.end_time}` : ""}
                    </p>
                  )}
                  {height > 46 && (
                    <p className={cn("text-[10px] leading-tight opacity-60 truncate", caTxt)}>{a.plan_title}</p>
                  )}
                </div>
              );
            }

            // cal block
            const { b } = item;
            const clr = BLOCK_COLORS[b.color] ?? BLOCK_COLORS.blue;
            return (
              <div key={`${b.is_recurring ? "r" : "b"}-${b.recurring_id ?? b.id}-${b.date}`}
                className={cn("absolute rounded border px-1.5 py-0.5 cursor-pointer overflow-hidden", clr.bg, clr.border)}
                style={{ top, height, left, right }}
                onClick={(e) => { e.stopPropagation(); onClickBlock(b); }}
              >
                <div className="flex items-center gap-1">
                  {b.is_recurring && <Repeat2 className={cn("h-2.5 w-2.5 shrink-0 opacity-70", clr.text)} />}
                  <p className={cn("text-[11px] font-semibold leading-tight truncate", clr.text)}>{b.title}</p>
                </div>
                {height > 30 && (
                  <p className={cn("text-[10px] leading-tight opacity-70", clr.text)}>{b.start_time}–{b.end_time}</p>
                )}
                {height > 46 && b.location && (
                  <div className={cn("flex items-center gap-0.5 mt-0.5", clr.text)}>
                    <MapPin className="h-2.5 w-2.5 shrink-0 opacity-70" />
                    <p className="text-[10px] leading-tight opacity-70 truncate">{b.location}</p>
                  </div>
                )}
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}

// ── Systems bar ───────────────────────────────────────────────────────────────

function SystemsBar({ systems, onMarkDone, onAdd, onEdit }: {
  systems: SystemEntry[]; onMarkDone: (id: number) => void; onAdd: () => void; onEdit: (s: SystemEntry) => void;
}) {
  return (
    <div className="shrink-0 border-t border-border bg-card px-4 py-2 flex items-center gap-2 overflow-x-auto">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0 flex items-center gap-1">
        <RefreshCw className="h-3 w-3" /> Systems
      </span>
      <div className="w-px h-4 bg-border shrink-0" />
      {systems.length === 0 && <span className="text-xs text-muted-foreground italic">No systems yet.</span>}
      {systems.map((sys) => {
        const due = isDue(sys);
        return (
          <div key={sys.id} className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 border text-xs shrink-0",
            due ? "border-orange-400/50 bg-orange-400/10 text-foreground" : "border-border bg-secondary/50 text-muted-foreground")}>
            <button onClick={() => onEdit(sys)} className="flex items-center gap-1.5 hover:opacity-80">
              <span className="truncate max-w-[80px]">{sys.title}</span>
              {sys.streak_count > 1 && <span className="flex items-center gap-0.5 text-orange-500"><Flame className="h-3 w-3" />{sys.streak_count}</span>}
              <span className="text-muted-foreground/60 text-[10px]">{sys.frequency[0].toUpperCase()}</span>
            </button>
            {due && (
              <button onClick={() => onMarkDone(sys.id)}
                className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/20 hover:bg-primary/40 transition-colors">
                <Check className="h-2.5 w-2.5 text-primary" />
              </button>
            )}
          </div>
        );
      })}
      <button onClick={onAdd} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0">
        <Plus className="h-3.5 w-3.5" /> Add
      </button>
    </div>
  );
}

// ── Header panel (completion rate + daily indicators) ─────────────────────────

function HeaderPanel({ items, today, days, view }: {
  items: WeekItems; today: string; days: Date[]; view: "week" | "month";
}) {
  const tasks = items.tasks;
  const cas   = items.course_assignments;

  // Per-day "free day" toggle — stored in localStorage
  const [freeDays, setFreeDays] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("free_days");
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch { return new Set(); }
  });

  function toggleFreeDay(iso: string) {
    setFreeDays((prev) => {
      const next = new Set(prev);
      next.has(iso) ? next.delete(iso) : next.add(iso);
      localStorage.setItem("free_days", JSON.stringify([...next]));
      return next;
    });
  }

  const total = tasks.length + cas.length;
  const done  = tasks.filter((t) => t.done).length + cas.filter((a) => a.status === "done").length;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="shrink-0 border-b border-border bg-card/50 px-5 py-3 flex items-center gap-6">

      {/* Weekly / monthly completion rate */}
      <div className="flex flex-col gap-1.5 w-44 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            {view === "month" ? "Month" : "Week"} completion
          </span>
          <span className="text-sm font-bold text-foreground tabular-nums">{pct}%</span>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500",
              pct === 100 ? "bg-emerald-500" : "bg-primary"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground">{done} of {total} tasks done</span>
      </div>

      {/* Daily progress bars — week view only */}
      {view === "week" && (
        <>
          <div className="w-px h-10 bg-border shrink-0" />
          <div className="flex items-end gap-2.5">
            {days.map((day) => {
              const iso      = toISO(day);
              const dayTasks = tasks.filter((t) => t.due_date === iso);
              const dayCAs   = cas.filter((a) => a.due_date === iso);
              const dayDone  = dayTasks.filter((t) => t.done).length + dayCAs.filter((a) => a.status === "done").length;
              const dayTotal = dayTasks.length + dayCAs.length;
              const dayPct   = dayTotal > 0 ? dayDone / dayTotal : 0;
              const isToday  = iso === today;
              const isPast   = iso < today && !isToday;
              const isEmpty  = dayTotal === 0;
              const isFree   = isEmpty && freeDays.has(iso);

              const barColor =
                isFree                    ? "bg-emerald-500"
                : dayDone === dayTotal && dayTotal > 0 ? "bg-emerald-500"
                : isPast                  ? "bg-amber-500"
                :                          "bg-primary";

              return (
                <div key={iso} className="flex flex-col items-center gap-1">
                  <span className={cn(
                    "text-[10px] font-medium",
                    isToday ? "text-primary font-bold" : "text-muted-foreground"
                  )}>
                    {DAY_NAMES[day.getDay()]}
                  </span>

                  {/* Bar — clickable only when empty */}
                  <div
                    className={cn(
                      "relative w-5 h-9 bg-secondary rounded-full overflow-hidden flex flex-col-reverse",
                      isEmpty && "cursor-pointer hover:bg-secondary/60 transition-colors"
                    )}
                    onClick={() => isEmpty && toggleFreeDay(iso)}
                    title={isEmpty ? (isFree ? "Click to unmark" : "Click to mark as free day") : undefined}
                  >
                    {(dayTotal > 0 || isFree) && (
                      <div
                        className={cn("rounded-full transition-all duration-500", barColor)}
                        style={{ height: isFree ? "100%" : `${dayPct * 100}%` }}
                      />
                    )}
                  </div>

                  <span className="text-[9px] text-muted-foreground tabular-nums leading-none">
                    {isFree ? "free" : dayTotal > 0 ? `${dayDone}/${dayTotal}` : "·"}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Left panel (goals, plans, weekly focus) ────────────────────────────────────

function LeftPanel({ goals, plans, weekNote, onNoteChange, onEditGoal, onEditPlan }: {
  goals: Goal[]; plans: Plan[]; weekNote: string;
  onNoteChange: (v: string) => void;
  onEditGoal: (g: Goal) => void; onEditPlan: (p: Plan) => void;
}) {
  const activeGoals = goals.filter((g) => g.status === "active");
  const activePlans = plans.filter((p) => p.status === "active" && !p.is_lifestyle && !p.is_course);

  return (
    <div className="w-52 shrink-0 border-r border-border bg-card/40 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">

        <section className="flex flex-col gap-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Focus this week</p>
          <textarea
            className="w-full text-xs text-foreground bg-secondary/40 border border-border/60 rounded-md px-2.5 py-2 outline-none focus:ring-1 focus:ring-ring resize-none placeholder:text-muted-foreground/50"
            rows={4}
            placeholder="What matters most this week…"
            value={weekNote}
            onChange={(e) => onNoteChange(e.target.value)}
          />
        </section>

        {activeGoals.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Target className="h-3 w-3" /> Goals
            </p>
            {activeGoals.map((g) => {
              const pct = g.task_count > 0 ? Math.round((g.done_count / g.task_count) * 100) : 0;
              return (
                <button key={g.id} onClick={() => onEditGoal(g)}
                  className="flex flex-col gap-1 p-2 rounded-md border border-border/50 hover:bg-secondary/60 transition-colors text-left w-full">
                  <span className="text-xs font-medium text-foreground leading-tight truncate w-full">{g.title}</span>
                  <div className="flex items-center gap-2 w-full">
                    <div className="flex-1 h-1 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{g.done_count}/{g.task_count}</span>
                  </div>
                </button>
              );
            })}
          </section>
        )}

        {activePlans.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <ListChecks className="h-3 w-3" /> Plans
            </p>
            {activePlans.map((p) => {
              const pct = p.task_count > 0 ? Math.round((p.done_count / p.task_count) * 100) : 0;
              return (
                <button key={p.id} onClick={() => onEditPlan(p)}
                  className="flex flex-col gap-1 p-2 rounded-md border border-border/50 hover:bg-secondary/60 transition-colors text-left w-full">
                  <span className="text-xs font-medium text-foreground leading-tight truncate w-full">{p.title}</span>
                  <div className="flex items-center gap-2 w-full">
                    <div className="flex-1 h-1 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-primary/70 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{p.done_count}/{p.task_count}</span>
                  </div>
                </button>
              );
            })}
          </section>
        )}

        {activeGoals.length === 0 && activePlans.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No active goals or plans.</p>
        )}
      </div>
    </div>
  );
}

// ── Right panel (deadlines, reminders, assignments) ───────────────────────────

// ── Assignment section with expandable subtasks ───────────────────────────────

function AssignmentSection({ assignments, onToggle, daysTag }: {
  assignments: CourseAssignment[];
  onToggle: (a: CourseAssignment) => void;
  daysTag: (iso: string | null) => React.ReactNode;
}) {
  const [expanded,    setExpanded]    = useState<Set<number>>(new Set());
  const [subtasksMap, setSubtasksMap] = useState<Map<number, CaSubtask[]>>(new Map());

  async function handleExpand(id: number) {
    const next = new Set(expanded);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      if (!subtasksMap.has(id)) {
        const subs = await getCaSubtasks(id);
        setSubtasksMap((prev) => new Map(prev).set(id, subs));
      }
    }
    setExpanded(next);
  }

  async function handleToggleSub(assignmentId: number, subtaskId: number) {
    const updated = await toggleCaSubtask(subtaskId);
    setSubtasksMap((prev) => {
      const next = new Map(prev);
      next.set(assignmentId, (prev.get(assignmentId) ?? []).map((s) => s.id === updated.id ? updated : s));
      return next;
    });
  }

  const pending = assignments.filter((a) => a.status !== "done");
  const done    = assignments.filter((a) => a.status === "done");

  function renderRow(a: CourseAssignment, isDone: boolean) {
    const isOpen  = expanded.has(a.id);
    const subs    = subtasksMap.get(a.id) ?? [];
    return (
      <div key={a.id} className={cn("flex flex-col gap-1", isDone && "opacity-40")}>
        <div className="flex items-start gap-1.5 min-w-0">
          {/* Expand chevron */}
          <button
            onClick={() => handleExpand(a.id)}
            className="shrink-0 mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            {isOpen
              ? <ChevronDown className="h-3 w-3" />
              : <ChevronRight className="h-3 w-3" />}
          </button>

          {/* Done toggle */}
          <button
            onClick={() => onToggle(a)}
            className={cn(
              "h-3.5 w-3.5 shrink-0 rounded-sm border flex items-center justify-center transition-colors mt-0.5",
              isDone
                ? "border-emerald-400 bg-emerald-400/30"
                : "border-indigo-400 hover:bg-indigo-400/20"
            )}
          >
            {isDone && <Check className="h-2 w-2 text-emerald-600" />}
          </button>

          <div className="flex-1 min-w-0">
            <p className={cn("text-xs leading-tight truncate", isDone ? "line-through text-muted-foreground" : "text-foreground")}>{a.title}</p>
            <p className="text-[10px] text-muted-foreground truncate">{a.plan_title}</p>
          </div>
          {daysTag(a.due_date ?? null)}
        </div>

        {/* Subtasks */}
        {isOpen && (
          <div className="ml-6 flex flex-col gap-1">
            {subs.length === 0 && (
              <p className="text-[10px] text-muted-foreground italic">No subtasks.</p>
            )}
            {subs.map((s) => (
              <div key={s.id} className="flex items-center gap-1.5 min-w-0">
                <button
                  onClick={() => handleToggleSub(a.id, s.id)}
                  className={cn(
                    "h-3 w-3 shrink-0 rounded-sm border flex items-center justify-center transition-colors",
                    s.done ? "border-emerald-400 bg-emerald-400/30" : "border-border hover:border-indigo-400"
                  )}
                >
                  {s.done && <Check className="h-1.5 w-1.5 text-emerald-600" />}
                </button>
                <span className={cn("text-[11px] leading-tight truncate", s.done ? "line-through text-muted-foreground" : "text-foreground")}>
                  {s.title}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-1.5">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
        <GraduationCap className="h-3 w-3" /> Assignments
      </p>
      {pending.map((a) => renderRow(a, false))}
      {done.map((a) => renderRow(a, true))}
    </section>
  );
}

// ── Right panel ───────────────────────────────────────────────────────────────

function RightPanel({ tasks, deadlines, reminders, courseAssignments, today, onToggleTask, onToggleDeadline, onToggleReminder, onToggleAssignment }: {
  tasks: TaskWithContext[]; deadlines: Deadline[]; reminders: Reminder[]; courseAssignments: CourseAssignment[];
  today: string; onToggleTask: (id: number) => void; onToggleDeadline: (id: number) => void; onToggleReminder: (id: number) => void; onToggleAssignment: (a: CourseAssignment) => void;
}) {
  const upcomingDL = deadlines.filter((d) => !d.done).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const doneDL     = deadlines.filter((d) => d.done);
  const pendingRM  = reminders.filter((r) => !r.done).sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });

  function daysTag(iso: string | null) {
    if (!iso) return null;
    const diff = Math.round((new Date(iso + "T12:00:00").getTime() - new Date(today + "T12:00:00").getTime()) / 86400000);
    if (diff < 0) return <span className="text-[10px] text-red-500 shrink-0">{Math.abs(diff)}d late</span>;
    if (diff === 0) return <span className="text-[10px] text-amber-500 shrink-0">today</span>;
    if (diff === 1) return <span className="text-[10px] text-amber-500 shrink-0">tmrw</span>;
    return <span className="text-[10px] text-muted-foreground shrink-0">{diff}d</span>;
  }

  const pendingTasks = tasks.filter((t) => !t.done).sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });
  const doneTasks = tasks.filter((t) => t.done);

  return (
    <div className="w-52 shrink-0 border-l border-border bg-card/40 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">

        {/* Tasks */}
        <section className="flex flex-col gap-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <CheckSquare className="h-3 w-3" /> Tasks
          </p>
          {pendingTasks.length === 0 && doneTasks.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No tasks this week.</p>
          )}
          {pendingTasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => onToggleTask(t.id)}
                className={cn(
                  "h-3.5 w-3.5 shrink-0 rounded-sm border flex items-center justify-center transition-colors",
                  t.priority === "high"   ? "border-red-400 hover:bg-red-400/20"
                  : t.priority === "medium" ? "border-amber-400 hover:bg-amber-400/20"
                  :                          "border-blue-400 hover:bg-blue-400/20"
                )}
              />
              <span className="flex-1 text-xs text-foreground leading-tight truncate">{t.title}</span>
              {daysTag(t.due_date ?? null)}
            </div>
          ))}
          {doneTasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 min-w-0 opacity-40">
              <button
                onClick={() => onToggleTask(t.id)}
                className="h-3.5 w-3.5 shrink-0 rounded-sm border border-emerald-400 bg-emerald-400/30 flex items-center justify-center"
              >
                <Check className="h-2 w-2 text-emerald-600" />
              </button>
              <span className="flex-1 text-xs line-through text-muted-foreground leading-tight truncate">{t.title}</span>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Flag className="h-3 w-3" /> Deadlines
          </p>
          {upcomingDL.length === 0 && doneDL.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No deadlines.</p>
          )}
          {upcomingDL.map((d) => (
            <div key={d.id} className="flex items-center gap-2 min-w-0">
              <button onClick={() => onToggleDeadline(d.id)}
                className="h-3.5 w-3.5 shrink-0 rounded-sm border border-red-400 flex items-center justify-center hover:bg-red-400/20 transition-colors" />
              <span className="flex-1 text-xs text-foreground leading-tight truncate">{d.title}</span>
              {daysTag(d.due_date)}
            </div>
          ))}
          {doneDL.map((d) => (
            <div key={d.id} className="flex items-center gap-2 min-w-0 opacity-40">
              <button onClick={() => onToggleDeadline(d.id)}
                className="h-3.5 w-3.5 shrink-0 rounded-sm border border-emerald-400 bg-emerald-400/30 flex items-center justify-center">
                <Check className="h-2 w-2 text-emerald-600" />
              </button>
              <span className="flex-1 text-xs line-through text-muted-foreground leading-tight truncate">{d.title}</span>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Bell className="h-3 w-3" /> Reminders
          </p>
          {pendingRM.length === 0 && <p className="text-xs text-muted-foreground italic">No reminders.</p>}
          {pendingRM.map((r) => (
            <div key={r.id} className="flex items-center gap-2 min-w-0">
              <button onClick={() => onToggleReminder(r.id)}
                className="h-3.5 w-3.5 shrink-0 rounded-sm border border-amber-400 flex items-center justify-center hover:bg-amber-400/20 transition-colors" />
              <span className="flex-1 text-xs text-foreground leading-tight truncate">{r.title}</span>
              {daysTag(r.due_date ?? null)}
            </div>
          ))}
        </section>

        {courseAssignments.length > 0 && (
          <AssignmentSection
            assignments={courseAssignments}
            onToggle={onToggleAssignment}
            daysTag={daysTag}
          />
        )}
      </div>
    </div>
  );
}

// ── Month View ────────────────────────────────────────────────────────────────

const MAX_CELL_ITEMS = 3;

function MonthView({ monthStart, calBlocks, items, today, onClickDay, onClickBlock, onToggleTask, onEditGoal }: {
  monthStart: Date;
  calBlocks: CalBlock[];
  items: WeekItems;
  today: string;
  onClickDay: (iso: string) => void;
  onClickBlock: (b: CalBlock) => void;
  onToggleTask: (id: number) => void;
  onEditGoal: (g: Goal) => void;
}) {
  const deadlinesFor         = (iso: string) => items.deadlines.filter((d) => d.due_date === iso);
  const remindersFor         = (iso: string) => items.reminders.filter((r) => r.due_date === iso);
  const courseAssignmentsFor = (iso: string) => items.course_assignments.filter((a) => a.due_date === iso);
  const currentMonth = monthStart.getMonth();

  // Start grid on the Sunday of the week containing the 1st
  const gridStart = useMemo(() => {
    const d = new Date(monthStart);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }, [monthStart]);

  const cells = useMemo(() =>
    Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)),
  [gridStart]);

  const blocksFor = (iso: string) => calBlocks.filter((b) => b.date === iso);
  const tasksFor  = (iso: string) => items.tasks.filter((t) => t.due_date === iso);
  const goalsFor  = (iso: string) => items.goals.filter((g) => g.deadline === iso);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">

      {/* Day name header row */}
      <div className="shrink-0 grid grid-cols-7 border-b border-border bg-card">
        {DAY_NAMES.map((name) => (
          <div key={name} className="text-center py-2 border-r border-border last:border-r-0">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{name}</span>
          </div>
        ))}
      </div>

      {/* 6-row grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-7 h-full" style={{ gridTemplateRows: "repeat(6, minmax(100px, 1fr))" }}>
          {cells.map((day) => {
            const iso       = toISO(day);
            const isToday   = iso === today;
            const inMonth   = day.getMonth() === currentMonth;
            const blocks    = blocksFor(iso);
            const tasks     = tasksFor(iso);
            const goals     = goalsFor(iso);
            const dlItems   = deadlinesFor(iso);
            const rmItems   = remindersFor(iso);
            const caItems   = courseAssignmentsFor(iso);
            const total     = blocks.length + goals.length + tasks.length + dlItems.length + rmItems.length + caItems.length;
            let shown       = 0;

            return (
              <div
                key={iso}
                className={cn(
                  "border-r border-b border-border p-1 flex flex-col gap-0.5 cursor-pointer hover:bg-secondary/20 transition-colors overflow-hidden",
                  isToday && "bg-primary/[0.04]",
                  !inMonth && "opacity-35"
                )}
                onClick={() => onClickDay(iso)}
              >
                {/* Day number */}
                <div className={cn(
                  "text-xs font-semibold h-5 w-5 flex items-center justify-center rounded-full shrink-0 self-start",
                  isToday ? "bg-primary text-primary-foreground" : "text-foreground"
                )}>
                  {day.getDate()}
                </div>

                {/* Cal blocks */}
                {blocks.map((b) => {
                  if (shown >= MAX_CELL_ITEMS) return null;
                  shown++;
                  const col = BLOCK_COLORS[b.color] ?? BLOCK_COLORS.blue;
                  return (
                    <div key={`b-${b.recurring_id ?? b.id}-${iso}`}
                      className={cn("flex items-center gap-0.5 rounded px-1 py-px text-[10px] leading-tight border truncate shrink-0", col.bg, col.border)}
                      onClick={(e) => { e.stopPropagation(); onClickBlock(b); }}
                    >
                      {b.is_recurring && <Repeat2 className={cn("h-2 w-2 shrink-0", col.text)} />}
                      <span className={cn("truncate", col.text)}>{b.start_time} {b.title}</span>
                    </div>
                  );
                })}

                {/* Goals */}
                {goals.map((g) => {
                  if (shown >= MAX_CELL_ITEMS) return null;
                  shown++;
                  return (
                    <div key={`g-${g.id}`}
                      className="flex items-center gap-0.5 rounded px-1 py-px text-[10px] leading-tight border truncate shrink-0 bg-blue-500/10 border-blue-500/20"
                      onClick={(e) => { e.stopPropagation(); onEditGoal(g); }}
                    >
                      <Target className="h-2 w-2 text-blue-500 shrink-0" />
                      <span className="text-foreground truncate">{g.title}</span>
                    </div>
                  );
                })}

                {/* Tasks */}
                {tasks.map((t) => {
                  if (shown >= MAX_CELL_ITEMS) return null;
                  shown++;
                  const chip = t.done
                    ? "bg-emerald-500/15 border-emerald-400/40"
                    : t.priority === "high"   ? "bg-red-500/10 border-red-400/30"
                    : t.priority === "medium"  ? "bg-amber-500/10 border-amber-400/30"
                    : "bg-blue-500/10 border-blue-400/30";
                  const check = t.done
                    ? "bg-emerald-500 border-emerald-500"
                    : t.priority === "high"   ? "border-red-400"
                    : t.priority === "medium"  ? "border-amber-400"
                    : "border-blue-400";
                  return (
                    <div key={`t-${t.id}`}
                      className={cn("flex items-center gap-0.5 rounded px-1 py-px text-[10px] leading-tight border shrink-0", chip)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleTask(t.id); }}
                        className={cn("h-2.5 w-2.5 shrink-0 rounded-sm border flex items-center justify-center transition-colors", check)}
                      >
                        {t.done && <Check className="h-1.5 w-1.5 text-white" />}
                      </button>
                      <span className={cn("truncate", t.done && "line-through text-muted-foreground")}>{t.title}</span>
                    </div>
                  );
                })}

                {/* Deadlines */}
                {dlItems.map((d) => {
                  if (shown >= MAX_CELL_ITEMS) return null;
                  shown++;
                  return (
                    <div key={`dl-${d.id}`}
                      className={cn("flex items-center gap-0.5 rounded px-1 py-px text-[10px] leading-tight border truncate shrink-0",
                        d.done ? "bg-secondary/40 border-border/40" : "bg-red-500/10 border-red-400/30")}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Flag className={cn("h-2 w-2 shrink-0", d.done ? "text-muted-foreground" : "text-red-500")} />
                      <span className={cn("truncate", d.done ? "line-through text-muted-foreground" : "text-foreground")}>{d.title}</span>
                    </div>
                  );
                })}

                {/* Reminders */}
                {rmItems.map((r) => {
                  if (shown >= MAX_CELL_ITEMS) return null;
                  shown++;
                  return (
                    <div key={`rm-${r.id}`}
                      className={cn("flex items-center gap-0.5 rounded px-1 py-px text-[10px] leading-tight border truncate shrink-0",
                        r.done ? "bg-secondary/40 border-border/40" : "bg-amber-500/10 border-amber-400/30")}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Bell className={cn("h-2 w-2 shrink-0", r.done ? "text-muted-foreground" : "text-amber-500")} />
                      <span className={cn("truncate", r.done ? "line-through text-muted-foreground" : "text-foreground")}>{r.title}</span>
                    </div>
                  );
                })}

                {/* Course assignments */}
                {caItems.map((a) => {
                  if (shown >= MAX_CELL_ITEMS) return null;
                  shown++;
                  return (
                    <div key={`ca-${a.id}`}
                      className="flex items-center gap-0.5 rounded px-1 py-px text-[10px] leading-tight border truncate shrink-0 bg-indigo-500/10 border-indigo-400/30"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <GraduationCap className="h-2 w-2 shrink-0 text-indigo-500" />
                      <span className="truncate text-foreground">{a.title}</span>
                    </div>
                  );
                })}

                {/* Overflow count */}
                {total > MAX_CELL_ITEMS && (
                  <p className="text-[9px] text-muted-foreground px-1 shrink-0">+{total - MAX_CELL_ITEMS} more</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Week page ─────────────────────────────────────────────────────────────────

type ModalState =
  | { kind: "pick";          date: string }
  | { kind: "create-task";   date: string }
  | { kind: "create-goal";   date: string }
  | { kind: "create-plan";   date: string }
  | { kind: "edit-task";     task: TaskWithContext }
  | { kind: "edit-goal";     goal: Goal }
  | { kind: "edit-plan";     plan: Plan }
  | { kind: "create-system" }
  | { kind: "edit-system";   system: SystemEntry }
  | { kind: "create-block";  date: string; startTime: string }
  | { kind: "edit-block";    block: CalBlock };

export function Week() {
  const [view,       setView]      = useState<"week" | "month">("week");
  const [sun,        setSun]       = useState<Date>(() => weekStart(new Date()));
  const [monthStart, setMonthStart] = useState<Date>(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });
  const [items,        setItems]       = useState<WeekItems>({ tasks: [], goals: [], plans: [], deadlines: [], reminders: [], course_assignments: [] });
  const [allPlans,     setAllPlans]    = useState<Plan[]>([]);
  const [allGoals,     setAllGoals]    = useState<Goal[]>([]);
  const [systems,      setSystems]     = useState<SystemEntry[]>([]);
  const [calBlocks,    setCalBlocks]   = useState<CalBlock[]>([]);
  const [allDeadlines, setAllDeadlines] = useState<Deadline[]>([]);
  const [allReminders, setAllReminders] = useState<Reminder[]>([]);
  const [modal,        setModal]       = useState<ModalState | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Panel visibility — persisted in localStorage
  const [showLeft,   setShowLeft]   = useState(() => localStorage.getItem("week_panel_left")   === "1");
  const [showRight,  setShowRight]  = useState(() => localStorage.getItem("week_panel_right")  === "1");
  const [showHeader, setShowHeader] = useState(() => localStorage.getItem("week_panel_header") === "1");
  const [showFooter, setShowFooter] = useState(() => (localStorage.getItem("week_panel_footer") ?? "1") === "1");

  const toggleLeft   = () => setShowLeft((v)   => { localStorage.setItem("week_panel_left",   v ? "0" : "1"); return !v; });
  const toggleRight  = () => setShowRight((v)  => { localStorage.setItem("week_panel_right",  v ? "0" : "1"); return !v; });
  const toggleHeader = () => setShowHeader((v) => { localStorage.setItem("week_panel_header", v ? "0" : "1"); return !v; });
  const toggleFooter = () => setShowFooter((v) => { localStorage.setItem("week_panel_footer", v ? "0" : "1"); return !v; });

  // Weekly focus note — persisted per-week in localStorage
  const [weekNote, setWeekNote] = useState("");

  const days  = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(sun, i)), [sun]);
  const start = toISO(sun);
  const end   = toISO(days[6]);
  const today = todayISO();

  // Month grid range
  const monthGridStart = useMemo(() => {
    const d = new Date(monthStart); d.setDate(d.getDate() - d.getDay()); return d;
  }, [monthStart]);
  const monthGridEnd = useMemo(() => {
    const last = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    last.setDate(last.getDate() + (6 - last.getDay())); return last;
  }, [monthStart]);

  const queryStart = view === "week" ? start : toISO(monthGridStart);
  const queryEnd   = view === "week" ? end   : toISO(monthGridEnd);

  const load = useCallback(async () => {
    const [wi, gp, pl, sy, cb, dl, rm] = await Promise.all([
      getWeekItems(queryStart, queryEnd), getGoals(), getPlans(), getSystems(),
      getCalBlocks(queryStart, queryEnd), getDeadlines(), getReminders(),
    ]);
    setItems(wi); setAllGoals(gp); setAllPlans(pl); setSystems(sy); setCalBlocks(cb);
    setAllDeadlines(dl); setAllReminders(rm);
  }, [queryStart, queryEnd]);

  useEffect(() => { load(); }, [load]);

  // Load/save weekly focus note from localStorage
  useEffect(() => { setWeekNote(localStorage.getItem(`week_note_${start}`) ?? ""); }, [start]);
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(`week_note_${start}`, weekNote), 400);
    return () => clearTimeout(t);
  }, [weekNote, start]);

  // Scroll to 8am on week change (week view only)
  useEffect(() => {
    if (view === "week" && gridRef.current) {
      gridRef.current.scrollTop = (8 - HOUR_START) * HOUR_PX - 8;
    }
  }, [start, view]);

  // Week navigation
  const prevWeek = () => setSun((d) => addDays(d, -7));
  const nextWeek = () => setSun((d) => addDays(d,  7));
  const goToday  = () => {
    setSun(weekStart(new Date()));
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setMonthStart(d);
  };

  // Month navigation
  const prevMonth = () => setMonthStart((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const nextMonth = () => setMonthStart((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));

  const tasksFor     = (iso: string) => items.tasks.filter((t) => t.due_date === iso);
  const goalsFor     = (iso: string) => items.goals.filter((g) => g.deadline  === iso);
  const deadlinesFor         = (iso: string) => items.deadlines.filter((d) => d.due_date === iso);
  const remindersFor         = (iso: string) => items.reminders.filter((r) => r.due_date === iso);
  const courseAssignmentsFor = (iso: string) => items.course_assignments.filter((a) => a.due_date === iso);
  const blocksFor            = (iso: string) => calBlocks.filter((b) => b.date === iso);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleToggleTask = async (id: number) => {
    await toggleTask(id);
    setItems((prev) => ({ ...prev, tasks: prev.tasks.map((t) => t.id === id ? { ...t, done: !t.done } : t) }));
  };

  const handleCreateTask = async (d: TaskDraft) => {
    await createTask({ title: d.title, plan_id: Number(d.plan_id), priority: d.priority, due_date: d.due_date || null });
    setModal(null); load();
  };

  const handleEditTask = async (task: TaskWithContext, d: TaskDraft) => {
    await updateTask(task.id, { title: d.title, priority: d.priority, due_date: d.due_date || null });
    setModal(null); load();
  };

  const handleDeleteTask = async (id: number) => { await deleteTask(id); setModal(null); load(); };

  const handleCreateGoal = async (d: GoalDraft) => {
    await createGoal({ title: d.title, priority: d.priority, deadline: d.deadline || null, description: d.description || null });
    setModal(null); load();
  };

  const handleEditGoal = async (goal: Goal, d: GoalDraft) => {
    await updateGoal(goal.id, { title: d.title, priority: d.priority, deadline: d.deadline || null, status: d.status, description: d.description || null });
    setModal(null); load();
  };

  const handleDeleteGoal = async (id: number) => { await deleteGoal(id); setModal(null); load(); };

  const handleCreatePlan = async (d: PlanDraft) => {
    await createPlan({ title: d.title, goal_id: d.goal_id ? Number(d.goal_id) : null, deadline: d.deadline || null, description: d.description || null });
    setModal(null); load();
  };

  const handleEditPlan = async (plan: Plan, d: PlanDraft) => {
    await updatePlan(plan.id, { title: d.title, goal_id: d.goal_id ? Number(d.goal_id) : null, deadline: d.deadline || null, status: d.status, description: null, is_course: plan.is_course });
    setModal(null); load();
  };

  const handleDeletePlan = async (id: number) => { await deletePlan(id); setModal(null); load(); };

  const handleCreateSystem = async (d: SystemDraft) => {
    await createSystem({ title: d.title, description: d.description || null, frequency: d.frequency, days_of_week: null, start_time: d.start_time || null, end_time: d.end_time || null });
    setModal(null); setSystems(await getSystems());
  };

  const handleEditSystem = async (sys: SystemEntry, d: SystemDraft) => {
    await updateSystem(sys.id, { title: d.title, description: d.description || null, frequency: d.frequency, days_of_week: sys.days_of_week, start_time: d.start_time || null, end_time: d.end_time || null });
    setModal(null); setSystems(await getSystems());
  };

  const handleDeleteSystem = async (id: number) => { await deleteSystem(id); setModal(null); setSystems(await getSystems()); };
  const handleMarkSystemDone = async (id: number) => { await markSystemDone(id); setSystems(await getSystems()); };

  const handleToggleAssignment = async (a: CourseAssignment) => {
    const newStatus = a.status === "done" ? "pending" : "done";
    const updated = await updateCourseAssignment(a.id, {
      plan_id: a.plan_id, title: a.title, assignment_type: a.assignment_type,
      due_date: a.due_date, status: newStatus, priority: a.priority,
      book_title: a.book_title, chapter_start: a.chapter_start, chapter_end: a.chapter_end,
      page_start: a.page_start, page_end: a.page_end, page_current: a.page_current,
      notes: a.notes, start_time: a.start_time, end_time: a.end_time,
    });
    setItems((prev) => ({
      ...prev,
      course_assignments: prev.course_assignments.map((x) => x.id === a.id ? updated : x),
    }));
  };

  const handleToggleDeadline = async (id: number) => {
    const updated = await toggleDeadline(id);
    setAllDeadlines((prev) => prev.map((d) => d.id === id ? updated : d));
  };
  const handleToggleReminder = async (id: number) => {
    const updated = await toggleReminder(id);
    setAllReminders((prev) => prev.map((r) => r.id === id ? updated : r));
  };

  const handleCreateBlock = async (d: BlockDraft) => {
    if (modal?.kind !== "create-block") return;
    const desc = d.description.trim() || null;
    const loc  = d.location.trim()    || null;
    if (d.is_recurring) {
      const dow = d.recurrence === "weekly" ? d.days_of_week.join(",") : null;
      await createRecurringCalBlock(d.title, d.start_time, d.end_time, d.color, d.recurrence, dow, modal.date, d.series_end_date || null, desc, loc);
      load();
    } else {
      const b = await createCalBlock(modal.date, d.title, d.start_time, d.end_time, d.color, desc, loc);
      setCalBlocks((prev) => [...prev, b]);
    }
    setModal(null);
  };

  const handleEditBlock = async (block: CalBlock, d: BlockDraft) => {
    const desc = d.description.trim() || null;
    const loc  = d.location.trim()    || null;
    if (block.is_recurring && block.recurring_id != null) {
      const dow = d.recurrence === "weekly" ? d.days_of_week.join(",") : null;
      await updateRecurringCalBlock(block.recurring_id, d.title, d.start_time, d.end_time, d.color, d.recurrence, dow, d.series_end_date || null, desc, loc);
      load();
    } else {
      const b = await updateCalBlock(block.id, d.title, d.start_time, d.end_time, d.color, desc, loc);
      setCalBlocks((prev) => prev.map((x) => x.id === block.id ? b : x));
    }
    setModal(null);
  };

  const handleDeleteBlock = async (block: CalBlock) => {
    if (block.is_recurring && block.recurring_id != null) {
      await deleteRecurringCalBlock(block.recurring_id);
      load();
    } else {
      await deleteCalBlock(block.id);
      setCalBlocks((prev) => prev.filter((b) => b.id !== block.id));
    }
    setModal(null);
  };

  // ── Header label ─────────────────────────────────────────────────────────────

  const headerLabel = view === "month"
    ? `${MONTHS[monthStart.getMonth()]} ${monthStart.getFullYear()}`
    : (() => {
        const s = sun; const e = days[6];
        if (s.getMonth() === e.getMonth())
          return `${MONTHS[s.getMonth()]} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`;
        return `${MONTHS[s.getMonth()]} ${s.getDate()} – ${MONTHS[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
      })();

  const handlePrev = view === "week" ? prevWeek : prevMonth;
  const handleNext = view === "week" ? nextWeek : nextMonth;

  const panelBtn = (active: boolean) =>
    cn("p-1 rounded transition-colors", active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground");

  return (
    <div className="flex flex-col h-[calc(100vh-2.5rem)] overflow-hidden">

      {/* ── Nav header ───────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <button onClick={handlePrev} className="p-1 rounded hover:bg-secondary transition-colors">
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          </button>
          <button onClick={handleNext} className="p-1 rounded hover:bg-secondary transition-colors">
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
          <span className="text-sm font-medium text-foreground">{headerLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Panel toggles */}
          <div className="flex items-center gap-0.5 mr-1">
            <button onClick={toggleHeader} title="Toggle header panel" className={panelBtn(showHeader)}>
              <PanelTop className="h-4 w-4" />
            </button>
            <button onClick={toggleLeft} title="Toggle left panel" className={panelBtn(showLeft)}>
              <PanelLeft className="h-4 w-4" />
            </button>
            <button onClick={toggleRight} title="Toggle right panel" className={panelBtn(showRight)}>
              <PanelRight className="h-4 w-4" />
            </button>
            <button onClick={toggleFooter} title="Toggle systems bar" className={panelBtn(showFooter)}>
              <PanelBottom className="h-4 w-4" />
            </button>
          </div>
          <div className="w-px h-4 bg-border" />
          {/* View toggle */}
          <div className="flex rounded-md border border-border overflow-hidden">
            {(["week", "month"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={cn("px-3 py-1 text-xs font-medium transition-colors capitalize",
                  view === v ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                )}>
                {v}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={goToday}>Today</Button>
        </div>
      </div>

      {/* ── Header panel ─────────────────────────────────────────────────── */}
      {showHeader && <HeaderPanel items={items} today={today} days={days} view={view} />}

      {/* ── Main content row ─────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* Left sidebar */}
        {showLeft && (
          <LeftPanel
            goals={allGoals}
            plans={allPlans}
            weekNote={weekNote}
            onNoteChange={setWeekNote}
            onEditGoal={(g) => setModal({ kind: "edit-goal", goal: g })}
            onEditPlan={(p) => setModal({ kind: "edit-plan", plan: p })}
          />
        )}

        {/* ── Calendar content ───────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {view === "month" ? (
          <MonthView
            monthStart={monthStart}
            calBlocks={calBlocks}
            items={items}
            today={today}
            onClickDay={(iso) => setModal({ kind: "create-block", date: iso, startTime: "09:00" })}
            onClickBlock={(b) => setModal({ kind: "edit-block", block: b })}
            onToggleTask={handleToggleTask}
            onEditGoal={(g) => setModal({ kind: "edit-goal", goal: g })}
          />
        ) : (
          <>
            {/* Day name headers */}
            <div className="shrink-0 flex border-b border-border bg-card">
              <div className="w-12 shrink-0" />
              {days.map((day) => {
                const iso = toISO(day);
                const isToday = iso === today;
                return (
                  <div key={iso} className={cn("flex-1 text-center py-2 border-r border-border", isToday && "bg-primary/5")}>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {DAY_NAMES[day.getDay()]}
                    </p>
                    <p className={cn("text-lg font-semibold leading-none mt-0.5", isToday ? "text-primary" : "text-foreground")}>
                      {day.getDate()}
                    </p>
                    <p className="text-xs text-muted-foreground">{MONTHS[day.getMonth()]}</p>
                  </div>
                );
              })}
            </div>

            {/* Shared all-day row */}
            <div className="shrink-0 flex border-b border-border bg-card/50 overflow-y-auto" style={{ maxHeight: 96 }}>
              <div className="w-12 shrink-0 flex items-start justify-end pr-1.5 pt-1">
                <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wide">all-day</span>
              </div>
              {days.map((day) => {
                const iso = toISO(day);
                const isToday = iso === today;
                const dayGoals    = goalsFor(iso);
                const dayTasks    = tasksFor(iso);
                const dayDL       = deadlinesFor(iso);
                const dayRM       = remindersFor(iso);
                const dayCA       = courseAssignmentsFor(iso);
                const hasItems = dayGoals.length + dayTasks.length + dayDL.length + dayRM.length + dayCA.length > 0;
                return (
                  <div key={iso}
                    className={cn("flex-1 min-w-0 border-r border-border p-0.5 flex flex-col gap-0.5",
                      isToday && "bg-primary/[0.03]",
                      !hasItems && "min-h-[1.75rem]"
                    )}>
                    {dayGoals.map((g) => (
                      <button key={`g-${g.id}`} onClick={() => setModal({ kind: "edit-goal", goal: g })}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-left w-full bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 transition-colors">
                        <Target className="h-2.5 w-2.5 text-blue-500 shrink-0" />
                        <span className="text-[11px] text-foreground truncate">{g.title}</span>
                      </button>
                    ))}
                    {dayTasks.map((t) => (
                      <TaskPopupChip
                        key={`t-${t.id}`}
                        t={t}
                        onToggle={() => handleToggleTask(t.id)}
                        onEdit={() => setModal({ kind: "edit-task", task: t })}
                      />
                    ))}
                    {dayDL.map((d) => (
                      <div key={`dl-${d.id}`}
                        className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded border",
                          d.done ? "bg-secondary/40 border-border/40" : "bg-red-500/10 border-red-400/40")}>
                        <Flag className={cn("h-2.5 w-2.5 shrink-0", d.done ? "text-muted-foreground" : "text-red-500")} />
                        <span className={cn("text-[11px] truncate", d.done ? "line-through text-muted-foreground" : "text-foreground")}>{d.title}</span>
                      </div>
                    ))}
                    {dayRM.map((r) => (
                      <div key={`rm-${r.id}`}
                        className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded border",
                          r.done ? "bg-secondary/40 border-border/40" : "bg-amber-500/10 border-amber-400/40")}>
                        <Bell className={cn("h-2.5 w-2.5 shrink-0", r.done ? "text-muted-foreground" : "text-amber-500")} />
                        <span className={cn("text-[11px] truncate", r.done ? "line-through text-muted-foreground" : "text-foreground")}>{r.title}</span>
                      </div>
                    ))}
                    {dayCA.map((a) => (
                      <div key={`ca-${a.id}`}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded border bg-indigo-500/10 border-indigo-400/40">
                        <GraduationCap className="h-2.5 w-2.5 shrink-0 text-indigo-500" />
                        <span className="text-[11px] truncate text-foreground">{a.title}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* Scrollable time area */}
            <div ref={gridRef} className="flex-1 overflow-y-auto">
              <div className="flex" style={{ height: HOURS.length * HOUR_PX + 1 }}>

                {/* Time labels */}
                <div className="w-12 shrink-0 relative select-none">
                  {HOURS.map((h, i) => (
                    <div key={h} className="absolute right-2 text-[10px] text-muted-foreground/60 tabular-nums"
                      style={{ top: i * HOUR_PX - 6 }}>
                      {h}:00
                    </div>
                  ))}
                </div>

                {/* Day columns */}
                {days.map((day) => {
                  const iso = toISO(day);
                  return (
                    <TimeColumn
                      key={iso}
                      date={day}
                      isToday={iso === today}
                      blocks={blocksFor(iso)}
                      systems={systems}
                      courseAssignments={items.course_assignments.filter((a) => a.due_date === iso)}
                      onClickSlot={(date, time) => setModal({ kind: "create-block", date, startTime: time })}
                      onClickBlock={(b) => setModal({ kind: "edit-block", block: b })}
                    />
                  );
                })}
              </div>
            </div>
          </>
        )}
        </div>{/* end calendar content */}

        {/* Right sidebar */}
        {showRight && (
          <RightPanel
            tasks={items.tasks}
            deadlines={allDeadlines}
            reminders={allReminders}
            courseAssignments={items.course_assignments}
            today={today}
            onToggleTask={handleToggleTask}
            onToggleDeadline={handleToggleDeadline}
            onToggleReminder={handleToggleReminder}
            onToggleAssignment={handleToggleAssignment}
          />
        )}

      </div>{/* end main content row */}

      {/* ── Systems bar (toggleable footer) ─────────────────────────────── */}
      {showFooter && (
        <SystemsBar
          systems={systems}
          onMarkDone={handleMarkSystemDone}
          onAdd={() => setModal({ kind: "create-system" })}
          onEdit={(s) => setModal({ kind: "edit-system", system: s })}
        />
      )}

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {modal?.kind === "pick" && (
        <TypePickerModal date={modal.date}
          onPick={(type) => setModal({ kind: `create-${type}` as "create-task" | "create-goal" | "create-plan", date: modal.date })}
          onClose={() => setModal(null)} />
      )}

      {modal?.kind === "create-block" && (
        <CalBlockModal date={modal.date} startTime={modal.startTime}
          onSave={handleCreateBlock} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "edit-block" && (
        <CalBlockModal initial={modal.block} date={modal.block.date} startTime={modal.block.start_time}
          onSave={(d) => handleEditBlock(modal.block, d)}
          onDelete={() => handleDeleteBlock(modal.block)}
          onClose={() => setModal(null)} />
      )}

      {modal?.kind === "create-task" && (
        <TaskModal date={modal.date} plans={allPlans} onSave={handleCreateTask} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "edit-task" && (
        <TaskModal initial={modal.task} date={modal.task.due_date ?? today} plans={allPlans}
          onSave={(d) => handleEditTask(modal.task, d)}
          onDelete={() => handleDeleteTask(modal.task.id)}
          onClose={() => setModal(null)} />
      )}

      {modal?.kind === "create-goal" && (
        <GoalModal date={modal.date} onSave={handleCreateGoal} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "edit-goal" && (
        <GoalModal initial={modal.goal} date={modal.goal.deadline ?? today}
          onSave={(d) => handleEditGoal(modal.goal, d)}
          onDelete={() => handleDeleteGoal(modal.goal.id)}
          onClose={() => setModal(null)} />
      )}

      {modal?.kind === "create-plan" && (
        <PlanModal date={modal.date} goals={allGoals} onSave={handleCreatePlan} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "edit-plan" && (
        <PlanModal initial={modal.plan} date={modal.plan.deadline ?? today} goals={allGoals}
          onSave={(d) => handleEditPlan(modal.plan, d)}
          onDelete={() => handleDeletePlan(modal.plan.id)}
          onClose={() => setModal(null)} />
      )}

      {modal?.kind === "create-system" && (
        <SystemModal onSave={handleCreateSystem} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "edit-system" && (
        <SystemModal initial={modal.system}
          onSave={(d) => handleEditSystem(modal.system, d)}
          onDelete={() => handleDeleteSystem(modal.system.id)}
          onClose={() => setModal(null)} />
      )}
    </div>
  );
}
