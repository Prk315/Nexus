import { useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  RadialBarChart, RadialBar, PolarAngleAxis, ReferenceLine, Cell,
} from "recharts";
import { CARD_STYLE } from "../../lib/uiHelpers";
import RingGauge from "./RingGauge";
import { goalTarget } from "../../lib/nutritionScore";
import { NUTRIENT_META } from "../../lib/nutrients";
import type { NutrientTotals } from "../../lib/mealNutrition";
import type { NutritionGoalItem } from "../../store/types";

/** Reference daily values (adult) — used to normalise mixed-unit nutrients to a
 *  comparable "% of daily value" so they can share one bar chart. */
const RDV: Record<string, number> = {
  protein_g: 50, carbs_g: 275, fiber_g: 28, sugar_g: 50, added_sugar_g: 50,
  fat_g: 78, saturated_fat_g: 20, omega3_mg: 1600,
  sodium_mg: 2300, potassium_mg: 4700, calcium_mg: 1300, iron_mg: 18, magnesium_mg: 420,
  zinc_mg: 11, phosphorus_mg: 1250, copper_mg: 0.9, manganese_mg: 2.3, selenium_mcg: 55,
  iodine_mcg: 150, chloride_mg: 2300, chromium_mcg: 35, molybdenum_mcg: 45,
  vitamin_a_mcg: 900, thiamin_mg: 1.2, riboflavin_mg: 1.3, niacin_mg: 16, pantothenic_acid_mg: 5,
  vitamin_b6_mg: 1.7, biotin_mcg: 30, folate_mcg: 400, vitamin_b12_mcg: 2.4, vitamin_c_mg: 90,
  vitamin_d_mcg: 20, vitamin_e_mg: 15, vitamin_k_mcg: 120, choline_mg: 550,
  cholesterol_mg: 300, water_ml: 3000,
};

/** Colour per nutrient group, for the coverage bars. */
const GROUP_COLOR: Record<string, string> = {
  Macros: "#10b981", "Amino Acids": "#8b5cf6", Minerals: "#3b82f6",
  Vitamins: "#f59e0b", Other: "#ec4899", Supplements: "#14b8a6", Medication: "#ef4444",
};

const META = new Map<string, (typeof NUTRIENT_META)[number]>(NUTRIENT_META.map((m) => [m.key, m]));

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

  // Macro split as % of today's energy — the nested-ring infographic.
  const macroRadial = useMemo(() => {
    const kP = todayTotals.protein_g * 4, kC = todayTotals.carbs_g * 4, kF = todayTotals.fat_g * 9;
    const total = kP + kC + kF;
    const pc = (x: number) => (total > 0 ? Math.round((x / total) * 100) : 0);
    return [
      { label: "Protein", grams: todayTotals.protein_g, pct: pc(kP), color: MACRO_COLORS.protein, desc: "builds & repairs muscle" },
      { label: "Carbs",   grams: todayTotals.carbs_g,   pct: pc(kC), color: MACRO_COLORS.carbs,   desc: "primary energy" },
      { label: "Fat",     grams: todayTotals.fat_g,     pct: pc(kF), color: MACRO_COLORS.fat,     desc: "hormones & vitamin uptake" },
    ];
  }, [todayTotals]);

  // Every logged nutrient with a reference daily value, normalised to % DV so
  // mixed units (kcal, g, mg, mcg) share one bar chart. Grouped + colour-coded.
  const coverage = useMemo(() => {
    const t = todayTotals as unknown as Record<string, number>;
    return Object.keys(RDV)
      .map((key) => {
        const amount = Number(t[key] ?? 0);
        if (amount <= 0) return null;
        const meta = META.get(key);
        const group = meta?.group ?? "Other";
        const pct = Math.round((amount / RDV[key]) * 100);
        return { key, label: meta?.label ?? key, unit: meta?.unit ?? "", group, amount, pct, plotted: Math.min(pct, 200), color: GROUP_COLOR[group] ?? "#888888" };
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .sort((a, b) => (a.group === b.group ? b.pct - a.pct : a.group.localeCompare(b.group)));
  }, [todayTotals]);

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

        {/* Macro breakdown — nested-ring infographic (share of today's energy) */}
        <div style={{ flex: "1 1 300px", minWidth: 280, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>
            Macros today
          </div>
          {hasMacros ? (
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ position: "relative", width: 150, height: 150, flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart data={macroRadial} innerRadius="30%" outerRadius="100%" startAngle={90} endAngle={-270} barCategoryGap={2}>
                    <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
                    <RadialBar dataKey="pct" cornerRadius={5} background={{ fill: "var(--progress-bg)" }} isAnimationActive={false}>
                      {macroRadial.map((m) => <Cell key={m.label} fill={m.color} />)}
                    </RadialBar>
                  </RadialBarChart>
                </ResponsiveContainer>
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text)" }}>{Math.round(todayTotals.calories)}</div>
                  <div style={{ fontSize: 9, color: "var(--text-muted)" }}>kcal</div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                {macroRadial.map((m) => (
                  <div key={m.label} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: m.color, flexShrink: 0, transform: "translateY(1px)" }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: "var(--text)" }}><strong>{m.pct}%</strong> <span style={{ color: "var(--text-secondary)" }}>{m.label} · {Math.round(m.grams)}g</span></div>
                      <div style={{ fontSize: 9, color: "var(--text-muted)", lineHeight: 1.2 }}>{m.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
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

      {/* Daily coverage — every logged nutrient with a reference value, normalised */}
      {coverage.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>Daily coverage</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
            Every logged nutrient as % of its reference daily value, so mixed units compare. Dashed line = 100%.
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={coverage} margin={{ top: 8, right: 8, bottom: 52, left: -12 }}>
              <CartesianGrid stroke="var(--border-subtle)" strokeWidth={1} vertical={false} />
              <XAxis dataKey="label" interval={0} tick={{ fontSize: 9, fill: "var(--text-muted)" }} angle={-45} textAnchor="end" height={64} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} domain={[0, (m: number) => Math.max(120, Math.ceil(m / 20) * 20)]} />
              <Tooltip content={<CoverageTip />} />
              <ReferenceLine y={100} stroke="var(--text-muted)" strokeDasharray="4 4" strokeOpacity={0.6} />
              <Bar dataKey="plotted" radius={[2, 2, 0, 0]} maxBarSize={13} isAnimationActive={false}>
                {coverage.map((c) => <Cell key={c.key} fill={c.color} />)}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 2 }}>
            {[...new Set(coverage.map((c) => c.group))].map((g) => (
              <span key={g} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--text-muted)" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: GROUP_COLOR[g] ?? "#888888" }} /> {g}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Tooltip for the coverage bars — shows the real amount + unit + % DV. Uses a
 *  content component (not a formatter) to sidestep recharts' Formatter typing. */
function CoverageTip({ active, payload }: { active?: boolean; payload?: { payload: { label: string; amount: number; unit: string; pct: number } }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{ ...TOOLTIP_STYLE, padding: "6px 10px" }}>
      <strong>{p.label}</strong> — {Math.round(p.amount)} {p.unit} · {p.pct}% DV
    </div>
  );
}
