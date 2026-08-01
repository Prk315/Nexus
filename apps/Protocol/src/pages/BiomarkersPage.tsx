import { useEffect, useState } from "react";
import { Moon, Apple, Activity, ChevronDown, ChevronUp } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { fetchSleep, fetchBodyMetrics } from "../store/slices/biomarkersSlice";
import {
  fetchFoods, fetchMeals, fetchMealItems, fetchMealPlanEntries, fetchNutritionGoals,
} from "../store/slices/mealPlannerSlice";
import { entryNutrition } from "../lib/mealNutrition";
import SleepLogger from "../components/biomarkers/SleepLogger";
import BodyMetricsLogger from "../components/biomarkers/BodyMetricsLogger";
import OuraImportPanel from "../components/biomarkers/OuraImportPanel";
import GarminSyncPanel from "../components/shared/GarminSyncPanel";
import { StatTile, TrendChart } from "../components/biomarkers/BiomarkerCharts";
import { formatMinutes, isoDate } from "../lib/uiHelpers";
import type { BodyMetric, SleepEntry } from "../store/types";

const NUTRITION_HISTORY_DAYS = 14;

function subDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function lastNDates(n: number): string[] {
  return Array.from({ length: n }, (_, i) => subDays(n - 1 - i));
}

/** Most recent entry (by date) that has a non-null value for `field`. */
function latestNonNull<T extends { date: string }>(entries: T[], field: keyof T): number | null {
  const found = [...entries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .find((e) => e[field] != null);
  return found ? (found[field] as number) : null;
}

// ── Module shell ─────────────────────────────────────────────────────────────

const MODULE_STYLE: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "24px 28px",
  display: "flex",
  flexDirection: "column",
  gap: 20,
};

function ModuleHeader({
  icon, title, color, tint, children,
}: {
  icon: React.ReactNode;
  title: string;
  color: string;
  tint: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: tint, display: "flex", alignItems: "center", justifyContent: "center", color, flexShrink: 0 }}>
          {icon}
        </div>
        <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{title}</span>
      </div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function ManageToggle({
  open, onToggle, label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        background: "none", border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)", padding: "6px 12px",
        fontSize: 12, fontWeight: 600, color: "var(--text-secondary)",
        alignSelf: "flex-start", cursor: "pointer",
      }}
    >
      {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      {open ? "Hide" : label}
    </button>
  );
}

// ── Sleep module ─────────────────────────────────────────────────────────────

function SleepModule() {
  const dispatch = useAppDispatch();
  const entries = useAppSelector((s) => s.biomarkers.sleep);
  const [manageOpen, setManageOpen] = useState(false);

  const cutoff7 = subDays(6);
  const cutoff30 = subDays(29);
  const recent7 = entries.filter((e) => e.date >= cutoff7);
  const recent30 = entries.filter((e) => e.date >= cutoff30);

  const avgQuality = avg(recent7.map((e) => e.quality_score));
  const avgDuration = avg(recent7.map((e) => e.duration_min));

  const byDate = new Map(entries.map((e: SleepEntry) => [e.date, e]));
  const chartData = lastNDates(30).map((date) => ({
    date: date.slice(5),
    value: byDate.get(date)?.quality_score ?? null,
  }));

  return (
    <div style={MODULE_STYLE}>
      <ModuleHeader icon={<Moon size={16} />} title="Sleep" color="var(--series-sleep)" tint="var(--series-sleep-track)">
        <StatTile label="Avg quality (7d)" value={avgQuality != null ? `${avgQuality.toFixed(1)}` : "—"} sub="/ 10" />
        <StatTile label="Avg duration (7d)" value={avgDuration != null ? formatMinutes(avgDuration) : "—"} sub="per night" />
        <StatTile label="Nights logged (30d)" value={String(recent30.length)} />
      </ModuleHeader>

      <div>
        <TrendChart data={chartData} color="var(--series-sleep)" gradientId="sleepTrend" domain={[0, 10]} height={140} />
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <ManageToggle open={manageOpen} onToggle={() => setManageOpen((v) => !v)} label="Log & manage entries" />
        <div style={{ flex: 1, minWidth: 220 }}>
          <GarminSyncPanel mode="sleep" onSynced={() => dispatch(fetchSleep())} />
        </div>
      </div>

      {manageOpen && <SleepLogger />}
    </div>
  );
}

// ── Nutrition module ─────────────────────────────────────────────────────────
// Sourced from the Meal Planner's own tables (protocol_foods/protocol_meals/
// protocol_meal_plan_entries) — logging happens on the Meal Planner tab now,
// this is a read-only glance.

function NutritionModule() {
  const dispatch = useAppDispatch();
  const foods = useAppSelector((s) => s.mealPlanner.foods);
  const meals = useAppSelector((s) => s.mealPlanner.meals);
  const mealItemsById = useAppSelector((s) => s.mealPlanner.mealItems);
  const planEntries = useAppSelector((s) => s.mealPlanner.planEntries);
  const goals = useAppSelector((s) => s.mealPlanner.goals);

  useEffect(() => {
    dispatch(fetchFoods());
    dispatch(fetchMeals());
    dispatch(fetchNutritionGoals());
    dispatch(fetchMealPlanEntries({ start: subDays(NUTRITION_HISTORY_DAYS - 1), end: isoDate(new Date()) }));
  }, [dispatch]);

  useEffect(() => {
    for (const meal of meals) {
      if (!mealItemsById[meal.id]) dispatch(fetchMealItems(meal.id));
    }
  }, [dispatch, meals, mealItemsById]);

  const foodsById = new Map(foods.map((f) => [f.id, f]));
  const mealsById = new Map(meals.map((m) => [m.id, m]));

  const today = isoDate(new Date());
  const loggedEntries = planEntries.filter((e) => e.logged);
  const todayEntries = loggedEntries.filter((e) => e.date === today);

  const caloriesByDate = new Map<string, number>();
  const proteinToday = todayEntries.reduce((sum, e) => {
    const n = entryNutrition(e, foodsById, mealsById, mealItemsById);
    return sum + (n?.protein_g ?? 0);
  }, 0);
  for (const e of loggedEntries) {
    const n = entryNutrition(e, foodsById, mealsById, mealItemsById);
    if (!n) continue;
    caloriesByDate.set(e.date, (caloriesByDate.get(e.date) ?? 0) + n.calories);
  }
  const caloriesToday = caloriesByDate.get(today) ?? 0;

  const cutoff7 = subDays(6);
  const recentCalorieDays = [...caloriesByDate.entries()].filter(([date]) => date >= cutoff7).map(([, cal]) => cal);
  const avgCalories = avg(recentCalorieDays);

  const chartData = lastNDates(NUTRITION_HISTORY_DAYS).map((date) => ({
    date: date.slice(5),
    value: caloriesByDate.get(date) ?? null,
  }));

  return (
    <div style={MODULE_STYLE}>
      <ModuleHeader icon={<Apple size={16} />} title="Nutrition" color="var(--series-nutrition)" tint="var(--series-nutrition-track)">
        <StatTile label="Calories today" value={todayEntries.length ? String(Math.round(caloriesToday)) : "—"} sub={goals?.calories ? `/ ${goals.calories}` : undefined} />
        <StatTile label="Protein today" value={todayEntries.length ? `${Math.round(proteinToday)}g` : "—"} sub={goals?.protein_g ? `/ ${goals.protein_g}g` : undefined} />
        <StatTile label="Avg calories (7d)" value={avgCalories != null ? String(Math.round(avgCalories)) : "—"} sub="per day" />
      </ModuleHeader>

      <div>
        <TrendChart data={chartData} color="var(--series-nutrition)" gradientId="nutritionTrend" height={140} valueSuffix=" kcal" />
      </div>

      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
        Log meals and set goals in the Meal Planner tab.
      </div>
    </div>
  );
}

// ── Body metrics module ───────────────────────────────────────────────────────

function BodyModule() {
  const dispatch = useAppDispatch();
  const entries = useAppSelector((s) => s.biomarkers.bodyMetrics);
  const [manageOpen, setManageOpen] = useState(false);

  const latestWeight = latestNonNull(entries, "weight_kg");
  const latestHRV = latestNonNull(entries, "hrv_ms");
  const latestRHR = latestNonNull(entries, "resting_hr_bpm");

  const cutoff30 = subDays(29);
  const byDate = new Map(entries.map((e: BodyMetric) => [e.date, e]));
  const weightData = lastNDates(30).map((date) => ({
    date: date.slice(5),
    value: byDate.get(date)?.weight_kg ?? null,
  }));
  const hrvData = lastNDates(30).map((date) => ({
    date: date.slice(5),
    value: byDate.get(date)?.hrv_ms ?? null,
  }));
  const loggedCount = entries.filter((e) => e.date >= cutoff30).length;

  return (
    <div style={MODULE_STYLE}>
      <ModuleHeader icon={<Activity size={16} />} title="Body Metrics" color="var(--series-body)" tint="var(--series-body-track)">
        <StatTile label="Weight (latest)" value={latestWeight != null ? latestWeight.toFixed(1) : "—"} sub="kg" />
        <StatTile label="HRV (latest)" value={latestHRV != null ? String(latestHRV) : "—"} sub="ms" />
        <StatTile label="Resting HR (latest)" value={latestRHR != null ? String(latestRHR) : "—"} sub="bpm" />
        <StatTile label="Entries (30d)" value={String(loggedCount)} />
      </ModuleHeader>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>Weight trend</div>
          <TrendChart data={weightData} color="var(--series-body)" gradientId="weightTrend" height={130} valueSuffix=" kg" />
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>HRV trend</div>
          <TrendChart data={hrvData} color="var(--series-workout)" gradientId="hrvTrend" height={130} valueSuffix=" ms" />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <ManageToggle open={manageOpen} onToggle={() => setManageOpen((v) => !v)} label="Log & manage entries" />
        <div style={{ flex: 1, minWidth: 220 }}>
          <GarminSyncPanel mode="body" onSynced={() => dispatch(fetchBodyMetrics())} />
        </div>
      </div>

      {manageOpen && <BodyMetricsLogger />}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BiomarkersPage() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(fetchSleep());
    dispatch(fetchBodyMetrics());
  }, [dispatch]);

  return (
    <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
          Biomarkers
        </h2>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          Sleep, nutrition, and body metrics — all in one view.
        </p>
      </div>

      <OuraImportPanel onImported={() => {
        dispatch(fetchSleep());
        dispatch(fetchBodyMetrics());
      }} />

      <SleepModule />
      <NutritionModule />
      <BodyModule />
    </div>
  );
}
