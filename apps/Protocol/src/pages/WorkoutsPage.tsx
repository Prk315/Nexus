import { useEffect, useMemo, useState } from "react";
import { Dumbbell, Flame } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { fetchWorkoutSessions, fetchExerciseHistory, fetchWorkoutPlans, fetchRoutineExercises, startSessionFromRoutine } from "../store/slices/workoutsSlice";
import { fetchRunningSessions } from "../store/slices/runningSlice";
import { fetchBodyMetrics } from "../store/slices/biomarkersSlice";
import { fetchExerciseSetsFromCloud, fetchExerciseAliases, upsertExerciseAlias } from "../lib/api";
import { CARD_STYLE, isoDate, todayISO } from "../lib/uiHelpers";
import { buildRunningStats, buildStrengthStats, type TimeRange } from "../lib/progressStats";
import { getCachedConfig, loadTrackingConfig, saveTrackingConfig, type TrackingConfig, type Activity } from "../lib/trackingConfig";
import { ConsistencyHeatmap, buildHeatmapGrid } from "../components/habits/HabitCharts";
import ProgressStats from "../components/workouts/ProgressStats";
import RecoveryCard from "../components/workouts/RecoveryCard";
import RoutinesDesigner from "../components/workouts/RoutinesDesigner";
import ExerciseAliasEditor from "../components/workouts/ExerciseAliasEditor";
import LogPlanCard from "../components/workouts/LogPlanCard";
import RunsCard from "../components/workouts/RunsCard";
import ProgressionView from "../components/workouts/ProgressionView";
import ActivityModule from "../components/biomarkers/ActivityModule";
import StravaImportPanel from "../components/shared/StravaImportPanel";
import GarminSyncPanel from "../components/shared/GarminSyncPanel";
import type { WorkoutSession, RunningSession, WorkoutRoutine, ExerciseSet, ExerciseHistory } from "../store/types";

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
 * Workouts — one scrolling dashboard. Two side-by-side progress cards (Running,
 * Strength) headline the page, then Recovery, activity stats, a Runs card and a
 * single Log & Plan card. The Garmin panel syncs everything exercise-related.
 */
export default function WorkoutsPage() {
  const dispatch = useAppDispatch();
  const workoutSessions = useAppSelector((s) => s.workouts.sessions);
  const runningSessions = useAppSelector((s) => s.running.sessions);
  const bodyMetrics = useAppSelector((s) => s.biomarkers.bodyMetrics);

  const [runRange, setRunRange] = useState<TimeRange>("3months");
  const [strRange, setStrRange] = useState<TimeRange>("3months");
  const [runCfg, setRunCfg] = useState<TrackingConfig>(() => getCachedConfig("running"));
  const [strCfg, setStrCfg] = useState<TrackingConfig>(() => getCachedConfig("strength"));
  const [strengthSets, setStrengthSets] = useState<ExerciseSet[]>([]);
  const [aliases, setAliases] = useState<Record<string, string>>({});

  const saveAlias = (key: string, name: string) => {
    setAliases((prev) => {
      const next = { ...prev };
      if (name.trim()) next[key] = name.trim(); else delete next[key];
      return next;
    });
    void upsertExerciseAlias(key, name);
  };

  // Cache seeds the first render; Supabase is the source of truth once it resolves.
  useEffect(() => {
    loadTrackingConfig("running").then(setRunCfg);
    loadTrackingConfig("strength").then(setStrCfg);
  }, []);

  const updateCfg = (a: Activity, c: TrackingConfig) => {
    if (a === "running") setRunCfg(c); else setStrCfg(c);
    void saveTrackingConfig(a, c);
  };

  const refresh = () => {
    dispatch(fetchWorkoutSessions());
    dispatch(fetchRunningSessions());
  };

  useEffect(() => {
    refresh();
    dispatch(fetchBodyMetrics());
    dispatch(fetchWorkoutPlans());
    // Garmin strength lands in protocol_exercise_sets (per-set), not
    // protocol_exercises — pull a wide window so strength progress populates too.
    fetchExerciseSetsFromCloud(isoDate(new Date(Date.now() - 730 * 86400000))).then(setStrengthSets);
    fetchExerciseAliases().then(setAliases).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  // "Log this day" from a training-day routine → spin up a session pre-filled with
  // its prescribed exercises; it then shows in the Log & Plan card and progress.
  const handleStartFromRoutine = async (routine: WorkoutRoutine) => {
    const { items } = await dispatch(fetchRoutineExercises(routine.id)).unwrap();
    await dispatch(startSessionFromRoutine({ routine, exercises: items, date: todayISO() })).unwrap();
    dispatch(fetchWorkoutSessions());
  };

  // Strength progress needs the per-exercise history across loaded sessions.
  useEffect(() => {
    if (workoutSessions.length > 0) {
      dispatch(fetchExerciseHistory(workoutSessions.map((s) => ({ id: s.id, date: s.scheduled_date }))));
    }
  }, [dispatch, workoutSessions]);

  const runData = useMemo(() => buildRunningStats(runningSessions, bodyMetrics, runRange, runCfg), [runningSessions, bodyMetrics, runRange, runCfg]);
  // Strength progress draws from the Garmin import (protocol_exercise_sets), NOT
  // the manually-logged sessions — those are often a duplicate re-log of the same
  // workout, so combining would double-count. Each set → one ExerciseHistory row;
  // name falls back to category when Garmin leaves exercise_name null.
  const strengthKeys = useMemo(() => [...new Set(strengthSets.map((s) => s.exercise_name ?? s.category))].sort(), [strengthSets]);
  const strengthEntries = useMemo<ExerciseHistory[]>(() =>
    strengthSets.map((s) => {
      const key = s.exercise_name ?? s.category;
      return { name: aliases[key] ?? key, date: s.date, sets: 1, reps: s.reps, weight_kg: s.weight_kg };
    }),
  [strengthSets, aliases]);
  const strData = useMemo(() => buildStrengthStats(strengthEntries, bodyMetrics, strRange, strCfg), [strengthEntries, bodyMetrics, strRange, strCfg]);

  const today = isoDate(new Date());
  const grid = buildHeatmapGrid(today, HEATMAP_WEEKS);
  const fractions = trainingFractions(workoutSessions, runningSessions);
  const hasTraining = workoutSessions.length > 0 || runningSessions.length > 0;

  return (
    <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Dumbbell size={24} color="var(--accent)" />
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0 }}>Workouts</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
            Recovery, activity, runs and strength — plan and log it all in one place
          </p>
        </div>
      </div>

      {/* Progress overview — running & strength side by side */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch" }}>
        <ProgressStats title="Running" color="var(--series-running)" activity="running" range={runRange} onRange={setRunRange} config={runCfg} onConfigChange={(c) => updateCfg("running", c)} data={runData} />
        <ProgressStats title="Strength" color="var(--series-workout)" activity="strength" range={strRange} onRange={setStrRange} config={strCfg} onConfigChange={(c) => updateCfg("strength", c)} data={strData} extraConfig={<ExerciseAliasEditor keys={strengthKeys} aliases={aliases} onSave={saveAlias} />} />
      </div>

      <div>
        <StravaImportPanel mode="workouts" onImported={refresh} />
        <GarminSyncPanel mode="workouts" onSynced={refresh} />
      </div>

      {/* Training-consistency heatmap */}
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

      {/* Strength training plans — programs, training days, prescribed exercises */}
      <div style={{ ...CARD_STYLE, padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Dumbbell size={16} color="var(--accent)" />
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>Strength Plans</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· programs, training days &amp; prescribed exercises</span>
        </div>
        <RoutinesDesigner onStart={handleStartFromRoutine} />
      </div>

      {/* Log & plan a workout with a live muscle map */}
      <LogPlanCard exerciseSets={strengthSets} aliases={aliases} />
    </div>
  );
}
