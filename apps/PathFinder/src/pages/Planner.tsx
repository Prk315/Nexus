import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  CalendarClock, Check, Pencil, X, Plus, GraduationCap,
  ChevronRight, Flame, CheckCircle, Trash2, CalendarDays,
  Eye, EyeOff, MapPin, Repeat2, Train, Stethoscope, Dumbbell,
  Briefcase, Users, Circle, Clock, CalendarRange, ChevronDown, ChevronLeft,
} from "lucide-react";
import {
  getAllTasks, createTask, updateTask, toggleTask, deleteTask, getCourseAssignments,
  getSystems, createSystem, updateSystem, deleteSystem, markSystemDone,
  getSystemSubtasks, addSystemSubtask, deleteSystemSubtask, toggleSystemSubtask,
  getPlans, createPlan, updatePlan, deletePlan,
  getAllScheduleEntries, getScheduleEntriesByPlan,
  createScheduleEntry, updateScheduleEntry, deleteScheduleEntry,
} from "../lib/api";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogClose } from "../components/ui/dialog";
import { PriorityDot } from "../components/PriorityDot";
import {
  cn, layoutCalItems, daysUntil, deadlineLabel, deadlineVariant, PRIORITY_BADGE_CLASSES,
} from "../lib/utils";
import type {
  TaskWithContext, Priority, CourseAssignment,
  SystemEntry, SystemSubtask, Frequency, Plan, ScheduleEntry,
} from "../types";

// ── Planner date helpers ───────────────────────────────────────────────────────

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

const TODAY          = isoDate(new Date());
const THIS_WEEK_START = startOfWeek(TODAY);

// ── Schedules: hour grid constants ────────────────────────────────────────────

const HOUR_START = 6;
const HOUR_END   = 22;
const HOUR_PX    = 52;
const HOURS      = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
const TOTAL_PX   = HOURS.length * HOUR_PX;

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minToPx(min: number): number {
  return ((min - HOUR_START * 60) / 60) * HOUR_PX;
}
function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${h}:${String(m).padStart(2, "0")}`;
}
function durationLabel(start: string, end: string): string {
  const diff = timeToMin(end) - timeToMin(start);
  if (diff <= 0) return "";
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

// ── Schedules: categories ─────────────────────────────────────────────────────

type Category = "transport" | "medical" | "fitness" | "work" | "social" | "other";

const CATEGORIES: { id: Category; label: string; icon: React.ReactNode; color: string }[] = [
  { id: "transport", label: "Transport", icon: <Train        className="h-4 w-4" />, color: "text-blue-500"    },
  { id: "medical",   label: "Medical",   icon: <Stethoscope  className="h-4 w-4" />, color: "text-rose-500"   },
  { id: "fitness",   label: "Fitness",   icon: <Dumbbell     className="h-4 w-4" />, color: "text-green-500"  },
  { id: "work",      label: "Work",      icon: <Briefcase    className="h-4 w-4" />, color: "text-amber-500"  },
  { id: "social",    label: "Social",    icon: <Users        className="h-4 w-4" />, color: "text-violet-500" },
  { id: "other",     label: "Other",     icon: <Circle       className="h-4 w-4" />, color: "text-slate-400"  },
];

function catMeta(id: string) {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[5];
}

// ── Schedules: colors ─────────────────────────────────────────────────────────

const COLORS = [
  "teal", "cyan", "blue", "indigo", "violet", "purple",
  "pink", "rose", "red", "orange", "amber", "green", "emerald", "slate",
];

const COLOR_DOT: Record<string, string> = {
  teal: "bg-teal-500", cyan: "bg-cyan-500", blue: "bg-blue-500",
  indigo: "bg-indigo-500", violet: "bg-violet-500", purple: "bg-purple-500",
  pink: "bg-pink-500", rose: "bg-rose-500", red: "bg-red-500",
  orange: "bg-orange-500", amber: "bg-amber-500", green: "bg-green-500",
  emerald: "bg-emerald-500", slate: "bg-slate-400",
};

const BLOCK_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  teal:    { bg: "bg-teal-500/20",    border: "border-teal-400/50",    text: "text-teal-700 dark:text-teal-300",       dot: "bg-teal-500"    },
  cyan:    { bg: "bg-cyan-500/20",    border: "border-cyan-400/50",    text: "text-cyan-700 dark:text-cyan-300",       dot: "bg-cyan-500"    },
  blue:    { bg: "bg-blue-500/20",    border: "border-blue-400/50",    text: "text-blue-700 dark:text-blue-300",       dot: "bg-blue-500"    },
  indigo:  { bg: "bg-indigo-500/20",  border: "border-indigo-400/50",  text: "text-indigo-700 dark:text-indigo-300",   dot: "bg-indigo-500"  },
  violet:  { bg: "bg-violet-500/20",  border: "border-violet-400/50",  text: "text-violet-700 dark:text-violet-300",   dot: "bg-violet-500"  },
  purple:  { bg: "bg-purple-500/20",  border: "border-purple-400/50",  text: "text-purple-700 dark:text-purple-300",   dot: "bg-purple-500"  },
  pink:    { bg: "bg-pink-500/20",    border: "border-pink-400/50",    text: "text-pink-700 dark:text-pink-300",       dot: "bg-pink-500"    },
  rose:    { bg: "bg-rose-500/20",    border: "border-rose-400/50",    text: "text-rose-700 dark:text-rose-300",       dot: "bg-rose-500"    },
  red:     { bg: "bg-red-500/20",     border: "border-red-400/50",     text: "text-red-700 dark:text-red-300",         dot: "bg-red-500"     },
  orange:  { bg: "bg-orange-500/20",  border: "border-orange-400/50",  text: "text-orange-700 dark:text-orange-300",   dot: "bg-orange-500"  },
  amber:   { bg: "bg-amber-500/20",   border: "border-amber-400/50",   text: "text-amber-700 dark:text-amber-300",     dot: "bg-amber-500"   },
  green:   { bg: "bg-green-500/20",   border: "border-green-400/50",   text: "text-green-700 dark:text-green-300",     dot: "bg-green-500"   },
  emerald: { bg: "bg-emerald-500/20", border: "border-emerald-400/50", text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  slate:   { bg: "bg-slate-500/20",   border: "border-slate-400/50",   text: "text-slate-600 dark:text-slate-300",     dot: "bg-slate-400"   },
};

// ── Schedules: date helpers ────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// renamed from Schedules.tsx addDays to avoid collision
function addDaysUTC(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function entriesForDate(rawEntries: ScheduleEntry[], dateStr: string): ScheduleEntry[] {
  const date      = new Date(dateStr + "T00:00:00Z");
  const dayOfWeek = date.getUTCDay();
  const result: ScheduleEntry[] = [];
  for (const e of rawEntries) {
    if (!e.is_recurring) {
      if (e.date === dateStr) result.push(e);
    } else {
      const start = e.series_start_date ? new Date(e.series_start_date + "T00:00:00Z") : null;
      const end   = e.series_end_date   ? new Date(e.series_end_date   + "T00:00:00Z") : null;
      if (start && date < start) continue;
      if (end   && date > end  ) continue;
      if (e.recurrence === "daily") {
        result.push({ ...e, date: dateStr });
      } else if (e.recurrence === "weekly") {
        const days = e.days_of_week ? e.days_of_week.split(",").map(Number) : [];
        if (days.includes(dayOfWeek)) result.push({ ...e, date: dateStr, recurring_id: e.id });
      }
    }
  }
  return result.sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));
}

// ── Systems helpers ────────────────────────────────────────────────────────────

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isDue(sys: SystemEntry): boolean {
  if (sys.days_of_week) {
    const todayDay = new Date().getDay();
    const days = sys.days_of_week.split(",").map(Number);
    if (!days.includes(todayDay)) return false;
    if (!sys.last_done) return true;
    return sys.last_done.slice(0, 10) !== todayISO();
  }
  if (!sys.last_done) return true;
  const diff = (Date.now() - new Date(sys.last_done).getTime()) / 86_400_000;
  if (sys.frequency === "daily")  return diff >= 1;
  if (sys.frequency === "weekly") return diff >= 7;
  return diff >= 30;
}

function frequencyBadge(sys: SystemEntry) {
  const map: Record<Frequency, "default" | "secondary" | "outline"> = {
    daily: "default", weekly: "secondary", monthly: "outline",
  };
  if (sys.days_of_week) {
    const days = sys.days_of_week.split(",").map(Number).map((d) => DAY_LABELS[d]);
    return <Badge variant="secondary">{days.join(", ")}</Badge>;
  }
  const f = sys.frequency as Frequency;
  return <Badge variant={map[f]}>{f.charAt(0).toUpperCase() + f.slice(1)}</Badge>;
}

function lastDoneLabel(lastDone: string | null): string {
  if (!lastDone) return "Never done";
  const days = Math.floor((Date.now() - new Date(lastDone).getTime()) / 86400000);
  if (days === 0) return "Done today";
  if (days === 1) return "Done yesterday";
  return `Done ${days}d ago`;
}

// ── Systems form state ────────────────────────────────────────────────────────

interface SystemFormState {
  title: string;
  description: string;
  frequency: Frequency;
  days: number[];
  start_time: string;
  end_time: string;
}

const emptyForm: SystemFormState = { title: "", description: "", frequency: "daily", days: [], start_time: "", end_time: "" };

function systemToForm(sys: SystemEntry): SystemFormState {
  return {
    title:       sys.title,
    description: sys.description ?? "",
    frequency:   sys.frequency as Frequency,
    days:        sys.days_of_week ? sys.days_of_week.split(",").map(Number) : [],
    start_time:  sys.start_time ?? "",
    end_time:    sys.end_time ?? "",
  };
}

function formToDaysOfWeek(form: SystemFormState): string | null {
  if (form.frequency === "weekly" && form.days.length > 0) return form.days.join(",");
  return null;
}

// ── Layout persistence ────────────────────────────────────────────────────────

const LS_KEY = "planner_layout_v1";
const LAYOUT_DEFAULTS = { sidebarWidth: 340, systemsSplit: 45, systemsCollapsed: false, schedulesCollapsed: false };

function loadLayout() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...LAYOUT_DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return LAYOUT_DEFAULTS;
}

// ── DayPicker ─────────────────────────────────────────────────────────────────

function DayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  const toggle = (day: number) => {
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b));
  };
  return (
    <div className="flex gap-1 flex-wrap">
      {DAY_LABELS.map((label, i) => (
        <button key={i} type="button" onClick={() => toggle(i)}
          className={cn(
            "h-7 w-9 rounded-md text-xs font-medium border transition-colors",
            value.includes(i)
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background text-muted-foreground border-input hover:border-ring"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── SystemForm ────────────────────────────────────────────────────────────────

function SystemForm({ initial = emptyForm, onSubmit, submitLabel }: {
  initial?: SystemFormState;
  onSubmit: (data: SystemFormState) => Promise<void>;
  submitLabel: string;
}) {
  const [form, setForm] = useState<SystemFormState>(initial);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setLoading(true);
    try { await onSubmit(form); } finally { setLoading(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-2">
      <Input placeholder="System title" value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
      <Textarea placeholder="Description (optional)" value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Frequency</label>
        <select
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={form.frequency}
          onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as Frequency, days: [] }))}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>

      {form.frequency === "weekly" && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Days of the week</label>
          <DayPicker value={form.days} onChange={(days) => setForm((f) => ({ ...f, days }))} />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Scheduled time (optional)</label>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground/70">Start</span>
            <input type="time"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={form.start_time}
              onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground/70">End</span>
            <input type="time"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={form.end_time}
              onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-1">
        <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
        <Button type="submit" disabled={loading}>{submitLabel}</Button>
      </div>
    </form>
  );
}

// ── SubtaskManager ────────────────────────────────────────────────────────────

function SubtaskManager({ systemId, onClose }: { systemId: number; onClose: () => void }) {
  const date = todayISO();
  const [subtasks, setSubtasks] = useState<SystemSubtask[]>([]);
  const [newTitle, setNewTitle] = useState("");

  const load = useCallback(async () => {
    setSubtasks(await getSystemSubtasks(systemId, date));
  }, [systemId, date]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    const t = newTitle.trim();
    if (!t) return;
    setSubtasks(await addSystemSubtask(systemId, t));
    setNewTitle("");
  };

  return (
    <div className="flex flex-col gap-2 mt-2 border-t border-border pt-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Subtasks</p>
      {subtasks.length === 0 && <p className="text-xs text-muted-foreground italic">No subtasks yet.</p>}
      <div className="flex flex-col gap-1">
        {subtasks.map((sub) => (
          <div key={sub.id} className="flex items-center gap-2 group py-0.5">
            <span className="text-sm text-foreground flex-1 truncate">{sub.title}</span>
            <button onClick={async () => { await deleteSystemSubtask(sub.id); load(); }}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          className="flex-1 h-7 rounded border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring min-w-0"
          placeholder="Add subtask..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        />
        <button onClick={handleAdd} className="text-primary hover:text-primary/80 shrink-0">
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="flex justify-end mt-1">
        <Button size="sm" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

// ── SystemCard ────────────────────────────────────────────────────────────────

function SystemCard({ sys, due, subtasks, onMarkDone, onToggleSubtask, onEdit, onDelete }: {
  sys: SystemEntry; due: boolean; subtasks: SystemSubtask[];
  onMarkDone: () => void; onToggleSubtask: (id: number) => void;
  onEdit: () => void; onDelete: () => void;
}) {
  const hasSubtasks = subtasks.length > 0;
  const doneSubs    = subtasks.filter((s) => s.done).length;
  const allSubsDone = hasSubtasks && doneSubs === subtasks.length;

  return (
    <div className={cn("rounded-xl border bg-card p-3 flex flex-col gap-2.5", due ? "border-primary/30" : "border-border")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            {due && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
            <span className="text-xs font-medium text-foreground leading-snug">{sys.title}</span>
          </div>
          {sys.description && (
            <p className="text-[11px] text-muted-foreground line-clamp-2">{sys.description}</p>
          )}
        </div>
        {frequencyBadge(sys)}
      </div>

      {hasSubtasks && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Subtasks</p>
            <span className="text-[10px] text-muted-foreground tabular-nums">{doneSubs}/{subtasks.length}</span>
          </div>
          {subtasks.map((sub) => (
            <div key={sub.id} className="flex items-center gap-2">
              <button onClick={() => onToggleSubtask(sub.id)}
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                  sub.done ? "bg-primary border-primary" : "border-border hover:border-primary"
                )}>
                {sub.done && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
              </button>
              <span className={cn("text-xs flex-1 truncate", sub.done ? "line-through text-muted-foreground" : "text-foreground")}>
                {sub.title}
              </span>
            </div>
          ))}
        </div>
      )}

      {sys.streak_count > 0 && (
        <div className="flex items-center gap-1">
          <Flame className={cn("h-3 w-3", sys.streak_count >= 7 ? "text-orange-500" : sys.streak_count >= 3 ? "text-yellow-500" : "text-muted-foreground")} />
          <span className="text-[10px] text-muted-foreground">
            {sys.streak_count} {sys.frequency === "daily" ? "day" : sys.frequency === "weekly" ? "week" : "month"} streak
          </span>
        </div>
      )}

      <div className="flex items-center justify-between pt-1 border-t border-border">
        <span className={cn("text-[10px]", due ? "text-primary font-medium" : "text-muted-foreground")}>
          {lastDoneLabel(sys.last_done)}
        </span>
        <div className="flex items-center gap-1">
          {!hasSubtasks && (
            <Button variant={due ? "default" : "outline"} size="sm" className="h-6 text-[10px] px-2" onClick={onMarkDone}>
              <CheckCircle className="h-3 w-3" />
              {due ? "Done" : "Again"}
            </Button>
          )}
          {hasSubtasks && allSubsDone && (
            <span className="flex items-center gap-1 text-[10px] text-green-600 font-medium">
              <CheckCircle className="h-3 w-3" /> Complete
            </span>
          )}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onEdit}><Pencil className="h-3 w-3" /></Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Schedules Modal shell ─────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-t-2xl sm:rounded-xl shadow-2xl w-full sm:w-[28rem] max-h-[92vh] overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 flex flex-col gap-5">{children}</div>
      </div>
    </div>
  );
}

const inputCls    = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow";
const textareaCls = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring resize-none transition-shadow";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/60">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50">{title}</span>
        <div className="flex-1 h-px bg-border/50" />
      </div>
      {children}
    </div>
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!value)} className="flex items-center gap-2.5 w-full group">
      <div className={cn("relative h-5 w-9 rounded-full border-2 transition-colors shrink-0",
        value ? "bg-primary border-primary" : "bg-secondary border-border")}>
        <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform",
          value ? "translate-x-4" : "translate-x-0.5")} />
      </div>
      <span className="text-sm text-foreground group-hover:text-foreground/80 transition-colors">{label}</span>
    </button>
  );
}

// ── PlanFormModal ─────────────────────────────────────────────────────────────

interface PlanDraft { title: string; description: string; }

function PlanFormModal({ initial, onSave, onDelete, onClose }: {
  initial?: Plan; onSave: (d: PlanDraft) => Promise<void>;
  onDelete?: () => Promise<void>; onClose: () => void;
}) {
  const [form, setForm] = useState<PlanDraft>({ title: initial?.title ?? "", description: initial?.description ?? "" });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setLoading(true);
    try { await onSave(form); } finally { setLoading(false); }
  }

  return (
    <Modal title={initial ? "Edit Schedule" : "New Schedule"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Section title="Details">
          <Field label="Name">
            <input className={inputCls} placeholder="e.g. Daily Commute, Medical, Gym"
              value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required autoFocus />
          </Field>
          <Field label="Description">
            <textarea className={textareaCls} rows={2}
              value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
        </Section>
        <div className="flex justify-between items-center pt-1">
          {onDelete && (
            <button type="button" onClick={onDelete}
              className="text-xs text-destructive hover:opacity-80 flex items-center gap-1">
              <Trash2 className="h-3.5 w-3.5" /> Delete schedule
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="ghost" type="button" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={loading}>{initial ? "Save" : "Create"}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ── EntryFormModal ────────────────────────────────────────────────────────────

interface EntryDraft {
  category: Category; title: string; location: string; description: string; color: string;
  start_time: string; end_time: string; is_recurring: boolean; date: string;
  recurrence: "weekly" | "daily"; days_of_week: number[];
  series_start_date: string; series_end_date: string;
}

function defaultDraft(): EntryDraft {
  return {
    category: "other", title: "", location: "", description: "", color: "teal",
    start_time: "09:00", end_time: "10:00", is_recurring: false, date: todayISO(),
    recurrence: "weekly", days_of_week: [new Date().getDay()],
    series_start_date: todayISO(), series_end_date: "",
  };
}

function entryToDraft(e: ScheduleEntry): EntryDraft {
  return {
    category: (e.category as Category) ?? "other", title: e.title,
    location: e.location ?? "", description: e.description ?? "", color: e.color,
    start_time: e.start_time ?? "09:00", end_time: e.end_time ?? "10:00",
    is_recurring: e.is_recurring, date: e.date ?? todayISO(),
    recurrence: (e.recurrence as "weekly" | "daily") ?? "weekly",
    days_of_week: e.days_of_week ? e.days_of_week.split(",").map(Number) : [new Date().getDay()],
    series_start_date: e.series_start_date ?? todayISO(), series_end_date: e.series_end_date ?? "",
  };
}

function EntryFormModal({ initial, onSave, onDelete, onClose }: {
  initial?: ScheduleEntry; onSave: (d: EntryDraft) => Promise<void>;
  onDelete?: () => Promise<void>; onClose: () => void;
}) {
  const [form, setForm] = useState<EntryDraft>(initial ? entryToDraft(initial) : defaultDraft());
  const [loading, setLoading] = useState(false);

  function set<K extends keyof EntryDraft>(key: K, val: EntryDraft[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }
  function toggleDay(d: number) {
    setForm((f) => ({
      ...f,
      days_of_week: f.days_of_week.includes(d)
        ? f.days_of_week.filter((x) => x !== d)
        : [...f.days_of_week, d].sort(),
    }));
  }

  const duration = form.start_time && form.end_time && form.start_time < form.end_time
    ? durationLabel(form.start_time, form.end_time) : null;
  const valid = form.title.trim().length > 0 && form.start_time < form.end_time
    && (!form.is_recurring || form.recurrence !== "weekly" || form.days_of_week.length > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    try { await onSave(form); } finally { setLoading(false); }
  }

  return (
    <Modal title={initial ? "Edit Activity" : "Add Activity"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Section title="Category">
          <div className="grid grid-cols-3 gap-2">
            {CATEGORIES.map((cat) => (
              <button key={cat.id} type="button" onClick={() => set("category", cat.id)}
                className={cn(
                  "flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-xs font-medium transition-all",
                  form.category === cat.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:border-border/80 hover:bg-accent"
                )}>
                <span className={form.category === cat.id ? "text-primary" : cat.color}>{cat.icon}</span>
                {cat.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Activity">
          <Field label="Title">
            <input className={inputCls}
              placeholder={form.category === "transport" ? "e.g. Train to work" : form.category === "medical" ? "e.g. GP appointment" : "e.g. Morning run"}
              value={form.title} onChange={(e) => set("title", e.target.value)} required autoFocus={!initial} />
          </Field>
          <Field label="Colour">
            <div className="flex flex-wrap gap-1.5 mt-0.5">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => set("color", c)}
                  className={cn("h-5 w-5 rounded-full transition-all", COLOR_DOT[c],
                    form.color === c ? "ring-2 ring-offset-2 ring-ring scale-110" : "opacity-50 hover:opacity-100")} />
              ))}
            </div>
          </Field>
        </Section>

        <Section title="Time">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Start"><input type="time" className={inputCls} value={form.start_time} onChange={(e) => set("start_time", e.target.value)} /></Field>
            <Field label="End"><input type="time" className={inputCls} value={form.end_time} onChange={(e) => set("end_time", e.target.value)} /></Field>
          </div>
          {duration && <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Duration: <span className="font-medium text-foreground">{duration}</span></p>}
        </Section>

        <Section title="Location">
          <Field label={form.category === "transport" ? "Route" : "Location"}>
            <div className="relative">
              <MapPin className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input className={cn(inputCls, "pl-8")} placeholder="Address or room" value={form.location} onChange={(e) => set("location", e.target.value)} />
            </div>
          </Field>
        </Section>

        <Section title="Notes">
          <textarea className={textareaCls} rows={2} placeholder="Additional details…"
            value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Section>

        <Section title="Scheduling">
          <Toggle value={form.is_recurring} onChange={(v) => set("is_recurring", v)} label="Recurring activity" />
          {form.is_recurring ? (
            <div className="flex flex-col gap-3 pt-1">
              <Field label="Repeat">
                <select className={inputCls} value={form.recurrence} onChange={(e) => set("recurrence", e.target.value as "weekly" | "daily")}>
                  <option value="weekly">Weekly</option>
                  <option value="daily">Daily</option>
                </select>
              </Field>
              {form.recurrence === "weekly" && (
                <Field label="Days">
                  <div className="flex gap-1.5 flex-wrap mt-0.5">
                    {DAY_LABELS.map((label, i) => (
                      <button key={i} type="button" onClick={() => toggleDay(i)}
                        className={cn("h-8 w-10 rounded-lg text-xs font-medium border transition-all",
                          form.days_of_week.includes(i) ? "bg-primary text-primary-foreground border-primary shadow-sm" : "border-border text-muted-foreground hover:border-foreground/40"
                        )}>{label}</button>
                    ))}
                  </div>
                </Field>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Field label="Series start"><input type="date" className={inputCls} value={form.series_start_date} onChange={(e) => set("series_start_date", e.target.value)} required /></Field>
                <Field label="Series end"><input type="date" className={inputCls} value={form.series_end_date} onChange={(e) => set("series_end_date", e.target.value)} /></Field>
              </div>
            </div>
          ) : (
            <Field label="Date"><input type="date" className={inputCls} value={form.date} onChange={(e) => set("date", e.target.value)} required /></Field>
          )}
        </Section>

        <div className="flex justify-between items-center pt-1">
          {onDelete && (
            <button type="button" onClick={onDelete} className="text-xs text-destructive hover:opacity-80 flex items-center gap-1.5">
              <Trash2 className="h-3.5 w-3.5" /> Delete activity
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="ghost" type="button" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={loading || !valid}>{initial ? "Save changes" : "Add activity"}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ── ScheduleTimetable ─────────────────────────────────────────────────────────

function ScheduleTimetable({ allEntries }: { allEntries: ScheduleEntry[] }) {
  const [date, setDate] = useState(todayISO());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const toggleHidden = useCallback((id: string) => {
    setHiddenIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);
  const today   = todayISO();
  const isToday = date === today;
  const dayEntries = entriesForDate(allEntries, date);
  const now    = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowPx  = minToPx(nowMin);
  const showNow = isToday && nowMin >= HOUR_START * 60 && nowMin <= (HOUR_END + 1) * 60;

  type EvtItem = { startMin: number; endMin: number; entry: ScheduleEntry };
  const evts: EvtItem[] = dayEntries.filter((e) => e.start_time).map((e) => ({
    startMin: timeToMin(e.start_time!),
    endMin:   e.end_time ? timeToMin(e.end_time) : timeToMin(e.start_time!) + 30,
    entry: e,
  }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button onClick={() => setDate((d) => addDaysUTC(d, -1))}
          className="p-1.5 rounded-lg border border-border hover:bg-accent transition-colors">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="flex-1 text-center text-xs font-medium">{formatDateLabel(date)}</span>
        <button onClick={() => setDate((d) => addDaysUTC(d, 1))}
          className="p-1.5 rounded-lg border border-border hover:bg-accent transition-colors">
          <ChevronLeft className="h-4 w-4 rotate-180" />
        </button>
        {!isToday && (
          <button onClick={() => setDate(today)}
            className="px-2 h-6 text-[10px] rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors">
            Today
          </button>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {dayEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
            <CalendarDays className="h-6 w-6 text-muted-foreground/25" />
            <p className="text-xs text-muted-foreground">No activities on this day</p>
          </div>
        ) : (
          <div className="flex" style={{ height: TOTAL_PX }}>
            <div className="relative shrink-0" style={{ width: 36 }}>
              {HOURS.map((h) => (
                <div key={h} className="absolute text-right pr-1.5" style={{ top: (h - HOUR_START) * HOUR_PX - 7, width: 36 }}>
                  <span className="text-[9px] font-mono text-muted-foreground/40">
                    {h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`}
                  </span>
                </div>
              ))}
            </div>
            <div className="relative flex-1 border-l border-border/30">
              {HOURS.map((h) => (
                <div key={h} className="absolute left-0 right-0 border-t border-border/30 pointer-events-none" style={{ top: (h - HOUR_START) * HOUR_PX }} />
              ))}
              {HOURS.map((h) => (
                <div key={`${h}h`} className="absolute left-0 right-0 border-t border-dashed border-border/15 pointer-events-none" style={{ top: (h - HOUR_START) * HOUR_PX + HOUR_PX / 2 }} />
              ))}
              {showNow && (
                <div className="absolute left-0 right-0 flex items-center gap-1 pointer-events-none z-10" style={{ top: nowPx }}>
                  <div className="h-2 w-2 rounded-full bg-red-500 -ml-1" />
                  <div className="flex-1 border-t-2 border-red-500/60" />
                </div>
              )}
              {layoutCalItems(evts).map(({ item, col, totalCols }) => {
                const top    = minToPx(item.startMin);
                const height = Math.max(20, minToPx(item.endMin) - top);
                const w      = `${(1 / totalCols) * 100}%`;
                const left   = `${(col / totalCols) * 100}%`;
                const clr    = BLOCK_COLORS[item.entry.color] ?? BLOCK_COLORS.teal;
                const cat    = catMeta(item.entry.category);
                const seId   = `se-${item.entry.id}-${item.entry.date}`;
                const seHidden = hiddenIds.has(seId);
                return (
                  <div key={`${item.entry.id}-${item.entry.date}`}
                    className={cn("absolute rounded-lg border px-1.5 py-0.5 overflow-hidden cursor-default group", clr.bg, clr.border, clr.text, seHidden && "opacity-15")}
                    style={{ top, height, left, width: w, marginLeft: col > 0 ? 2 : 3, marginRight: 3 }}
                  >
                    <button className={cn("absolute top-0.5 right-0.5 z-10 p-0.5 rounded transition-opacity", seHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                      onClick={(e) => { e.stopPropagation(); toggleHidden(seId); }}>
                      {seHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </button>
                    <div className="flex items-center gap-0.5 leading-tight">
                      <span className="shrink-0 opacity-70">{cat.icon}</span>
                      <span className="text-[10px] font-semibold truncate">{item.entry.title}</span>
                    </div>
                    {height > 32 && (
                      <div className="text-[9px] opacity-60 mt-0.5 flex items-center gap-0.5">
                        <Clock className="h-2 w-2" />
                        {fmtTime(item.entry.start_time!)}{item.entry.end_time && ` – ${fmtTime(item.entry.end_time)}`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── EntryRow ──────────────────────────────────────────────────────────────────

function EntryRow({ entry, onEdit, onDelete }: { entry: ScheduleEntry; onEdit: () => void; onDelete: () => void }) {
  const clr = BLOCK_COLORS[entry.color] ?? BLOCK_COLORS.teal;
  const cat = catMeta(entry.category);
  const timeLabel = entry.start_time
    ? `${fmtTime(entry.start_time)}${entry.end_time ? ` – ${fmtTime(entry.end_time)}` : ""}` : null;
  const recurLabel = entry.is_recurring
    ? entry.recurrence === "daily" ? "Every day"
    : (() => { const days = entry.days_of_week?.split(",").map(Number) ?? []; return days.map((d) => DAY_LABELS[d]).join(", "); })()
    : entry.date ?? null;

  return (
    <div className={cn("flex items-start gap-2 px-2.5 py-2 rounded-xl border group", clr.bg, clr.border, clr.text)}>
      <span className={cn("mt-0.5 shrink-0 opacity-70", cat.color)}>{cat.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold leading-tight">{entry.title}</p>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
          {timeLabel && <span className="flex items-center gap-0.5 text-[10px] opacity-70"><Clock className="h-2.5 w-2.5" /> {timeLabel}</span>}
          {entry.location && <span className="flex items-center gap-0.5 text-[10px] opacity-70"><MapPin className="h-2.5 w-2.5" /> {entry.location}</span>}
          {recurLabel && <span className="flex items-center gap-0.5 text-[10px] opacity-70">{entry.is_recurring ? <Repeat2 className="h-2.5 w-2.5" /> : null}{recurLabel}</span>}
        </div>
      </div>
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button onClick={onEdit} className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"><Pencil className="h-3 w-3" /></button>
        <button onClick={onDelete} className="p-1 rounded hover:bg-destructive/20 text-destructive transition-colors"><Trash2 className="h-3 w-3" /></button>
      </div>
    </div>
  );
}

// ── PlanCard ──────────────────────────────────────────────────────────────────

type CatFilter = "all" | Category;

function PlanCard({ plan, onEdit, onEntriesChange }: {
  plan: Plan; onEdit: () => void; onEntriesChange?: (entries: ScheduleEntry[]) => void;
}) {
  const [expanded,  setExpanded]  = useState(true);
  const [entries,   setEntries]   = useState<ScheduleEntry[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [catFilter, setCatFilter] = useState<CatFilter>("all");
  const [addOpen,   setAddOpen]   = useState(false);
  const [editEntry, setEditEntry] = useState<ScheduleEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getScheduleEntriesByPlan(plan.id);
      setEntries(data);
      onEntriesChange?.(data);
    } finally { setLoading(false); }
  }, [plan.id, onEntriesChange]);

  useEffect(() => { load(); }, [load]);

  const presentCats = CATEGORIES.filter((c) => entries.some((e) => e.category === c.id));
  const showTabs    = presentCats.length > 1;
  const visible     = catFilter === "all" ? entries : entries.filter((e) => e.category === catFilter);

  async function handleAddEntry(d: EntryDraft) {
    await createScheduleEntry({
      plan_id: plan.id, title: d.title, category: d.category,
      description: d.description.trim() || null, location: d.location.trim() || null,
      color: d.color, start_time: d.start_time || null, end_time: d.end_time || null,
      is_recurring: d.is_recurring, recurrence: d.is_recurring ? d.recurrence : null,
      days_of_week: d.is_recurring && d.recurrence === "weekly" ? d.days_of_week.join(",") : null,
      date: d.is_recurring ? null : (d.date || null),
      series_start_date: d.is_recurring ? (d.series_start_date || null) : null,
      series_end_date: d.is_recurring ? (d.series_end_date || null) : null,
    });
    setAddOpen(false);
    load();
  }

  async function handleEditEntry(entry: ScheduleEntry, d: EntryDraft) {
    await updateScheduleEntry(entry.id, {
      title: d.title, category: d.category, description: d.description.trim() || null,
      location: d.location.trim() || null, color: d.color, start_time: d.start_time || null,
      end_time: d.end_time || null, is_recurring: d.is_recurring,
      recurrence: d.is_recurring ? d.recurrence : null,
      days_of_week: d.is_recurring && d.recurrence === "weekly" ? d.days_of_week.join(",") : null,
      date: d.is_recurring ? null : (d.date || null),
      series_start_date: d.is_recurring ? (d.series_start_date || null) : null,
      series_end_date: d.is_recurring ? (d.series_end_date || null) : null,
    });
    setEditEntry(null);
    load();
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-card/80">
          <button onClick={() => setExpanded((v) => !v)} className="text-muted-foreground hover:text-foreground shrink-0">
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          <CalendarRange className="h-3.5 w-3.5 text-teal-500 shrink-0" />
          <span className="flex-1 text-xs font-semibold text-foreground truncate">{plan.title}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">{entries.length}</span>
          <button onClick={onEdit} className="p-1 rounded text-muted-foreground hover:text-foreground"><Pencil className="h-3 w-3" /></button>
        </div>

        {expanded && showTabs && (
          <div className="flex gap-1 px-2 pt-2 overflow-x-auto">
            <button onClick={() => setCatFilter("all")}
              className={cn("px-2.5 h-6 rounded-lg text-[10px] font-medium whitespace-nowrap shrink-0",
                catFilter === "all" ? "bg-foreground text-background" : "border border-border text-muted-foreground hover:text-foreground")}>
              All
            </button>
            {presentCats.map((cat) => (
              <button key={cat.id} onClick={() => setCatFilter(cat.id)}
                className={cn("flex items-center gap-1 px-2.5 h-6 rounded-lg text-[10px] font-medium whitespace-nowrap shrink-0",
                  catFilter === cat.id ? "bg-foreground text-background" : "border border-border text-muted-foreground hover:text-foreground")}>
                <span className={catFilter === cat.id ? "text-background" : cat.color}>{cat.icon}</span>
                {cat.label}
              </button>
            ))}
          </div>
        )}

        {expanded && (
          <div className="p-2.5 flex flex-col gap-1.5">
            {loading && entries.length === 0 && <p className="text-[10px] text-muted-foreground italic">Loading…</p>}
            {!loading && visible.length === 0 && entries.length === 0 && <p className="text-[10px] text-muted-foreground italic">No activities yet.</p>}
            {visible.map((e) => (
              <EntryRow key={e.id} entry={e}
                onEdit={() => setEditEntry(e)}
                onDelete={async () => { await deleteScheduleEntry(e.id); load(); }} />
            ))}
            <Button variant="ghost" size="sm" className="self-start h-6 text-[10px] gap-1 mt-0.5" onClick={() => setAddOpen(true)}>
              <Plus className="h-3 w-3" /> Add activity
            </Button>
          </div>
        )}
      </div>

      {addOpen && <EntryFormModal onSave={handleAddEntry} onClose={() => setAddOpen(false)} />}
      {editEntry && (
        <EntryFormModal initial={editEntry}
          onSave={(d) => handleEditEntry(editEntry, d)}
          onDelete={async () => { await deleteScheduleEntry(editEntry.id); setEditEntry(null); load(); }}
          onClose={() => setEditEntry(null)} />
      )}
    </>
  );
}

// ── PanelHeader ───────────────────────────────────────────────────────────────

function PanelHeader({ title, badge, collapsed, onToggle, actions }: {
  title: string; badge?: React.ReactNode; collapsed: boolean;
  onToggle: () => void; actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 h-8 px-2 border-b border-border bg-card/80 shrink-0">
      <button onClick={onToggle}
        className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0">
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", !collapsed && "rotate-90")} />
      </button>
      <span className="text-xs font-semibold text-foreground flex-1 truncate">{title}</span>
      {badge}
      {actions}
    </div>
  );
}

// ── SystemsPanel ──────────────────────────────────────────────────────────────

function SystemsPanel({ collapsed, onToggleCollapse, panelStyle }: {
  collapsed: boolean; onToggleCollapse: () => void; panelStyle: React.CSSProperties;
}) {
  const date = todayISO();
  const [systems,    setSystems]    = useState<SystemEntry[]>([]);
  const [subtaskMap, setSubtaskMap] = useState<Record<number, SystemSubtask[]>>({});
  const [editing,    setEditing]    = useState<SystemEntry | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen,   setEditOpen]   = useState(false);

  const loadSubtasks = useCallback(async (sysList: SystemEntry[]) => {
    const entries = await Promise.all(
      sysList.map(async (s) => [s.id, await getSystemSubtasks(s.id, date)] as [number, SystemSubtask[]])
    );
    setSubtaskMap(Object.fromEntries(entries));
  }, [date]);

  const load = useCallback(async () => {
    const s = await getSystems();
    setSystems(s);
    loadSubtasks(s);
  }, [loadSubtasks]);

  useEffect(() => { load(); }, [load]);

  const handleToggleSubtask = async (subtaskId: number, systemId: number) => {
    const result = await toggleSystemSubtask(subtaskId, date);
    setSubtaskMap((prev) => ({ ...prev, [systemId]: result.subtasks }));
    setSystems((prev) => prev.map((s) => s.id === result.system.id ? result.system : s));
  };

  const due      = systems.filter(isDue);
  const upToDate = systems.filter((s) => !isDue(s));

  return (
    <div style={panelStyle} className="flex flex-col overflow-hidden transition-none">
      <PanelHeader
        title="Systems"
        badge={due.length > 0 ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium shrink-0">
            {due.length}
          </span>
        ) : undefined}
        collapsed={collapsed}
        onToggle={onToggleCollapse}
        actions={
          !collapsed ? (
            <button onClick={() => setCreateOpen(true)}
              className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0">
              <Plus className="h-3.5 w-3.5" />
            </button>
          ) : undefined
        }
      />

      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
          {systems.length === 0 && (
            <p className="text-xs text-muted-foreground italic px-1 pt-2">No systems yet. Click + to add one.</p>
          )}

          {due.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-1">Due</p>
              <div className="flex flex-col gap-2">
                {due.map((sys) => (
                  <SystemCard key={sys.id} sys={sys} due
                    subtasks={subtaskMap[sys.id] ?? []}
                    onMarkDone={async () => { await markSystemDone(sys.id); load(); }}
                    onToggleSubtask={(sid) => handleToggleSubtask(sid, sys.id)}
                    onEdit={() => { setEditing(sys); setEditOpen(true); }}
                    onDelete={async () => { await deleteSystem(sys.id); load(); }}
                  />
                ))}
              </div>
            </div>
          )}

          {upToDate.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-1">Up to date</p>
              <div className="flex flex-col gap-2">
                {upToDate.map((sys) => (
                  <SystemCard key={sys.id} sys={sys} due={false}
                    subtasks={subtaskMap[sys.id] ?? []}
                    onMarkDone={async () => { await markSystemDone(sys.id); load(); }}
                    onToggleSubtask={(sid) => handleToggleSubtask(sid, sys.id)}
                    onEdit={() => { setEditing(sys); setEditOpen(true); }}
                    onDelete={async () => { await deleteSystem(sys.id); load(); }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent title="New System" description="A recurring process that keeps you on track.">
          <SystemForm
            onSubmit={async (f) => {
              await createSystem({
                title: f.title, description: f.description || null, frequency: f.frequency,
                days_of_week: formToDaysOfWeek(f), start_time: f.start_time || null, end_time: f.end_time || null,
              });
              setCreateOpen(false);
              load();
            }}
            submitLabel="Create"
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (!o) { setEditing(null); load(); } }}>
        <DialogContent title="Edit System">
          {editing && (
            <>
              <SystemForm
                initial={systemToForm(editing)}
                onSubmit={async (f) => {
                  await updateSystem(editing.id, {
                    title: f.title, description: f.description || null, frequency: f.frequency,
                    days_of_week: formToDaysOfWeek(f), start_time: f.start_time || null, end_time: f.end_time || null,
                  });
                  setEditOpen(false);
                  setEditing(null);
                  load();
                }}
                submitLabel="Save"
              />
              <SubtaskManager systemId={editing.id} onClose={() => { setEditOpen(false); setEditing(null); load(); }} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── SchedulesPanel ────────────────────────────────────────────────────────────

type MainTab = "timetable" | "plans";

function SchedulesPanel({ collapsed, onToggleCollapse, panelStyle }: {
  collapsed: boolean; onToggleCollapse: () => void; panelStyle: React.CSSProperties;
}) {
  const [plans,      setPlans]      = useState<Plan[]>([]);
  const [allEntries, setAllEntries] = useState<ScheduleEntry[]>([]);
  const [tab,        setTab]        = useState<MainTab>("timetable");
  const [createOpen, setCreateOpen] = useState(false);
  const [editPlan,   setEditPlan]   = useState<Plan | null>(null);

  const loadPlans = useCallback(async () => {
    const all = await getPlans();
    setPlans(all.filter((p) => p.is_schedule));
  }, []);

  const loadAllEntries = useCallback(async () => {
    setAllEntries(await getAllScheduleEntries());
  }, []);

  useEffect(() => { loadPlans(); loadAllEntries(); }, [loadPlans, loadAllEntries]);

  function mergeEntries(planId: number, planEntries: ScheduleEntry[]) {
    setAllEntries((prev) => [...prev.filter((e) => e.plan_id !== planId), ...planEntries]);
  }

  return (
    <div style={panelStyle} className="flex flex-col overflow-hidden transition-none">
      <PanelHeader
        title="Schedules"
        badge={plans.length > 0 ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 font-medium shrink-0">
            {plans.length}
          </span>
        ) : undefined}
        collapsed={collapsed}
        onToggle={onToggleCollapse}
        actions={
          !collapsed ? (
            <div className="flex items-center gap-1 shrink-0">
              {plans.length > 0 && (
                <div className="flex gap-0.5 p-0.5 bg-muted rounded-md">
                  {(["timetable", "plans"] as MainTab[]).map((t) => (
                    <button key={t} onClick={() => setTab(t)}
                      className={cn("px-2 h-5 rounded text-[10px] font-medium capitalize transition-all",
                        tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                      {t === "timetable" ? "Grid" : "Plans"}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => setCreateOpen(true)}
                className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : undefined
        }
      />

      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-2">
          {plans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
              <CalendarRange className="h-8 w-8 text-muted-foreground/25" />
              <p className="text-xs text-muted-foreground">No schedules yet.</p>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3 w-3" /> Create schedule
              </Button>
            </div>
          ) : tab === "timetable" ? (
            <ScheduleTimetable allEntries={allEntries} />
          ) : (
            <div className="flex flex-col gap-2">
              {plans.map((plan) => (
                <PlanCard key={plan.id} plan={plan}
                  onEdit={() => setEditPlan(plan)}
                  onEntriesChange={(entries) => mergeEntries(plan.id, entries)} />
              ))}
            </div>
          )}
        </div>
      )}

      {createOpen && (
        <PlanFormModal
          onSave={async (d) => {
            await createPlan({ title: d.title, description: d.description.trim() || null, is_schedule: true });
            setCreateOpen(false);
            loadPlans();
          }}
          onClose={() => setCreateOpen(false)} />
      )}
      {editPlan && (
        <PlanFormModal
          initial={editPlan}
          onSave={async (d) => {
            await updatePlan(editPlan.id, { title: d.title, description: d.description.trim() || null, status: editPlan.status, is_schedule: true });
            setEditPlan(null);
            loadPlans();
          }}
          onDelete={async () => {
            await deletePlan(editPlan.id);
            setEditPlan(null);
            loadPlans();
            loadAllEntries();
          }}
          onClose={() => setEditPlan(null)} />
      )}
    </div>
  );
}

// ── Planner task & study dialogs ──────────────────────────────────────────────

interface EditState { title: string; priority: Priority; due_date: string; time_estimate: string; }

function EditTaskDialog({ task, onSave, onClose }: {
  task: TaskWithContext; onSave: (data: EditState) => Promise<void>; onClose: () => void;
}) {
  const [form, setForm] = useState<EditState>({
    title: task.title, priority: task.priority, due_date: task.due_date ?? "",
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
          <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as Priority }))}>
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
        <label className="text-xs text-muted-foreground">Time estimate (min)</label>
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

function AddTaskDialog({ initialDate, onSave }: { initialDate: string; onSave: (data: AddState) => Promise<void> }) {
  const [form, setForm] = useState<AddState>({ title: "", priority: "medium", due_date: initialDate, time_estimate: "" });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setLoading(true);
    try { await onSave(form); } finally { setLoading(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-2">
      <Input placeholder="Task title" value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required autoFocus />
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Priority</label>
          <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as Priority }))}>
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
        <label className="text-xs text-muted-foreground">Time estimate (min)</label>
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

function PlannerTaskRow({ task, onToggle, onEdit, onDelete }: {
  task: TaskWithContext; onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 group hover:bg-secondary/50 transition-colors">
      <button onClick={onToggle}
        className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
          task.done ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary")}>
        {task.done && <Check className="h-2.5 w-2.5" />}
      </button>
      <PriorityDot priority={task.priority} />
      <span className={cn("text-sm flex-1 truncate", task.done && "line-through text-muted-foreground")}>{task.title}</span>
      {task.plan_title && (
        <span className="text-xs text-muted-foreground shrink-0 hidden group-hover:inline">{task.plan_title}</span>
      )}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onEdit} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"><Pencil className="h-3 w-3" /></button>
        <button onClick={onDelete} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
      </div>
    </div>
  );
}

interface WeekGroup {
  weekStart: string; label: string; totalCount: number;
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
        <Badge variant={deadlineVariant(days)} className="shrink-0 text-xs">{deadlineLabel(days)}</Badge>
      )}
    </div>
  );
}

interface StudyWeekGroup {
  weekStart: string; label: string; totalCount: number;
  days: { date: string; assignments: CourseAssignment[] }[];
}

// ── Planner ───────────────────────────────────────────────────────────────────

export function Planner() {
  const [tasks,       setTasks]       = useState<TaskWithContext[]>([]);
  const [assignments, setAssignments] = useState<CourseAssignment[]>([]);
  const [editingTask, setEditingTask] = useState<TaskWithContext | null>(null);
  const [addOpen,     setAddOpen]     = useState(false);
  const [addDate,     setAddDate]     = useState(() => addDays(TODAY, 1));

  // ── Layout state ──
  const [sidebarWidth,       setSidebarWidth]       = useState(() => loadLayout().sidebarWidth);
  const [systemsSplit,       setSystemsSplit]       = useState(() => loadLayout().systemsSplit);
  const [systemsCollapsed,   setSystemsCollapsed]   = useState(() => loadLayout().systemsCollapsed);
  const [schedulesCollapsed, setSchedulesCollapsed] = useState(() => loadLayout().schedulesCollapsed);

  const containerRef = useRef<HTMLDivElement>(null);
  const sidebarRef   = useRef<HTMLDivElement>(null);
  const sidebarDrag  = useRef<{ x: number; w: number } | null>(null);
  const splitDrag    = useRef<{ y: number; split: number; sidebarH: number } | null>(null);
  const isDragging   = useRef(false);

  // Persist layout
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify({ sidebarWidth, systemsSplit, systemsCollapsed, schedulesCollapsed }));
  }, [sidebarWidth, systemsSplit, systemsCollapsed, schedulesCollapsed]);

  // Sidebar width drag
  const onSidebarDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    sidebarDrag.current = { x: e.clientX, w: sidebarRef.current?.offsetWidth ?? sidebarWidth };
    isDragging.current  = true;
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!sidebarDrag.current) return;
      const delta  = sidebarDrag.current.x - ev.clientX;
      const newW   = Math.max(200, Math.min(700, sidebarDrag.current.w + delta));
      setSidebarWidth(newW);
    };
    const onUp = () => {
      sidebarDrag.current = null;
      isDragging.current  = false;
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  }, [sidebarWidth]);

  // Split drag
  const onSplitDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const sidebarH = sidebarRef.current?.offsetHeight ?? 600;
    splitDrag.current = { y: e.clientY, split: systemsSplit, sidebarH };
    isDragging.current = true;
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!splitDrag.current) return;
      const delta   = ev.clientY - splitDrag.current.y;
      const pxMoved = (delta / splitDrag.current.sidebarH) * 100;
      const newSplit = Math.max(15, Math.min(85, splitDrag.current.split + pxMoved));
      setSystemsSplit(newSplit);
    };
    const onUp = () => {
      splitDrag.current  = null;
      isDragging.current = false;
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  }, [systemsSplit]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { document.body.style.userSelect = ""; };
  }, []);

  // Panel heights
  const systemsHeight: string = systemsCollapsed
    ? "2rem"
    : schedulesCollapsed
      ? "calc(100% - 2rem)"
      : `${systemsSplit}%`;

  const schedulesHeight: string = schedulesCollapsed
    ? "2rem"
    : systemsCollapsed
      ? "calc(100% - 2rem)"
      : `${100 - systemsSplit}%`;

  // ── Data load ──
  const load = () => Promise.all([getAllTasks(), getCourseAssignments()]).then(([t, a]) => {
    setTasks(t);
    setAssignments(a);
  });
  useEffect(() => { load(); }, []);

  // ── Task weeks ──
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
        const days = Array.from(dayMap.entries()).sort(([a], [b]) => a.localeCompare(b))
          .map(([date, dayTasks]) => ({ date, tasks: dayTasks }));
        return { weekStart: ws, label: formatWeekLabel(ws, THIS_WEEK_START), totalCount: days.reduce((sum, d) => sum + d.tasks.length, 0), days };
      });
  }, [tasks]);

  // ── Study weeks ──
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
        const days = Array.from(dayMap.entries()).sort(([a], [b]) => a.localeCompare(b))
          .map(([date, dayAssignments]) => ({ date, assignments: dayAssignments }));
        return { weekStart: ws, label: formatWeekLabel(ws, THIS_WEEK_START), totalCount: days.reduce((s, d) => s + d.assignments.length, 0), days };
      });
  }, [assignments]);

  async function handleToggle(id: number) { await toggleTask(id); load(); }
  async function handleDelete(id: number) { await deleteTask(id); load(); }
  async function handleEdit(form: EditState) {
    if (!editingTask) return;
    await updateTask(editingTask.id, {
      title: form.title, priority: form.priority,
      due_date: form.due_date || null,
      time_estimate: form.time_estimate ? Number(form.time_estimate) : null,
    });
    setEditingTask(null);
    load();
  }
  async function handleAdd(form: AddState) {
    await createTask({
      plan_id: null, title: form.title, priority: form.priority,
      due_date: form.due_date || null,
      time_estimate: form.time_estimate ? Number(form.time_estimate) : null,
    });
    setAddOpen(false);
    load();
  }

  return (
    <div ref={containerRef} className="flex h-[calc(100vh-2.5rem)] overflow-hidden">
      {/* ── Left: main content ── */}
      <div className="flex-1 min-w-0 overflow-y-auto px-4 py-3 flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CalendarClock className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold text-foreground">Planner</h1>
          </div>
          <Button size="sm" onClick={() => { setAddDate(addDays(TODAY, 1)); setAddOpen(true); }}>
            <Plus className="h-3.5 w-3.5" /> New Task
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
              <button onClick={() => { setAddDate(week.days[0]?.date ?? addDays(week.weekStart, 1)); setAddOpen(true); }}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                <Plus className="h-3 w-3" /> Add
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
                      <PlannerTaskRow key={task.id} task={task}
                        onToggle={() => handleToggle(task.id)}
                        onEdit={() => setEditingTask(task)}
                        onDelete={() => handleDelete(task.id)} />
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
                        {day.assignments.map((a) => <StudyAssignmentRow key={a.id} assignment={a} />)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Dialogs */}
        {editingTask && (
          <Dialog open onOpenChange={(o) => { if (!o) setEditingTask(null); }}>
            <DialogContent title="Edit Task">
              <EditTaskDialog task={editingTask} onSave={handleEdit} onClose={() => setEditingTask(null)} />
            </DialogContent>
          </Dialog>
        )}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent title="New Task">
            <AddTaskDialog initialDate={addDate} onSave={handleAdd} />
          </DialogContent>
        </Dialog>
      </div>

      {/* ── Horizontal drag handle ── */}
      <div
        onMouseDown={onSidebarDragStart}
        className="w-1 cursor-col-resize shrink-0 bg-border hover:bg-primary/30 transition-colors"
      />

      {/* ── Right sidebar ── */}
      <div ref={sidebarRef} style={{ width: sidebarWidth }}
        className="flex flex-col border-l border-border shrink-0 overflow-hidden bg-background">
        <SystemsPanel
          collapsed={systemsCollapsed}
          onToggleCollapse={() => setSystemsCollapsed((v: boolean) => !v)}
          panelStyle={{ height: systemsHeight }}
        />
        {!systemsCollapsed && !schedulesCollapsed && (
          <div
            onMouseDown={onSplitDragStart}
            className="h-1 cursor-row-resize shrink-0 bg-border hover:bg-primary/30 transition-colors"
          />
        )}
        <SchedulesPanel
          collapsed={schedulesCollapsed}
          onToggleCollapse={() => setSchedulesCollapsed((v: boolean) => !v)}
          panelStyle={{ height: schedulesHeight }}
        />
      </div>
    </div>
  );
}
