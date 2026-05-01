import { useState } from "react";
import { Plus, Trash2, Target, Trophy } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { addRunningPlan, removeRunningPlan } from "../../store/slices/runningSlice";
import type { RunningPlan } from "../../store/types";
import { CARD_PADDED, INPUT_STYLE, SECTION_LABEL, BTN_PRIMARY, ICON_BTN } from "../../lib/uiHelpers";

const GOAL_TYPES = [
  { value: "5k",            label: "5K",            weeks: { beginner: 8,  intermediate: 6,  advanced: 4  }, runsPerWeek: { beginner: 3, intermediate: 3, advanced: 4 }, color: "#0ea5e9" },
  { value: "10k",           label: "10K",           weeks: { beginner: 10, intermediate: 8,  advanced: 6  }, runsPerWeek: { beginner: 3, intermediate: 4, advanced: 4 }, color: "#8b5cf6" },
  { value: "half_marathon", label: "Half Marathon", weeks: { beginner: 18, intermediate: 14, advanced: 12 }, runsPerWeek: { beginner: 4, intermediate: 4, advanced: 5 }, color: "#f59e0b" },
  { value: "full_marathon", label: "Full Marathon", weeks: { beginner: 24, intermediate: 18, advanced: 16 }, runsPerWeek: { beginner: 4, intermediate: 5, advanced: 5 }, color: "#ef4444" },
  { value: "custom",        label: "Custom",        weeks: { beginner: 12, intermediate: 10, advanced: 8  }, runsPerWeek: { beginner: 3, intermediate: 4, advanced: 5 }, color: "#6b7280" },
] as const;

const FITNESS_LEVELS = [
  { value: "beginner",     label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced",     label: "Advanced" },
] as const;

type GoalType = typeof GOAL_TYPES[number]["value"];
type FitnessLevel = typeof FITNESS_LEVELS[number]["value"];

function getTrainingPreview(goalType: GoalType, fitnessLevel: FitnessLevel, weeklyKmBase: number): string {
  const goal = GOAL_TYPES.find((g) => g.value === goalType)!;
  const weeks = goal.weeks[fitnessLevel];
  const runs = goal.runsPerWeek[fitnessLevel];
  const peakKm = Math.round(weeklyKmBase * 1.6);
  return `~${weeks} weeks to ${goal.label} race day · ${runs} runs/week · Starting at ${weeklyKmBase} km/week, peaking at ~${peakKm} km/week`;
}

interface RunningPlanBuilderProps {
  onSelectPlan?: (plan: RunningPlan | null) => void;
  selectedPlanId?: string | null;
}

export default function RunningPlanBuilder({ onSelectPlan, selectedPlanId }: RunningPlanBuilderProps) {
  const dispatch = useAppDispatch();
  const plans = useAppSelector((s) => s.running.plans);

  const [name, setName] = useState("");
  const [goalType, setGoalType] = useState<GoalType>("5k");
  const [targetDate, setTargetDate] = useState("");
  const [weeklyKmBase, setWeeklyKmBase] = useState(20);
  const [fitnessLevel, setFitnessLevel] = useState<FitnessLevel>("beginner");

  const preview = getTrainingPreview(goalType, fitnessLevel, weeklyKmBase);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    dispatch(addRunningPlan({
      name: name.trim(),
      goal_type: goalType,
      target_date: targetDate || null,
      weekly_km_base: weeklyKmBase,
      fitness_level: fitnessLevel,
    }));
    setName("");
    setTargetDate("");
    setWeeklyKmBase(20);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    dispatch(removeRunningPlan(id));
    if (selectedPlanId === id) onSelectPlan?.(null);
  };

  return (
    <div>
      <div style={CARD_PADDED}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Target size={18} color="var(--accent)" />
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>New Running Plan</span>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label style={SECTION_LABEL}>Plan Name</label>
            <input style={INPUT_STYLE} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spring 10K Build" required />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={SECTION_LABEL}>Goal Type</label>
              <select style={{ ...INPUT_STYLE, cursor: "pointer" }} value={goalType} onChange={(e) => setGoalType(e.target.value as GoalType)}>
                {GOAL_TYPES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>
            <div>
              <label style={SECTION_LABEL}>Fitness Level</label>
              <select style={{ ...INPUT_STYLE, cursor: "pointer" }} value={fitnessLevel} onChange={(e) => setFitnessLevel(e.target.value as FitnessLevel)}>
                {FITNESS_LEVELS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={SECTION_LABEL}>Current Weekly km</label>
              <input
                style={INPUT_STYLE}
                type="number"
                value={weeklyKmBase}
                onChange={(e) => setWeeklyKmBase(Number(e.target.value))}
                min={0}
                step={1}
                placeholder="Your current weekly km"
              />
            </div>
            <div>
              <label style={SECTION_LABEL}>Target Race Date (optional)</label>
              <input style={INPUT_STYLE} type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </div>
          </div>

          <div style={{ padding: "10px 14px", background: "var(--bg)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", marginBottom: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>Training Preview</p>
            <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{preview}</p>
          </div>

          <button type="submit" style={BTN_PRIMARY}>
            <Plus size={14} /> Create Plan
          </button>
        </form>
      </div>

      {plans.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: 14, textAlign: "center", padding: "24px 0" }}>
          No running plans yet. Create one above.
        </p>
      ) : (
        plans.map((plan) => {
          const isSelected = selectedPlanId === plan.id;
          const goalMeta = GOAL_TYPES.find((g) => g.value === plan.goal_type);
          const color = goalMeta?.color ?? "#6b7280";
          const goalLabel = goalMeta?.label ?? plan.goal_type;
          const levelLabel = FITNESS_LEVELS.find((f) => f.value === plan.fitness_level)?.label ?? plan.fitness_level;
          return (
            <div
              key={plan.id}
              style={{
                ...CARD_PADDED,
                cursor: "pointer",
                borderColor: isSelected ? "var(--accent)" : "var(--border)",
                transition: "border-color 0.15s",
              }}
              onClick={() => onSelectPlan?.(isSelected ? null : plan)}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                  <Trophy size={16} color={color} style={{ flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {plan.name}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <span style={{ display: "inline-block", padding: "2px 8px", background: color, color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                    {goalLabel}
                  </span>
                  <button onClick={(e) => handleDelete(e, plan.id)} style={ICON_BTN}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 8, paddingLeft: 26, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Level: {levelLabel}</span>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Base: {plan.weekly_km_base} km/wk</span>
                {plan.target_date && (
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Race: {new Date(plan.target_date).toLocaleDateString()}</span>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
