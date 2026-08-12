import { useMemo, useState } from "react";
import { Target, Check } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { saveActivityGoals } from "../../store/slices/workoutsSlice";
import { CARD_STYLE, INPUT_SM, todayISO } from "../../lib/uiHelpers";

function addDaysISO(dateStr: string, delta: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Weekly training targets — strength sessions/week and running km/week. These
 * drive the dashboard's Workout & Running scores (rolling last-7-days vs the
 * goal). Shows this week's progress so the target has immediate context.
 */
export default function WeeklyGoalsCard() {
  const dispatch = useAppDispatch();
  const goals = useAppSelector((s) => s.workouts.activityGoals);
  const sessions = useAppSelector((s) => s.workouts.sessions);
  const runs = useAppSelector((s) => s.running.sessions);

  const [strength, setStrength] = useState("");
  const [km, setKm] = useState("");
  const [saving, setSaving] = useState(false);
  // Seed the inputs from the stored goals once they arrive (keying the fields on
  // the stored values, so an edit-in-progress isn't clobbered by a refetch).
  const [seeded, setSeeded] = useState(false);
  if (!seeded && goals) {
    setStrength(goals.strength_sessions_per_week != null ? String(goals.strength_sessions_per_week) : "");
    setKm(goals.running_km_per_week != null ? String(goals.running_km_per_week) : "");
    setSeeded(true);
  }

  const today = todayISO();
  const weekAgo = addDaysISO(today, -6);
  const strengthThisWeek = useMemo(
    () => sessions.filter((s) => s.completed && s.scheduled_date >= weekAgo && s.scheduled_date <= today).length,
    [sessions, weekAgo, today],
  );
  const kmThisWeek = useMemo(
    () => runs.filter((r) => r.completed && r.date >= weekAgo && r.date <= today).reduce((a, r) => a + (r.actual_km ?? 0), 0),
    [runs, weekAgo, today],
  );

  async function save() {
    setSaving(true);
    try {
      await dispatch(saveActivityGoals({
        strength_sessions_per_week: strength.trim() !== "" ? Number(strength) : null,
        running_km_per_week: km.trim() !== "" ? Number(km) : null,
      })).unwrap();
    } finally {
      setSaving(false);
    }
  }

  const strengthGoal = strength.trim() !== "" ? Number(strength) : null;
  const kmGoal = km.trim() !== "" ? Number(km) : null;

  return (
    <div style={{ ...CARD_STYLE, padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Target size={16} color="var(--accent)" />
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>Weekly Goals</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· drive the dashboard Workout &amp; Running scores</span>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <GoalField
          label="Strength sessions / week"
          value={strength}
          onChange={setStrength}
          actual={strengthThisWeek}
          goal={strengthGoal}
          unit=""
          color="var(--series-workout)"
        />
        <GoalField
          label="Running km / week"
          value={km}
          onChange={setKm}
          actual={Math.round(kmThisWeek * 10) / 10}
          goal={kmGoal}
          unit="km"
          color="var(--series-running)"
        />
        <button
          onClick={save}
          disabled={saving}
          style={{ alignSelf: "flex-end", display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "var(--accent)", color: "var(--accent-fg)", border: "none", borderRadius: "var(--radius-sm)", fontWeight: 600, fontSize: 13, cursor: "pointer", opacity: saving ? 0.6 : 1 }}
        >
          <Check size={14} /> {saving ? "Saving…" : "Save goals"}
        </button>
      </div>
    </div>
  );
}

function GoalField({
  label, value, onChange, actual, goal, unit, color,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  actual: number;
  goal: number | null;
  unit: string;
  color: string;
}) {
  const pct = goal && goal > 0 ? Math.min(100, Math.round((actual / goal) * 100)) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 180 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </label>
      <input type="number" min={0} value={value} onChange={(e) => onChange(e.target.value)} placeholder="—" style={{ ...INPUT_SM, width: 120 }} />
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        This week: <strong style={{ color: "var(--text)" }}>{actual}{unit}</strong>
        {goal ? ` / ${goal}${unit}` : " · no goal set"}
        {pct != null ? ` · ${pct}%` : ""}
      </div>
      <div style={{ height: 5, borderRadius: 3, background: "var(--progress-bg)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct ?? 0}%`, background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}
