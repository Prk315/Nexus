import { useEffect } from "react";
import { Dumbbell, Flame } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { fetchWorkoutSessions } from "../store/slices/workoutsSlice";
import { fetchRunningSessions } from "../store/slices/runningSlice";
import { CARD_STYLE, isoDate } from "../lib/uiHelpers";
import { ConsistencyHeatmap, buildHeatmapGrid } from "../components/habits/HabitCharts";
import RecoveryCard from "../components/workouts/RecoveryCard";
import LogPlanCard from "../components/workouts/LogPlanCard";
import RunsCard from "../components/workouts/RunsCard";
import ProgressionView from "../components/workouts/ProgressionView";
import ActivityModule from "../components/biomarkers/ActivityModule";
import StravaImportPanel from "../components/shared/StravaImportPanel";
import GarminSyncPanel from "../components/shared/GarminSyncPanel";
import type { WorkoutSession, RunningSession } from "../store/types";

const HEATMAP_WEEKS = 12;

/** A training day = a completed workout OR any run. Both light up the heatmap. */
function trainingFractions(workouts: WorkoutSession[], runs: RunningSession[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of workouts) {
    if (s.completed) m.set(s.scheduled_date, 1);
  }
  for (const r of runs) {
    m.set(r.date, 1);
  }
  return m;
}

/**
 * Workouts — one scrolling dashboard. A charts overview up top (strength
 * progression + the training-consistency heatmap), then Recovery (muscle map +
 * vitals), activity stats, a dedicated Runs card, and a single Log & Plan card
 * (build a workout and watch the muscles light up). The Garmin panel syncs
 * everything exercise-related — runs, workouts and strength sets — in one click.
 */
export default function WorkoutsPage() {
  const dispatch = useAppDispatch();
  const workoutSessions = useAppSelector((s) => s.workouts.sessions);
  const runningSessions = useAppSelector((s) => s.running.sessions);

  const refresh = () => {
    dispatch(fetchWorkoutSessions());
    dispatch(fetchRunningSessions());
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  const today = isoDate(new Date());
  const grid = buildHeatmapGrid(today, HEATMAP_WEEKS);
  const fractions = trainingFractions(workoutSessions, runningSessions);
  const hasTraining = workoutSessions.length > 0 || runningSessions.length > 0;

  return (
    <div style={{ padding: 32, maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Dumbbell size={24} color="var(--accent)" />
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0 }}>Workouts</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
            Recovery, activity, runs and strength — plan and log it all in one place
          </p>
        </div>
      </div>

      <div>
        <StravaImportPanel mode="workouts" onImported={refresh} />
        <GarminSyncPanel mode="workouts" onSynced={refresh} />
      </div>

      {/* Charts overview — strength progression + training-consistency heatmap */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ ...CARD_STYLE, padding: "20px 24px", flex: "3 1 480px", minWidth: 0 }}>
          <ProgressionView />
        </div>
        <div style={{ ...CARD_STYLE, padding: "20px 24px", flex: "1 1 240px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Flame size={15} color="var(--warning)" />
            <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Training Consistency</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
            Workouts &amp; runs, last {HEATMAP_WEEKS} weeks
          </div>
          {hasTraining ? (
            <ConsistencyHeatmap grid={grid} today={today} fractionByDate={fractions} cellSize={16} />
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>
              No training logged yet.
            </div>
          )}
        </div>
      </div>

      {/* Recovery: muscle map + readiness/vitals */}
      <RecoveryCard />

      {/* Activity stats (steps, calories, sessions + trends) */}
      <ActivityModule />

      {/* Runs — imported from Garmin/Strava */}
      <RunsCard />

      {/* Log & plan a workout with a live muscle map */}
      <LogPlanCard />
    </div>
  );
}
