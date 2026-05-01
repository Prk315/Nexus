import { useState } from "react";
import { Apple, Plus, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { addNutritionEntry, removeNutritionEntry } from "../../store/slices/biomarkersSlice";
import type { CreateNutritionEntry } from "../../store/types";
import { todayISO, LABEL_STYLE, FIELD_GROUP, CARD_STYLE, SUBMIT_BTN_STYLE } from "../../lib/uiHelpers";

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

const MACRO_COLORS: Record<string, string> = {
  calories: "#f59e0b",
  protein: "#3b82f6",
  carbs: "#10b981",
  fat: "#f87171",
};

function Pill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        color,
        background: color + "22",
        borderRadius: "var(--radius-sm)",
        padding: "1px 8px",
      }}
    >
      {label}: {value}
    </span>
  );
}

const INITIAL_FORM: CreateNutritionEntry = {
  date: "",
  meal_type: "lunch",
  calories: null,
  protein_g: null,
  carbs_g: null,
  fat_g: null,
  foods: null,
  notes: null,
};

export default function NutritionLogger() {
  const dispatch = useAppDispatch();
  const entries = useAppSelector((s) => s.biomarkers.nutrition);

  const [form, setForm] = useState<CreateNutritionEntry>({ ...INITIAL_FORM, date: todayISO() });
  const [submitting, setSubmitting] = useState(false);

  const sorted = [...entries].sort(
    (a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at),
  );

  const set = <K extends keyof CreateNutritionEntry>(key: K, value: CreateNutritionEntry[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await dispatch(addNutritionEntry(form)).unwrap();
      setForm({ ...INITIAL_FORM, date: todayISO() });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <form
        onSubmit={handleSubmit}
        style={{ ...CARD_STYLE, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Apple size={16} color="var(--accent)" />
          <span style={{ fontWeight: 600, color: "var(--text)" }}>Log Nutrition</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={FIELD_GROUP}>
            <label style={LABEL_STYLE}>Date</label>
            <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} required />
          </div>
          <div style={FIELD_GROUP}>
            <label style={LABEL_STYLE}>Meal Type</label>
            <select value={form.meal_type} onChange={(e) => set("meal_type", e.target.value)} required>
              {MEAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={FIELD_GROUP}>
          <label style={LABEL_STYLE}>What did you eat?</label>
          <input
            type="text"
            value={form.foods ?? ""}
            placeholder="e.g. chicken breast, rice, broccoli"
            onChange={(e) => set("foods", e.target.value || null)}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
          <div style={FIELD_GROUP}>
            <label style={LABEL_STYLE}>Calories</label>
            <input
              type="number"
              value={form.calories ?? ""}
              min={0}
              placeholder="—"
              onChange={(e) => set("calories", e.target.value ? parseInt(e.target.value) : null)}
            />
          </div>
          <div style={FIELD_GROUP}>
            <label style={LABEL_STYLE}>Protein (g)</label>
            <input
              type="number"
              value={form.protein_g ?? ""}
              min={0}
              step={0.1}
              placeholder="—"
              onChange={(e) => set("protein_g", e.target.value ? parseFloat(e.target.value) : null)}
            />
          </div>
          <div style={FIELD_GROUP}>
            <label style={LABEL_STYLE}>Carbs (g)</label>
            <input
              type="number"
              value={form.carbs_g ?? ""}
              min={0}
              step={0.1}
              placeholder="—"
              onChange={(e) => set("carbs_g", e.target.value ? parseFloat(e.target.value) : null)}
            />
          </div>
          <div style={FIELD_GROUP}>
            <label style={LABEL_STYLE}>Fat (g)</label>
            <input
              type="number"
              value={form.fat_g ?? ""}
              min={0}
              step={0.1}
              placeholder="—"
              onChange={(e) => set("fat_g", e.target.value ? parseFloat(e.target.value) : null)}
            />
          </div>
        </div>

        <div style={FIELD_GROUP}>
          <label style={LABEL_STYLE}>Notes (optional)</label>
          <textarea
            rows={2}
            value={form.notes ?? ""}
            placeholder="Any notes about this meal?"
            style={{ resize: "vertical" }}
            onChange={(e) => set("notes", e.target.value || null)}
          />
        </div>

        <button type="submit" disabled={submitting} style={SUBMIT_BTN_STYLE}>
          <Plus size={14} />
          {submitting ? "Saving..." : "Add Entry"}
        </button>
      </form>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sorted.length === 0 ? (
          <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>
            No nutrition entries yet — start logging!
          </p>
        ) : (
          sorted.map((entry) => (
            <div
              key={entry.id}
              style={{
                ...CARD_STYLE,
                padding: "12px 16px",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600, color: "var(--text)" }}>{entry.date}</span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--accent)",
                      background: "var(--accent)22",
                      borderRadius: "var(--radius-sm)",
                      padding: "1px 8px",
                      textTransform: "capitalize",
                    }}
                  >
                    {entry.meal_type}
                  </span>
                  {entry.foods && (
                    <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{entry.foods}</span>
                  )}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {entry.calories != null && <Pill label="kcal" value={String(entry.calories)} color={MACRO_COLORS.calories} />}
                  {entry.protein_g != null && <Pill label="protein" value={`${entry.protein_g}g`} color={MACRO_COLORS.protein} />}
                  {entry.carbs_g != null && <Pill label="carbs" value={`${entry.carbs_g}g`} color={MACRO_COLORS.carbs} />}
                  {entry.fat_g != null && <Pill label="fat" value={`${entry.fat_g}g`} color={MACRO_COLORS.fat} />}
                </div>
                {entry.notes && (
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{entry.notes}</span>
                )}
              </div>
              <button
                onClick={() => dispatch(removeNutritionEntry(entry.id))}
                style={{ background: "transparent", color: "var(--text-muted)", padding: "4px 6px", flexShrink: 0 }}
                title="Delete entry"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
