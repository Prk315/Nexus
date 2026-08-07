import { useEffect, useState } from "react";
import { useAppDispatch } from "../../../store/hooks";
import { fetchWorkoutPlans, fetchWorkoutSessions } from "../../../store/slices/workoutsSlice";
import WorkoutPlanner from "../WorkoutPlanner";
import WorkoutSessionLogger from "../WorkoutSessionLogger";
import StravaImportPanel from "../../shared/StravaImportPanel";
import GarminSyncPanel from "../../shared/GarminSyncPanel";
import MuscleMapCard from "../../shared/MuscleMapCard";
import type { WorkoutPlan } from "../../../store/types";

const sectionHeader: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10,
  marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid var(--border)",
};
const sectionTitle: React.CSSProperties = { fontSize: 18, fontWeight: 700, color: "var(--text)" };
const sectionSubtitle: React.CSSProperties = { fontSize: 13, color: "var(--text-muted)", marginTop: 2 };

/** Strength training: plans, logged sessions, muscle map + Strava/Garmin import. */
export default function StrengthPane() {
  const dispatch = useAppDispatch();
  const [selectedPlan, setSelectedPlan] = useState<WorkoutPlan | null>(null);

  useEffect(() => {
    dispatch(fetchWorkoutPlans());
    dispatch(fetchWorkoutSessions());
  }, [dispatch]);

  const refresh = () => {
    dispatch(fetchWorkoutPlans());
    dispatch(fetchWorkoutSessions());
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <StravaImportPanel mode="workouts" onImported={refresh} />
      <GarminSyncPanel mode="activities" onSynced={refresh} />

      <div style={{ marginTop: 16 }}>
        <MuscleMapCard showSync />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "start", marginTop: 24 }}>
        <div>
          <div style={sectionHeader}>
            <div>
              <div style={sectionTitle}>Plans</div>
              <div style={sectionSubtitle}>Create and manage your workout programs</div>
            </div>
          </div>
          <WorkoutPlanner onSelectPlan={setSelectedPlan} selectedPlanId={selectedPlan?.id ?? null} />
        </div>

        <div>
          <div style={sectionHeader}>
            <div>
              <div style={sectionTitle}>{selectedPlan ? `Sessions — ${selectedPlan.name}` : "All Sessions"}</div>
              <div style={sectionSubtitle}>
                {selectedPlan
                  ? `${selectedPlan.days_per_week} days/week · click a plan on the left to filter`
                  : "Select a plan to filter sessions, or view all"}
              </div>
            </div>
          </div>
          <WorkoutSessionLogger planId={selectedPlan?.id ?? null} />
        </div>
      </div>
    </div>
  );
}
