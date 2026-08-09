import { useEffect } from "react";
import { Dumbbell, Flame } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { fetchWorkoutSessions } from "../store/slices/workoutsSlice";
import { CARD_STYLE, isoDate } from "../lib/uiHelpers";
import { ConsistencyHeatmap, buildHeatmapGrid } from "../components/habits/HabitCharts";
import RecoveryCard from "../components/workouts/RecoveryCard";
import LogPlanCard from "../components/workouts/LogPlanCard";
import ProgressionView from "../components/workouts/ProgressionView";
import ActivityModule from "../components/biomarkers/ActivityModule";
import StravaImportPanel from "../components/shared/StravaImportPanel";
import GarminSyncPanel from "../components/shared/GarminSyncPanel";
import type { WorkoutSession } from "../store/types";

const HEATMAP_WEEKS = 12;

/** 1 if any session that day completed, 0 if scheduled but not, absent otherwise. */
function workoutFractions(sessions: WorkoutSession[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sessions) {
    m.set(s.scheduled_date, Math.max(m.get(s.scheduled_date) ?? 0, s.completed ? 1 : 0));
  }
  return m;
}

/**
 * Workouts — one scrolling dashboard. A charts overview up top (strength
 * progression + the workout-consistency heatmap), then Recovery (muscle map +
 * vitals), activity stats, and a single Log & Plan card (build a workout and watch
 * the muscles light up). Running and the old Design/Log/Progress sub-tabs are gone.
 */
export default function WorkoutsPage() {
  const dispatch = useAppDispatch();
  const workoutSessions = useAppSelector((s) => s.workouts.sessions);

  useEffect(() => {
    dispatch(fetchWorkoutSessions());
  }, [dispatch]);

  const today = isoDate(new Date());
  const grid = buildHeatmapGrid(today, HEATMAP_WEEKS);
  const fractions = workoutFractions(workoutSessions);

  return (
    <div style={{ padding: 32, maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Dumbbell size={24} color="var(--accent)" />
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0 }}>Workouts</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
            Recovery, activity and strength — plan and log it all in one place
          </p>
        </div>
      </div>

      <div>
        <StravaImportPanel mode="workouts" onImported={() => dispatch(fetchWorkoutSessions())} />
        <GarminSyncPanel mode="activities" onSynced={() => dispatch(fetchWorkoutSessions())} />
      </div>

      {/* Charts overview — strength progression + workout-consistency heatmap */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ ...CARD_STYLE, padding: "20px 24px", flex: "3 1 480px", minWidth: 0 }}>
          <ProgressionView />
        </div>
        <div style={{ ...CARD_STYLE, padding: "20px 24px", flex: "1 1 240px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Flame size={15} color="var(--warning)" />
            <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Workout Consistency</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
            Completed workouts, last {HEATMAP_WEEKS} weeks
          </div>
          {workoutSessions.length > 0 ? (
            <ConsistencyHeatmap grid={grid} today={today} fractionByDate={fractions} cellSize={16} />
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>
              No workouts logged yet.
            </div>
          )}
        </div>
      </div>

      {/* Recovery: muscle map + readiness/vitals */}
      <RecoveryCard />

      {/* Activity stats (steps, calories, sessions + trends) */}
      <ActivityModule />

      {/* Log & plan a workout with a live muscle map */}
      <LogPlanCard />
    </div>
  );
}
