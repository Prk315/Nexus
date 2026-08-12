import { useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { CARD_STYLE } from "../../lib/uiHelpers";
import { LegendRow } from "../biomarkers/BiomarkerCharts";
import RingGauge from "./RingGauge";
import { goalTarget } from "../../lib/nutritionScore";
import type { NutrientTotals } from "../../lib/mealNutrition";
import type { NutritionGoalItem } from "../../store/types";

const TOOLTIP_STYLE = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  fontSize: 12,
  color: "var(--text)",
};

const MACRO_COLORS = {
  protein: "var(--macro-protein)",
  carbs: "var(--macro-carbs)",
  fat: "var(--macro-fat)",
};

interface DayCalories {
  date: string;
  label: string;
  calories: number;
  /** That day's dynamic calorie target (base + active + offset). */
  target: number;
}

export default function NutrientOverview({
  perDay, todayTotals, weekTotals, goals, dailyCalorieTarget,
}: {
  perDay: DayCalories[];
  todayTotals: NutrientTotals;
  weekTotals: NutrientTotals;
  goals: NutritionGoalItem[];
  /** Rough daily calorie target (base + offset) for the reference line. */
  dailyCalorieTarget: number | null;
}) {
  // Nutrient goals are weekly — the micronutrient rings show this week's total
  // against the weekly goal.
  const weeklyGoal = (key: string) => goalTarget(goals.find((g) => g.nutrient_key === key));
  const calorieGoal = dailyCalorieTarget;
  const macroData = useMemo(() => {
    const proteinKcal = todayTotals.protein_g * 4;
    const carbsKcal = todayTotals.carbs_g * 4;
    const fatKcal = todayTotals.fat_g * 9;
    return [
      { name: "Protein", kcal: proteinKcal, grams: todayTotals.protein_g, color: MACRO_COLORS.protein },
      { name: "Carbs", kcal: carbsKcal, grams: todayTotals.carbs_g, color: MACRO_COLORS.carbs },
      { name: "Fat", kcal: fatKcal, grams: todayTotals.fat_g, color: MACRO_COLORS.fat },
    ];
  }, [todayTotals]);

  const hasMacros = macroData.some((m) => m.kcal > 0);

  return (
    <div style={{ ...CARD_STYLE, padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        {/* Calories per day */}
        <div style={{ flex: "2 1 360px", minWidth: 320 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>
            Calories logged this week
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={perDay} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="var(--border-subtle)" strokeWidth={1} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                axisLine={false}
                tickLine={false}
                domain={[0, (dataMax: number) => Math.ceil(Math.max(dataMax, calorieGoal ?? 0) * 1.1)]}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [`${Math.round(v)} kcal`, name === "target" ? "Goal" : "Logged"]} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} formatter={(v) => (v === "target" ? "Goal" : "Logged")} />
              <Bar dataKey="calories" name="calories" fill="var(--series-nutrition)" radius={[3, 3, 0, 0]} />
              {/* Per-day dynamic calorie target (base + that day's active + offset). */}
              <Line type="monotone" dataKey="target" name="target" stroke="var(--text-secondary)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Macro breakdown */}
        <div style={{ flex: "1 1 220px", minWidth: 200, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 10, alignSelf: "flex-start" }}>
            Macros today
          </div>
          {hasMacros ? (
            <>
              <div style={{ position: "relative", width: "100%", height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={macroData}
                      dataKey="kcal"
                      nameKey="name"
                      innerRadius="65%"
                      outerRadius="95%"
                      startAngle={90}
                      endAngle={-270}
                      isAnimationActive={false}
                    >
                      {macroData.map((m) => (
                        <Cell key={m.name} fill={m.color} stroke="var(--surface)" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(_v: number, _n: string, entry: { payload?: { grams: number; kcal: number } }) => {
                        const p = entry.payload;
                        return p ? [`${Math.round(p.grams)}g · ${Math.round(p.kcal)} kcal`, entry.payload && _n] : [_v, _n];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div
                  style={{
                    position: "absolute", inset: 0,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    pointerEvents: "none",
                  }}
                >
                  <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
                    {Math.round(todayTotals.calories)}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>kcal</div>
                </div>
              </div>
              <LegendRow
                items={macroData.map((m) => ({ label: `${m.name} ${Math.round(m.grams)}g`, color: m.color }))}
              />
            </>
          ) : (
            <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>
              No food logged today yet
            </div>
          )}
        </div>
      </div>

      {/* Micronutrients */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>
          Micronutrients this week
        </div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <RingGauge label="Sodium" value={weekTotals.sodium_mg} goal={weeklyGoal("sodium_mg")} unit="mg" color="var(--series-nutrition)" track="var(--series-nutrition-track)" />
          <RingGauge label="Potassium" value={weekTotals.potassium_mg} goal={weeklyGoal("potassium_mg")} unit="mg" color="var(--series-nutrition)" track="var(--series-nutrition-track)" />
          <RingGauge label="Calcium" value={weekTotals.calcium_mg} goal={weeklyGoal("calcium_mg")} unit="mg" color="var(--series-nutrition)" track="var(--series-nutrition-track)" />
          <RingGauge label="Iron" value={weekTotals.iron_mg} goal={weeklyGoal("iron_mg")} unit="mg" color="var(--series-nutrition)" track="var(--series-nutrition-track)" />
          <RingGauge label="Vitamin C" value={weekTotals.vitamin_c_mg} goal={weeklyGoal("vitamin_c_mg")} unit="mg" color="var(--series-nutrition)" track="var(--series-nutrition-track)" />
          <RingGauge label="Vitamin D" value={weekTotals.vitamin_d_mcg} goal={weeklyGoal("vitamin_d_mcg")} unit="mcg" color="var(--series-nutrition)" track="var(--series-nutrition-track)" />
          <RingGauge label="Fiber" value={weekTotals.fiber_g} goal={weeklyGoal("fiber_g")} unit="g" color="var(--series-nutrition)" track="var(--series-nutrition-track)" />
          <RingGauge label="Sugar" value={weekTotals.sugar_g} goal={weeklyGoal("sugar_g")} unit="g" color="var(--series-nutrition)" track="var(--series-nutrition-track)" />
        </div>
      </div>
    </div>
  );
}
