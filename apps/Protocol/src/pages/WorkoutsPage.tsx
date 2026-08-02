import { useEffect, useState, useCallback } from "react";
import { Dumbbell } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { fetchWorkoutPlans, fetchWorkoutSessions } from "../store/slices/workoutsSlice";
import WorkoutPlanner from "../components/workouts/WorkoutPlanner";
import WorkoutSessionLogger from "../components/workouts/WorkoutSessionLogger";
import StravaImportPanel from "../components/shared/StravaImportPanel";
import GarminSyncPanel from "../components/shared/GarminSyncPanel";
import MuscleMap from "../components/workouts/MuscleMap";
import { fetchExerciseSetsFromCloud } from "../lib/api";
import { isoDate, CARD_STYLE } from "../lib/uiHelpers";
import type { WorkoutPlan, ExerciseSet } from "../store/types";

const MUSCLE_MAP_HISTORY_DAYS = 45;

function subDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

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

export default function WorkoutsPage() {
  const dispatch = useAppDispatch();
  const loading = useAppSelector((s) => s.workouts.loading);
  const [selectedPlan, setSelectedPlan] = useState<WorkoutPlan | null>(null);
  const [exerciseSets, setExerciseSets] = useState<ExerciseSet[]>([]);

  const loadExerciseSets = useCallback(() => {
    fetchExerciseSetsFromCloud(subDays(MUSCLE_MAP_HISTORY_DAYS)).then(setExerciseSets);
  }, []);

  useEffect(() => {
    dispatch(fetchWorkoutPlans());
    dispatch(fetchWorkoutSessions());
    loadExerciseSets();
  }, [dispatch, loadExerciseSets]);

  return (
    <div style={{ padding: 32, maxWidth: 800, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <Dumbbell size={24} color="var(--accent)" />
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0 }}>Workouts</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
            Build training plans and log your sessions
          </p>
        </div>
        {loading && (
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>Loading…</span>
        )}
      </div>

      <StravaImportPanel mode="workouts" onImported={() => {
        dispatch(fetchWorkoutPlans());
        dispatch(fetchWorkoutSessions());
      }} />
      <GarminSyncPanel mode="activities" onSynced={() => {
        dispatch(fetchWorkoutPlans());
        dispatch(fetchWorkoutSessions());
      }} />
      <GarminSyncPanel mode="exercise_sets" onSynced={loadExerciseSets} />

      <div style={{ ...CARD_STYLE, padding: "20px 24px", marginTop: 16 }}>
        <div style={sectionHeader}>
          <div>
            <div style={sectionTitle}>Muscle Map</div>
            <div style={sectionSubtitle}>
              Recency by muscle group, from Garmin strength-training sets — brighter = trained more recently
            </div>
          </div>
        </div>
        <MuscleMap sets={exerciseSets} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "start", marginTop: 24 }}>
        <div>
          <div>
            <div style={sectionHeader}>
              <div>
                <div style={sectionTitle}>Plans</div>
                <div style={sectionSubtitle}>Create and manage your workout programs</div>
              </div>
            </div>
            <WorkoutPlanner
              onSelectPlan={setSelectedPlan}
              selectedPlanId={selectedPlan?.id ?? null}
            />
          </div>
        </div>

        <div>
          <div>
            <div style={sectionHeader}>
              <div>
                <div style={sectionTitle}>
                  {selectedPlan ? `Sessions — ${selectedPlan.name}` : "All Sessions"}
                </div>
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
    </div>
  );
}
