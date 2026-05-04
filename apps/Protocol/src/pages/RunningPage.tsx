import { useEffect, useState } from "react";
import { Target } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { fetchRunningPlans, fetchRunningSessions } from "../store/slices/runningSlice";
import RunningPlanBuilder from "../components/running/RunningPlanBuilder";
import RunningSessionLogger from "../components/running/RunningSessionLogger";
import StravaImportPanel from "../components/shared/StravaImportPanel";
import GarminSyncPanel from "../components/shared/GarminSyncPanel";
import type { RunningPlan } from "../store/types";

const sectionHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 16,
  paddingBottom: 12,
  borderBottom: "1px solid var(--border)",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: "var(--text)",
};

const sectionSubtitle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-muted)",
  marginTop: 2,
};

export default function RunningPage() {
  const dispatch = useAppDispatch();
  const loading = useAppSelector((s) => s.running.loading);
  const [selectedPlan, setSelectedPlan] = useState<RunningPlan | null>(null);

  useEffect(() => {
    dispatch(fetchRunningPlans());
    dispatch(fetchRunningSessions());
  }, [dispatch]);

  return (
    <div style={{ padding: 32, maxWidth: 800, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <Target size={24} color="var(--accent)" />
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0 }}>Running</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
            Build goal-based training plans and track your runs
          </p>
        </div>
        {loading && (
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>Loading…</span>
        )}
      </div>

      <StravaImportPanel mode="running" onImported={() => {
        dispatch(fetchRunningPlans());
        dispatch(fetchRunningSessions());
      }} />
      <GarminSyncPanel mode="activities" onSynced={() => {
        dispatch(fetchRunningPlans());
        dispatch(fetchRunningSessions());
      }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "start", marginTop: 24 }}>
        <div>
          <div style={sectionHeader}>
            <div>
              <div style={sectionTitle}>Plans</div>
              <div style={sectionSubtitle}>Create goal-based running programs</div>
            </div>
          </div>
          <RunningPlanBuilder
            onSelectPlan={setSelectedPlan}
            selectedPlanId={selectedPlan?.id ?? null}
          />
        </div>

        <div>
          <div style={sectionHeader}>
            <div>
              <div style={sectionTitle}>
                {selectedPlan ? `Runs — ${selectedPlan.name}` : "All Runs"}
              </div>
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
