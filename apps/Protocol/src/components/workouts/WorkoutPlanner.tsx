import { useState } from "react";
import { Plus, Trash2, ChevronRight, Dumbbell } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { addWorkoutPlan, removeWorkoutPlan } from "../../store/slices/workoutsSlice";
import type { WorkoutPlan } from "../../store/types";
import { CARD_PADDED, INPUT_STYLE, SECTION_LABEL, BTN_PRIMARY, ICON_BTN } from "../../lib/uiHelpers";

interface WorkoutPlannerProps {
  onSelectPlan?: (plan: WorkoutPlan | null) => void;
  selectedPlanId?: string | null;
}

const badge: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  background: "var(--accent)",
  color: "#fff",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
};

export default function WorkoutPlanner({ onSelectPlan, selectedPlanId }: WorkoutPlannerProps) {
  const dispatch = useAppDispatch();
  const plans = useAppSelector((s) => s.workouts.plans);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [daysPerWeek, setDaysPerWeek] = useState(3);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    dispatch(addWorkoutPlan({ name: name.trim(), description: description.trim() || null, days_per_week: daysPerWeek }));
    setName("");
    setDescription("");
    setDaysPerWeek(3);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    dispatch(removeWorkoutPlan(id));
    if (selectedPlanId === id) onSelectPlan?.(null);
  };

  const handlePlanClick = (plan: WorkoutPlan) => {
    onSelectPlan?.(selectedPlanId === plan.id ? null : plan);
  };

  return (
    <div>
      <div style={CARD_PADDED}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Dumbbell size={18} color="var(--accent)" />
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>New Workout Plan</span>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label style={SECTION_LABEL}>Plan Name</label>
            <input
              style={INPUT_STYLE}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Strength Block A"
              required
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={SECTION_LABEL}>Description (optional)</label>
            <textarea
              style={{ ...INPUT_STYLE, resize: "vertical", minHeight: 60 }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this plan focused on?"
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={SECTION_LABEL}>Days per Week</label>
            <select
              style={{ ...INPUT_STYLE, cursor: "pointer" }}
              value={daysPerWeek}
              onChange={(e) => setDaysPerWeek(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>
              ))}
            </select>
          </div>
          <button type="submit" style={BTN_PRIMARY}>
            <Plus size={14} />
            Create Plan
          </button>
        </form>
      </div>

      {plans.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: 14, textAlign: "center", padding: "24px 0" }}>
          No plans yet. Create one above.
        </p>
      ) : (
        plans.map((plan) => {
          const isExpanded = selectedPlanId === plan.id;
          return (
            <div
              key={plan.id}
              style={{
                ...CARD_PADDED,
                cursor: "pointer",
                borderColor: isExpanded ? "var(--accent)" : "var(--border)",
                transition: "border-color 0.15s",
              }}
              onClick={() => handlePlanClick(plan)}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                  <ChevronRight
                    size={16}
                    color="var(--text-muted)"
                    style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
                  />
                  <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {plan.name}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={badge}>{plan.days_per_week}d/wk</span>
                  <button onClick={(e) => handleDelete(e, plan.id)} style={ICON_BTN} title="Delete plan">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                  {plan.description && (
                    <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>
                      {plan.description}
                    </p>
                  )}
                  <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-muted)" }}>
                    <span>Created: {new Date(plan.created_at).toLocaleDateString()}</span>
                    <span>{plan.days_per_week} training days/week</span>
                  </div>
                  <p style={{ marginTop: 10, fontSize: 12, color: "var(--accent)", fontWeight: 500 }}>
                    Sessions for this plan are shown on the right.
                  </p>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
