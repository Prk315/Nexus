import { useEffect, useState } from "react";
import { useAppDispatch } from "../../../store/hooks";
import { fetchRunningPlans, fetchRunningSessions } from "../../../store/slices/runningSlice";
import RunningPlanBuilder from "../../running/RunningPlanBuilder";
import RunningSessionLogger from "../../running/RunningSessionLogger";
import StravaImportPanel from "../../shared/StravaImportPanel";
import GarminSyncPanel from "../../shared/GarminSyncPanel";
import type { RunningPlan } from "../../../store/types";

const sectionHeader: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10,
  marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid var(--border)",
};
const sectionTitle: React.CSSProperties = { fontSize: 18, fontWeight: 700, color: "var(--text)" };
const sectionSubtitle: React.CSSProperties = { fontSize: 13, color: "var(--text-muted)", marginTop: 2 };

/** Running: goal-based plans, logged runs + Strava/Garmin import. */
export default function RunningPane() {
  const dispatch = useAppDispatch();
  const [selectedPlan, setSelectedPlan] = useState<RunningPlan | null>(null);

  useEffect(() => {
    dispatch(fetchRunningPlans());
    dispatch(fetchRunningSessions());
  }, [dispatch]);

  const refresh = () => {
    dispatch(fetchRunningPlans());
    dispatch(fetchRunningSessions());
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <StravaImportPanel mode="running" onImported={refresh} />
      <GarminSyncPanel mode="activities" onSynced={refresh} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "start", marginTop: 24 }}>
        <div>
          <div style={sectionHeader}>
            <div>
              <div style={sectionTitle}>Plans</div>
              <div style={sectionSubtitle}>Create goal-based running programs</div>
            </div>
          </div>
          <RunningPlanBuilder onSelectPlan={setSelectedPlan} selectedPlanId={selectedPlan?.id ?? null} />
        </div>

        <div>
          <div style={sectionHeader}>
            <div>
              <div style={sectionTitle}>{selectedPlan ? `Runs — ${selectedPlan.name}` : "All Runs"}</div>
              <div style={sectionSubtitle}>
                {selectedPlan
                  ? `${selectedPlan.goal_type} · ${selectedPlan.fitness_level} · click a plan to filter`
                  : "Select a plan to filter, or view all runs"}
              </div>
            </div>
          </div>
          <RunningSessionLogger planId={selectedPlan?.id ?? null} />
        </div>
      </div>
    </div>
  );
}
