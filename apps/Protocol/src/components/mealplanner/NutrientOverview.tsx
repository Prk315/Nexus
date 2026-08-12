import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
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
}

export default function NutrientOverview({
  perDay, todayTotals, goals, dailyCalorieTarget,
}: {
  perDay: DayCalories[];
  todayTotals: NutrientTotals;
  goals: NutritionGoalItem[];
  /** Rough daily calorie target (base + offset) for the reference line. */
  dailyCalorieTarget: number | null;
}) {
  // Nutrient goals are weekly; the daily rings show a ÷7 pace target.
  const dailyTarget = (key: string) => {
    const wk = goalTarget(goals.find((g) => g.nutrient_key === key));
    return wk != null ? Math.round(wk / 7) : null;
  };
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
            <BarChart data={perDay} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="var(--border-subtle)" strokeWidth={1} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                axisLine={false}
                tickLine={false}
                domain={[0, (dataMax: number) => Math.ceil(Math.max(dataMax, calorieGoal ?? 0) * 1.1)]}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${Math.round(v)} kcal`, "Calories"]} />
              {calorieGoal && (
                <ReferenceLine
                  y={calorieGoal}
                  stroke="var(--text-muted)"
                  strokeDasharray="4 4"
                  label={{ value: "Goal", position: "insideTopRight", fontSize: 10, fill: "var(--text-muted)" }}
                />
              )}
              <Bar dataKey="calories" fill="var(--series-nutrition)" radius={[3, 3, 0, 0]} />
            </BarChart>
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
          Micronutrients today
        </div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <RingGauge label="Sodium" value={todayTotals.sodium_mg} goal={dailyTarget("sodium_mg")} unit="mg" color="var(--series-nutrition)" track="var(--series-nutrition-track)" />
          <RingGauge label="Potassium" value={todayTotals.potassium_mg} goal={dailyTarget("potassium_mg")} unit="mg" color="var(--series-nutrition)" track="var(--series-nutrition-track)" />
          <RingGauge label="Calcium" value={todayTotals.calcium_mg} goal={dailyTarget("calcium_mg")} unit="mg" color="var(--series-nutrition)" track="var(--series-nutrition-track)" />
          <RingGauge label="Iron" value={todayTotals.iron_mg} goal={dailyTarget("iron_mg")} unit="mg" color="var(--series-nutrition)" track="var(--series-nutrition-track)" />
          <RingGauge label="Vitamin C" value={todayTotals.vitamin_c_mg} goal={dailyTarget("vitamin_c_mg")} unit="mg" color="var(--series-nutrition)" track="var(--series-nutrition-track)" />
          <RingGauge label="Vitamin D" value={todayTotals.vitamin_d_mcg} goal={dailyTarget("vitamin_d_mcg")} unit="mcg" color="var(--series-nutrition)" track="var(--series-nutrition-track)" />
          <RingGauge label="Fiber" value={todayTotals.fiber_g} goal={dailyTarget("fiber_g")} unit="g" color="var(--series-nutrition)" track="var(--series-nutrition-track)" />
          <RingGauge label="Sugar" value={todayTotals.sugar_g} goal={dailyTarget("sugar_g")} unit="g" color="var(--series-nutrition)" track="var(--series-nutrition-track)" />
        </div>
      </div>
    </div>
  );
}
