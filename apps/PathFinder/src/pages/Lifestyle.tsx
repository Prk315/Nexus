import { useEffect, useState, useCallback } from "react";
import {
  Heart, Plus, X, Check, Trash2, ChevronDown, ChevronRight,
  Dumbbell, Footprints, Flame, Timer, Ruler, Calendar, TrendingUp, Zap,
  CalendarDays, BarChart2, Pencil, LayoutDashboard, Activity, Target,
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
  createTrainingSession,
  toggleTrainingSession,
  deleteTrainingSession,
  getSessionPerformance,
  addSessionPerformance,
  deleteSessionPerformance,
} from "../lib/api";
import type { HabitWithCompletion, HabitStack, RunLog, WorkoutLog, TrainingPlan, TrainingSession, SessionPerformance } from "../types";
import { cn } from "../lib/utils";

type Tab = "overview" | "habits" | "running" | "strength" | "training";

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
  stacks,
}: {
  habit: HabitWithCompletion;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onMoveToStack: (id: number, stackId: number | null) => void;
  stacks: HabitStack[];
}) {
  const [hovered, setHovered] = useState(false);
  const [showStackMenu, setShowStackMenu] = useState(false);
  const color = habit.color as HabitColor;
  const weekDots = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(TODAY + "T00:00:00");
    d.setDate(d.getDate() - i);
    return habit.recent_dates.includes(d.toISOString().slice(0, 10));
  });

  return (
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

  const habitRowProps = { onToggle: handleToggle, onDelete: handleDelete, onMoveToStack: handleMoveToStack, stacks };

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
  const [date, setDate] = useState(TODAY);
  const [distance, setDistance] = useState("");
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setLogs(await getRunLogs());
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
    </div>
  );
}

// ── Strength Tab ──────────────────────────────────────────────────────────────

function StrengthTab() {
  const [workouts, setWorkouts] = useState<WorkoutLog[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newDate, setNewDate] = useState(TODAY);
  const [newName, setNewName] = useState("Workout");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [exForms, setExForms] = useState<Record<number, { name: string; sets: string; reps: string; weight: string }>>({});

  const load = useCallback(async () => {
    try {
      setWorkouts(await getWorkoutLogs());
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
    </div>
  );
}

// ── Training Tab ──────────────────────────────────────────────────────────────

type TrainingSubTab = "plans" | "schedule" | "performance";

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
            { id: "plans" as const, label: "Plans", icon: <Dumbbell className="w-3.5 h-3.5" /> },
            { id: "schedule" as const, label: "Schedule", icon: <CalendarDays className="w-3.5 h-3.5" /> },
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
      {subTab === "schedule" && (
        <ScheduleSection plans={plans} sessions={sessions} onRefresh={loadSessions} />
      )}
      {subTab === "performance" && (
        <PerformanceSection plans={plans} sessions={sessions} />
      )}
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

  const resetForm = () => {
    setTitle(""); setDescription(""); setColor("violet");
    setGoal(""); setDaysPerWeek(""); setEditing(null); setShowForm(false);
  };

  const openEdit = (p: TrainingPlan) => {
    setEditing(p);
    setTitle(p.title);
    setDescription(p.description ?? "");
    setColor((p.color as HabitColor) ?? "violet");
    setGoal(p.goal ?? "");
    setDaysPerWeek(p.days_per_week?.toString() ?? "");
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
    };
    try {
      if (editing) {
        await updateTrainingPlan(editing.id, payload);
      } else {
        await createTrainingPlan(payload);
      }
      resetForm();
      onRefresh();
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (id: number) => {
    try { await deleteTrainingPlan(id); onRefresh(); } catch (e) { console.error(e); }
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

      <div className="border border-border bg-card rounded-lg divide-y divide-border">
        {plans.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No training plans yet. Create one to get started.
          </div>
        )}
        {plans.map((plan) => {
          const c = plan.color as HabitColor;
          return (
            <div key={plan.id} className="px-4 py-3 flex items-center gap-3 group">
              <span className={cn("w-3 h-3 rounded-full flex-shrink-0", COLOR_DOT[c] ?? "bg-violet-500")} />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{plan.title}</span>
                {plan.goal && (
                  <span className="ml-2 text-xs text-muted-foreground">· {plan.goal}</span>
                )}
                {plan.days_per_week && (
                  <span className="ml-2 text-xs text-muted-foreground">· {plan.days_per_week}×/week</span>
                )}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => openEdit(plan)}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(plan.id)}
                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Session Row ───────────────────────────────────────────────────────────────

function SessionRow({
  s,
  planMap,
  onToggle,
  onDelete,
}: {
  s: TrainingSession;
  planMap: Map<number, TrainingPlan>;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const plan = s.plan_id ? planMap.get(s.plan_id) : null;
  const planColor = (plan?.color ?? "slate") as HabitColor;
  return (
    <div className="px-4 py-3 flex items-start gap-3 group">
      <button
        onClick={() => onToggle(s.id)}
        className={cn(
          "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all",
          s.completed
            ? "bg-violet-500 border-transparent"
            : "border-border bg-transparent hover:border-violet-400"
        )}
      >
        {s.completed && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("text-sm font-medium", s.completed && "line-through text-muted-foreground")}>
            {s.title}
          </span>
          {plan && (
            <span className={cn("px-1.5 py-0.5 text-xs rounded-full font-medium", COLOR_BADGE[planColor] ?? COLOR_BADGE.slate)}>
              {plan.title}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {s.scheduled_date && (
            <span className="text-xs text-muted-foreground">{formatDate(s.scheduled_date)}</span>
          )}
          {s.start_time && (
            <span className="text-xs text-muted-foreground">
              {s.start_time.slice(0, 5)}{s.end_time ? `–${s.end_time.slice(0, 5)}` : ""}
            </span>
          )}
          {s.location && (
            <span className="text-xs text-muted-foreground">· {s.location}</span>
          )}
        </div>
      </div>
      <button
        onClick={() => onDelete(s.id)}
        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Schedule Section ──────────────────────────────────────────────────────────

function ScheduleSection({
  plans, sessions, onRefresh,
}: {
  plans: TrainingPlan[];
  sessions: TrainingSession[];
  onRefresh: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [planId, setPlanId] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(TODAY);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  const resetForm = () => {
    setPlanId(""); setTitle(""); setDate(TODAY);
    setStartTime(""); setEndTime(""); setLocation(""); setNotes("");
    setShowForm(false);
  };

  const handleCreate = async () => {
    if (!title.trim()) return;
    try {
      await createTrainingSession({
        plan_id: planId ? parseInt(planId) : null,
        title: title.trim(),
        scheduled_date: date || null,
        start_time: startTime || null,
        end_time: endTime || null,
        location: location.trim() || null,
        notes: notes.trim() || null,
      });
      resetForm();
      onRefresh();
    } catch (e) { console.error(e); }
  };

  const handleToggle = async (id: number) => {
    try { await toggleTrainingSession(id); onRefresh(); } catch (e) { console.error(e); }
  };

  const handleDelete = async (id: number) => {
    try { await deleteTrainingSession(id); onRefresh(); } catch (e) { console.error(e); }
  };

  const upcoming = sessions.filter((s) => !s.completed && (s.scheduled_date == null || s.scheduled_date >= TODAY));
  const past = sessions.filter((s) => s.completed || (s.scheduled_date != null && s.scheduled_date < TODAY));

  const planMap = new Map(plans.map((p) => [p.id, p]));

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-violet-600 text-white rounded hover:bg-violet-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> Schedule Session
        </button>
      </div>

      {showForm && (
        <div className="border border-border bg-card rounded-lg p-4 space-y-3">
          <div className="text-sm font-medium text-muted-foreground">New Session</div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className="text-sm bg-input border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">No plan</option>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Session title *"
                className="flex-1 min-w-48 text-sm bg-input border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="text-sm bg-input border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring" />
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                placeholder="Start"
                className="text-sm bg-input border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring" />
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                placeholder="End"
                className="text-sm bg-input border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring" />
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Location"
                className="flex-1 min-w-32 text-sm bg-input border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="w-full text-sm bg-input border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              disabled={!title.trim()}
              className="flex items-center gap-1 px-3 py-1 text-sm bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-40 transition-colors"
            >
              <Check className="w-4 h-4" /> Create
            </button>
            <button onClick={resetForm} className="px-3 py-1 text-sm border border-border rounded hover:bg-muted transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="border border-border bg-card rounded-lg divide-y divide-border">
        {sessions.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No sessions scheduled yet.</div>
        )}
        {upcoming.length > 0 && (
          <>
            <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30">
              Upcoming
            </div>
            {upcoming.map((s) => <SessionRow key={s.id} s={s} planMap={planMap} onToggle={handleToggle} onDelete={handleDelete} />)}
          </>
        )}
        {past.length > 0 && (
          <>
            <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30">
              Past
            </div>
            {past.map((s) => <SessionRow key={s.id} s={s} planMap={planMap} onToggle={handleToggle} onDelete={handleDelete} />)}
          </>
        )}
      </div>
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

// ── Overview Tab ──────────────────────────────────────────────────────────────

function dateOffsetStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function OverviewCard({
  icon,
  title,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl border border-border bg-card p-4 cursor-pointer hover:bg-accent/30 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="text-sm font-semibold">{title}</span>
      </div>
      {children}
    </div>
  );
}

function OverviewTab({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const [habits, setHabits] = useState<HabitWithCompletion[]>([]);
  const [runLogs, setRunLogs] = useState<RunLog[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutLog[]>([]);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [plans, setPlans] = useState<TrainingPlan[]>([]);

  useEffect(() => {
    Promise.all([
      getHabitsForDate(TODAY),
      getRunLogs(),
      getWorkoutLogs(),
      getTrainingSessions(),
      getTrainingPlans(),
    ]).then(([h, r, w, s, p]) => {
      setHabits(h);
      setRunLogs(r);
      setWorkouts(w);
      setSessions(s);
      setPlans(p);
    }).catch(console.error);
  }, []);

  const doneHabits = habits.filter((h) => h.done).length;
  const totalHabits = habits.length;

  const sevenDaysAgoStr = dateOffsetStr(-6);
  const fourteenDaysAgoStr = dateOffsetStr(-13);
  const endOfWeekStr = dateOffsetStr(6 - new Date().getDay());

  const recentRuns = runLogs.filter((r) => r.date >= sevenDaysAgoStr);
  const weekKm = recentRuns.reduce((s, r) => s + (r.distance_km ?? 0), 0);
  const prevKm = runLogs
    .filter((r) => r.date >= fourteenDaysAgoStr && r.date < sevenDaysAgoStr)
    .reduce((s, r) => s + (r.distance_km ?? 0), 0);
  const runTrendUp = weekKm > prevKm;

  const lastWorkout = workouts[0] ?? null;

  const upcomingSessions = sessions
    .filter((s) => !s.completed && s.scheduled_date && s.scheduled_date >= TODAY && s.scheduled_date <= endOfWeekStr)
    .slice(0, 3);
  const planMap = new Map(plans.map((p) => [p.id, p]));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <OverviewCard icon={<Zap className="h-4 w-4 text-amber-500" />} title="Habits Today" onClick={() => onNavigate("habits")}>
        {totalHabits === 0 ? (
          <p className="text-xs text-muted-foreground">No habits yet.</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xl font-bold">{doneHabits}<span className="text-muted-foreground text-base font-normal">/{totalHabits}</span></span>
              <span className="text-xs text-muted-foreground">{Math.round((doneHabits / totalHabits) * 100)}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden mb-3">
              <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${(doneHabits / totalHabits) * 100}%` }} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {habits.map((h) => (
                <span key={h.id} title={h.title} className={cn("w-2 h-2 rounded-full", COLOR_DOT[(h.color as HabitColor)] ?? "bg-emerald-500", !h.done && "opacity-30")} />
              ))}
            </div>
          </>
        )}
      </OverviewCard>

      <OverviewCard icon={<Target className="h-4 w-4 text-violet-500" />} title="Training This Week" onClick={() => onNavigate("training")}>
        {upcomingSessions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No sessions scheduled this week.</p>
        ) : (
          <div className="space-y-2">
            {upcomingSessions.map((s) => {
              const plan = s.plan_id ? planMap.get(s.plan_id) : null;
              const planColor = (plan?.color ?? "slate") as HabitColor;
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="text-xs font-medium truncate flex-1">{s.title}</span>
                  {s.scheduled_date && (
                    <span className="text-xs text-muted-foreground flex-shrink-0">{formatDate(s.scheduled_date)}</span>
                  )}
                  {plan && (
                    <span className={cn("px-1.5 py-0.5 text-xs rounded-full font-medium flex-shrink-0", COLOR_BADGE[planColor] ?? COLOR_BADGE.slate)}>
                      {plan.title}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </OverviewCard>

      <OverviewCard icon={<Activity className="h-4 w-4 text-emerald-500" />} title="Running (7 days)" onClick={() => onNavigate("running")}>
        <div className="flex items-end gap-3">
          <span className="text-2xl font-bold">{weekKm.toFixed(1)}<span className="text-sm font-normal text-muted-foreground ml-1">km</span></span>
          {weekKm > 0 && prevKm > 0 && (
            <span className={cn("text-xs font-medium mb-1 flex items-center gap-0.5", runTrendUp ? "text-emerald-500" : "text-rose-500")}>
              <TrendingUp className={cn("h-3 w-3", !runTrendUp && "rotate-180")} />
              {runTrendUp ? "up" : "down"}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{recentRuns.length} run{recentRuns.length !== 1 ? "s" : ""} in the last 7 days</p>
      </OverviewCard>

      <OverviewCard icon={<Dumbbell className="h-4 w-4 text-orange-500" />} title="Strength" onClick={() => onNavigate("strength")}>
        {lastWorkout ? (
          <>
            <p className="text-base font-semibold truncate">{lastWorkout.name}</p>
            <p className="text-xs text-muted-foreground mt-1">{formatDate(lastWorkout.date)} · {lastWorkout.exercises.length} exercise{lastWorkout.exercises.length !== 1 ? "s" : ""}</p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No workouts logged yet.</p>
        )}
      </OverviewCard>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="w-3.5 h-3.5" /> },
  { id: "habits", label: "Habits", icon: <Zap className="w-3.5 h-3.5" /> },
  { id: "running", label: "Running", icon: <Activity className="w-3.5 h-3.5" /> },
  { id: "strength", label: "Strength", icon: <Dumbbell className="w-3.5 h-3.5" /> },
  { id: "training", label: "Training", icon: <Target className="w-3.5 h-3.5" /> },
];

export function Lifestyle() {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex gap-1 px-5 pt-4 pb-2 overflow-x-auto border-b border-border flex-shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-all",
              tab === t.id
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6 min-h-0">
        <div className="max-w-3xl mx-auto space-y-6">
          {tab === "overview" && (
            <>
              <div className="flex items-center gap-2">
                <Flame className="w-6 h-6 text-orange-500" />
                <h1 className="text-2xl font-bold">Lifestyle</h1>
              </div>
              <OverviewTab onNavigate={setTab} />
            </>
          )}
          {tab === "habits" && <HabitsTab />}
          {tab === "running" && <RunningTab />}
          {tab === "strength" && <StrengthTab />}
          {tab === "training" && <TrainingTab />}
        </div>
      </div>
    </div>
  );
}
