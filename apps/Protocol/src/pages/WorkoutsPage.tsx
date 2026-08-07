import { useState } from "react";
import { Dumbbell, Footprints, Activity } from "lucide-react";
import StrengthPane from "../components/workouts/panes/StrengthPane";
import RunningPane from "../components/workouts/panes/RunningPane";
import ActivityModule from "../components/biomarkers/ActivityModule";

type PaneId = "strength" | "running" | "activities";
const PANES: { id: PaneId; label: string; icon: typeof Dumbbell }[] = [
  { id: "strength", label: "Strength Training", icon: Dumbbell },
  { id: "running", label: "Running", icon: Footprints },
  { id: "activities", label: "Activities", icon: Activity },
];

/**
 * Workouts is the training dashboard — strength, running and general activities
 * all live here as panes. Running used to be its own top-level tab; it moved in
 * so everything training-related sits under one roof.
 */
export default function WorkoutsPage() {
  const [pane, setPane] = useState<PaneId>("strength");

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Dumbbell size={24} color="var(--accent)" />
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0 }}>Workouts</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
            Strength, running and activities — your whole training picture in one place
          </p>
        </div>
      </div>

      {/* Pane tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 24, flexWrap: "wrap" }}>
        {PANES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setPane(id)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "none", border: "none", cursor: "pointer",
              padding: "8px 12px", marginRight: 4,
              fontSize: 13, fontWeight: 600,
              color: pane === id ? "var(--accent)" : "var(--text-muted)",
              borderBottom: `2px solid ${pane === id ? "var(--accent)" : "transparent"}`,
            }}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {pane === "strength" && <StrengthPane />}
      {pane === "running" && <RunningPane />}
      {pane === "activities" && <ActivityModule />}
    </div>
  );
}
