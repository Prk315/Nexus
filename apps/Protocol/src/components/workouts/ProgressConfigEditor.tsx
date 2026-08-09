import { useState } from "react";
import { Plus, X } from "lucide-react";
import { BIOMARKER_OPTIONS } from "../../lib/progressStats";
import { RUN_METRIC_OPTIONS, type Activity, type TrackingConfig } from "../../lib/trackingConfig";
import { INPUT_SM } from "../../lib/uiHelpers";
import ExerciseNameInput from "./ExerciseNameInput";

function toggle(arr: string[], key: string): string[] {
  return arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key];
}

function Chip({ label, on, color, onClick }: { label: string; on: boolean; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", fontSize: 12, fontWeight: 600,
        cursor: "pointer", borderRadius: 999,
        border: `1px solid ${on ? color : "var(--border)"}`,
        background: on ? `${color}22` : "transparent",
        color: on ? "var(--text)" : "var(--text-muted)",
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: on ? color : "var(--border)" }} />
      {label}
    </button>
  );
}

/** Inline CRUD for what a progress card tracks: biomarkers (both activities),
 *  tracked exercises' weight (strength) and run metrics like speed (running). */
export default function ProgressConfigEditor({
  activity, config, onChange,
}: {
  activity: Activity;
  config: TrackingConfig;
  onChange: (cfg: TrackingConfig) => void;
}) {
  const [exName, setExName] = useState("");

  const addExercise = () => {
    const n = exName.trim();
    if (!n || config.exercises.includes(n)) { setExName(""); return; }
    onChange({ ...config, exercises: [...config.exercises, n] });
    setExName("");
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "14px 16px", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Biomarkers */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Biomarkers</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {BIOMARKER_OPTIONS.map((o) => (
            <Chip key={o.key} label={o.name} color={o.color} on={config.biomarkers.includes(o.key)} onClick={() => onChange({ ...config, biomarkers: toggle(config.biomarkers, o.key) })} />
          ))}
        </div>
      </div>

      {/* Running metrics */}
      {activity === "running" && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Tracked metrics</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {RUN_METRIC_OPTIONS.map((o) => (
              <Chip key={o.key} label={o.name} color={o.color} on={config.runMetrics.includes(o.key)} onClick={() => onChange({ ...config, runMetrics: toggle(config.runMetrics, o.key) })} />
            ))}
          </div>
        </div>
      )}

      {/* Tracked exercises (strength) */}
      {activity === "strength" && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Tracked exercises (weight / 1RM)</div>
          {config.exercises.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {config.exercises.map((n) => (
                <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", fontSize: 12, borderRadius: 999, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}>
                  {n}
                  <button onClick={() => onChange({ ...config, exercises: config.exercises.filter((x) => x !== n) })} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", padding: 0 }}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ExerciseNameInput value={exName} onChange={(n) => setExName(n)} placeholder="Add an exercise to track…" />
            </div>
            <button onClick={addExercise} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", flexShrink: 0, ...(INPUT_SM.height ? { height: INPUT_SM.height } : {}) }}>
              <Plus size={13} /> Add
            </button>
          </div>
          {config.exercises.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>Nothing tracked yet — showing your 3 most-logged exercises by default.</div>
          )}
        </div>
      )}
    </div>
  );
}
