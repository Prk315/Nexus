import { useEffect, useState, useCallback } from "react";
import {
  Heart, Plus, X, Check, Trash2, ChevronDown, ChevronRight,
  Dumbbell, Footprints, Flame, Timer, Ruler, Calendar, TrendingUp, Zap,
} from "lucide-react";
import {
  getHabitsForDate,
  createDailyHabit,
  deleteDailyHabit,
  toggleHabitCompletion,
  getRunLogs,
  createRunLog,
  deleteRunLog,
  getWorkoutLogs,
  createWorkoutLog,
  deleteWorkoutLog,
  addWorkoutExercise,
  deleteWorkoutExercise,
} from "../lib/api";
import type { HabitWithCompletion, RunLog, WorkoutLog } from "../types";
import { cn } from "../lib/utils";

type Tab = "habits" | "running" | "strength";

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

function HabitsTab() {
  const [habits, setHabits] = useState<HabitWithCompletion[]>([]);
  const [addTitle, setAddTitle] = useState("");
  const [addColor, setAddColor] = useState<HabitColor>("emerald");
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const todayLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const load = useCallback(async () => {
    try {
      const data = await getHabitsForDate(TODAY);
      setHabits(data);
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
      await createDailyHabit({ title, color: addColor });
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

  const doneCount = habits.filter((h) => h.done).length;

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
        {habits.length > 0 && (
          <div className="text-sm font-medium text-muted-foreground">
            {doneCount}/{habits.length} done
          </div>
        )}
      </div>

      <div className="border border-border bg-card rounded-lg divide-y divide-border">
        {habits.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No habits yet. Add one below.
          </div>
        )}
        {habits.map((habit) => {
          const color = habit.color as HabitColor;
          // Compute last 7 days dots (index 0 = today, 6 = 6 days ago)
          const weekDots = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(TODAY + "T00:00:00");
            d.setDate(d.getDate() - i);
            return habit.recent_dates.includes(d.toISOString().slice(0, 10));
          });
          return (
            <div
              key={habit.id}
              className="flex items-center gap-3 px-4 py-3 group"
              onMouseEnter={() => setHoveredId(habit.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <button
                onClick={() => handleToggle(habit.id)}
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

              {/* 7-day dots */}
              <div className="flex items-center gap-0.5 flex-shrink-0">
                {weekDots.map((done, i) => (
                  <span
                    key={i}
                    title={i === 0 ? "Today" : `${i}d ago`}
                    className={cn(
                      "w-2 h-2 rounded-full",
                      done
                        ? (COLOR_DOT[color] ?? "bg-emerald-500")
                        : "bg-muted-foreground/20"
                    )}
                  />
                ))}
              </div>

              {/* Streak badge */}
              {habit.streak > 0 && (
                <div className="flex items-center gap-0.5 flex-shrink-0 text-orange-500">
                  <Zap className="w-3 h-3" />
                  <span className="text-xs font-semibold">{habit.streak}</span>
                </div>
              )}

              {hoveredId === habit.id ? (
                <button
                  onClick={() => handleDelete(habit.id)}
                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive flex-shrink-0 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                <div className="w-5 flex-shrink-0" />
              )}
            </div>
          );
        })}

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

// ── Main Page ─────────────────────────────────────────────────────────────────

export function Lifestyle() {
  const [tab, setTab] = useState<Tab>("habits");

  const tabs: { id: Tab; label: string; icon: React.ReactNode; color: string }[] = [
    { id: "habits", label: "Habits", icon: <Heart className="w-4 h-4" />, color: "text-rose-500" },
    { id: "running", label: "Running", icon: <Footprints className="w-4 h-4" />, color: "text-emerald-500" },
    { id: "strength", label: "Strength", icon: <Dumbbell className="w-4 h-4" />, color: "text-orange-500" },
  ];

  return (
    <div className="flex h-full min-h-0">
      {/* Main content */}
      <div className="flex-1 min-w-0 p-6 overflow-y-auto">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="flex items-center gap-2">
            <Flame className="w-6 h-6 text-orange-500" />
            <h1 className="text-2xl font-bold">Lifestyle</h1>
          </div>
          {tab === "habits" && <HabitsTab />}
          {tab === "running" && <RunningTab />}
          {tab === "strength" && <StrengthTab />}
        </div>
      </div>

      {/* Right sidebar nav */}
      <div className="w-44 border-l border-border bg-card/50 flex flex-col py-6 px-3 gap-1 flex-shrink-0">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">Section</p>
        {tabs.map(({ id, label, icon, color }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left w-full",
              tab === id
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            )}
          >
            <span className={tab === id ? color : ""}>{icon}</span>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
