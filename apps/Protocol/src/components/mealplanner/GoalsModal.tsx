import { useState } from "react";
import { X, Check } from "lucide-react";
import { CARD_STYLE, INPUT_SM, LABEL_STYLE, FIELD_GROUP } from "../../lib/uiHelpers";
import type { NutritionGoals, UpdateNutritionGoals } from "../../store/types";

const ROWS: [keyof UpdateNutritionGoals, string][][] = [
  [["calories", "Calories"], ["protein_g", "Protein (g)"], ["carbs_g", "Carbs (g)"], ["fat_g", "Fat (g)"]],
  [["fiber_g", "Fiber (g)"], ["sugar_g", "Sugar (g)"], ["sodium_mg", "Sodium (mg)"], ["potassium_mg", "Potassium (mg)"]],
  [["calcium_mg", "Calcium (mg)"], ["iron_mg", "Iron (mg)"], ["vitamin_c_mg", "Vitamin C (mg)"], ["vitamin_d_mcg", "Vitamin D (mcg)"]],
];

export default function GoalsModal({
  goals, onSave, onClose,
}: {
  goals: NutritionGoals | null;
  onSave: (goals: UpdateNutritionGoals) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<UpdateNutritionGoals>(goals ? { ...goals } : {});
  const [saving, setSaving] = useState(false);

  const setGoal = (key: keyof UpdateNutritionGoals, value: string) =>
    setForm((g) => ({ ...g, [key]: value ? Number(value) : null }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: 60, zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{ ...CARD_STYLE, width: 460, maxHeight: "80vh", overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>Daily nutrition goals</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {ROWS.map((row, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
              {row.map(([key, label]) => (
                <div key={key} style={FIELD_GROUP}>
                  <label style={LABEL_STYLE}>{label}</label>
                  <input type="number" value={form[key] ?? ""} onChange={(e) => setGoal(key, e.target.value)} style={INPUT_SM} />
                </div>
              ))}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              disabled={saving}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "var(--accent)", color: "var(--accent-fg)", border: "none", borderRadius: "var(--radius-sm)", fontWeight: 600, fontSize: 13, cursor: "pointer", opacity: saving ? 0.6 : 1 }}
            >
              <Check size={13} /> Save
            </button>
            <button type="button" onClick={onClose} style={{ background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 14px", fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
