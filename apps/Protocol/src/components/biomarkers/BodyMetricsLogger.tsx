import { useState } from "react";
import { Activity, Plus, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { addBodyMetric, removeBodyMetric } from "../../store/slices/biomarkersSlice";
import type { BodyMetric, CreateBodyMetric } from "../../store/types";
import { todayISO, LABEL_STYLE, FIELD_GROUP, CARD_STYLE, SUBMIT_BTN_STYLE } from "../../lib/uiHelpers";

const CHIP_COLORS = {
  weight: "#8b5cf6",
  hrv: "#3b82f6",
  hr: "#ef4444",
  spo2: "#10b981",
  readiness: "#f59e0b",
  temp: "#f97316",
  recovery: "#06b6d4",
};

interface MetricChip { label: string; value: string; color: string; }

function buildChips(entry: BodyMetric): MetricChip[] {
  const chips: MetricChip[] = [];
  if (entry.readiness_score != null)
    chips.push({ label: "Readiness", value: `${entry.readiness_score}`, color: CHIP_COLORS.readiness });
  if (entry.hrv_ms != null)
    chips.push({ label: "HRV", value: `${entry.hrv_ms} ms`, color: CHIP_COLORS.hrv });
  if (entry.resting_hr_bpm != null)
    chips.push({ label: "Resting HR", value: `${entry.resting_hr_bpm} bpm`, color: CHIP_COLORS.hr });
  if (entry.weight_kg != null)
    chips.push({ label: "Weight", value: `${entry.weight_kg} kg`, color: CHIP_COLORS.weight });
  if (entry.spo2_pct != null)
    chips.push({ label: "SpO₂", value: `${entry.spo2_pct}%`, color: CHIP_COLORS.spo2 });
  if (entry.temperature_deviation != null)
    chips.push({
      label: "Temp dev",
      value: `${entry.temperature_deviation > 0 ? "+" : ""}${entry.temperature_deviation}°C`,
      color: entry.temperature_deviation > 0.5 ? "#f97316" : entry.temperature_deviation < -0.5 ? "#3b82f6" : CHIP_COLORS.temp,
    });
  if (entry.recovery_index != null)
    chips.push({ label: "Recovery", value: `${entry.recovery_index}`, color: CHIP_COLORS.recovery });
  return chips;
}

const INITIAL_FORM: CreateBodyMetric = {
  date: "",
  weight_kg: null,
  hrv_ms: null,
  resting_hr_bpm: null,
  spo2_pct: null,
  readiness_score: null,
  temperature_deviation: null,
  recovery_index: null,
  notes: null,
};

export default function BodyMetricsLogger() {
  const dispatch = useAppDispatch();
  const entries = useAppSelector((s) => s.biomarkers.bodyMetrics);

  const [form, setForm] = useState<CreateBodyMetric>({ ...INITIAL_FORM, date: todayISO() });
  const [submitting, setSubmitting] = useState(false);

  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));

  const set = <K extends keyof CreateBodyMetric>(key: K, value: CreateBodyMetric[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await dispatch(addBodyMetric(form)).unwrap();
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
          <Activity size={16} color="var(--accent)" />
          <span style={{ fontWeight: 600, color: "var(--text)" }}>Log Body Metrics</span>
        </div>

        <div style={FIELD_GROUP}>
          <label style={LABEL_STYLE}>Date</label>
          <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} required />
        </div>

        {/* Oura readiness */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Oura Readiness (optional)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div style={FIELD_GROUP}>
              <label style={LABEL_STYLE}>Readiness Score (0–100)</label>
              <input
                type="number" value={form.readiness_score ?? ""} min={0} max={100} placeholder="—"
                onChange={(e) => set("readiness_score", e.target.value ? parseInt(e.target.value) : null)}
              />
            </div>
            <div style={FIELD_GROUP}>
              <label style={LABEL_STYLE}>Recovery Index</label>
              <input
                type="number" value={form.recovery_index ?? ""} min={0} max={10} step={0.1} placeholder="—"
                onChange={(e) => set("recovery_index", e.target.value ? parseFloat(e.target.value) : null)}
              />
            </div>
            <div style={FIELD_GROUP}>
              <label style={LABEL_STYLE}>Temp Deviation (°C)</label>
              <input
                type="number" value={form.temperature_deviation ?? ""} min={-5} max={5} step={0.01} placeholder="—"
                onChange={(e) => set("temperature_deviation", e.target.value ? parseFloat(e.target.value) : null)}
              />
            </div>
          </div>
        </div>

        {/* Core biometrics */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Biometrics (optional)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
            <div style={FIELD_GROUP}>
              <label style={LABEL_STYLE}>HRV (ms)</label>
              <input
                type="number" value={form.hrv_ms ?? ""} min={0} max={300} step={0.1} placeholder="—"
                onChange={(e) => set("hrv_ms", e.target.value ? parseFloat(e.target.value) : null)}
              />
            </div>
            <div style={FIELD_GROUP}>
              <label style={LABEL_STYLE}>Resting HR (bpm)</label>
              <input
                type="number" value={form.resting_hr_bpm ?? ""} min={0} max={250} placeholder="—"
                onChange={(e) => set("resting_hr_bpm", e.target.value ? parseInt(e.target.value) : null)}
              />
            </div>
            <div style={FIELD_GROUP}>
              <label style={LABEL_STYLE}>Weight (kg)</label>
              <input
                type="number" value={form.weight_kg ?? ""} min={0} max={500} step={0.1} placeholder="—"
                onChange={(e) => set("weight_kg", e.target.value ? parseFloat(e.target.value) : null)}
              />
            </div>
            <div style={FIELD_GROUP}>
              <label style={LABEL_STYLE}>SpO₂ (%)</label>
              <input
                type="number" value={form.spo2_pct ?? ""} min={0} max={100} step={0.1} placeholder="—"
                onChange={(e) => set("spo2_pct", e.target.value ? parseFloat(e.target.value) : null)}
              />
            </div>
          </div>
        </div>

        <div style={FIELD_GROUP}>
          <label style={LABEL_STYLE}>Notes (optional)</label>
          <textarea
            rows={2}
            value={form.notes ?? ""}
            placeholder="Any notes about today's metrics?"
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
            No body metrics yet — start logging!
          </p>
        ) : (
          sorted.map((entry) => {
            const chips = buildChips(entry);
            return (
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
                <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                  <span style={{ fontWeight: 600, color: "var(--text)" }}>{entry.date}</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {chips.length > 0 ? (
                      chips.map((chip) => (
                        <span
                          key={chip.label}
                          style={{
                            fontSize: 12, fontWeight: 600,
                            color: chip.color,
                            background: chip.color + "22",
                            borderRadius: "var(--radius-sm)",
                            padding: "1px 8px",
                          }}
                        >
                          {chip.label}: {chip.value}
                        </span>
                      ))
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>No metrics recorded</span>
                    )}
                  </div>
                  {entry.notes && (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{entry.notes}</span>
                  )}
                </div>
                <button
                  onClick={() => dispatch(removeBodyMetric(entry.id))}
                  style={{ background: "transparent", color: "var(--text-muted)", padding: "4px 6px", flexShrink: 0 }}
                  title="Delete entry"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
