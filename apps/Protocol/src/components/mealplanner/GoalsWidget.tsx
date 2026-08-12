import { useState } from "react";
import { Target } from "lucide-react";
import { CARD_STYLE } from "../../lib/uiHelpers";
import { goalTarget } from "../../lib/nutritionScore";
import GoalsModal, { type CalorieStrategy } from "./GoalsModal";
import type { NutrientTotals } from "../../lib/mealNutrition";
import type { NutritionGoalItem, CreateNutritionGoalItem } from "../../store/types";

function Stat({ label, value, goal, unit }: { label: string; value: number; goal: number | null; unit: string }) {
  const pct = goal ? Math.min(100, Math.round((value / goal) * 100)) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 74 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
        {Math.round(value)}
        <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>
          {unit}{goal ? ` / ${Math.round(goal)}${unit}` : ""}
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: "var(--progress-bg)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct ?? 0}%`, background: "var(--accent)", borderRadius: 2 }} />
      </div>
    </div>
  );
}

export default function GoalsWidget({
  weekTotals, goals, calorie, weekCalorieTarget, onSave,
}: {
  weekTotals: NutrientTotals;
  goals: NutritionGoalItem[];
  calorie: CalorieStrategy | null;
  /** This week's dynamic calorie target (Σ daily base + active + offset). */
  weekCalorieTarget: number;
  onSave: (items: CreateNutritionGoalItem[], calorie: CalorieStrategy) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  // Goals are weekly, so compare this week's totals directly to the weekly goal.
  const weeklyGoal = (key: string) => goalTarget(goals.find((g) => g.nutrient_key === key));

  return (
    <>
      <div style={{ ...CARD_STYLE, padding: "12px 16px", display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>This&nbsp;week</span>
        <Stat label="Calories" value={weekTotals.calories} goal={weekCalorieTarget} unit="" />
        <Stat label="Protein" value={weekTotals.protein_g} goal={weeklyGoal("protein_g")} unit="g" />
        <Stat label="Carbs" value={weekTotals.carbs_g} goal={weeklyGoal("carbs_g")} unit="g" />
        <button
          onClick={() => setEditing(true)}
          title={goals.length ? "Edit goals" : "Set goals"}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 30, height: 30, flexShrink: 0,
            background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
            color: "var(--text-secondary)", cursor: "pointer", alignSelf: "flex-end",
          }}
        >
          <Target size={14} />
        </button>
      </div>

      {editing && (
        <GoalsModal goals={goals} calorie={calorie} onSave={onSave} onClose={() => setEditing(false)} />
      )}
    </>
  );
}
