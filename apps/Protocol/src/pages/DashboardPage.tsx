import { useEffect } from "react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Moon, Activity, TrendingUp, Flame, Dumbbell } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { fetchSleep, fetchBodyMetrics } from "../store/slices/biomarkersSlice";
import { fetchWorkoutSessions } from "../store/slices/workoutsSlice";
import { fetchRunningSessions } from "../store/slices/runningSlice";
import { fetchHabits, fetchHabitCompletions } from "../store/slices/habitsSlice";
import {
  fetchFoods, fetchMeals, fetchMealItems, fetchMealPlanEntries, fetchNutritionGoals,
} from "../store/slices/mealPlannerSlice";
import { formatMinutes, CARD_STYLE, isoDate } from "../lib/uiHelpers";
import { entryNutrition } from "../lib/mealNutrition";
import { StatTile } from "../components/shared/StatTile";
import ProtocolChargeChart from "../components/dashboard/ProtocolChargeChart";
import { ConsistencyHeatmap, buildHeatmapGrid, computeFractionByDate } from "../components/habits/HabitCharts";
import type { WorkoutSession } from "../store/types";

const HABITS_HISTORY_DAYS = 90;
const NUTRITION_HISTORY_DAYS = 186; // covers the chart's 6M range
const HEATMAP_WEEKS = 12;

function subDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function avgNullable(values: (number | null)[]): number | null {
  return avg(values.filter((v): v is number => v != null));
}

/** 1 if any session that day was completed, 0 if scheduled but not, absent otherwise. */
function computeWorkoutFractionByDate(sessions: WorkoutSession[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sessions) {
    const existing = m.get(s.scheduled_date) ?? 0;
    m.set(s.scheduled_date, Math.max(existing, s.completed ? 1 : 0));
  }
  return m;
}

const TOOLTIP_STYLE = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  fontSize: 12,
  color: "var(--text)",
};

const CHART_MARGIN = { top: 4, right: 8, bottom: 0, left: -20 };

const NO_DATA = (
  <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: 13 }}>
    No data yet — start logging!
  </div>
);

export default function DashboardPage() {
  const dispatch = useAppDispatch();
  const sleep = useAppSelector((s) => s.biomarkers.sleep);
  const bodyMetrics = useAppSelector((s) => s.biomarkers.bodyMetrics);
  const workoutSessions = useAppSelector((s) => s.workouts.sessions);
  const runningSessions = useAppSelector((s) => s.running.sessions);
  const habits = useAppSelector((s) => s.habits.habits);
  const habitCompletions = useAppSelector((s) => s.habits.completions);
  const foods = useAppSelector((s) => s.mealPlanner.foods);
  const meals = useAppSelector((s) => s.mealPlanner.meals);
  const mealItemsById = useAppSelector((s) => s.mealPlanner.mealItems);
  const planEntries = useAppSelector((s) => s.mealPlanner.planEntries);
  const nutritionGoals = useAppSelector((s) => s.mealPlanner.goals);

  useEffect(() => {
    dispatch(fetchSleep());
    dispatch(fetchBodyMetrics());
    dispatch(fetchWorkoutSessions());
    dispatch(fetchRunningSessions());
    dispatch(fetchHabits());
    dispatch(fetchHabitCompletions(subDays(HABITS_HISTORY_DAYS)));
    dispatch(fetchFoods());
    dispatch(fetchMeals());
    dispatch(fetchNutritionGoals());
    dispatch(fetchMealPlanEntries({ start: subDays(NUTRITION_HISTORY_DAYS), end: isoDate(new Date()) }));
  }, [dispatch]);

  useEffect(() => {
    for (const meal of meals) {
      if (!mealItemsById[meal.id]) dispatch(fetchMealItems(meal.id));
    }
  }, [dispatch, meals, mealItemsById]);

  const cutoff7 = subDays(7);
  const cutoff14 = subDays(14);

  const today = isoDate(new Date());
  const heatmapGrid = buildHeatmapGrid(today, HEATMAP_WEEKS);
  const fractionByDate = computeFractionByDate(habitCompletions, habits.length);
  const workoutFractionByDate = computeWorkoutFractionByDate(workoutSessions);

  const foodsById = new Map(foods.map((f) => [f.id, f]));
  const mealsById = new Map(meals.map((m) => [m.id, m]));
  const nutritionByDate = new Map<string, number>();
  for (const entry of planEntries) {
    if (!entry.logged) continue;
    const n = entryNutrition(entry, foodsById, mealsById, mealItemsById);
    if (!n) continue;
    nutritionByDate.set(entry.date, (nutritionByDate.get(entry.date) ?? 0) + n.calories);
  }

  const recentSleep = sleep.filter((e) => e.date >= cutoff7);
  const avgQuality = avg(recentSleep.map((e) => e.quality_score));
  const avgDuration = avg(recentSleep.map((e) => e.duration_min));
  const avgDeepSleep = avgNullable(recentSleep.map((e) => e.deep_sleep_min));
  const avgRemSleep = avgNullable(recentSleep.map((e) => e.rem_sleep_min));
  const avgLightSleep = avgNullable(recentSleep.map((e) => e.light_sleep_min));
  const avgAwakeTime = avgNullable(recentSleep.map((e) => e.awake_time_min));
  const avgRespRate = avgNullable(recentSleep.map((e) => e.respiratory_rate));
  const avgTempDeviation = avgNullable(recentSleep.map((e) => e.temperature_deviation));

  // Single-pass: find the entry with the most-recent date that has a weight reading
  const lastWeight = bodyMetrics.reduce<{ date: string; weight: number } | null>((best, e) => {
    if (e.weight_kg == null) return best;
    if (best == null || e.date > best.date) return { date: e.date, weight: e.weight_kg };
    return best;
  }, null)?.weight ?? null;

  const sleepChartData = [...sleep]
    .filter((e) => e.date >= cutoff14)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ date: e.date.slice(5), quality: e.quality_score }));

  const weightChartData = [...bodyMetrics]
    .filter((e) => e.date >= cutoff14 && e.weight_kg != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ date: e.date.slice(5), weight: e.weight_kg }));

  const STAT_CARD: React.CSSProperties = { ...CARD_STYLE, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 4 };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <ProtocolChargeChart
        sleep={sleep}
        nutritionByDate={nutritionByDate}
        calorieGoal={nutritionGoals?.calories ?? null}
        bodyMetrics={bodyMetrics}
        workoutSessions={workoutSessions}
        runningSessions={runningSessions}
      />

      <div style={{ padding: "24px 40px", display: "flex", flexDirection: "column", gap: 24 }}>
      {(habits.length > 0 || workoutSessions.length > 0) && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {habits.length > 0 && (
            <div style={{ ...CARD_STYLE, padding: "20px 24px", flex: "1 1 260px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Flame size={15} color="var(--warning)" />
                <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Habit Consistency</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
                Share of habits completed each day, last {HEATMAP_WEEKS} weeks
              </div>
              <ConsistencyHeatmap grid={heatmapGrid} today={today} fractionByDate={fractionByDate} />
            </div>
          )}

          {workoutSessions.length > 0 && (
            <div style={{ ...CARD_STYLE, padding: "20px 24px", flex: "1 1 260px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Dumbbell size={15} color="#8b5cf6" />
                <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Workout Consistency</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
                Days with a completed workout, last {HEATMAP_WEEKS} weeks
              </div>
              <ConsistencyHeatmap grid={heatmapGrid} today={today} fractionByDate={workoutFractionByDate} />
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <div style={STAT_CARD}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Moon size={14} color="var(--accent)" />
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>Avg Sleep Quality (7d)</span>
          </div>
          <span style={{ fontSize: 28, fontWeight: 700, color: "var(--text)" }}>
            {avgQuality != null ? avgQuality.toFixed(1) : "—"}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>/ 10</span>
        </div>

        <div style={STAT_CARD}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Moon size={14} color="var(--accent)" />
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>Avg Sleep Duration (7d)</span>
          </div>
          <span style={{ fontSize: 28, fontWeight: 700, color: "var(--text)" }}>
            {avgDuration != null ? formatMinutes(avgDuration) : "—"}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>per night</span>
        </div>

        <div style={STAT_CARD}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <TrendingUp size={14} color="var(--accent)" />
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>Body Weight</span>
          </div>
          <span style={{ fontSize: 28, fontWeight: 700, color: "var(--text)" }}>
            {lastWeight != null ? lastWeight.toFixed(1) : "—"}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>kg (latest)</span>
        </div>
      </div>

      <div style={{ ...CARD_STYLE, padding: "20px 20px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Moon size={15} color="var(--accent)" />
          <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Sleep Quality — Last 14 Days</span>
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div style={{ flex: "2 1 320px", minWidth: 260 }}>
            {sleepChartData.length === 0 ? NO_DATA : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={sleepChartData} margin={CHART_MARGIN}>
                  <defs>
                    <linearGradient id="sleepGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Area type="monotone" dataKey="quality" stroke="var(--accent)" strokeWidth={2} fill="url(#sleepGrad)" dot={{ fill: "var(--accent)", r: 3 }} name="Quality" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <div style={{ flex: "1 1 140px", display: "flex", flexDirection: "column", gap: 14, justifyContent: "center" }}>
            <StatTile label="Deep sleep" value={avgDeepSleep != null ? formatMinutes(avgDeepSleep) : "—"} sub="avg, 7d" />
            <StatTile label="REM sleep" value={avgRemSleep != null ? formatMinutes(avgRemSleep) : "—"} sub="avg, 7d" />
            <StatTile label="Light sleep" value={avgLightSleep != null ? formatMinutes(avgLightSleep) : "—"} sub="avg, 7d" />
          </div>
        </div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-subtle)" }}>
          <StatTile label="Awake time" value={avgAwakeTime != null ? formatMinutes(avgAwakeTime) : "—"} sub="avg, 7d" />
          <StatTile
            label="Respiratory rate"
            value={avgRespRate != null ? avgRespRate.toFixed(1) : "—"}
            sub="breaths/min, avg 7d"
          />
          <StatTile
            label="Temp deviation"
            value={avgTempDeviation != null ? `${avgTempDeviation > 0 ? "+" : ""}${avgTempDeviation.toFixed(2)}°` : "—"}
            sub="avg, 7d"
          />
        </div>
      </div>

      <div style={{ ...CARD_STYLE, padding: "20px 20px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Activity size={15} color="#8b5cf6" />
          <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Weight Trend — Last 14 Days</span>
        </div>
        {weightChartData.length === 0 ? NO_DATA : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={weightChartData} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="weight" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: "#8b5cf6", r: 3 }} name="Weight (kg)" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      </div>
    </div>
  );
}
