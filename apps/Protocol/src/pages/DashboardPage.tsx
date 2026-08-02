import { useEffect } from "react";
import {
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

  // Most recent logged night, not an average — broader trends live on Biomarkers.
  const lastNight = [...sleep].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  const lastNightLabel = lastNight
    ? lastNight.date === today
      ? "last night"
      : new Date(`${lastNight.date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "no data";

  // Single-pass: find the entry with the most-recent date that has a weight reading
  const lastWeight = bodyMetrics.reduce<{ date: string; weight: number } | null>((best, e) => {
    if (e.weight_kg == null) return best;
    if (best == null || e.date > best.date) return { date: e.date, weight: e.weight_kg };
    return best;
  }, null)?.weight ?? null;

  // Most recent logged body-metrics day, not an average — same convention as lastNight.
  const lastVitals = [...bodyMetrics].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  const lastVitalsLabel = lastVitals
    ? lastVitals.date === today
      ? "today"
      : new Date(`${lastVitals.date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "no data";

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
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>Sleep Quality</span>
          </div>
          <span style={{ fontSize: 28, fontWeight: 700, color: "var(--text)" }}>
            {lastNight ? lastNight.quality_score.toFixed(1) : "—"}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>/ 10, {lastNightLabel}</span>
        </div>

        <div style={STAT_CARD}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Moon size={14} color="var(--accent)" />
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>Sleep Duration</span>
          </div>
          <span style={{ fontSize: 28, fontWeight: 700, color: "var(--text)" }}>
            {lastNight ? formatMinutes(lastNight.duration_min) : "—"}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{lastNightLabel}</span>
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
          <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Last Night's Sleep</span>
        </div>
        {!lastNight ? NO_DATA : (
          <>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <StatTile label="Deep sleep" value={lastNight.deep_sleep_min != null ? formatMinutes(lastNight.deep_sleep_min) : "—"} />
              <StatTile label="REM sleep" value={lastNight.rem_sleep_min != null ? formatMinutes(lastNight.rem_sleep_min) : "—"} />
              <StatTile label="Light sleep" value={lastNight.light_sleep_min != null ? formatMinutes(lastNight.light_sleep_min) : "—"} />
              <StatTile label="Awake time" value={lastNight.awake_time_min != null ? formatMinutes(lastNight.awake_time_min) : "—"} />
            </div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-subtle)" }}>
              <StatTile
                label="Respiratory rate"
                value={lastNight.respiratory_rate != null ? lastNight.respiratory_rate.toFixed(1) : "—"}
                sub="breaths/min"
              />
              <StatTile
                label="Temp deviation"
                value={lastNight.temperature_deviation != null ? `${lastNight.temperature_deviation > 0 ? "+" : ""}${lastNight.temperature_deviation.toFixed(2)}°` : "—"}
              />
            </div>
          </>
        )}
      </div>

      <div style={{ ...CARD_STYLE, padding: "20px 20px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Activity size={15} color="#8b5cf6" />
          <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Recovery & Vitals</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· {lastVitalsLabel}</span>
        </div>
        {!lastVitals ? NO_DATA : (
          <>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <StatTile label="HRV" value={lastVitals.hrv_ms != null ? String(lastVitals.hrv_ms) : "—"} sub="ms" />
              <StatTile label="Resting HR" value={lastVitals.resting_hr_bpm != null ? String(lastVitals.resting_hr_bpm) : "—"} sub="bpm" />
              <StatTile label="Avg heart rate" value={lastVitals.avg_heart_rate_bpm != null ? String(lastVitals.avg_heart_rate_bpm) : "—"} sub="bpm" />
              <StatTile label="Readiness" value={lastVitals.readiness_score != null ? String(lastVitals.readiness_score) : "—"} sub="/ 100" />
              <StatTile label="SpO2" value={lastVitals.spo2_pct != null ? lastVitals.spo2_pct.toFixed(1) : "—"} sub="%" />
            </div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-subtle)" }}>
              <StatTile
                label="Stress high"
                value={lastVitals.stress_high_min != null ? formatMinutes(lastVitals.stress_high_min) : "—"}
                sub={lastVitals.stress_summary ?? undefined}
              />
              <StatTile label="Resilience" value={lastVitals.resilience_level ?? "—"} />
              <StatTile label="Cardio age" value={lastVitals.cardio_age != null ? String(lastVitals.cardio_age) : "—"} />
              <StatTile
                label="Temp deviation"
                value={lastVitals.temperature_deviation != null ? `${lastVitals.temperature_deviation > 0 ? "+" : ""}${lastVitals.temperature_deviation.toFixed(2)}°` : "—"}
              />
            </div>
          </>
        )}
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
