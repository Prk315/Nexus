import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  PanelRight, PanelRightClose,
  CheckCircle, CheckSquare, Check, ChevronDown, ChevronRight,
  Plus, X, Clock, Star, Pencil, BookOpen,
  Eye, EyeOff,
} from "lucide-react";
import {
  getGoals, getPlans, getAllTasks, getSystems,
  toggleTask, createTask, updateTask, deleteTask,
  toTaskWithContext, getTaskSessionsInRange, logTaskSession, unlogTaskOccurrence,
  getCalBlocks, createCalBlock, updateCalBlock, deleteCalBlock,
  getDailyGoals, setDailyPrimaryGoal, clearDailyPrimaryGoal, addDailySecondaryGoal, updateDailySecondaryGoal, deleteDailySecondaryGoal,
  getCourseAssignments, updateCourseAssignment,
  getScheduleEntriesForDate,
  getHabitsForDate, toggleHabitCompletion, getHabitStacks,
  getHabitSubtasks, toggleHabitSubtask,
  getTrainingSessionsForDate,
} from "../lib/api";
import { PriorityDot } from "../components/PriorityDot";
import { daysUntil, cn, layoutCalItems, formatDateShort } from "../lib/utils";
import { blockMinutes, planningOf, isFullTask } from "../lib/taskTree";
import { UrgencyMeter } from "../components/UrgencyMeter";
import { isDue } from "../components/workspace/systemForms";
import type { Goal, Plan, TaskWithContext, SystemEntry, CalBlock, DailyGoals, DailyPrimaryGoal, DailySecGoal, CourseAssignment, ScheduleEntry, HabitWithCompletion, HabitStack, HabitSubtask, TrainingSession, TaskSession } from "../types";

const todayDate = () => new Date().toISOString().slice(0, 10);

// ── Day Calendar constants ────────────────────────────────────────────────────

const DC_HOUR_START = 5;
const DC_HOUR_END   = 23;
const DC_HOUR_PX    = 48;
const DC_HOURS      = Array.from({ length: DC_HOUR_END - DC_HOUR_START + 1 }, (_, i) => DC_HOUR_START + i);

function dcTimeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function dcMinToPx(min: number) {
  return ((min - DC_HOUR_START * 60) / 60) * DC_HOUR_PX;
}
function dcPxToTime(px: number) {
  const raw     = DC_HOUR_START * 60 + (px / DC_HOUR_PX) * 60;
  const snapped = Math.round(raw / 30) * 30;
  const clamped = Math.max(DC_HOUR_START * 60, Math.min((DC_HOUR_END + 1) * 60 - 30, snapped));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function dcAddHour(t: string) {
  const [h, m] = t.split(":").map(Number);
  const total  = Math.min((DC_HOUR_END + 1) * 60, h * 60 + m + 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

const DC_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  blue:    { bg: "bg-blue-500/20",    border: "border-blue-400/50",    text: "text-blue-700 dark:text-blue-300",       dot: "bg-blue-500" },
  indigo:  { bg: "bg-indigo-500/20",  border: "border-indigo-400/50",  text: "text-indigo-700 dark:text-indigo-300",   dot: "bg-indigo-500" },
  violet:  { bg: "bg-violet-500/20",  border: "border-violet-400/50",  text: "text-violet-700 dark:text-violet-300",   dot: "bg-violet-500" },
  purple:  { bg: "bg-purple-500/20",  border: "border-purple-400/50",  text: "text-purple-700 dark:text-purple-300",   dot: "bg-purple-500" },
  pink:    { bg: "bg-pink-500/20",    border: "border-pink-400/50",    text: "text-pink-700 dark:text-pink-300",       dot: "bg-pink-500" },
  rose:    { bg: "bg-rose-500/20",    border: "border-rose-400/50",    text: "text-rose-700 dark:text-rose-300",       dot: "bg-rose-500" },
  red:     { bg: "bg-red-500/20",     border: "border-red-400/50",     text: "text-red-700 dark:text-red-300",         dot: "bg-red-500" },
  orange:  { bg: "bg-orange-500/20",  border: "border-orange-400/50",  text: "text-orange-700 dark:text-orange-300",   dot: "bg-orange-500" },
  amber:   { bg: "bg-amber-500/20",   border: "border-amber-400/50",   text: "text-amber-700 dark:text-amber-300",     dot: "bg-amber-500" },
  yellow:  { bg: "bg-yellow-400/20",  border: "border-yellow-400/50",  text: "text-yellow-700 dark:text-yellow-300",   dot: "bg-yellow-400" },
  green:   { bg: "bg-green-500/20",   border: "border-green-400/50",   text: "text-green-700 dark:text-green-300",     dot: "bg-green-500" },
  emerald: { bg: "bg-emerald-500/20", border: "border-emerald-400/50", text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  teal:    { bg: "bg-teal-500/20",    border: "border-teal-400/50",    text: "text-teal-700 dark:text-teal-300",       dot: "bg-teal-500" },
  cyan:    { bg: "bg-cyan-500/20",    border: "border-cyan-400/50",    text: "text-cyan-700 dark:text-cyan-300",       dot: "bg-cyan-500" },
  slate:   { bg: "bg-slate-500/20",   border: "border-slate-400/50",   text: "text-slate-700 dark:text-slate-300",     dot: "bg-slate-500" },
};
const DC_COLOR_KEYS = Object.keys(DC_COLORS);

type DCBlockDraft = {
  title: string; start_time: string; end_time: string;
  color: string; description: string; location: string;
  task_id: number | null;
};

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// ── Day Block Modal ───────────────────────────────────────────────────────────

function DayBlockModal({
  initial, startTime, endTime, tasks, onSave, onDelete, onClose,
}: {
  initial?: CalBlock;
  startTime?: string;
  endTime?: string;
  tasks: TaskWithContext[];
  onSave: (d: DCBlockDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<DCBlockDraft>({
    title:       initial?.title       ?? "",
    start_time:  initial?.start_time  ?? startTime ?? "09:00",
    end_time:    initial?.end_time    ?? endTime   ?? "10:00",
    color:       initial?.color       ?? "blue",
    description: initial?.description ?? "",
    location:    initial?.location    ?? "",
    task_id:     initial?.task_id     ?? null,
  });
  const set = (p: Partial<DCBlockDraft>) => setForm((f) => ({ ...f, ...p }));
  const valid = form.title.trim() !== "" && form.start_time < form.end_time;
  const [saving, setSaving] = useState(false);

  const openTasks = tasks.filter((t) => !t.done);

  function handleTaskSelect(rawId: string) {
    if (!rawId) { set({ task_id: null }); return; }
    const id = Number(rawId);
    const task = openTasks.find((t) => t.id === id);
    if (!task) return;
    const updates: Partial<DCBlockDraft> = { task_id: id, title: task.title };
    if (task.time_estimate) {
      updates.end_time = addMinutes(form.start_time, task.time_estimate);
    }
    set(updates);
  }

  async function handleSave() {
    if (!valid || saving) return;
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-80 rounded-xl border border-border bg-popover shadow-2xl p-4 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{initial ? "Edit block" : "New block"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Link task (optional)</label>
          <select
            className="h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
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
        </div>

        <input
          autoFocus
          className="h-8 rounded border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Title"
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onClose(); }}
        />

        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-0.5 flex-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Start</label>
            <input type="time" className="h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              value={form.start_time}
              onChange={(e) => {
                const newStart = e.target.value;
                const linkedTask = openTasks.find((t) => t.id === form.task_id);
                const newEnd = linkedTask?.time_estimate
                  ? addMinutes(newStart, linkedTask.time_estimate)
                  : form.end_time;
                set({ start_time: newStart, end_time: newEnd });
              }} />
          </div>
          <div className="flex flex-col gap-0.5 flex-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">End</label>
            <input type="time" className="h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              value={form.end_time} onChange={(e) => set({ end_time: e.target.value })} />
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {DC_COLOR_KEYS.map((c) => (
            <button
              key={c}
              onClick={() => set({ color: c })}
              title={c}
              className={cn(
                "h-4 w-4 rounded-full transition-transform shrink-0",
                DC_COLORS[c].dot,
                form.color === c && "ring-2 ring-offset-1 ring-ring scale-110"
              )}
            />
          ))}
        </div>

        <input
          className="h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Description (optional)"
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
        />
        <input
          className="h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Location (optional)"
          value={form.location}
          onChange={(e) => set({ location: e.target.value })}
        />

        <div className="flex items-center gap-2 pt-0.5">
          <button
            disabled={!valid || saving}
            onClick={handleSave}
            className="flex-1 h-8 rounded bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {initial ? "Save changes" : "Add block"}
          </button>
          {onDelete && (
            <button
              disabled={saving}
              onClick={async () => { setSaving(true); try { await onDelete(); } finally { setSaving(false); } }}
              className="h-8 px-3 rounded border border-destructive/50 text-destructive text-xs hover:bg-destructive/10 transition-colors disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Habits Strip ─────────────────────────────────────────────────────────────

const HABIT_COLOR_DOT: Record<string, string> = {
  red:    "bg-red-500",    orange: "bg-orange-500", amber:  "bg-amber-500",
  yellow: "bg-yellow-500", lime:   "bg-lime-500",   green:  "bg-green-500",
  emerald:"bg-emerald-500",teal:   "bg-teal-500",   cyan:   "bg-cyan-500",
  sky:    "bg-sky-500",    blue:   "bg-blue-500",   indigo: "bg-indigo-500",
  violet: "bg-violet-500", purple: "bg-purple-500", pink:   "bg-pink-500",
  rose:   "bg-rose-500",   slate:  "bg-slate-500",
};

function HabitRowWithSubtasks({ h, today, onToggle }: {
  h: HabitWithCompletion;
  today: string;
  onToggle: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [subtasks, setSubtasks] = useState<HabitSubtask[]>([]);
  const [loaded, setLoaded] = useState(false);

  const handleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded) {
      try {
        const data = await getHabitSubtasks(h.id, today);
        setSubtasks(data);
        setLoaded(true);
      } catch (e) { console.error(e); }
    }
  };

  const handleToggleSub = async (subtaskId: number) => {
    try {
      const updated = await toggleHabitSubtask(subtaskId, today);
      setSubtasks(updated);
    } catch (e) { console.error(e); }
  };

  return (
    <div>
      <div className="flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-secondary/60 group">
        <button
          onClick={() => onToggle(h.id)}
          className={cn(
            "h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors",
            h.done
              ? `border-transparent ${HABIT_COLOR_DOT[h.color] ?? "bg-primary"}`
              : "border-border group-hover:border-muted-foreground/50"
          )}
        >
          {h.done && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
        </button>
        <span
          onClick={() => onToggle(h.id)}
          className={cn("flex-1 text-[11px] truncate cursor-pointer transition-colors", h.done ? "line-through text-muted-foreground/50" : "text-foreground")}
        >
          {h.title}
        </span>
        {h.subtask_count > 0 && (
          <span className="text-[9px] tabular-nums text-muted-foreground/70 shrink-0">
            {h.subtask_done_count}/{h.subtask_count}
          </span>
        )}
        {h.streak > 1 && (
          <span className="text-[9px] text-amber-500 font-semibold shrink-0">🔥{h.streak}</span>
        )}
        {(h.subtask_count > 0 || expanded) && (
          <button
            onClick={handleExpand}
            className="p-0.5 rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0"
          >
            <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", expanded && "rotate-180")} />
          </button>
        )}
      </div>
      {expanded && (
        <div className="pl-5 pr-1 pb-1 flex flex-col gap-0.5">
          {subtasks.length === 0 && loaded && (
            <span className="text-[10px] text-muted-foreground/50 italic px-1">No sub-habits yet.</span>
          )}
          {subtasks.map((sub) => (
            <button
              key={sub.id}
              onClick={() => handleToggleSub(sub.id)}
              className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-secondary/60 text-left transition-colors group/sub"
            >
              <div className={cn(
                "h-3 w-3 shrink-0 rounded border flex items-center justify-center transition-colors",
                sub.done ? `border-transparent ${HABIT_COLOR_DOT[h.color] ?? "bg-primary"}` : "border-border"
              )}>
                {sub.done && <Check className="h-2 w-2 text-white" strokeWidth={3} />}
              </div>
              <span className={cn("text-[10px] flex-1 truncate", sub.done && "line-through text-muted-foreground/50")}>
                {sub.title}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HabitsStrip({ habits, stacks, onToggle, today }: {
  habits: HabitWithCompletion[];
  stacks: HabitStack[];
  onToggle: (id: number) => void;
  today: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedStacks, setCollapsedStacks] = useState<Set<number>>(new Set());

  if (!habits.length) return null;
  const done  = habits.filter((h) => h.done).length;
  const total = habits.length;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

  const ungrouped = habits.filter((h) => h.stack_id === null);
  const grouped = stacks
    .map((s) => ({ stack: s, habits: habits.filter((h) => h.stack_id === s.id) }))
    .filter((g) => g.habits.length > 0);

  const toggleStack = (id: number) =>
    setCollapsedStacks((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const renderHabitRow = (h: HabitWithCompletion) => (
    <HabitRowWithSubtasks key={h.id} h={h} today={today} onToggle={onToggle} />
  );

  return (
    <div className="shrink-0 flex flex-col gap-2 pb-2 border-b border-border">
      {/* Header — click to collapse the whole strip */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center justify-between px-1 w-full hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-1">
          <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform", !collapsed && "rotate-90")} />
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Habits
          </span>
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {done}/{total}
        </span>
      </button>

      {!collapsed && (
        <>
          {/* Progress bar */}
          <div className="h-1 bg-secondary rounded-full overflow-hidden mx-1">
            <div
              className={cn("h-full rounded-full transition-all duration-500", pct === 100 ? "bg-emerald-500" : "bg-primary")}
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Stacked groups — each collapsible */}
          {grouped.map(({ stack, habits: sh }) => {
            const stackColor = HABIT_COLOR_DOT[stack.color] ?? "bg-blue-500";
            const stackDone = sh.filter((h) => h.done).length;
            const stackCollapsed = collapsedStacks.has(stack.id);
            return (
              <div key={stack.id} className="flex flex-col gap-0">
                <button
                  onClick={() => toggleStack(stack.id)}
                  className="flex items-center gap-1.5 px-1.5 py-0.5 w-full hover:opacity-80 transition-opacity"
                >
                  <ChevronRight className={cn("h-2.5 w-2.5 text-muted-foreground transition-transform flex-shrink-0", !stackCollapsed && "rotate-90")} />
                  <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", stackColor)} />
                  <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider flex-1 truncate text-left">{stack.title}</span>
                  <span className="text-[9px] tabular-nums text-muted-foreground">{stackDone}/{sh.length}</span>
                </button>
                {!stackCollapsed && (
                  <div className="flex flex-col gap-0.5 pl-1">
                    {sh.map(renderHabitRow)}
                  </div>
                )}
              </div>
            );
          })}

          {/* Ungrouped */}
          {ungrouped.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {grouped.length > 0 && (
                <div className="flex items-center gap-1.5 px-1.5 py-0.5">
                  <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Other</span>
                </div>
              )}
              {ungrouped.map(renderHabitRow)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Day Calendar ──────────────────────────────────────────────────────────────

function DayCalendar({
  date: _date, calBlocks, systems, courseAssignments, scheduleEntries, tasks,
  sessionsByBlock, onCreateBlock, onUpdateBlock, onDeleteBlock, onToggleWorked,
}: {
  date: string;
  calBlocks: CalBlock[];
  systems: SystemEntry[];
  courseAssignments: CourseAssignment[];
  scheduleEntries: ScheduleEntry[];
  tasks: TaskWithContext[];
  /** Sessions already logged, keyed by the occurrence's cal_block_id. */
  sessionsByBlock: Map<number, TaskSession>;
  onCreateBlock: (d: DCBlockDraft) => Promise<void>;
  onUpdateBlock: (id: number, d: DCBlockDraft) => Promise<void>;
  onDeleteBlock: (b: CalBlock) => Promise<void>;
  onToggleWorked: (b: CalBlock) => void;
}) {
  const colRef    = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<{
    block?: CalBlock;
    startTime?: string;
    endTime?: string;
  } | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const toggleHidden = useCallback((id: string) => {
    setHiddenIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);

  const totalPx = DC_HOURS.length * DC_HOUR_PX;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = dcMinToPx(8 * 60) - 24;
    }
  }, []);

  const now     = new Date();
  const nowMin  = now.getHours() * 60 + now.getMinutes();
  const nowPx   = dcMinToPx(nowMin);
  const showNow = nowMin >= DC_HOUR_START * 60 && nowMin <= (DC_HOUR_END + 1) * 60;

  function handleColClick(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("[data-block]")) return;
    const rect = colRef.current!.getBoundingClientRect();
    const st   = dcPxToTime(Math.max(0, e.clientY - rect.top));
    const et   = dcAddHour(st);
    setModal({ startTime: st, endTime: et });
  }

  // Systems with a start_time (shown as context, not editable here)
  const timedSystems = systems.filter((s) => s.start_time);
  // Course assignments for today with a start_time
  const timedCAs     = courseAssignments.filter((ca) => ca.start_time);
  // Schedule entries for today with a start_time
  const timedSEs     = scheduleEntries.filter((e) => e.start_time);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 shrink-0 px-1">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
        </h2>
        <button
          onClick={() => setModal({ startTime: "09:00", endTime: "10:00" })}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          title="Add block"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Scrollable grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex" style={{ height: totalPx }}>

          {/* Hour labels */}
          <div className="w-7 shrink-0 relative select-none pointer-events-none">
            {DC_HOURS.map((h) => (
              <div
                key={h}
                className="absolute w-full text-right pr-1"
                style={{ top: (h - DC_HOUR_START) * DC_HOUR_PX - 6 }}
              >
                <span className="text-[9px] font-mono text-muted-foreground/40">
                  {String(h).padStart(2, "0")}
                </span>
              </div>
            ))}
          </div>

          {/* Event column */}
          <div
            ref={colRef}
            className="flex-1 min-w-0 relative border-l border-border cursor-crosshair"
            style={{ height: totalPx }}
            onClick={handleColClick}
          >
            {/* Hour lines */}
            {DC_HOURS.map((h) => (
              <div
                key={h}
                className="absolute left-0 right-0 border-t border-border/30 pointer-events-none"
                style={{ top: (h - DC_HOUR_START) * DC_HOUR_PX }}
              />
            ))}
            {/* Half-hour dashed lines */}
            {DC_HOURS.slice(0, -1).map((h) => (
              <div
                key={`${h}h`}
                className="absolute left-0 right-0 border-t border-dashed border-border/15 pointer-events-none"
                style={{ top: (h - DC_HOUR_START) * DC_HOUR_PX + DC_HOUR_PX / 2 }}
              />
            ))}

            {/* Current time indicator */}
            {showNow && (
              <div
                className="absolute left-0 right-0 pointer-events-none z-10 flex items-center"
                style={{ top: nowPx }}
              >
                <div className="h-2 w-2 rounded-full bg-primary shrink-0 -ml-1 animate-pulse" />
                <div className="flex-1 border-t-2 border-primary" />
              </div>
            )}

            {/* All timed events — unified overlap layout */}
            {(() => {
              type DcEvt =
                | { kind: "sys"; startMin: number; endMin: number; s: typeof timedSystems[number] }
                | { kind: "ca";  startMin: number; endMin: number; ca: typeof timedCAs[number] }
                | { kind: "blk"; startMin: number; endMin: number; b: CalBlock }
                | { kind: "se";  startMin: number; endMin: number; e: ScheduleEntry };

              const evts: DcEvt[] = [
                ...timedSystems.map((s) => ({
                  kind: "sys" as const,
                  startMin: dcTimeToMin(s.start_time!),
                  endMin:   s.end_time ? dcTimeToMin(s.end_time) : dcTimeToMin(s.start_time!) + 60,
                  s,
                })),
                ...timedCAs.map((ca) => ({
                  kind: "ca" as const,
                  startMin: dcTimeToMin(ca.start_time!),
                  endMin:   ca.end_time ? dcTimeToMin(ca.end_time) : dcTimeToMin(ca.start_time!) + 60,
                  ca,
                })),
                ...calBlocks.map((b) => ({
                  kind: "blk" as const,
                  startMin: dcTimeToMin(b.start_time),
                  endMin:   dcTimeToMin(b.end_time),
                  b,
                })),
                ...timedSEs.map((e) => ({
                  kind: "se" as const,
                  startMin: dcTimeToMin(e.start_time!),
                  endMin:   e.end_time ? dcTimeToMin(e.end_time) : dcTimeToMin(e.start_time!) + 60,
                  e,
                })),
              ];

              return layoutCalItems(evts).map(({ item, col, totalCols }) => {
                const top   = dcMinToPx(item.startMin);
                const ht    = Math.max(18, dcMinToPx(item.endMin) - top);
                const left  = `calc(${(col / totalCols) * 100}% + 1px)`;
                const right = `calc(${((totalCols - col - 1) / totalCols) * 100}% + 1px)`;

                if (item.kind === "sys") {
                  const { s } = item;
                  const clr = DC_COLORS.emerald;
                  const sysId = `sys-${s.id}`;
                  const sysHidden = hiddenIds.has(sysId);
                  return (
                    <div
                      key={`sys-${s.id}`}
                      data-block="1"
                      title={s.title}
                      className={cn("absolute rounded border px-1 py-0.5 overflow-hidden cursor-default group", clr.bg, clr.border, sysHidden && "opacity-15")}
                      style={{ top, height: ht, left, right }}
                    >
                      <button
                        className={cn("absolute top-0.5 right-0.5 z-10 p-0.5 rounded transition-opacity", sysHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                        onClick={(e) => { e.stopPropagation(); toggleHidden(sysId); }}
                      >
                        {sysHidden ? <EyeOff className={cn("h-3.5 w-3.5", clr.text)} /> : <Eye className={cn("h-3.5 w-3.5", clr.text)} />}
                      </button>
                      <p className={cn("text-[10px] font-medium leading-tight truncate", clr.text)}>{s.title}</p>
                      {ht > 26 && (
                        <p className={cn("text-[9px] leading-tight opacity-70 tabular-nums", clr.text)}>
                          {s.start_time}{s.end_time ? `–${s.end_time}` : ""}
                        </p>
                      )}
                    </div>
                  );
                }

                if (item.kind === "ca") {
                  const { ca } = item;
                  const clr = ca.assignment_type === "theory" ? DC_COLORS.orange : DC_COLORS.indigo;
                  const caId = `ca-${ca.id}`;
                  const caHidden = hiddenIds.has(caId);
                  return (
                    <div
                      key={`ca-${ca.id}`}
                      data-block="1"
                      title={ca.title}
                      className={cn("absolute rounded border px-1 py-0.5 overflow-hidden cursor-default group", clr.bg, clr.border, caHidden && "opacity-15")}
                      style={{ top, height: ht, left, right }}
                    >
                      <button
                        className={cn("absolute top-0.5 right-0.5 z-10 p-0.5 rounded transition-opacity", caHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                        onClick={(e) => { e.stopPropagation(); toggleHidden(caId); }}
                      >
                        {caHidden ? <EyeOff className={cn("h-3.5 w-3.5", clr.text)} /> : <Eye className={cn("h-3.5 w-3.5", clr.text)} />}
                      </button>
                      <p className={cn("text-[10px] font-medium leading-tight truncate", clr.text)}>{ca.title}</p>
                      {ht > 26 && ca.end_time && (
                        <p className={cn("text-[9px] leading-tight opacity-70 tabular-nums", clr.text)}>
                          {ca.start_time}–{ca.end_time}
                        </p>
                      )}
                    </div>
                  );
                }

                if (item.kind === "se") {
                  const { e } = item;
                  const clr   = DC_COLORS[e.color] ?? DC_COLORS.blue;
                  const seId  = `se-${e.recurring_id ?? e.id}-${e.date}`;
                  const seHidden = hiddenIds.has(seId);
                  return (
                    <div
                      key={seId}
                      data-block="1"
                      title={e.title}
                      className={cn("absolute rounded border px-1 py-0.5 overflow-hidden cursor-default group", clr.bg, clr.border, seHidden && "opacity-15")}
                      style={{ top, height: ht, left, right }}
                    >
                      <button
                        className={cn("absolute top-0.5 right-0.5 z-10 p-0.5 rounded transition-opacity", seHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                        onClick={(e) => { e.stopPropagation(); toggleHidden(seId); }}
                      >
                        {seHidden ? <EyeOff className={cn("h-3.5 w-3.5", clr.text)} /> : <Eye className={cn("h-3.5 w-3.5", clr.text)} />}
                      </button>
                      <p className={cn("text-[10px] font-medium leading-tight truncate", clr.text)}>{e.title}</p>
                      {ht > 26 && e.start_time && (
                        <p className={cn("text-[9px] leading-tight opacity-70 tabular-nums", clr.text)}>
                          {e.start_time}{e.end_time ? `–${e.end_time}` : ""}
                        </p>
                      )}
                      {ht > 42 && e.location && (
                        <p className={cn("text-[9px] leading-tight opacity-60 truncate", clr.text)}>{e.location}</p>
                      )}
                    </div>
                  );
                }

                // cal block
                const { b } = item;
                const clr = DC_COLORS[b.color] ?? DC_COLORS.blue;
                const cbId = `cb-${b.recurring_id ?? b.id}-${b.date}`;
                const cbHidden = hiddenIds.has(cbId);
                // A block committed to a task can be worked off in place; ticking
                // it logs a session, which is what advances sessions/time modes.
                const worked = b.task_id != null && sessionsByBlock.has(b.id);
                return (
                  <div
                    key={`blk-${b.id}`}
                    data-block="1"
                    className={cn(
                      "absolute rounded border px-1 py-0.5 overflow-hidden z-20 transition-all group",
                      clr.bg, clr.border,
                      b.is_recurring ? "cursor-default opacity-80" : "cursor-pointer hover:brightness-110",
                      cbHidden && "opacity-15",
                      worked && "ring-1 ring-emerald-400/60"
                    )}
                    style={{ top, height: ht, left, right }}
                    onClick={b.is_recurring ? undefined : (e) => { e.stopPropagation(); setModal({ block: b }); }}
                    title={b.is_recurring ? `${b.title} (recurring — edit in Week view)` : b.title}
                  >
                    <button
                      className={cn("absolute top-0.5 right-0.5 z-10 p-0.5 rounded transition-opacity", cbHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                      onClick={(e) => { e.stopPropagation(); toggleHidden(cbId); }}
                    >
                      {cbHidden ? <EyeOff className={cn("h-3.5 w-3.5", clr.text)} /> : <Eye className={cn("h-3.5 w-3.5", clr.text)} />}
                    </button>
                    <div className="flex items-center gap-1">
                      {b.task_id != null && (
                        <button
                          title={worked ? "Worked — click to undo" : "Mark this block as worked"}
                          onClick={(e) => { e.stopPropagation(); onToggleWorked(b); }}
                          className={cn(
                            "flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-[2px] border transition-colors",
                            worked
                              ? "bg-emerald-500 border-emerald-500 text-white"
                              : cn("border-current opacity-50 hover:opacity-100", clr.text),
                          )}
                        >
                          {worked && <Check className="h-1.5 w-1.5" />}
                        </button>
                      )}
                      <p className={cn("text-[10px] font-semibold leading-tight truncate", clr.text, worked && "line-through opacity-70")}>{b.title}</p>
                    </div>
                    {ht > 26 && (
                      <p className={cn("text-[9px] leading-tight opacity-70 tabular-nums", clr.text)}>
                        {b.start_time}–{b.end_time}
                      </p>
                    )}
                    {ht > 42 && b.location && (
                      <p className={cn("text-[9px] leading-tight opacity-60 truncate", clr.text)}>{b.location}</p>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 px-1 shrink-0">
        <span className="flex items-center gap-1 text-[9px] text-muted-foreground/60">
          <span className="h-2 w-2 rounded-sm bg-emerald-500/40 border border-emerald-400/50 shrink-0" />Systems
        </span>
        <span className="flex items-center gap-1 text-[9px] text-muted-foreground/60">
          <span className="h-2 w-2 rounded-sm bg-indigo-500/40 border border-indigo-400/50 shrink-0" />Study
        </span>
        <span className="flex items-center gap-1 text-[9px] text-muted-foreground/60">
          <span className="h-2 w-2 rounded-sm bg-blue-500/40 border border-blue-400/50 shrink-0" />Events
        </span>
        <span className="flex items-center gap-1 text-[9px] text-muted-foreground/60">
          <span className="h-2 w-2 rounded-sm bg-violet-500/40 border border-violet-400/50 shrink-0" />Schedule
        </span>
      </div>

      {/* Modal */}
      {modal && (
        <DayBlockModal
          initial={modal.block}
          startTime={modal.startTime}
          endTime={modal.endTime}
          tasks={tasks}
          onSave={async (draft) => {
            if (modal.block) await onUpdateBlock(modal.block.id, draft);
            else await onCreateBlock(draft);
            setModal(null);
          }}
          onDelete={
            modal.block && !modal.block.is_recurring
              ? async () => { await onDeleteBlock(modal.block!); setModal(null); }
              : undefined
          }
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

// ── Today Pie Chart ───────────────────────────────────────────────────────────

interface PieItem {
  id: number;
  label: string;
  subtitle?: string;
  minutes: number;
  done: boolean;
  kind: "task" | "assignment" | "goal";
}

function fmtMin(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function TodayPie({ doneMin, pendingMin, freeMin, capTotal, items }: {
  doneMin: number; pendingMin: number; freeMin: number; capTotal: number;
  items: PieItem[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const SIZE   = 68;
  const STROKE = 10;
  const r      = (SIZE - STROKE) / 2;
  const cx     = SIZE / 2;
  const cy     = SIZE / 2;
  const circ   = 2 * Math.PI * r;

  const doneFrac    = capTotal > 0 ? doneMin    / capTotal : 0;
  const pendingFrac = capTotal > 0 ? pendingMin / capTotal : 0;
  const freeFrac    = capTotal > 0 ? freeMin    / capTotal : 1;

  const segments: { frac: number; color: string; cumOffset: number }[] = [];
  let cum = 0;
  for (const [frac, color] of [
    [doneFrac,    "#10b981"          ] as const,
    [pendingFrac, "#6366f1"          ] as const,
    [freeFrac,    "hsl(var(--muted))"] as const,
  ]) {
    if (frac > 0.0005) segments.push({ frac, color, cumOffset: cum });
    cum += frac;
  }

  const doneWorkPct = (doneMin + pendingMin) > 0
    ? Math.round((doneMin / (doneMin + pendingMin)) * 100) : 0;

  const maxItemMin = items.reduce((m, i) => Math.max(m, i.minutes), 1);

  return (
    <div ref={containerRef} className="relative flex items-center gap-3 shrink-0">
      {/* Donut + legend */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Click to see schedule breakdown"
        className="relative shrink-0 hover:opacity-80 transition-opacity focus:outline-none"
        style={{ width: SIZE, height: SIZE }}
      >
        <svg width={SIZE} height={SIZE}>
          <circle cx={cx} cy={cy} r={r} fill="none"
            stroke="hsl(var(--muted))" strokeWidth={STROKE} />
          {segments.map((seg, i) => (
            <circle
              key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={seg.color} strokeWidth={STROKE}
              strokeDasharray={`${seg.frac * circ} ${circ}`}
              strokeDashoffset={-(seg.cumOffset * circ)}
              style={{ transform: "rotate(-90deg)", transformOrigin: `${cx}px ${cy}px` }}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-[11px] font-bold tabular-nums leading-none">{doneWorkPct}%</span>
        </div>
      </button>

      <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full shrink-0 bg-emerald-500" />
          <span>{fmtMin(doneMin)} done</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full shrink-0 bg-indigo-500" />
          <span>{fmtMin(pendingMin)} planned</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full shrink-0 bg-muted-foreground/25" />
          <span>{fmtMin(Math.max(0, freeMin))} free</span>
        </div>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 w-80 rounded-lg border border-border bg-popover shadow-xl">
          <div className="px-3 pt-3 pb-2 border-b border-border">
            <p className="text-xs font-semibold text-foreground">Today's schedule</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">16-hour basis · timed tasks use actual duration</p>
          </div>

          {items.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground italic">Nothing scheduled today.</p>
          ) : (
            <div className="flex flex-col gap-0 max-h-72 overflow-y-auto px-3 py-2">
              {items.map((item) => {
                const barPct = Math.round((item.minutes / maxItemMin) * 100);
                return (
                  <div key={`${item.kind}-${item.id}`} className="py-1.5 border-b border-border/40 last:border-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn(
                        "flex-1 text-xs truncate",
                        item.done ? "line-through text-muted-foreground" : "text-foreground"
                      )}>
                        {item.label}
                      </span>
                      <span className={cn(
                        "text-[10px] font-medium shrink-0 px-1.5 py-0.5 rounded",
                        item.done
                          ? "bg-emerald-500/15 text-emerald-600"
                          : item.kind === "goal"
                            ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                            : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                      )}>
                        {fmtMin(item.minutes)}
                      </span>
                    </div>
                    {item.subtitle && (
                      <p className="text-[10px] text-muted-foreground/60 mb-1">{item.subtitle}</p>
                    )}
                    <div className="h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all",
                          item.done ? "bg-emerald-500" : item.kind === "goal" ? "bg-yellow-400" : "bg-indigo-400"
                        )}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="px-3 py-2 border-t border-border flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              {fmtMin(doneMin + pendingMin)} planned of 16h
            </span>
            <span className="text-[10px] font-medium text-foreground">
              {Math.round(((doneMin + pendingMin) / capTotal) * 100)}% of day used
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Welcome Box ───────────────────────────────────────────────────────────────

/**
 * Active goals, compacted into the header.
 *
 * They used to be a full-width block above the task list, which spent a whole
 * row and ~1000px of width on two short titles and two progress bars. Goals are
 * *context* for the day rather than something you act on hourly, so they belong
 * beside the other at-a-glance header readouts — next to the pie, not above the
 * work.
 *
 * Same ordering as the old block (priority, then nearest deadline) so the goal
 * that mattered most still reads first. Scrolls past three rather than growing
 * the header.
 */
function HeaderGoals({ goals }: { goals: Goal[] }) {
  const active = [...goals]
    .filter((g) => g.status === "active")
    .sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 } as Record<string, number>;
      const pd = (p[a.priority] ?? 1) - (p[b.priority] ?? 1);
      if (pd !== 0) return pd;
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      return a.deadline ? -1 : b.deadline ? 1 : 0;
    });

  if (active.length === 0) return null;

  return (
    <div className="hidden lg:flex shrink-0 w-56 max-h-16 flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-background px-2 py-1.5">
      {active.map((g) => {
        const pct  = g.task_count === 0 ? 0 : Math.round((g.done_count / g.task_count) * 100);
        const days = g.deadline ? daysUntil(g.deadline) : null;
        return (
          <div key={g.id} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <PriorityDot priority={g.priority} />
              <span className="flex-1 min-w-0 truncate text-[11px] font-medium text-foreground" title={g.title}>
                {g.title}
              </span>
              {days !== null && (
                <span className={cn(
                  "shrink-0 text-[10px] tabular-nums",
                  days < 0 ? "text-rose-500" : days <= 7 ? "text-amber-500" : "text-muted-foreground/60",
                )}>
                  {days < 0 ? `${-days}d late` : `${days}d`}
                </span>
              )}
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60 w-7 text-right">{pct}%</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WelcomeBox({
  goals, plans, tasks, systems, dailyGoals, courseAssignments, date,
  goalPrimaryDone, goalSecDone, todaySessions,
  onTogglePrimaryDone, onToggleSecDone, onSetPrimary, onClearPrimary,
  onAddSecondary, onUpdateSecondaryEstimate, onDeleteSecondary,
}: {
  goals: Goal[]; plans: Plan[]; tasks: TaskWithContext[]; systems: SystemEntry[];
  dailyGoals: DailyGoals; courseAssignments: CourseAssignment[]; date: string;
  goalPrimaryDone: boolean; goalSecDone: Set<number>; todaySessions: TrainingSession[];
  onTogglePrimaryDone: () => void;
  onToggleSecDone: (id: number) => void;
  onSetPrimary: (payload: DailyPrimaryGoal) => void;
  onClearPrimary: () => void;
  onAddSecondary: (text: string) => void;
  onUpdateSecondaryEstimate: (id: number, min: number | null) => void;
  onDeleteSecondary: (id: number) => void;
}) {
  const hour     = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Inline goal editing state (primary + secondary edited directly in the header)
  const [editingPrimary, setEditingPrimary] = useState(false);
  const [primaryDraft, setPrimaryDraft] = useState(dailyGoals.primary?.text ?? "");
  const [primaryEstDraft, setPrimaryEstDraft] = useState(dailyGoals.primary?.time_estimate_min ? formatMinutes(dailyGoals.primary.time_estimate_min) : "");
  const [secDraft, setSecDraft] = useState("");
  const [editingEstId, setEditingEstId] = useState<number | null>(null);
  const [estDraft, setEstDraft] = useState("");

  function commitPrimary() {
    const text = primaryDraft.trim();
    if (text) onSetPrimary({ text, time_estimate_min: parseMinutes(primaryEstDraft) });
    else onClearPrimary();
    setEditingPrimary(false);
  }
  function startEditPrimary() {
    setPrimaryDraft(dailyGoals.primary?.text ?? "");
    setPrimaryEstDraft(dailyGoals.primary?.time_estimate_min ? formatMinutes(dailyGoals.primary.time_estimate_min) : "");
    setEditingPrimary(true);
  }
  function handleSecKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && secDraft.trim()) {
      onAddSecondary(secDraft.trim());
      setSecDraft("");
    }
  }
  function commitSecEst(g: DailySecGoal) {
    onUpdateSecondaryEstimate(g.id, parseMinutes(estDraft));
    setEditingEstId(null);
  }

  // Stat pills.
  //
  // Every count here is over *top-level* tasks only. A subtask is a step inside
  // a task, not a task of its own — counting both would report a task broken
  // into five steps as six things to do, and the number would grow the more
  // carefully you planned.
  const rootTasks   = tasks.filter((t) => t.parent_id == null);
  const activeGoals = goals.filter((g) => g.status === "active").length;
  const openTasks   = rootTasks.filter((t) => !t.done).length;
  const activePlans = plans.filter((p) => p.status === "active").length;
  const systemsDue  = systems.filter(isDue).length;

  // Today's task progress (tasks due today + assignments + training sessions)
  const todayTasks = rootTasks.filter((t) => t.due_date === date);
  const totalToday = todayTasks.length + courseAssignments.length + todaySessions.length;
  const doneToday  = todayTasks.filter((t) => t.done).length
                   + courseAssignments.filter((ca) => ca.status === "done").length
                   + todaySessions.filter((s) => s.completed).length;
  const progressPct = totalToday === 0 ? 0 : Math.round((doneToday / totalToday) * 100);

  // Pie chart: 16-hour day = 960 minutes
  // Normal task → 10 min; timed assignment → duration (minutes)
  const TOTAL_MIN = 16 * 60;
  const TASK_MIN  = 10;
  let doneMin = 0, pendingMin = 0;

  for (const t of todayTasks) {
    // `aggregate_estimate` is the trigger-maintained roll-up of the whole
    // breakdown, so a task split into steps contributes its real total exactly
    // once. Falling back to its own estimate covers leaves and any row read
    // before the aggregate was computed.
    const min = t.aggregate_estimate || t.time_estimate || TASK_MIN;
    (t.done ? (doneMin += min) : (pendingMin += min));
  }
  for (const ca of courseAssignments) {
    let min: number;
    if (ca.time_estimate != null) {
      min = ca.time_estimate;
    } else if (ca.start_time && ca.end_time) {
      const [sh, sm] = ca.start_time.split(":").map(Number);
      const [eh, em] = ca.end_time.split(":").map(Number);
      const dur = (eh * 60 + em) - (sh * 60 + sm);
      min = dur > 0 ? dur : TASK_MIN;
    } else {
      min = TASK_MIN;
    }
    ca.status === "done" ? (doneMin += min) : (pendingMin += min);
  }

  const SESSION_DEFAULT_MIN = 60;
  for (const s of todaySessions) {
    let min = SESSION_DEFAULT_MIN;
    if (s.start_time && s.end_time) {
      const [sh, sm] = s.start_time.split(":").map(Number);
      const [eh, em] = s.end_time.split(":").map(Number);
      const dur = (eh * 60 + em) - (sh * 60 + sm);
      if (dur > 0) min = dur;
    }
    s.completed ? (doneMin += min) : (pendingMin += min);
  }

  const goalPieItems: PieItem[] = [];
  if (dailyGoals.primary?.time_estimate_min) {
    const min = dailyGoals.primary.time_estimate_min;
    goalPrimaryDone ? (doneMin += min) : (pendingMin += min);
    goalPieItems.push({ id: 0, label: dailyGoals.primary.text, subtitle: "Primary goal", minutes: min, done: goalPrimaryDone, kind: "goal" });
  }
  for (const g of dailyGoals.secondary) {
    if (!g.time_estimate_min) continue;
    const isDone = goalSecDone.has(g.id);
    isDone ? (doneMin += g.time_estimate_min) : (pendingMin += g.time_estimate_min);
    goalPieItems.push({ id: g.id, label: g.text, subtitle: "Secondary goal", minutes: g.time_estimate_min, done: isDone, kind: "goal" });
  }

  const workMin  = doneMin + pendingMin;
  const capTotal = Math.max(TOTAL_MIN, workMin);
  const freeMin  = capTotal - workMin;

  const pieItems: PieItem[] = [
    ...todayTasks.map((t) => ({
      id: t.id, label: t.title, subtitle: t.plan_title ?? undefined,
      // Same roll-up the totals above use, so the slices sum to the ring.
      minutes: t.aggregate_estimate || t.time_estimate || TASK_MIN,
      done: t.done, kind: "task" as const,
    })),
    ...courseAssignments.map((ca) => {
      let min: number;
      if (ca.time_estimate != null) {
        min = ca.time_estimate;
      } else if (ca.start_time && ca.end_time) {
        const [sh, sm] = ca.start_time.split(":").map(Number);
        const [eh, em] = ca.end_time.split(":").map(Number);
        const dur = (eh * 60 + em) - (sh * 60 + sm);
        min = dur > 0 ? dur : TASK_MIN;
      } else {
        min = TASK_MIN;
      }
      return { id: ca.id, label: ca.title, subtitle: ca.plan_title, minutes: min, done: ca.status === "done", kind: "assignment" as const };
    }),
    ...todaySessions.map((s) => {
      let min = SESSION_DEFAULT_MIN;
      if (s.start_time && s.end_time) {
        const [sh, sm] = s.start_time.split(":").map(Number);
        const [eh, em] = s.end_time.split(":").map(Number);
        const dur = (eh * 60 + em) - (sh * 60 + sm);
        if (dur > 0) min = dur;
      }
      const typeIcons: Record<string, string> = { running: "🏃", strength: "🏋️", yoga: "🧘", other: "⚡" };
      const icon = typeIcons[s.plan_type ?? "other"] ?? "⚡";
      return { id: s.id, label: `${icon} ${s.title}`, subtitle: s.plan_title ?? "Training", minutes: min, done: s.completed, kind: "assignment" as const };
    }),
    ...goalPieItems,
  ];

  return (
    <div className="shrink-0 flex flex-col md:flex-row items-stretch md:items-center gap-4 px-5 py-2.5 border-b border-border bg-card">

      {/* Greeting */}
      <div className="shrink-0 w-full md:w-auto">
        <h1 className="text-xl font-semibold text-foreground">{greeting}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </p>
      </div>

      <div className="hidden md:block h-10 w-px bg-border shrink-0" />

      {/* Goals editor + today's progress */}
      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        {/* Primary goal */}
        {editingPrimary ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <input
              autoFocus
              className="flex-1 h-7 rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring min-w-0"
              placeholder="What's your main focus today?"
              value={primaryDraft}
              onChange={(e) => setPrimaryDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitPrimary();
                if (e.key === "Escape") setEditingPrimary(false);
              }}
            />
            <TimeEstimateInput value={primaryEstDraft} onChange={setPrimaryEstDraft} onBlur={commitPrimary} className="w-16" />
            {dailyGoals.primary && (
              <button onClick={() => { onClearPrimary(); setEditingPrimary(false); }}
                className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : dailyGoals.primary ? (
          <div className="group flex items-center gap-1.5 min-w-0">
            <button
              onClick={onTogglePrimaryDone}
              className={cn(
                "h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition-colors",
                goalPrimaryDone ? "bg-emerald-500 border-emerald-500 text-white" : "border-yellow-500/50 hover:border-yellow-500"
              )}
            >
              {goalPrimaryDone && <Check className="h-2.5 w-2.5" />}
            </button>
            <Star className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
            <button onClick={startEditPrimary} className="flex items-center gap-1.5 text-left min-w-0 flex-1">
              <span className={cn("text-sm font-medium truncate", goalPrimaryDone ? "line-through text-muted-foreground" : "text-foreground")}>
                {dailyGoals.primary.text}
              </span>
              <TimeEstimateBadge min={dailyGoals.primary.time_estimate_min} />
              <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </button>
          </div>
        ) : (
          <button
            onClick={startEditPrimary}
            className="flex items-center gap-1.5 text-left text-muted-foreground/50 hover:text-muted-foreground transition-colors w-fit"
          >
            <Star className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs italic">Set your primary goal for today…</span>
          </button>
        )}

        {/* Secondary goals — compact chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {dailyGoals.secondary.map((g) => {
            const done = goalSecDone.has(g.id);
            return (
              <div key={g.id} className="group flex items-center gap-1 rounded-full border border-border bg-background pl-1.5 pr-1 py-0.5">
                <button
                  onClick={() => onToggleSecDone(g.id)}
                  className={cn(
                    "h-3 w-3 shrink-0 rounded-full border flex items-center justify-center transition-colors",
                    done ? "bg-emerald-500 border-emerald-500 text-white" : "border-muted-foreground/30 hover:border-muted-foreground"
                  )}
                >
                  {done && <Check className="h-2 w-2" />}
                </button>
                <span className={cn("text-xs max-w-[120px] truncate", done ? "line-through text-muted-foreground" : "text-foreground")}>
                  {g.text}
                </span>
                {editingEstId === g.id ? (
                  <TimeEstimateInput value={estDraft} onChange={setEstDraft} onBlur={() => commitSecEst(g)} className="w-14 h-6" />
                ) : (
                  <button
                    onClick={() => { setEditingEstId(g.id); setEstDraft(g.time_estimate_min ? formatMinutes(g.time_estimate_min) : ""); }}
                    className={cn(
                      "flex items-center transition-colors shrink-0",
                      g.time_estimate_min
                        ? "text-muted-foreground hover:text-foreground"
                        : "opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-muted-foreground"
                    )}
                    title="Set time estimate"
                  >
                    {g.time_estimate_min ? <TimeEstimateBadge min={g.time_estimate_min} /> : <Clock className="h-3 w-3" />}
                  </button>
                )}
                <button onClick={() => onDeleteSecondary(g.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0">
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          <input
            className="h-6 w-36 rounded-full border border-input bg-transparent px-2.5 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="+ secondary goal"
            value={secDraft}
            onChange={(e) => setSecDraft(e.target.value)}
            onKeyDown={handleSecKey}
          />
        </div>

        {totalToday > 0 ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {doneToday}/{totalToday} today
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/40 italic">Nothing scheduled for today</p>
        )}
      </div>

      <div className="hidden lg:block h-10 w-px bg-border shrink-0" />

      {/* Active goals — context for the day, beside the other header readouts */}
      <HeaderGoals goals={goals} />

      <div className="hidden md:block h-10 w-px bg-border shrink-0" />

      {/* Pie chart */}
      <TodayPie doneMin={doneMin} pendingMin={pendingMin} freeMin={freeMin} capTotal={capTotal} items={pieItems} />

      <div className="hidden md:block h-10 w-px bg-border shrink-0" />

      {/* Stat pills */}
      <div className="flex items-center gap-2 shrink-0 w-full md:w-auto flex-wrap">
        {[
          { label: "Goals",   value: activeGoals },
          { label: "Plans",   value: activePlans },
          { label: "Tasks",   value: openTasks },
          { label: "Systems", value: systemsDue, sub: systemsDue === 0 ? "clear" : "due" },
        ].map(({ label, value, sub }) => (
          <div key={label} className="rounded-lg border border-border px-3 py-1.5 bg-background text-center min-w-[56px]">
            <p className="text-sm font-semibold text-foreground leading-none">{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{sub ?? label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Goal time-estimate helpers ────────────────────────────────────────────────

function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function parseMinutes(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  // "1h 30m", "1h30m", "1h", "90m", "90", "1.5h"
  const hm = s.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*m?)?$/);
  if (hm) {
    const h = parseFloat(hm[1]);
    const m = hm[2] ? parseInt(hm[2]) : 0;
    return Math.round(h * 60) + m;
  }
  const m = s.match(/^(\d+)\s*m?$/);
  if (m) return parseInt(m[1]);
  return null;
}

function TimeEstimateBadge({ min, className }: { min: number | null; className?: string }) {
  if (!min) return null;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground shrink-0", className)}>
      <Clock className="h-2.5 w-2.5" />
      {formatMinutes(min)}
    </span>
  );
}

function TimeEstimateInput({ value, onChange, onBlur, className }: {
  value: string; onChange: (v: string) => void; onBlur: () => void; className?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
      placeholder="e.g. 30m, 1h"
      className={cn("h-7 w-20 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40", className)}
    />
  );
}

// ── Quick Cards ───────────────────────────────────────────────────────────────

// ── Top Goals ─────────────────────────────────────────────────────────────────

// ── Dashboard task row ───────────────────────────────────────────────────────

/** Left accent bar per importance — scannable down a column in a way a dot isn't. */
const PRIORITY_BAR: Record<string, string> = {
  high: "bg-rose-500",
  medium: "bg-amber-400",
  low: "bg-slate-400/50",
};

/**
 * A due-date chip that says how urgent the date actually is.
 *
 * Overdue and today are the only two states worth colour: everything else is a
 * quiet grey date. Colouring every future date turns the list into confetti and
 * makes the two states that need attention stop standing out.
 */
function DueChip({ due, today }: { due: string; today: string }) {
  const overdue = due < today;
  const isToday = due === today;
  if (!overdue && !isToday) {
    return (
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/50">
        {formatDateShort(due)}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1 py-px text-[10px] font-medium tabular-nums",
        overdue
          ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
          : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
      )}
    >
      {overdue ? `${daysUntil(due) * -1}d late` : "Today"}
    </span>
  );
}

/**
 * One task on the dashboard.
 *
 * Rewritten from a bare dot-and-title line for three reasons the old row got
 * wrong: its checkbox rendered no tick at all (so completing a task gave no
 * feedback), nothing showed a due date or an estimate on a *today*-focused
 * screen, and the hover affordances were driven by React state, re-rendering the
 * whole list on every mouse move. Hover is now pure CSS via `group/task`.
 *
 * Steps expand inline — a breakdown you can't see from the dashboard may as well
 * not exist, and the whole point of the recursive model is that today's work is
 * usually a step, not a whole task.
 */
function DashTaskRow({
  task, steps, today, expanded, onToggleExpand, onToggle, onEdit, onDelete,
}: {
  task: TaskWithContext;
  /** Direct subtasks. Named `steps`, not `children` — that prop name is React's. */
  steps: TaskWithContext[];
  today: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggle: (id: number) => void;
  onEdit: () => void;
  onDelete: (id: number) => void;
}) {
  const doneKids = steps.filter((c) => c.done).length;
  const hasKids = steps.length > 0;
  const effort = task.aggregate_estimate || task.time_estimate || 0;
  const plan = planningOf(task);

  return (
    <div className="flex flex-col">
      <div className="group/task flex items-center gap-2 rounded-md pr-1 py-1 hover:bg-secondary/50 transition-colors">
        {/* Importance as a left accent bar. */}
        <span className={cn("w-0.5 self-stretch rounded-full shrink-0", PRIORITY_BAR[task.priority] ?? PRIORITY_BAR.medium)} />

        <button
          onClick={() => onToggle(task.id)}
          disabled={hasKids}
          title={hasKids ? "Finish its steps to complete this" : "Mark done"}
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
            "border-border hover:border-primary hover:bg-primary/10",
            hasKids && "opacity-40 cursor-default hover:bg-transparent hover:border-border",
          )}
        >
          <Check className="h-2.5 w-2.5 opacity-0 group-hover/task:opacity-40 transition-opacity" />
        </button>

        {isFullTask(task) && <UrgencyMeter urgency={plan.urgency} />}

        <button
          onClick={onEdit}
          className="flex-1 min-w-0 text-left text-sm truncate hover:text-primary transition-colors"
          title={task.title}
        >
          {task.title}
        </button>

        {/* Steps — click to reveal them inline. */}
        {hasKids && (
          <button
            onClick={onToggleExpand}
            title={`${doneKids} of ${steps.length} steps done`}
            className="shrink-0 inline-flex items-center gap-1 rounded px-1 py-px text-[10px] tabular-nums text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
            {doneKids}/{steps.length}
          </button>
        )}

        {effort > 0 && <TimeEstimateBadge min={effort} />}
        {task.due_date && <DueChip due={task.due_date} today={today} />}

        <button
          onClick={() => onDelete(task.id)}
          title="Delete"
          className="shrink-0 p-0.5 rounded text-muted-foreground opacity-0 group-hover/task:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {expanded && hasKids && (
        <div className="flex flex-col gap-0.5 ml-4 pl-2 border-l border-border/60">
          {steps.map((c) => (
            <div key={c.id} className="group/step flex items-center gap-2 rounded-md pr-1 py-0.5 hover:bg-secondary/40 transition-colors">
              <button
                onClick={() => onToggle(c.id)}
                className={cn(
                  "flex h-3 w-3 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                  c.done
                    ? "bg-primary border-primary text-primary-foreground"
                    : "border-border hover:border-primary",
                )}
              >
                {c.done && <Check className="h-2 w-2" />}
              </button>
              <span className={cn("flex-1 min-w-0 truncate text-xs", c.done && "line-through text-muted-foreground")}>
                {c.title}
              </span>
              {c.time_estimate ? (
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
                  {formatMinutes(c.time_estimate)}
                </span>
              ) : null}
              {c.due_date && <DueChip due={c.due_date} today={today} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TodoList({
  tasks, plans, courseAssignments, onToggleTask, onCreateTask, onDeleteTask, onUpdateTask, onToggleAssignment,
}: {
  tasks: TaskWithContext[];
  plans: Plan[];
  courseAssignments: CourseAssignment[];
  onToggleTask: (id: number) => void;
  onCreateTask: (payload: { plan_id?: number | null; title: string; priority?: string; due_date?: string | null; category?: string | null }) => void;
  onDeleteTask: (id: number) => void;
  onUpdateTask: (id: number, payload: { title: string; priority: string; due_date?: string | null; category?: string | null }) => void;
  onToggleAssignment: (ca: CourseAssignment) => void;
}) {
  const [tasksCollapsed, setTasksCollapsed] = useState(false);
  const [studyCollapsed, setStudyCollapsed] = useState(false);
  const [collapsedPlans, setCollapsedPlans] = useState<Set<number | null>>(new Set());

  // Create form state
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPlanId, setNewPlanId] = useState<number | null>(null);
  const [newPriority, setNewPriority] = useState("medium");
  const [newDueDate, setNewDueDate] = useState("");
  const [newCategory, setNewCategory] = useState<string>("");

  // Inline edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPriority, setEditPriority] = useState("medium");
  const [editDueDate, setEditDueDate] = useState("");
  const [editCategory, setEditCategory] = useState<string>("");

  // Which tasks have their steps revealed. Hover affordances are pure CSS now
  // (see DashTaskRow's group/task), so no mouse-move state lives here.
  const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set());
  const toggleTaskExpand = (id: number) =>
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const activePlans = plans.filter((p) => p.status === "active");

  const submitCreate = () => {
    const title = newTitle.trim();
    if (!title) return;
    // A quick task belongs to a category, not a plan — the two are exclusive.
    onCreateTask({
      plan_id: newCategory ? null : newPlanId ?? null,
      title,
      priority: newPriority,
      due_date: newDueDate || null,
      category: newCategory || null,
    });
    setNewTitle(""); setNewPlanId(null); setNewPriority("medium"); setNewDueDate(""); setNewCategory("");
    setShowAdd(false);
  };

  const startEdit = (task: TaskWithContext) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditPriority(task.priority);
    setEditDueDate(task.due_date ?? "");
    setEditCategory(task.category ?? "");
  };

  const submitEdit = (id: number) => {
    const title = editTitle.trim();
    if (!title) { setEditingId(null); return; }
    onUpdateTask(id, { title, priority: editPriority, due_date: editDueDate || null, category: editCategory || null });
    setEditingId(null);
  };

  // Quick tasks (reminder / chore / shopping) are captured on the phone via
  // Nexus Local and are not project work — they now live in the sidebar rail,
  // one panel per category. Leaving them here meant a shopping list competed for
  // attention with the day's actual tasks.
  //
  // Steps live inside their parent row, not beside it. Without this filter a
  // task broken into five steps would occupy six lines on the dashboard, and
  // planning a task more carefully would make the day look busier.
  const childrenByParent = useMemo(() => {
    const m = new Map<number, TaskWithContext[]>();
    for (const t of tasks) {
      if (t.parent_id == null) continue;
      const b = m.get(t.parent_id);
      if (b) b.push(t); else m.set(t.parent_id, [t]);
    }
    for (const list of m.values()) list.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    return m;
  }, [tasks]);

  const open = useMemo(() => {
    const p = { high: 0, medium: 1, low: 2 } as Record<string, number>;
    return [...tasks]
      .filter((t) => !t.done && t.parent_id == null && t.category == null)
      // Overdue first, then by importance — the dashboard's job is to surface
      // what is slipping, and a high-priority task due next month should not
      // outrank one that was due yesterday.
      .sort((a, b) => {
        const aLate = a.due_date != null && a.due_date < todayDate() ? 0 : 1;
        const bLate = b.due_date != null && b.due_date < todayDate() ? 0 : 1;
        if (aLate !== bLate) return aLate - bLate;
        return (p[a.priority] ?? 1) - (p[b.priority] ?? 1);
      });
  }, [tasks]);

  // Group open tasks by plan. Quick tasks (category set) group under their
  // category instead — a shopping list under "No plan" reads as clutter, not
  // as a list. Category groups use negative pseudo-ids so they can share the
  // collapse mechanism without colliding with real plan ids.
  const byPlan = useMemo(() => {
    const map = new Map<number | null, { planTitle: string | null; goalTitle: string | null; tasks: TaskWithContext[] }>();
    for (const t of open) {
      const key = t.plan_id;
      if (!map.has(key)) {
        map.set(key, { planTitle: t.plan_title, goalTitle: t.goal_title, tasks: [] });
      }
      map.get(key)!.tasks.push(t);
    }
    // Unplanned work last; named plans keep their natural order otherwise.
    return Array.from(map.entries()).sort(([a], [b]) =>
      (a == null ? 1 : 0) - (b == null ? 1 : 0));
  }, [open]);

  const togglePlan = (planId: number | null) => {
    setCollapsedPlans((prev) => {
      const next = new Set(prev);
      if (next.has(planId)) next.delete(planId); else next.add(planId);
      return next;
    });
  };

  const SectionHeader = ({ icon, label, collapsed, onToggle }: {
    icon: import("react").ReactNode; label: string; collapsed: boolean; onToggle: () => void;
  }) => (
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors w-fit"
    >
      {icon}
      {label}
      {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">

      {/* ── Tasks section ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <SectionHeader
            icon={<CheckSquare className="h-3.5 w-3.5" />}
            label={`Tasks${open.length > 0 ? ` (${open.length})` : ""}`}
            collapsed={tasksCollapsed}
            onToggle={() => setTasksCollapsed((v) => !v)}
          />
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Inline create form */}
        {showAdd && (
          <div className="flex flex-col gap-2 p-2 rounded-md border border-border bg-muted/30">
            <input
              autoFocus
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); if (e.key === "Escape") setShowAdd(false); }}
              placeholder="Task title…"
              className="text-sm bg-transparent border-none outline-none placeholder:text-muted-foreground/50 w-full"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="text-xs bg-input border border-border rounded px-1.5 py-0.5 outline-none"
              >
                <option value="">Task</option>
                <option value="reminder">Reminder</option>
                <option value="chore">Chore</option>
                <option value="shopping">Shopping</option>
              </select>
              {/* Quick tasks don't belong to plans; hide the picker to say so. */}
              {!newCategory && (
                <select
                  value={newPlanId ?? ""}
                  onChange={(e) => setNewPlanId(e.target.value ? Number(e.target.value) : null)}
                  className="text-xs bg-input border border-border rounded px-1.5 py-0.5 outline-none max-w-32"
                >
                  <option value="">No plan</option>
                  {activePlans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              )}
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value)}
                className="text-xs bg-input border border-border rounded px-1.5 py-0.5 outline-none"
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="text-xs bg-input border border-border rounded px-1.5 py-0.5 outline-none"
              />
              <button
                onClick={submitCreate}
                disabled={!newTitle.trim()}
                className="ml-auto text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded disabled:opacity-40 hover:bg-primary/90 transition-colors"
              >
                Add
              </button>
              <button onClick={() => setShowAdd(false)} className="text-xs text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </div>
          </div>
        )}

        {!tasksCollapsed && (
          open.length === 0 ? (
            tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground/60 italic">
                Nothing due today — check Backlog for overdue tasks
              </p>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-green-500 shrink-0" /> All tasks done!
              </div>
            )
          ) : (
            /*
              A grid of group cards, not one long column.
              Each group holds a handful of short titles ("retinol", "mælk"), so a
              full-width row spent ~1000px of horizontal space on ~80px of text and
              pushed everything else below the fold. Cards let the groups sit
              side by side and make each one a scannable unit.
              `items-start` keeps a 2-task card from stretching to match a 6-task
              one — equal-height cards would just reintroduce the empty space.
            */
            <div className="grid gap-2.5 items-start auto-rows-min [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
              {byPlan.map(([planId, group]) => {
                const isPlanCollapsed = collapsedPlans.has(planId);
                return (
                  <div key={planId} className="flex flex-col gap-0.5 rounded-lg border border-border/60 bg-card/40 p-2">
                    {/* Plan group header */}
                    <button
                      onClick={() => togglePlan(planId)}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full min-w-0"
                    >
                      {isPlanCollapsed ? <ChevronRight className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
                      <span className="font-medium truncate" title={[group.planTitle ?? "No plan", group.goalTitle].filter(Boolean).join(" · ")}>{group.planTitle ?? "No plan"}</span>
                      <span className="opacity-50 shrink-0">({group.tasks.length})</span>
                    </button>

                    {!isPlanCollapsed && (
                      <div className="flex flex-col gap-0.5">
                        {group.tasks.map((task) => {
                          const isEditing = editingId === task.id;
                          if (!isEditing) {
                            return (
                              <DashTaskRow
                                key={task.id}
                                task={task}
                                steps={childrenByParent.get(task.id) ?? []}
                                today={todayDate()}
                                expanded={expandedTasks.has(task.id)}
                                onToggleExpand={() => toggleTaskExpand(task.id)}
                                onToggle={onToggleTask}
                                onEdit={() => startEdit(task)}
                                onDelete={onDeleteTask}
                              />
                            );
                          }
                          return (
                            <div key={task.id} className="flex items-start gap-2 py-0.5">
                              <div className="flex-1 min-w-0">
                                {isEditing ? (
                                  <div className="flex flex-col gap-1">
                                    <input
                                      autoFocus
                                      value={editTitle}
                                      onChange={(e) => setEditTitle(e.target.value)}
                                      onKeyDown={(e) => { if (e.key === "Enter") submitEdit(task.id); if (e.key === "Escape") setEditingId(null); }}
                                      onBlur={() => submitEdit(task.id)}
                                      className="text-sm bg-input border border-border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-ring w-full"
                                    />
                                    <div className="flex gap-1.5 items-center">
                                      <select
                                        value={editCategory}
                                        onChange={(e) => setEditCategory(e.target.value)}
                                        className="text-xs bg-input border border-border rounded px-1 py-0.5 outline-none"
                                      >
                                        <option value="">Task</option>
                                        <option value="reminder">Reminder</option>
                                        <option value="chore">Chore</option>
                                        <option value="shopping">Shopping</option>
                                      </select>
                                      <select
                                        value={editPriority}
                                        onChange={(e) => setEditPriority(e.target.value)}
                                        className="text-xs bg-input border border-border rounded px-1 py-0.5 outline-none"
                                      >
                                        <option value="high">High</option>
                                        <option value="medium">Medium</option>
                                        <option value="low">Low</option>
                                      </select>
                                      <input
                                        type="date"
                                        value={editDueDate}
                                        onChange={(e) => setEditDueDate(e.target.value)}
                                        className="text-xs bg-input border border-border rounded px-1 py-0.5 outline-none"
                                      />
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* ── Study section ── */}
      {courseAssignments.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionHeader
            icon={<BookOpen className="h-3.5 w-3.5" />}
            label={`Study (${courseAssignments.length})`}
            collapsed={studyCollapsed}
            onToggle={() => setStudyCollapsed((v) => !v)}
          />
          {!studyCollapsed && (
            <div className="flex flex-col gap-1">
              {courseAssignments.map((ca) => {
                const done = ca.status === "done";
                return (
                  <div key={ca.id} className="flex items-start gap-2 py-0.5">
                    <button
                      onClick={() => onToggleAssignment(ca)}
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                        done ? "bg-primary border-primary" : "border-border hover:border-primary"
                      )}
                    >
                      {done && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className={cn("text-sm truncate block", done && "line-through text-muted-foreground")}>
                        {ca.title}
                      </span>
                      <p className="text-xs text-muted-foreground truncate">{ca.plan_title}</p>
                    </div>
                    {ca.start_time && (
                      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{ca.start_time}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function Dashboard() {
  const [goals,      setGoals]      = useState<Goal[]>([]);
  const [plans,      setPlans]      = useState<Plan[]>([]);
  const [tasks,      setTasks]      = useState<TaskWithContext[]>([]);
  const [systems,    setSystems]    = useState<SystemEntry[]>([]);
  const [calBlocks,  setCalBlocks]  = useState<CalBlock[]>([]);
  // Sessions logged against today's calendar occurrences, keyed by cal_block_id.
  const [sessionsByBlock, setSessionsByBlock] = useState<Map<number, TaskSession>>(new Map());
  const [dailyGoals, setDailyGoals] = useState<DailyGoals>({ primary: null, secondary: [] });
  const [courseAssignments, setCourseAssignments] = useState<CourseAssignment[]>([]);
  const [scheduleEntries,  setScheduleEntries]  = useState<ScheduleEntry[]>([]);
  const [habits,           setHabits]           = useState<HabitWithCompletion[]>([]);
  const [habitStacks,      setHabitStacks]      = useState<HabitStack[]>([]);
  const [todaySessions,    setTodaySessions]    = useState<TrainingSession[]>([]);

  const date = todayDate();

  // Goal done-state — lifted here so WelcomeBox pie chart stays in sync
  const lsKey = `daily_goals_done_${date}`;
  const [goalPrimaryDone, setGoalPrimaryDone] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem(`daily_goals_done_${todayDate()}`) ?? "{}").primary === true; }
    catch { return false; }
  });
  const [goalSecDone, setGoalSecDone] = useState<Set<number>>(() => {
    try { return new Set<number>(JSON.parse(localStorage.getItem(`daily_goals_done_${todayDate()}`) ?? "{}").secondary ?? []); }
    catch { return new Set(); }
  });

  function persistGoalDone(primary: boolean, sec: Set<number>) {
    localStorage.setItem(lsKey, JSON.stringify({ primary, secondary: [...sec] }));
  }
  function handleTogglePrimaryDone() {
    const next = !goalPrimaryDone;
    setGoalPrimaryDone(next);
    persistGoalDone(next, goalSecDone);
  }
  function handleToggleSecDone(id: number) {
    const next = new Set(goalSecDone);
    next.has(id) ? next.delete(id) : next.add(id);
    setGoalSecDone(next);
    persistGoalDone(goalPrimaryDone, next);
  }

  const load = useCallback(async () => {
    // The six side-tools (reminders, notes, brain dump, events, deadlines,
    // agreements) are no longer loaded here — they live in the sidebar and fetch
    // their own data on first open. See components/QuickPanels.tsx.
    const [g, p, t, s, cb, dg, cas, ses, hb, hs, ts, wk] = await Promise.all([
      getGoals(), getPlans(), getAllTasks(), getSystems(), getCalBlocks(date, date),
      getDailyGoals(date),
      getCourseAssignments(), getScheduleEntriesForDate(date), getHabitsForDate(date), getHabitStacks(),
      getTrainingSessionsForDate(date), getTaskSessionsInRange(date, date),
    ]);
    setGoals(g); setPlans(p); setTasks(t); setSystems(s); setCalBlocks(cb);
    setDailyGoals(dg);
    setCourseAssignments(cas.filter((ca) => ca.due_date === date));
    setScheduleEntries(ses);
    setHabits(hb);
    setHabitStacks(hs);
    setTodaySessions(ts);
    setSessionsByBlock(new Map(
      wk.filter((x) => x.cal_block_id != null).map((x) => [x.cal_block_id!, x]),
    ));
  }, [date]);

  useEffect(() => { load(); }, [load]);

  // ── Day-calendar rail: collapsible + drag-resizable ───────────────────────
  const RAIL_MIN = 220, RAIL_MAX = 620, RAIL_DEFAULT = 288;
  const [railOpen, setRailOpen] = useState(
    () => localStorage.getItem("pf-dash-rail-open") !== "0",
  );
  const [railWidth, setRailWidth] = useState(() => {
    const v = Number(localStorage.getItem("pf-dash-rail-w"));
    return Number.isFinite(v) && v >= RAIL_MIN && v <= RAIL_MAX ? v : RAIL_DEFAULT;
  });

  useEffect(() => { localStorage.setItem("pf-dash-rail-open", railOpen ? "1" : "0"); }, [railOpen]);
  useEffect(() => { localStorage.setItem("pf-dash-rail-w", String(railWidth)); }, [railWidth]);

  /**
   * Drag the divider to resize.
   *
   * Width is read from the pointer's distance to the window's right edge rather
   * than accumulated deltas — accumulating drifts whenever a move event is
   * coalesced or the clamp bites, so the handle slowly desyncs from the cursor.
   * Pointer capture keeps the drag alive when the cursor outruns the 4px handle.
   */
  const startResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();

    // Listeners go on `window`, not on the handle with setPointerCapture.
    // Capture retargets events to the element in theory, but in practice moves
    // went missing and the rail barely tracked the cursor. Window listeners are
    // the conventional shape here and also keep the drag alive when the pointer
    // outruns the handle or leaves the viewport entirely.
    const onMove = (ev: PointerEvent) => {
      setRailWidth(Math.min(RAIL_MAX, Math.max(RAIL_MIN, window.innerWidth - ev.clientX)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    // Without these, dragging selects the text it sweeps over and the cursor
    // flickers back to a caret whenever it crosses the content.
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);

  // Quick tasks (reminders / chores / shopping) are standing lists — they show
  // regardless of due date, unlike project tasks which only surface on their day.
  const todayTasks   = useMemo(
    () => tasks.filter((t) => t.due_date === date || t.category != null),
    [tasks, date],
  );

  const handleToggleTask = async (id: number) => {
    await toggleTask(id);
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, done: !t.done } : t));
  };

  const handleCreateTask = async (payload: { plan_id?: number | null; title: string; priority?: string; due_date?: string | null; category?: string | null }) => {
    await createTask(payload);
    const t = await getAllTasks();
    setTasks(t);
  };

  const handleDeleteTask = async (id: number) => {
    await deleteTask(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const handleUpdateTask = async (id: number, payload: { title: string; priority: string; due_date?: string | null; category?: string | null }) => {
    await updateTask(id, payload);
    const t = await getAllTasks();
    setTasks(t);
  };

  const handleSetPrimary = async (payload: DailyPrimaryGoal) => {
    await setDailyPrimaryGoal(date, payload);
    setDailyGoals((prev) => ({ ...prev, primary: payload }));
  };
  const handleClearPrimary = async () => {
    await clearDailyPrimaryGoal(date);
    setDailyGoals((prev) => ({ ...prev, primary: null }));
  };
  const handleAddSecondary = async (text: string) => {
    const g = await addDailySecondaryGoal(date, text);
    setDailyGoals((prev) => ({ ...prev, secondary: [...prev.secondary, g] }));
  };
  const handleUpdateSecondaryEstimate = async (id: number, min: number | null) => {
    await updateDailySecondaryGoal(id, { time_estimate_min: min });
    setDailyGoals((prev) => ({
      ...prev,
      secondary: prev.secondary.map((s) => s.id === id ? { ...s, time_estimate_min: min } : s),
    }));
  };
  const handleDeleteSecondary = async (id: number) => {
    await deleteDailySecondaryGoal(id);
    setDailyGoals((prev) => ({ ...prev, secondary: prev.secondary.filter((s) => s.id !== id) }));
  };


  const handleToggleAssignment = async (ca: CourseAssignment) => {
    const newStatus = ca.status === "done" ? "pending" : "done";
    const updated = await updateCourseAssignment(ca.id, {
      plan_id: ca.plan_id, title: ca.title, assignment_type: ca.assignment_type,
      due_date: ca.due_date, status: newStatus, priority: ca.priority,
      book_title: ca.book_title, chapter_start: ca.chapter_start, chapter_end: ca.chapter_end,
      page_start: ca.page_start, page_end: ca.page_end, page_current: ca.page_current,
      notes: ca.notes, start_time: ca.start_time, end_time: ca.end_time,
    });
    setCourseAssignments((prev) => prev.map((x) => x.id === ca.id ? updated : x));
  };

  const handleToggleHabit = async (id: number) => {
    const nowDone = await toggleHabitCompletion(id, date);
    setHabits((prev) => prev.map((h) => h.id === id ? { ...h, done: nowDone } : h));
  };

  /**
   * Ticks a scheduled block off as worked, or un-ticks it.
   *
   * Mirrors Week's handler: the session is keyed to `block.id`, which for a
   * recurring occurrence is its virtual negative id, so one day's tick doesn't
   * mark the whole series. This is what advances sessions- and time-mode
   * completion — without it a recurring step never finishes.
   */
  const handleToggleWorked = async (block: CalBlock) => {
    if (block.task_id == null) return;
    const existing = sessionsByBlock.get(block.id);

    setSessionsByBlock((prev) => {
      const next = new Map(prev);
      if (existing) next.delete(block.id);
      else next.set(block.id, {
        id: -1, task_id: block.task_id!, date: block.date,
        minutes: blockMinutes(block.start_time, block.end_time),
        cal_block_id: block.id, note: null, created_at: new Date().toISOString(),
      });
      return next;
    });

    try {
      if (existing) {
        await unlogTaskOccurrence(block.task_id, block.id);
      } else {
        await logTaskSession({
          task_id: block.task_id,
          date: block.date,
          minutes: blockMinutes(block.start_time, block.end_time),
          cal_block_id: block.id,
        });
      }
    } finally {
      load();
    }
  };

  const handleCreateCalBlock = async (d: DCBlockDraft) => {
    let taskId = d.task_id;
    if (taskId === null) {
      const durationMin = timeToMin(d.end_time) - timeToMin(d.start_time);
      const newTask = await createTask({
        plan_id: null, title: d.title,
        time_estimate: durationMin > 0 ? durationMin : null,
        due_date: date,
      });
      taskId = newTask.id;
      setTasks((prev) => [toTaskWithContext(newTask), ...prev]);
    }
    const b = await createCalBlock(date, d.title, d.start_time, d.end_time, d.color, d.description || null, d.location || null, taskId);
    setCalBlocks((prev) => [...prev, b].sort((a, x) => a.start_time.localeCompare(x.start_time)));
  };
  const handleUpdateCalBlock = async (id: number, d: DCBlockDraft) => {
    const b = await updateCalBlock(id, d.title, d.start_time, d.end_time, d.color, d.description || null, d.location || null, d.task_id);
    setCalBlocks((prev) => prev.map((x) => x.id === id ? b : x));
  };
  const handleDeleteCalBlock = async (b: CalBlock) => {
    await deleteCalBlock(b.id);
    setCalBlocks((prev) => prev.filter((x) => x.id !== b.id));
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-2.75rem-5.5rem)] md:h-[calc(100vh-2.5rem)] overflow-hidden">

      <WelcomeBox goals={goals} plans={plans} tasks={tasks} systems={systems}
        dailyGoals={dailyGoals} courseAssignments={courseAssignments} date={date}
        goalPrimaryDone={goalPrimaryDone} goalSecDone={goalSecDone} todaySessions={todaySessions}
        onTogglePrimaryDone={handleTogglePrimaryDone} onToggleSecDone={handleToggleSecDone}
        onSetPrimary={handleSetPrimary} onClearPrimary={handleClearPrimary}
        onAddSecondary={handleAddSecondary} onUpdateSecondaryEstimate={handleUpdateSecondaryEstimate}
        onDeleteSecondary={handleDeleteSecondary} />

      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden relative">

        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-y-auto border-r border-border px-3 py-2 md:px-4 md:py-3 flex flex-col gap-3 md:gap-4">

          {/* To-Do List */}
          <TodoList
            tasks={todayTasks}
            plans={plans}
            courseAssignments={courseAssignments}
            onToggleTask={handleToggleTask}
            onCreateTask={handleCreateTask}
            onDeleteTask={handleDeleteTask}
            onUpdateTask={handleUpdateTask}
            onToggleAssignment={handleToggleAssignment}
          />

        </div>

        {/* ── Right column: Habits + Day Calendar ─────────────────────────── */}
        {/*
          Collapsible and resizable. The day calendar is the densest thing on the
          page and how much room it deserves depends entirely on what the day
          looks like — a wall of blocks wants width, an empty Sunday wants none.
          Both the width and the open/closed state persist, because a layout you
          have to re-adjust on every visit is worse than a fixed one.
        */}
        {!railOpen && (
          <button
            onClick={() => setRailOpen(true)}
            title="Show day calendar"
            className="hidden md:flex absolute bottom-3 right-3 z-10 h-8 w-8 items-center justify-center rounded-md border border-border bg-card shadow-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <PanelRight className="h-4 w-4" />
          </button>
        )}

        {/* 12px hit area around a 1px line. A hairline divider is the right
            *look* but a terrible target; separating the two means the handle is
            easy to grab without drawing a thick bar down the page.
            touch-none stops the browser claiming the gesture for scrolling. */}
        {railOpen && (
        <div
          onPointerDown={startResize}
          title="Drag to resize"
          className="hidden md:flex w-3 shrink-0 cursor-col-resize items-stretch justify-center touch-none group/resize"
        >
          <div className="w-px bg-border transition-colors group-hover/resize:bg-primary group-active/resize:bg-primary" />
        </div>
        )}

        {railOpen && (
        <div
          style={{ width: railWidth }}
          className="hidden md:flex shrink-0 flex-col overflow-hidden px-3 py-3 gap-3 relative">
          <button
            onClick={() => setRailOpen(false)}
            title="Hide day calendar"
            className="absolute top-1 right-1 z-10 p-1 rounded text-muted-foreground/50 hover:text-foreground hover:bg-secondary transition-colors"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
          <HabitsStrip habits={habits} stacks={habitStacks} onToggle={handleToggleHabit} today={date} />
          <DayCalendar
            date={date}
            calBlocks={calBlocks}
            systems={systems}
            courseAssignments={courseAssignments}
            scheduleEntries={scheduleEntries}
            tasks={tasks}
            sessionsByBlock={sessionsByBlock}
            onToggleWorked={handleToggleWorked}
            onCreateBlock={handleCreateCalBlock}
            onUpdateBlock={handleUpdateCalBlock}
            onDeleteBlock={handleDeleteCalBlock}
          />
        </div>
        )}

      </div>

    </div>
  );
}
