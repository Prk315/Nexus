import { useState } from "react";
import { Moon, Plus, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { addSleepEntry, removeSleepEntry } from "../../store/slices/biomarkersSlice";
import type { CreateSleepEntry } from "../../store/types";
import { todayISO, formatMinutes, LABEL_STYLE, FIELD_GROUP, CARD_STYLE, SUBMIT_BTN_STYLE } from "../../lib/uiHelpers";

function qualityColor(score: number): string {
  if (score <= 4) return "var(--danger)";
  if (score <= 7) return "var(--warning)";
  return "var(--success)";
}

const INITIAL_FORM: CreateSleepEntry = {
  date: "",
  duration_min: 480,
  quality_score: 7,
  deep_sleep_min: null,
  rem_sleep_min: null,
  light_sleep_min: null,
  awake_time_min: null,
  respiratory_rate: null,
  temperature_deviation: null,
  bedtime_start: null,
  bedtime_end: null,
  notes: null,
};

export default function SleepLogger() {
  const dispatch = useAppDispatch();
  const entries = useAppSelector((s) => s.biomarkers.sleep);

  const [form, setForm] = useState<CreateSleepEntry>({ ...INITIAL_FORM, date: todayISO() });
  const [submitting, setSubmitting] = useState(false);

  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));

  const set = <K extends keyof CreateSleepEntry>(key: K, value: CreateSleepEntry[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await dispatch(addSleepEntry(form)).unwrap();
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
          <Moon size={16} color="var(--accent)" />
          <span style={{ fontWeight: 600, color: "var(--text)" }}>Log Sleep</span>
        </div>

        {/* Row 1: Date + Duration */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={FIELD_GROUP}>
            <label style={LABEL_STYLE}>Date</label>
            <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} required />
          </div>
          <div style={FIELD_GROUP}>
            <label style={LABEL_STYLE}>Duration (min)</label>
            <input
              type="number"
              value={form.duration_min}
              min={0} max={1440}
              onChange={(e) => set("duration_min", parseInt(e.target.value) || 0)}
              required
            />
          </div>
        </div>

        {/* Quality slider */}
        <div style={FIELD_GROUP}>
          <label style={LABEL_STYLE}>Quality Score: {form.quality_score}/10</label>
          <input
            type="range" min={1} max={10}
            value={form.quality_score}
            onChange={(e) => set("quality_score", parseInt(e.target.value))}
            style={{ width: "100%", accentColor: qualityColor(form.quality_score) }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)" }}>
            <span>Poor</span><span>Excellent</span>
          </div>
        </div>

        {/* Sleep stage breakdown */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Sleep Stages (optional)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
            <div style={FIELD_GROUP}>
              <label style={LABEL_STYLE}>Deep (min)</label>
              <input
                type="number" value={form.deep_sleep_min ?? ""} min={0} max={form.duration_min} placeholder="—"
                onChange={(e) => set("deep_sleep_min", e.target.value ? parseInt(e.target.value) : null)}
              />
            </div>
            <div style={FIELD_GROUP}>
              <label style={LABEL_STYLE}>REM (min)</label>
              <input
                type="number" value={form.rem_sleep_min ?? ""} min={0} max={form.duration_min} placeholder="—"
                onChange={(e) => set("rem_sleep_min", e.target.value ? parseInt(e.target.value) : null)}
              />
            </div>
            <div style={FIELD_GROUP}>
              <label style={LABEL_STYLE}>Light (min)</label>
              <input
                type="number" value={form.light_sleep_min ?? ""} min={0} max={form.duration_min} placeholder="—"
                onChange={(e) => set("light_sleep_min", e.target.value ? parseInt(e.target.value) : null)}
              />
            </div>
            <div style={FIELD_GROUP}>
              <label style={LABEL_STYLE}>Awake (min)</label>
              <input
                type="number" value={form.awake_time_min ?? ""} min={0} max={120} placeholder="—"
                onChange={(e) => set("awake_time_min", e.target.value ? parseInt(e.target.value) : null)}
              />
            </div>
          </div>
        </div>

        {/* Oura vitals */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Vitals (optional — populated by Oura import)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={FIELD_GROUP}>
              <label style={LABEL_STYLE}>Respiratory Rate (br/min)</label>
              <input
                type="number" value={form.respiratory_rate ?? ""} min={8} max={40} step={0.1} placeholder="—"
                onChange={(e) => set("respiratory_rate", e.target.value ? parseFloat(e.target.value) : null)}
              />
            </div>
            <div style={FIELD_GROUP}>
              <label style={LABEL_STYLE}>Temp. Deviation (°C)</label>
              <input
                type="number" value={form.temperature_deviation ?? ""} min={-5} max={5} step={0.01} placeholder="—"
                onChange={(e) => set("temperature_deviation", e.target.value ? parseFloat(e.target.value) : null)}
              />
            </div>
          </div>
        </div>

        {/* Bedtime window */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Bedtime Window (optional)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={FIELD_GROUP}>
              <label style={LABEL_STYLE}>Bedtime Start</label>
              <input
                type="datetime-local" value={form.bedtime_start ?? ""}
                onChange={(e) => set("bedtime_start", e.target.value || null)}
              />
            </div>
            <div style={FIELD_GROUP}>
              <label style={LABEL_STYLE}>Bedtime End (wake)</label>
              <input
                type="datetime-local" value={form.bedtime_end ?? ""}
                onChange={(e) => set("bedtime_end", e.target.value || null)}
              />
            </div>
          </div>
        </div>

        <div style={FIELD_GROUP}>
          <label style={LABEL_STYLE}>Notes (optional)</label>
          <textarea
            rows={2}
            value={form.notes ?? ""}
            placeholder="How did you sleep?"
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
            No sleep entries yet — start logging!
          </p>
        ) : (
          sorted.map((entry) => {
            const color = qualityColor(entry.quality_score);
            const totalStages =
              (entry.deep_sleep_min ?? 0) +
              (entry.rem_sleep_min ?? 0) +
              (entry.light_sleep_min ?? 0);
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
                  {/* Top row: date + quality badge */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, color: "var(--text)" }}>{entry.date}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color, background: color + "22", borderRadius: "var(--radius-sm)", padding: "1px 8px" }}>
                      Quality {entry.quality_score}/10
                    </span>
                    <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                      {formatMinutes(entry.duration_min)}
                    </span>
                    {entry.bedtime_start && (
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {entry.bedtime_start.slice(11, 16)} → {entry.bedtime_end?.slice(11, 16) ?? "?"}
                      </span>
                    )}
                  </div>

                  {/* Stage bar */}
                  {totalStages > 0 && (
                    <div style={{ display: "flex", gap: 0, height: 6, borderRadius: 3, overflow: "hidden", width: "100%", maxWidth: 320 }}>
                      {entry.deep_sleep_min != null && entry.deep_sleep_min > 0 && (
                        <div style={{ flex: entry.deep_sleep_min, background: "#3b82f6" }} title={`Deep: ${formatMinutes(entry.deep_sleep_min)}`} />
                      )}
                      {entry.rem_sleep_min != null && entry.rem_sleep_min > 0 && (
                        <div style={{ flex: entry.rem_sleep_min, background: "#8b5cf6" }} title={`REM: ${formatMinutes(entry.rem_sleep_min)}`} />
                      )}
                      {entry.light_sleep_min != null && entry.light_sleep_min > 0 && (
                        <div style={{ flex: entry.light_sleep_min, background: "#94a3b8" }} title={`Light: ${formatMinutes(entry.light_sleep_min)}`} />
                      )}
                    </div>
                  )}

                  {/* Stage chips */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12, color: "var(--text-secondary)" }}>
                    {entry.deep_sleep_min != null   && <span><span style={{ color: "#3b82f6", fontWeight: 600 }}>●</span> Deep {formatMinutes(entry.deep_sleep_min)}</span>}
                    {entry.rem_sleep_min != null    && <span><span style={{ color: "#8b5cf6", fontWeight: 600 }}>●</span> REM {formatMinutes(entry.rem_sleep_min)}</span>}
                    {entry.light_sleep_min != null  && <span><span style={{ color: "#94a3b8", fontWeight: 600 }}>●</span> Light {formatMinutes(entry.light_sleep_min)}</span>}
                    {entry.awake_time_min != null   && <span style={{ color: "var(--text-muted)" }}>Awake {formatMinutes(entry.awake_time_min)}</span>}
                  </div>

                  {/* Vitals row */}
                  {(entry.respiratory_rate != null || entry.temperature_deviation != null) && (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--text-muted)" }}>
                      {entry.respiratory_rate != null && <span>Resp {entry.respiratory_rate} br/min</span>}
                      {entry.temperature_deviation != null && (
                        <span style={{ color: entry.temperature_deviation > 0.5 ? "#f97316" : entry.temperature_deviation < -0.5 ? "#3b82f6" : "var(--text-muted)" }}>
                          Temp {entry.temperature_deviation > 0 ? "+" : ""}{entry.temperature_deviation}°C
                        </span>
                      )}
                    </div>
                  )}

                  {entry.notes && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{entry.notes}</span>}
                </div>
                <button
                  onClick={() => dispatch(removeSleepEntry(entry.id))}
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
