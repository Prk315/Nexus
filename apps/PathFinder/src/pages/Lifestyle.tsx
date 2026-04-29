import React, { useEffect, useState, useCallback } from "react";
import {
  Heart, Plus, X, Check, Trash2, ChevronDown, ChevronRight,
  Dumbbell, Footprints, Flame, Timer, Ruler, Calendar, TrendingUp, Zap,
  CalendarDays, BarChart2, Pencil, Activity, Target, CalendarPlus,
  Layers,
} from "lucide-react";
import {
  getHabitsForDate,
  createDailyHabit,
  updateDailyHabit,
  deleteDailyHabit,
  toggleHabitCompletion,
  getHabitStacks,
  createHabitStack,
  deleteHabitStack,
  getRunLogs,
  createRunLog,
  deleteRunLog,
  getWorkoutLogs,
  createWorkoutLog,
  deleteWorkoutLog,
  addWorkoutExercise,
  deleteWorkoutExercise,
  getTrainingPlans,
  createTrainingPlan,
  updateTrainingPlan,
  deleteTrainingPlan,
  getTrainingSessions,
  getRecurringTrainingSessions,
  createTrainingSession,
  deleteTrainingSession,
  deleteTrainingSessionSeries,
  toggleTrainingSession,
  getSessionPerformance,
  addSessionPerformance,
  deleteSessionPerformance,
  getHabitSubtasks,
  addHabitSubtask,
  deleteHabitSubtask,
  toggleHabitSubtask,
} from "../lib/api";
import type { HabitWithCompletion, HabitStack, HabitSubtask, RunLog, WorkoutLog, TrainingPlan, TrainingSession, SessionPerformance } from "../types";

// ── Training plan type helpers ────────────────────────────────────────────────
type PlanType = "running" | "strength" | "yoga" | "other";
const PLAN_TYPES: { id: PlanType; label: string; icon: React.ReactNode; color: string; accent: string }[] = [
  { id: "running",  label: "Running",  icon: <Footprints className="w-3.5 h-3.5" />, color: "text-emerald-600", accent: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
  { id: "strength", label: "Strength", icon: <Dumbbell className="w-3.5 h-3.5" />,   color: "text-orange-600",  accent: "bg-orange-500/15 text-orange-700 border-orange-500/30" },
  { id: "yoga",     label: "Yoga",     icon: <Activity className="w-3.5 h-3.5" />,   color: "text-violet-600",  accent: "bg-violet-500/15 text-violet-700 border-violet-500/30" },
  { id: "other",    label: "Other",    icon: <Zap className="w-3.5 h-3.5" />,        color: "text-slate-500",   accent: "bg-slate-500/15 text-slate-700 border-slate-500/30" },
];
const planTypeInfo = (t: string | null) => PLAN_TYPES.find((p) => p.id === t) ?? PLAN_TYPES[3];
import { cn } from "../lib/utils";

const TODAY = new Date().toISOString().slice(0, 10);

const COLORS = ["emerald", "blue", "violet", "orange", "rose", "amber", "teal", "slate"] as const;
type HabitColor = (typeof COLORS)[number];

const COLOR_DOT: Record<HabitColor, string> = {
  emerald: "bg-emerald-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  orange: "bg-orange-500",
  rose: "bg-rose-500",
  amber: "bg-amber-500",
  teal: "bg-teal-500",
  slate: "bg-slate-500",
};

const COLOR_BADGE: Record<HabitColor, string> = {
  emerald: "bg-emerald-500/15 text-emerald-600",
  blue: "bg-blue-500/15 text-blue-600",
  violet: "bg-violet-500/15 text-violet-600",
  orange: "bg-orange-500/15 text-orange-600",
  rose: "bg-rose-500/15 text-rose-600",
  amber: "bg-amber-500/15 text-amber-600",
  teal: "bg-teal-500/15 text-teal-600",
  slate: "bg-slate-500/15 text-slate-600",
};

const COLOR_RING: Record<HabitColor, string> = {
  emerald: "ring-emerald-500",
  blue: "ring-blue-500",
  violet: "ring-violet-500",
  orange: "ring-orange-500",
  rose: "ring-rose-500",
  amber: "ring-amber-500",
  teal: "ring-teal-500",
  slate: "ring-slate-500",
};

const COLOR_BG_CHECKED: Record<HabitColor, string> = {
  emerald: "bg-emerald-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  orange: "bg-orange-500",
  rose: "bg-rose-500",
  amber: "bg-amber-500",
  teal: "bg-teal-500",
  slate: "bg-slate-500",
};

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatPace(distanceKm: number | null, durationMin: number | null): string {
  if (!distanceKm || !durationMin || distanceKm === 0) return "—";
  const pace = durationMin / distanceKm;
  const mins = Math.floor(pace);
  const secs = Math.round((pace - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")} min/km`;
}

// ── Habits Tab ────────────────────────────────────────────────────────────────

function HabitRow({
  habit,
  onToggle,
  onDelete,
  onMoveToStack,
  onSubtaskChange,
  stacks,
}: {
  habit: HabitWithCompletion;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onMoveToStack: (id: number, stackId: number | null) => void;
  onSubtaskChange?: () => void;
  stacks: HabitStack[];
}) {
  const [hovered, setHovered] = useState(false);
  const [showStackMenu, setShowStackMenu] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [subtasks, setSubtasks] = useState<HabitSubtask[]>([]);
  const [subtasksLoaded, setSubtasksLoaded] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");

  const color = habit.color as HabitColor;
  const weekDots = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(TODAY + "T00:00:00");
    d.setDate(d.getDate() - i);
    return habit.recent_dates.includes(d.toISOString().slice(0, 10));
  });

  const loadSubtasks = async () => {
    try {
      const data = await getHabitSubtasks(habit.id, TODAY);
      setSubtasks(data);
      setSubtasksLoaded(true);
    } catch (e) {
      console.error(e);
    }
  };

  const handleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !subtasksLoaded) await loadSubtasks();
  };

  const handleAddSubtask = async () => {
    const title = newSubtaskTitle.trim();
    if (!title) return;
    try {
      const updated = await addHabitSubtask(habit.id, title, TODAY);
      setSubtasks(updated);
      setSubtasksLoaded(true);
      setNewSubtaskTitle("");
      onSubtaskChange?.();
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleSubtask = async (subtaskId: number) => {
    try {
      const updated = await toggleHabitSubtask(subtaskId, TODAY);
      setSubtasks(updated);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteSubtask = async (subtaskId: number) => {
    try {
      await deleteHabitSubtask(subtaskId);
      setSubtasks((prev) => prev.filter((s) => s.id !== subtaskId));
      onSubtaskChange?.();
    } catch (e) {
      console.error(e);
    }
  };

  const hasSubtasks = habit.subtask_count > 0 || subtasks.length > 0;

  return (
    <div>
      <div
        className="flex items-center gap-3 px-4 py-3 group relative"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); setShowStackMenu(false); }}
      >
        <button
          onClick={() => onToggle(habit.id)}
          className={cn(
            "w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all",
            habit.done
              ? cn(COLOR_BG_CHECKED[color] ?? "bg-emerald-500", "border-transparent")
              : cn("border-border bg-transparent", COLOR_RING[color] ?? "ring-emerald-500", "ring-2 ring-offset-1")
          )}
        >
          {habit.done && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={cn("w-2 h-2 rounded-full flex-shrink-0", COLOR_DOT[color] ?? "bg-emerald-500")} />
          <span className={cn("text-sm font-medium truncate", habit.done && "line-through text-muted-foreground")}>
            {habit.title}
          </span>
          {hasSubtasks && (
            <span className="text-[10px] tabular-nums text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full flex-shrink-0">
              {habit.subtask_done_count}/{habit.subtask_count}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          {weekDots.map((done, i) => (
            <span
              key={i}
              title={i === 0 ? "Today" : `${i}d ago`}
              className={cn("w-2 h-2 rounded-full", done ? (COLOR_DOT[color] ?? "bg-emerald-500") : "bg-muted-foreground/20")}
            />
          ))}
        </div>

        {habit.streak > 0 && (
          <div className="flex items-center gap-0.5 flex-shrink-0 text-orange-500">
            <Zap className="w-3 h-3" />
            <span className="text-xs font-semibold">{habit.streak}</span>
          </div>
        )}

        <button
          onClick={handleExpand}
          className={cn(
            "p-1 rounded transition-colors flex-shrink-0",
            expanded ? "text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground",
          )}
          title="Sub-habits"
        >
          <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", expanded && "rotate-180")} />
        </button>

        {hovered && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {/* Move to stack button */}
            <div className="relative">
              <button
                onClick={() => setShowStackMenu((v) => !v)}
                className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                title="Move to stack"
              >
                <Layers className="w-3.5 h-3.5" />
              </button>
              {showStackMenu && (
                <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-lg py-1 min-w-32">
                  <button
                    onClick={() => { onMoveToStack(habit.id, null); setShowStackMenu(false); }}
                    className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-secondary transition-colors", habit.stack_id === null && "font-semibold")}
                  >
                    No stack
                  </button>
                  {stacks.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { onMoveToStack(habit.id, s.id); setShowStackMenu(false); }}
                      className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-secondary transition-colors flex items-center gap-2", habit.stack_id === s.id && "font-semibold")}
                    >
                      <span className={cn("w-2 h-2 rounded-full flex-shrink-0", COLOR_DOT[s.color as HabitColor] ?? "bg-emerald-500")} />
                      {s.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => onDelete(habit.id)}
              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Subtasks panel */}
      {expanded && (
        <div className="px-4 pb-3 pl-14 space-y-1.5 border-t border-border/40 pt-2 bg-secondary/10">
          {subtasks.length === 0 && subtasksLoaded && (
            <p className="text-xs text-muted-foreground italic">No sub-habits yet.</p>
          )}
          {subtasks.map((sub) => (
            <div key={sub.id} className="flex items-center gap-2 group/sub">
              <button
                onClick={() => handleToggleSubtask(sub.id)}
                className={cn(
                  "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-all",
                  sub.done ? cn(COLOR_BG_CHECKED[color] ?? "bg-emerald-500", "border-transparent") : "border-border hover:border-muted-foreground"
                )}
              >
                {sub.done && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
              </button>
              <span className={cn("text-xs flex-1", sub.done && "line-through text-muted-foreground")}>
                {sub.title}
              </span>
              <button
                onClick={() => handleDeleteSubtask(sub.id)}
                className="p-0.5 rounded opacity-0 group-hover/sub:opacity-100 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {/* Add sub-habit inline */}
          <div className="flex items-center gap-2 pt-1">
            <div className="w-4 h-4 rounded border border-dashed border-muted-foreground/30 flex-shrink-0" />
            <input
              type="text"
              value={newSubtaskTitle}
              onChange={(e) => setNewSubtaskTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddSubtask()}
              placeholder="Add sub-habit..."
              className="flex-1 text-xs bg-transparent border-none outline-none placeholder:text-muted-foreground/50"
            />
            {newSubtaskTitle.trim() && (
              <button
                onClick={handleAddSubtask}
                className="p-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                <Plus className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HabitsTab() {
  const [habits, setHabits] = useState<HabitWithCompletion[]>([]);
  const [stacks, setStacks] = useState<HabitStack[]>([]);
  const [addTitle, setAddTitle] = useState("");
  const [addColor, setAddColor] = useState<HabitColor>("emerald");
  const [addStackId, setAddStackId] = useState<number | null>(null);
  const [showStackManager, setShowStackManager] = useState(false);
  const [newStackTitle, setNewStackTitle] = useState("");
  const [newStackColor, setNewStackColor] = useState<HabitColor>("blue");

  const todayLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const load = useCallback(async () => {
    try {
      const [habitsData, stacksData] = await Promise.all([
        getHabitsForDate(TODAY),
        getHabitStacks(),
      ]);
      setHabits(habitsData);
      setStacks(stacksData);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (habitId: number) => {
    try {
      await toggleHabitCompletion(habitId, TODAY);
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const handleAdd = async () => {
    const title = addTitle.trim();
    if (!title) return;
    try {
      await createDailyHabit({ title, color: addColor, stack_id: addStackId });
      setAddTitle("");
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteDailyHabit(id);
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const handleMoveToStack = async (habitId: number, stackId: number | null) => {
    try {
      await updateDailyHabit(habitId, { stack_id: stackId });
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddStack = async () => {
    const title = newStackTitle.trim();
    if (!title) return;
    try {
      await createHabitStack({ title, color: newStackColor });
      setNewStackTitle("");
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteStack = async (id: number) => {
    try {
      await deleteHabitStack(id);
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const doneCount = habits.filter((h) => h.done).length;

  // Group habits: stacked then ungrouped
  const ungrouped = habits.filter((h) => h.stack_id === null);
  const grouped = stacks.map((s) => ({
    stack: s,
    habits: habits.filter((h) => h.stack_id === s.id),
  })).filter((g) => g.habits.length > 0);

  const habitRowProps = { onToggle: handleToggle, onDelete: handleDelete, onMoveToStack: handleMoveToStack, onSubtaskChange: load, stacks };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-rose-500" />
            <h2 className="text-lg font-semibold">Daily Habits</h2>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{todayLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {habits.length > 0 && (
            <div className="text-sm font-medium text-muted-foreground">
              {doneCount}/{habits.length} done
            </div>
          )}
          <button
            onClick={() => setShowStackManager((v) => !v)}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors",
              showStackManager ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <Layers className="w-3.5 h-3.5" />
            Stacks
          </button>
        </div>
      </div>

      {/* Stack manager */}
      {showStackManager && (
        <div className="border border-border bg-card rounded-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Manage Stacks</p>
          {stacks.length === 0 && (
            <p className="text-xs text-muted-foreground">No stacks yet.</p>
          )}
          {stacks.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <span className={cn("w-3 h-3 rounded-full flex-shrink-0", COLOR_DOT[s.color as HabitColor] ?? "bg-blue-500")} />
              <span className="text-sm flex-1">{s.title}</span>
              <span className="text-xs text-muted-foreground">{habits.filter((h) => h.stack_id === s.id).length} habits</span>
              <button
                onClick={() => handleDeleteStack(s.id)}
                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1 border-t border-border">
            <input
              type="text"
              value={newStackTitle}
              onChange={(e) => setNewStackTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddStack()}
              placeholder="New stack name..."
              className="flex-1 text-sm bg-transparent border-none outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center gap-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewStackColor(c)}
                  className={cn("w-4 h-4 rounded-full transition-transform", COLOR_DOT[c], newStackColor === c ? "scale-125 ring-2 ring-offset-1 ring-foreground/30" : "opacity-60 hover:opacity-100")}
                />
              ))}
            </div>
            <button
              onClick={handleAddStack}
              disabled={!newStackTitle.trim()}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Stacked habit groups */}
      {grouped.map(({ stack, habits: sh }) => {
        const stackDone = sh.filter((h) => h.done).length;
        const stackColor = stack.color as HabitColor;
        return (
          <div key={stack.id} className="border border-border bg-card rounded-lg overflow-hidden">
            <div className={cn("px-4 py-2 flex items-center gap-2 border-b border-border bg-secondary/30")}>
              <span className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", COLOR_DOT[stackColor] ?? "bg-blue-500")} />
              <span className="text-xs font-semibold flex-1">{stack.title}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">{stackDone}/{sh.length}</span>
            </div>
            <div className="divide-y divide-border">
              {sh.map((habit) => (
                <HabitRow key={habit.id} habit={habit} {...habitRowProps} />
              ))}
            </div>
          </div>
        );
      })}

      {/* Ungrouped habits */}
      <div className="border border-border bg-card rounded-lg divide-y divide-border">
        {ungrouped.length === 0 && grouped.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No habits yet. Add one below.
          </div>
        )}
        {ungrouped.map((habit) => (
          <HabitRow key={habit.id} habit={habit} {...habitRowProps} />
        ))}

        {/* Add habit inline form */}
        <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={addTitle}
            onChange={(e) => setAddTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="New habit..."
            className="flex-1 min-w-40 text-sm bg-transparent border-none outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setAddColor(c)}
                className={cn(
                  "w-5 h-5 rounded-full transition-transform",
                  COLOR_DOT[c],
                  addColor === c ? "scale-125 ring-2 ring-offset-1 ring-foreground/30" : "opacity-60 hover:opacity-100"
                )}
              />
            ))}
          </div>
          {stacks.length > 0 && (
            <select
              value={addStackId ?? ""}
              onChange={(e) => setAddStackId(e.target.value ? Number(e.target.value) : null)}
              className="text-xs bg-secondary border-none rounded px-1.5 py-0.5 outline-none cursor-pointer"
            >
              <option value="">No stack</option>
              {stacks.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          )}
          <button
            onClick={handleAdd}
            disabled={!addTitle.trim()}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Running Tab ───────────────────────────────────────────────────────────────

function RunningTab() {
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [plannedSessions, setPlannedSessions] = useState<TrainingSession[]>([]);
  const [date, setDate] = useState(TODAY);
  const [distance, setDistance] = useState("");
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [logsData, sessionsData, recurringData] = await Promise.all([getRunLogs(), getTrainingSessions(), getRecurringTrainingSessions()]);
      setLogs(logsData);
      // Combine one-off upcoming + recurring (show next 30 days of recurring)
      const endDate = new Date(); endDate.setDate(endDate.getDate() + 30);
      const endStr = endDate.toISOString().slice(0, 10);
      const expandedRec = recurringData
        .filter((s) => s.plan_type === "running")
        .flatMap((s) => {
          // produce one entry per occurrence in next 30 days via same expansion logic
          const results: TrainingSession[] = [];
          const cursor = new Date(Math.max(new Date(TODAY + "T00:00:00Z").getTime(), new Date((s.series_start_date ?? TODAY) + "T00:00:00Z").getTime()));
          const rangeEnd = new Date(endStr + "T00:00:00Z");
          const seriesEnd = s.series_end_date ? new Date(s.series_end_date + "T00:00:00Z") : null;
          const dows = s.days_of_week ? s.days_of_week.split(",").map(Number) : [];
          while (cursor <= rangeEnd && (!seriesEnd || cursor <= seriesEnd) && results.length < 4) {
            const dow = cursor.getUTCDay();
            if (s.recurrence === "daily" || (s.recurrence === "weekly" && dows.includes(dow))) {
              results.push({ ...s, scheduled_date: cursor.toISOString().slice(0, 10) });
            }
            cursor.setUTCDate(cursor.getUTCDate() + 1);
          }
          return results;
        });
      setPlannedSessions([
        ...sessionsData.filter((s) => s.plan_type === "running" && !s.completed && s.scheduled_date && s.scheduled_date >= TODAY),
        ...expandedRec,
      ].sort((a, b) => (a.scheduled_date ?? "").localeCompare(b.scheduled_date ?? "")));
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!date) return;
    try {
      await createRunLog({
        date,
        distance_km: distance ? parseFloat(distance) : null,
        duration_min: duration ? parseInt(duration) : null,
        notes: notes.trim() || null,
      });
      setDistance("");
      setDuration("");
      setNotes("");
      setDate(TODAY);
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteRunLog(id);
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  // Stats
  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonthLogs = logs.filter((l) => l.date.startsWith(monthStr));
  const totalKmMonth = thisMonthLogs.reduce((s, l) => s + (l.distance_km ?? 0), 0);
  const longestRun = logs.reduce((max, l) => Math.max(max, l.distance_km ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Footprints className="w-5 h-5 text-emerald-500" />
        <h2 className="text-lg font-semibold">Running</h2>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: <TrendingUp className="w-4 h-4 text-emerald-500" />, label: "Total Runs", value: logs.length.toString() },
          { icon: <Ruler className="w-4 h-4 text-emerald-500" />, label: "This Month", value: `${totalKmMonth.toFixed(1)} km` },
          { icon: <Flame className="w-4 h-4 text-emerald-500" />, label: "Longest Run", value: longestRun > 0 ? `${longestRun.toFixed(1)} km` : "—" },
        ].map((stat) => (
          <div key={stat.label} className="border border-border bg-card rounded-lg px-4 py-3 flex items-center gap-3">
            {stat.icon}
            <div>
              <div className="text-xs text-muted-foreground">{stat.label}</div>
              <div className="text-base font-semibold">{stat.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Log Run form */}
      <div className="border border-border bg-card rounded-lg p-4 space-y-3">
        <div className="text-sm font-medium text-muted-foreground">Log Run</div>
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="text-sm bg-transparent border-none outline-none"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Ruler className="w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="number"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              placeholder="Distance (km)"
              className="w-32 text-sm bg-input border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Timer className="w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="Duration (min)"
              className="w-32 text-sm bg-input border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="flex-1 min-w-40 text-sm bg-input border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={handleAdd}
            disabled={!date}
            className="flex items-center gap-1 px-3 py-1 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-40 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Log
          </button>
        </div>
      </div>

      {/* Run list */}
      <div className="border border-border bg-card rounded-lg divide-y divide-border">
        {logs.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No runs logged yet.</div>
        )}
        {logs.map((log) => (
          <div
            key={log.id}
            className="px-4 py-3 flex items-start gap-3 group"
            onMouseEnter={() => setHoveredId(log.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <Footprints className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{formatDate(log.date)}</span>
                {log.distance_km !== null && (
                  <span className="px-2 py-0.5 text-xs bg-emerald-500/15 text-emerald-600 rounded-full font-medium">
                    {log.distance_km.toFixed(2)} km
                  </span>
                )}
                {log.duration_min !== null && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Timer className="w-3 h-3" />
                    {log.duration_min} min
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {formatPace(log.distance_km, log.duration_min)}
                </span>
              </div>
              {log.notes && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.notes}</p>
              )}
            </div>
            {hoveredId === log.id && (
              <button
                onClick={() => handleDelete(log.id)}
                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive flex-shrink-0 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      <UpcomingSessionsPreview sessions={plannedSessions} onToggle={async (id) => { await toggleTrainingSession(id); await load(); }} />
    </div>
  );
}

// ── Strength Tab ──────────────────────────────────────────────────────────────

function UpcomingSessionsPreview({ sessions, onToggle }: { sessions: TrainingSession[]; onToggle: (id: number) => void }) {
  if (sessions.length === 0) return null;
  return (
    <div className="border border-border bg-card rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center gap-2">
        <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Planned Sessions</span>
      </div>
      <div className="divide-y divide-border">
        {sessions.map((s) => {
          const pt = planTypeInfo(s.plan_type);
          return (
            <div key={s.id} className="px-4 py-2.5 flex items-center gap-3 group">
              <button
                onClick={() => onToggle(s.id)}
                className="w-4 h-4 rounded-full border-2 border-border flex items-center justify-center flex-shrink-0 hover:border-emerald-400 transition-colors"
              />
              <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium flex-shrink-0", pt.accent)}>
                {s.scheduled_date === TODAY ? "Today" : s.scheduled_date ?? "—"}
              </span>
              <span className="text-sm flex-1 truncate">{s.title}</span>
              {s.start_time && <span className="text-xs text-muted-foreground flex-shrink-0">{s.start_time.slice(0, 5)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StrengthTab() {
  const [workouts, setWorkouts] = useState<WorkoutLog[]>([]);
  const [plannedSessions, setPlannedSessions] = useState<TrainingSession[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newDate, setNewDate] = useState(TODAY);
  const [newName, setNewName] = useState("Workout");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [exForms, setExForms] = useState<Record<number, { name: string; sets: string; reps: string; weight: string }>>({});

  const load = useCallback(async () => {
    try {
      const [workoutsData, sessionsData, recurringData] = await Promise.all([getWorkoutLogs(), getTrainingSessions(), getRecurringTrainingSessions()]);
      setWorkouts(workoutsData);
      const endDate = new Date(); endDate.setDate(endDate.getDate() + 30);
      const endStr = endDate.toISOString().slice(0, 10);
      const expandedRec = recurringData
        .filter((s) => s.plan_type === "strength")
        .flatMap((s) => {
          const results: TrainingSession[] = [];
          const cursor = new Date(Math.max(new Date(TODAY + "T00:00:00Z").getTime(), new Date((s.series_start_date ?? TODAY) + "T00:00:00Z").getTime()));
          const rangeEnd = new Date(endStr + "T00:00:00Z");
          const seriesEnd = s.series_end_date ? new Date(s.series_end_date + "T00:00:00Z") : null;
          const dows = s.days_of_week ? s.days_of_week.split(",").map(Number) : [];
          while (cursor <= rangeEnd && (!seriesEnd || cursor <= seriesEnd) && results.length < 4) {
            const dow = cursor.getUTCDay();
            if (s.recurrence === "daily" || (s.recurrence === "weekly" && dows.includes(dow))) {
              results.push({ ...s, scheduled_date: cursor.toISOString().slice(0, 10) });
            }
            cursor.setUTCDate(cursor.getUTCDate() + 1);
          }
          return results;
        });
      setPlannedSessions([
        ...sessionsData.filter((s) => s.plan_type === "strength" && !s.completed && s.scheduled_date && s.scheduled_date >= TODAY),
        ...expandedRec,
      ].sort((a, b) => (a.scheduled_date ?? "").localeCompare(b.scheduled_date ?? "")));
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreateWorkout = async () => {
    if (!newDate || !newName.trim()) return;
    try {
      const w = await createWorkoutLog({ date: newDate, name: newName.trim(), notes: null });
      setShowForm(false);
      setNewDate(TODAY);
      setNewName("Workout");
      setExpandedId(w.id);
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteWorkout = async (id: number) => {
    try {
      await deleteWorkoutLog(id);
      if (expandedId === id) setExpandedId(null);
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const getExForm = (workoutId: number) =>
    exForms[workoutId] ?? { name: "", sets: "", reps: "", weight: "" };

  const setExForm = (workoutId: number, patch: Partial<{ name: string; sets: string; reps: string; weight: string }>) => {
    setExForms((prev) => ({ ...prev, [workoutId]: { ...getExForm(workoutId), ...patch } }));
  };

  const handleAddExercise = async (workoutId: number) => {
    const form = getExForm(workoutId);
    if (!form.name.trim()) return;
    try {
      await addWorkoutExercise({
        workout_id: workoutId,
        name: form.name.trim(),
        sets: form.sets ? parseInt(form.sets) : null,
        reps: form.reps ? parseInt(form.reps) : null,
        weight_kg: form.weight ? parseFloat(form.weight) : null,
        notes: null,
      });
      setExForms((prev) => ({ ...prev, [workoutId]: { name: "", sets: "", reps: "", weight: "" } }));
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteExercise = async (exId: number, workoutId: number) => {
    try {
      await deleteWorkoutExercise(exId, workoutId);
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Dumbbell className="w-5 h-5 text-orange-500" />
          <h2 className="text-lg font-semibold">Strength Training</h2>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Log Workout
        </button>
      </div>

      {showForm && (
        <div className="border border-border bg-card rounded-lg p-4 space-y-3">
          <div className="text-sm font-medium text-muted-foreground">New Workout</div>
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="text-sm bg-transparent border-none outline-none"
              />
            </div>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Workout name"
              className="flex-1 min-w-40 text-sm bg-input border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={handleCreateWorkout}
              disabled={!newDate || !newName.trim()}
              className="flex items-center gap-1 px-3 py-1 text-sm bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-40 transition-colors"
            >
              <Check className="w-4 h-4" />
              Create
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-1 text-sm border border-border rounded hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {workouts.length === 0 && (
          <div className="border border-border bg-card rounded-lg px-4 py-8 text-center text-sm text-muted-foreground">
            No workouts logged yet. Click "Log Workout" to get started.
          </div>
        )}
        {workouts.map((workout) => {
          const isOpen = expandedId === workout.id;
          const form = getExForm(workout.id);
          return (
            <div key={workout.id} className="border border-border bg-card rounded-lg overflow-hidden">
              <div
                className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setExpandedId(isOpen ? null : workout.id)}
              >
                {isOpen ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <Dumbbell className="w-4 h-4 text-orange-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{workout.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">{formatDate(workout.date)}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {workout.exercises.length} exercise{workout.exercises.length !== 1 ? "s" : ""}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteWorkout(workout.id); }}
                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {isOpen && (
                <div className="border-t border-border">
                  {workout.exercises.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/30">
                            <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Exercise</th>
                            <th className="text-center px-3 py-2 text-xs font-medium text-muted-foreground">Sets</th>
                            <th className="text-center px-3 py-2 text-xs font-medium text-muted-foreground">Reps</th>
                            <th className="text-center px-3 py-2 text-xs font-medium text-muted-foreground">Weight</th>
                            <th className="w-8 px-2 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {workout.exercises.map((ex) => (
                            <tr key={ex.id} className="border-b border-border last:border-0 group hover:bg-muted/30">
                              <td className="px-4 py-2 font-medium">{ex.name}</td>
                              <td className="px-3 py-2 text-center text-muted-foreground">{ex.sets ?? "—"}</td>
                              <td className="px-3 py-2 text-center text-muted-foreground">{ex.reps ?? "—"}</td>
                              <td className="px-3 py-2 text-center text-muted-foreground">
                                {ex.weight_kg !== null ? `${ex.weight_kg} kg` : "—"}
                              </td>
                              <td className="px-2 py-2">
                                <button
                                  onClick={() => handleDeleteExercise(ex.id, workout.id)}
                                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Add exercise form */}
                  <div className="px-4 py-3 flex flex-wrap gap-2 items-center bg-muted/20 border-t border-border">
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setExForm(workout.id, { name: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && handleAddExercise(workout.id)}
                      placeholder="Exercise name"
                      className="flex-1 min-w-32 text-sm bg-input border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
                    />
                    <input
                      type="number"
                      value={form.sets}
                      onChange={(e) => setExForm(workout.id, { sets: e.target.value })}
                      placeholder="Sets"
                      className="w-16 text-sm bg-input border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring text-center"
                    />
                    <input
                      type="number"
                      value={form.reps}
                      onChange={(e) => setExForm(workout.id, { reps: e.target.value })}
                      placeholder="Reps"
                      className="w-16 text-sm bg-input border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring text-center"
                    />
                    <input
                      type="number"
                      value={form.weight}
                      onChange={(e) => setExForm(workout.id, { weight: e.target.value })}
                      placeholder="kg"
                      className="w-16 text-sm bg-input border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring text-center"
                    />
                    <button
                      onClick={() => handleAddExercise(workout.id)}
                      disabled={!form.name.trim()}
                      className="flex items-center gap-1 px-2 py-1 text-xs bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-40 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <UpcomingSessionsPreview sessions={plannedSessions} onToggle={async (id) => { await toggleTrainingSession(id); await load(); }} />
    </div>
  );
}

// ── Training Tab ──────────────────────────────────────────────────────────────

type TrainingSubTab = "plans" | "performance";

function TrainingTab() {
  const [subTab, setSubTab] = useState<TrainingSubTab>("plans");
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);

  const loadPlans = useCallback(async () => {
    try { setPlans(await getTrainingPlans()); } catch (e) { console.error(e); }
  }, []);

  const loadSessions = useCallback(async () => {
    try { setSessions(await getTrainingSessions()); } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { loadPlans(); loadSessions(); }, [loadPlans, loadSessions]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Dumbbell className="w-5 h-5 text-violet-500" />
          <h2 className="text-lg font-semibold">Training</h2>
        </div>
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
          {([
            { id: "plans" as const,       label: "Plans",       icon: <Dumbbell  className="w-3.5 h-3.5" /> },
            { id: "performance" as const, label: "Performance", icon: <BarChart2 className="w-3.5 h-3.5" /> },
          ]).map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setSubTab(id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                subTab === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {icon}{label}
            </button>
          ))}
        </div>
      </div>

      {subTab === "plans" && (
        <PlansSection plans={plans} onRefresh={loadPlans} />
      )}
      {subTab === "performance" && (
        <PerformanceSection plans={plans} sessions={sessions} />
      )}
    </div>
  );
}

// ── Plan Card List (with session scheduler + recurrence) ─────────────────────

const DOW_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

type SessionDraft = {
  title: string;
  isRecurring: boolean;
  recurrence: "daily" | "weekly";
  daysOfWeek: number[];
  seriesStart: string;
  seriesEnd: string;
  date: string;
  startTime: string;
  endTime: string;
};

function defaultDraft(planTitle: string): SessionDraft {
  return {
    title: planTitle,
    isRecurring: false,
    recurrence: "weekly",
    daysOfWeek: [],
    seriesStart: TODAY,
    seriesEnd: "",
    date: TODAY,
    startTime: "",
    endTime: "",
  };
}

function SessionSchedulerForm({
  draft, onChange, onSave, onCancel,
}: {
  planId?: number;
  draft: SessionDraft;
  onChange: (d: SessionDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const inputCls = "text-sm bg-input border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring";
  const toggleDow = (d: number) =>
    onChange({ ...draft, daysOfWeek: draft.daysOfWeek.includes(d) ? draft.daysOfWeek.filter((x) => x !== d) : [...draft.daysOfWeek, d].sort() });

  return (
    <div className="px-4 py-3 bg-muted/30 border-t border-border space-y-3">
      {/* Title */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Session name</span>
        <input autoFocus type="text" value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && onSave()}
          className={inputCls} />
      </div>

      {/* Recurring toggle */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => onChange({ ...draft, isRecurring: false })}
          className={cn("px-3 py-1 rounded-full text-xs font-medium border transition-colors",
            !draft.isRecurring ? "bg-emerald-600 text-white border-emerald-600" : "border-border text-muted-foreground hover:bg-muted")}
        >One-off</button>
        <button
          onClick={() => onChange({ ...draft, isRecurring: true })}
          className={cn("px-3 py-1 rounded-full text-xs font-medium border transition-colors",
            draft.isRecurring ? "bg-violet-600 text-white border-violet-600" : "border-border text-muted-foreground hover:bg-muted")}
        >Recurring</button>
      </div>

      {!draft.isRecurring ? (
        /* One-off: date + times */
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Date</span>
            <input type="date" value={draft.date} onChange={(e) => onChange({ ...draft, date: e.target.value })} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Start</span>
            <input type="time" value={draft.startTime} onChange={(e) => onChange({ ...draft, startTime: e.target.value })} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">End</span>
            <input type="time" value={draft.endTime} onChange={(e) => onChange({ ...draft, endTime: e.target.value })} className={inputCls} />
          </div>
        </div>
      ) : (
        /* Recurring: pattern + days + series range + times */
        <div className="space-y-2">
          {/* Recurrence type */}
          <div className="flex gap-2">
            {(["daily", "weekly"] as const).map((r) => (
              <button key={r} onClick={() => onChange({ ...draft, recurrence: r })}
                className={cn("px-3 py-1 rounded text-xs font-medium border transition-colors capitalize",
                  draft.recurrence === r ? "bg-violet-600/20 border-violet-500/50 text-violet-700 dark:text-violet-300" : "border-border text-muted-foreground hover:bg-muted")}>
                {r}
              </button>
            ))}
          </div>

          {/* Day of week picker (weekly only) */}
          {draft.recurrence === "weekly" && (
            <div className="flex gap-1 flex-wrap">
              {DOW_LABELS.map((label, i) => (
                <button key={i} onClick={() => toggleDow(i)}
                  className={cn("w-8 h-8 rounded-full text-xs font-semibold border transition-colors",
                    draft.daysOfWeek.includes(i)
                      ? "bg-violet-600 text-white border-violet-600"
                      : "border-border text-muted-foreground hover:bg-muted")}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Series start/end + times */}
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Series start</span>
              <input type="date" value={draft.seriesStart} onChange={(e) => onChange({ ...draft, seriesStart: e.target.value })} className={inputCls} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Series end</span>
              <input type="date" value={draft.seriesEnd} onChange={(e) => onChange({ ...draft, seriesEnd: e.target.value })} className={inputCls}
                placeholder="No end" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Start time</span>
              <input type="time" value={draft.startTime} onChange={(e) => onChange({ ...draft, startTime: e.target.value })} className={inputCls} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">End time</span>
              <input type="time" value={draft.endTime} onChange={(e) => onChange({ ...draft, endTime: e.target.value })} className={inputCls} />
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-1.5">
        <button onClick={onSave} disabled={!draft.title.trim() || (draft.isRecurring && draft.recurrence === "weekly" && draft.daysOfWeek.length === 0)}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-40 transition-colors">
          <Check className="w-3 h-3" /> Schedule
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-xs border border-border rounded hover:bg-muted transition-colors">Cancel</button>
      </div>
    </div>
  );
}

// Upcoming sessions list embedded under each plan card
function PlanSessions({
  sessions, recurringSessions, onDelete, onDeleteSeries,
}: {
  plan?: TrainingPlan;
  sessions: TrainingSession[];
  recurringSessions: TrainingSession[];
  onDelete: (id: number) => void;
  onDeleteSeries: (id: number) => void;
}) {
  if (sessions.length === 0 && recurringSessions.length === 0) return null;
  return (
    <div className="border-t border-border bg-muted/10 divide-y divide-border/50">
      {/* One-off upcoming */}
      {sessions.map((s) => (
        <div key={s.id} className="px-4 py-2 flex items-center gap-2 group text-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-500/60 flex-shrink-0" />
          <span className="flex-1 truncate text-foreground">{s.title}</span>
          <span className="text-muted-foreground flex-shrink-0">
            {s.scheduled_date === TODAY ? "Today" : s.scheduled_date}
          </span>
          {s.start_time && <span className="text-muted-foreground flex-shrink-0">{s.start_time.slice(0,5)}</span>}
          <button onClick={() => onDelete(s.id)}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all">
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      {/* Recurring series */}
      {recurringSessions.map((s) => {
        const dow = s.days_of_week ? s.days_of_week.split(",").map((d) => DOW_LABELS[Number(d)]).join(" · ") : null;
        return (
          <div key={s.id} className="px-4 py-2 flex items-center gap-2 group text-xs">
            <span className="w-2 h-2 rounded-full bg-violet-500/60 flex-shrink-0" />
            <span className="flex-1 truncate text-foreground">{s.title}</span>
            <span className="text-muted-foreground flex-shrink-0 flex items-center gap-1">
              <span className={cn("px-1.5 py-0.5 rounded border text-[10px] font-medium",
                "bg-violet-500/10 border-violet-500/30 text-violet-700 dark:text-violet-300")}>
                {s.recurrence === "daily" ? "Daily" : dow ?? "Weekly"}
              </span>
              {s.start_time && <span>{s.start_time.slice(0,5)}</span>}
            </span>
            <button onClick={() => onDeleteSeries(s.id)}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
              title="Delete entire series">
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function PlanCardList({
  plans, sessions, recurringSessions, onEdit, onDelete, onRefresh,
}: {
  plans: TrainingPlan[];
  sessions: TrainingSession[];
  recurringSessions: TrainingSession[];
  onEdit: (p: TrainingPlan) => void;
  onDelete: (id: number) => void;
  onRefresh: () => void;
}) {
  const [schedulingId, setSchedulingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<SessionDraft>(defaultDraft(""));

  const openScheduler = (plan: TrainingPlan) => {
    setSchedulingId(plan.id);
    setDraft(defaultDraft(plan.title));
  };

  const handleSave = async (planId: number) => {
    const title = draft.title.trim();
    if (!title) return;
    try {
      if (draft.isRecurring) {
        await createTrainingSession({
          plan_id: planId, title,
          is_recurring: true,
          recurrence: draft.recurrence,
          days_of_week: draft.recurrence === "weekly" ? draft.daysOfWeek.join(",") : null,
          series_start_date: draft.seriesStart || TODAY,
          series_end_date: draft.seriesEnd || null,
          start_time: draft.startTime || null,
          end_time: draft.endTime || null,
          scheduled_date: null,
        });
      } else {
        await createTrainingSession({
          plan_id: planId, title,
          is_recurring: false,
          scheduled_date: draft.date || TODAY,
          start_time: draft.startTime || null,
          end_time: draft.endTime || null,
        });
      }
      setSchedulingId(null);
      onRefresh();
    } catch (e) { console.error(e); }
  };

  const handleDeleteSession = async (id: number) => {
    try { await deleteTrainingSession(id); onRefresh(); } catch (e) { console.error(e); }
  };

  const handleDeleteSeries = async (id: number) => {
    try { await deleteTrainingSessionSeries(id); onRefresh(); } catch (e) { console.error(e); }
  };

  return (
    <div className="border border-border bg-card rounded-lg divide-y divide-border">
      {plans.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          No training plans yet. Create one to get started.
        </div>
      )}
      {plans.map((plan) => {
        const c = plan.color as HabitColor;
        const pt = planTypeInfo(plan.plan_type);
        const isScheduling = schedulingId === plan.id;
        const planSessions = sessions.filter((s) => s.plan_id === plan.id && !s.completed && s.scheduled_date && s.scheduled_date >= TODAY);
        const planRecurring = recurringSessions.filter((s) => s.plan_id === plan.id);
        return (
          <div key={plan.id}>
            <div className="px-4 py-3 flex items-center gap-3 group">
              <span className={cn("w-3 h-3 rounded-full flex-shrink-0", COLOR_DOT[c] ?? "bg-violet-500")} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{plan.title}</span>
                  <span className={cn("flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium flex-shrink-0", pt.accent)}>
                    {pt.icon}{pt.label}
                  </span>
                  {(planSessions.length + planRecurring.length) > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      {planSessions.length + planRecurring.length} session{planSessions.length + planRecurring.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                {(plan.goal || plan.days_per_week) && (
                  <div className="flex items-center gap-1 mt-0.5">
                    {plan.goal && <span className="text-xs text-muted-foreground">{plan.goal}</span>}
                    {plan.days_per_week && <span className="text-xs text-muted-foreground">· {plan.days_per_week}×/week</span>}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => isScheduling ? setSchedulingId(null) : openScheduler(plan)}
                  title="Schedule a session"
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-emerald-600 transition-colors">
                  <CalendarPlus className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onEdit(plan)}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onDelete(plan.id)}
                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Inline session list */}
            <PlanSessions
              plan={plan}
              sessions={planSessions}
              recurringSessions={planRecurring}
              onDelete={handleDeleteSession}
              onDeleteSeries={handleDeleteSeries}
            />

            {/* Schedule form */}
            {isScheduling && (
              <SessionSchedulerForm
                planId={plan.id}
                draft={draft}
                onChange={setDraft}
                onSave={() => handleSave(plan.id)}
                onCancel={() => setSchedulingId(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Plans Section ─────────────────────────────────────────────────────────────

function PlansSection({ plans, onRefresh }: { plans: TrainingPlan[]; onRefresh: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TrainingPlan | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<HabitColor>("violet");
  const [goal, setGoal] = useState("");
  const [daysPerWeek, setDaysPerWeek] = useState("");
  const [planType, setPlanType] = useState<PlanType>("other");
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [recurringSessions, setRecurringSessions] = useState<TrainingSession[]>([]);

  const loadSessions = useCallback(async () => {
    try {
      const [one, rec] = await Promise.all([getTrainingSessions(), getRecurringTrainingSessions()]);
      setSessions(one);
      setRecurringSessions(rec);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const handleRefresh = useCallback(() => { onRefresh(); loadSessions(); }, [onRefresh, loadSessions]);

  const resetForm = () => {
    setTitle(""); setDescription(""); setColor("violet");
    setGoal(""); setDaysPerWeek(""); setPlanType("other"); setEditing(null); setShowForm(false);
  };

  const openEdit = (p: TrainingPlan) => {
    setEditing(p);
    setTitle(p.title);
    setDescription(p.description ?? "");
    setColor((p.color as HabitColor) ?? "violet");
    setGoal(p.goal ?? "");
    setDaysPerWeek(p.days_per_week?.toString() ?? "");
    setPlanType(p.plan_type ?? "other");
    setShowForm(true);
  };

  const handleSave = async () => {
    const t = title.trim();
    if (!t) return;
    const payload = {
      title: t,
      description: description.trim() || null,
      color,
      goal: goal.trim() || null,
      days_per_week: daysPerWeek ? parseInt(daysPerWeek) : null,
      plan_type: planType,
    };
    try {
      if (editing) {
        await updateTrainingPlan(editing.id, payload);
      } else {
        await createTrainingPlan(payload);
      }
      resetForm();
      handleRefresh();
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (id: number) => {
    try { await deleteTrainingPlan(id); handleRefresh(); } catch (e) { console.error(e); }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-violet-600 text-white rounded hover:bg-violet-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Plan
        </button>
      </div>

      {showForm && (
        <div className="border border-border bg-card rounded-lg p-4 space-y-3">
          <div className="text-sm font-medium text-muted-foreground">
            {editing ? "Edit Plan" : "New Training Plan"}
          </div>
          <div className="space-y-2">
            {/* Plan type selector */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {PLAN_TYPES.map((pt) => (
                <button
                  key={pt.id}
                  onClick={() => setPlanType(pt.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
                    planType === pt.id ? pt.accent : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  {pt.icon}{pt.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Plan title *"
              className="w-full text-sm bg-input border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              className="w-full text-sm bg-input border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Goal (e.g. Run 5K, Lose 5kg)"
              className="w-full text-sm bg-input border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={cn(
                      "w-5 h-5 rounded-full transition-transform",
                      COLOR_DOT[c],
                      color === c ? "scale-125 ring-2 ring-offset-1 ring-foreground/30" : "opacity-60 hover:opacity-100"
                    )}
                  />
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Days/week:</span>
                <select
                  value={daysPerWeek}
                  onChange={(e) => setDaysPerWeek(e.target.value)}
                  className="text-sm bg-input border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">—</option>
                  {[1,2,3,4,5,6,7].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={!title.trim()}
              className="flex items-center gap-1 px-3 py-1 text-sm bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-40 transition-colors"
            >
              <Check className="w-4 h-4" /> {editing ? "Save" : "Create"}
            </button>
            <button
              onClick={resetForm}
              className="px-3 py-1 text-sm border border-border rounded hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <PlanCardList plans={plans} sessions={sessions} recurringSessions={recurringSessions} onEdit={openEdit} onDelete={handleDelete} onRefresh={handleRefresh} />
    </div>
  );
}

// ── Performance Section ───────────────────────────────────────────────────────

function PerformanceSection({
  plans,
  sessions,
}: {
  plans: TrainingPlan[];
  sessions: TrainingSession[];
}) {
  const completedSessions = sessions.filter((s) => s.completed);
  const planMap = new Map(plans.map((p) => [p.id, p]));

  return (
    <div className="space-y-3">
      {completedSessions.length === 0 && (
        <div className="border border-border bg-card rounded-lg px-4 py-8 text-center text-sm text-muted-foreground">
          No completed sessions yet. Mark sessions as complete to log performance.
        </div>
      )}
      {completedSessions.map((s) => (
        <PerformanceCard key={s.id} session={s} planMap={planMap} />
      ))}
    </div>
  );
}

function PerformanceCard({
  session,
  planMap,
}: {
  session: TrainingSession;
  planMap: Map<number, TrainingPlan>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [metrics, setMetrics] = useState<SessionPerformance[] | null>(null);
  const [metricName, setMetricName] = useState("");
  const [metricValue, setMetricValue] = useState("");
  const [metricUnit, setMetricUnit] = useState("");

  const load = useCallback(async () => {
    try {
      setMetrics(await getSessionPerformance(session.id));
    } catch (e) { console.error(e); }
  }, [session.id]);

  const handleExpand = () => {
    setExpanded((v) => !v);
    if (metrics === null) load();
  };

  const handleAdd = async () => {
    if (!metricName.trim() || !metricValue.trim()) return;
    try {
      await addSessionPerformance({
        session_id: session.id,
        metric_name: metricName.trim(),
        value: metricValue.trim(),
        unit: metricUnit.trim() || null,
      });
      setMetricName(""); setMetricValue(""); setMetricUnit("");
      load();
    } catch (e) { console.error(e); }
  };

  const handleDeleteMetric = async (id: number) => {
    try { await deleteSessionPerformance(id); load(); } catch (e) { console.error(e); }
  };

  const plan = session.plan_id ? planMap.get(session.plan_id) : null;
  const planColor = (plan?.color ?? "slate") as HabitColor;

  return (
    <div className="border border-border bg-card rounded-lg overflow-hidden">
      <div
        className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={handleExpand}
      >
        {expanded
          ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        }
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium">{session.title}</span>
          {plan && (
            <span className={cn("ml-2 px-1.5 py-0.5 text-xs rounded-full font-medium", COLOR_BADGE[planColor] ?? COLOR_BADGE.slate)}>
              {plan.title}
            </span>
          )}
          {session.scheduled_date && (
            <span className="ml-2 text-xs text-muted-foreground">{formatDate(session.scheduled_date)}</span>
          )}
        </div>
        {metrics !== null && (
          <span className="text-xs text-muted-foreground">{metrics.length} metric{metrics.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      {expanded && (
        <div className="border-t border-border">
          {metrics !== null && metrics.length > 0 && (
            <div className="divide-y divide-border">
              {metrics.map((m) => (
                <div key={m.id} className="px-4 py-2 flex items-center gap-3 group hover:bg-muted/30">
                  <span className="flex-1 text-sm font-medium">{m.metric_name}</span>
                  <span className="text-sm text-muted-foreground">{m.value}{m.unit ? ` ${m.unit}` : ""}</span>
                  <button
                    onClick={() => handleDeleteMetric(m.id)}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {metrics !== null && metrics.length === 0 && (
            <div className="px-4 py-3 text-sm text-muted-foreground">No metrics yet. Add one below.</div>
          )}

          <div className="px-4 py-3 flex flex-wrap gap-2 items-center bg-muted/20 border-t border-border">
            <input
              type="text"
              value={metricName}
              onChange={(e) => setMetricName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="Metric (e.g. Distance)"
              className="flex-1 min-w-28 text-sm bg-input border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              type="text"
              value={metricValue}
              onChange={(e) => setMetricValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="Value"
              className="w-24 text-sm bg-input border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              type="text"
              value={metricUnit}
              onChange={(e) => setMetricUnit(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="Unit"
              className="w-20 text-sm bg-input border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={handleAdd}
              disabled={!metricName.trim() || !metricValue.trim()}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-40 transition-colors"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Lifestyle Header ──────────────────────────────────────────────────────────

function LifestyleHeader() {
  const [habits, setHabits] = useState<HabitWithCompletion[]>([]);
  const [runLogs, setRunLogs] = useState<RunLog[]>([]);
  const [lastWorkout, setLastWorkout] = useState<WorkoutLog | null>(null);
  const [upcomingCount, setUpcomingCount] = useState(0);

  useEffect(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

    const endOfWeek = new Date();
    endOfWeek.setDate(endOfWeek.getDate() + (6 - endOfWeek.getDay()));
    const endOfWeekStr = endOfWeek.toISOString().slice(0, 10);

    Promise.all([
      getHabitsForDate(TODAY),
      getRunLogs(),
      getWorkoutLogs(),
      getTrainingSessions(),
    ]).then(([h, r, w, s]) => {
      setHabits(h);
      setRunLogs(r.filter((l: RunLog) => l.date >= sevenDaysAgoStr));
      setLastWorkout(w[0] ?? null);
      setUpcomingCount(
        s.filter((x: TrainingSession) => !x.completed && x.scheduled_date && x.scheduled_date >= TODAY && x.scheduled_date <= endOfWeekStr).length
      );
    }).catch(console.error);
  }, []);

  const doneHabits = habits.filter((h) => h.done).length;
  const totalHabits = habits.length;
  const weekKm = runLogs.reduce((s, r) => s + (r.distance_km ?? 0), 0);

  const stats = [
    {
      icon: <Zap className="w-3.5 h-3.5 text-amber-500" />,
      label: "Habits",
      value: totalHabits > 0 ? `${doneHabits}/${totalHabits}` : "—",
      sub: totalHabits > 0 ? `${Math.round((doneHabits / totalHabits) * 100)}%` : undefined,
    },
    {
      icon: <Activity className="w-3.5 h-3.5 text-emerald-500" />,
      label: "This week",
      value: `${weekKm.toFixed(1)} km`,
      sub: `${runLogs.length} run${runLogs.length !== 1 ? "s" : ""}`,
    },
    {
      icon: <Dumbbell className="w-3.5 h-3.5 text-orange-500" />,
      label: "Last workout",
      value: lastWorkout ? lastWorkout.name : "—",
      sub: lastWorkout ? formatDate(lastWorkout.date) : undefined,
    },
    {
      icon: <Target className="w-3.5 h-3.5 text-violet-500" />,
      label: "Sessions",
      value: upcomingCount > 0 ? `${upcomingCount} upcoming` : "None this week",
      sub: undefined,
    },
  ];

  return (
    <div className="flex items-center gap-2 px-5 py-3 border-b border-border flex-shrink-0 bg-card/50">
      <div className="flex items-center gap-2 mr-4 flex-shrink-0">
        <Flame className="w-5 h-5 text-orange-500" />
        <span className="text-base font-bold">Lifestyle</span>
      </div>
      <div className="flex items-center gap-1 flex-1 overflow-x-auto">
        {stats.map((s, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/40 border border-border flex-shrink-0">
            {s.icon}
            <div className="leading-tight">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide block">{s.label}</span>
              <span className="text-xs font-semibold">{s.value}</span>
              {s.sub && <span className="text-[10px] text-muted-foreground ml-1">{s.sub}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function Lifestyle() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <LifestyleHeader />

      {/* 3-column body */}
      <div className="flex flex-1 min-h-0 overflow-hidden gap-px bg-border">
        {/* Left column: Strength (top) + Running (bottom) */}
        <div className="flex flex-col w-[38%] min-w-0 bg-background">
          <div className="flex-1 min-h-0 overflow-y-auto p-4 border-b border-border">
            <StrengthTab />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            <RunningTab />
          </div>
        </div>

        {/* Middle column: Habits */}
        <div className="w-[25%] min-w-0 overflow-y-auto p-4 bg-background">
          <HabitsTab />
        </div>

        {/* Right column: Training */}
        <div className="flex-1 min-w-0 overflow-y-auto bg-background">
          <div className="p-4">
            <TrainingTab />
          </div>
        </div>
      </div>
    </div>
  );
}
