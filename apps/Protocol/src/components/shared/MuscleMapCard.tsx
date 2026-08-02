import { Activity } from "lucide-react";
import MuscleMap from "../workouts/MuscleMap";
import GarminSyncPanel from "./GarminSyncPanel";
import { useExerciseSets } from "../../lib/useExerciseSets";
import { CARD_STYLE } from "../../lib/uiHelpers";

/** Self-contained — fetches its own data, so it can be dropped into any page
 * with no wiring. `showSync` controls whether the Garmin sync trigger renders
 * alongside it (on by default for the Workouts tab, off for glance-only
 * placements like Dashboard/Biomarkers). */
export default function MuscleMapCard({ showSync = false }: { showSync?: boolean }) {
  const { exerciseSets, reload } = useExerciseSets();

  return (
    <div style={{ ...CARD_STYLE, padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Activity size={16} color="var(--series-workout)" />
        <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Muscle Map</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        Fatigue by muscle group, from Garmin strength-training sets — brighter = more fatigued, fades as it recovers
      </div>

      {showSync && (
        <div style={{ marginBottom: 16 }}>
          <GarminSyncPanel mode="exercise_sets" onSynced={reload} />
        </div>
      )}

      <MuscleMap sets={exerciseSets} />
    </div>
  );
}
