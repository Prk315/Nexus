import { useEffect, useState } from "react";
import { Dumbbell, ClipboardList, TrendingUp } from "lucide-react";
import { useAppDispatch } from "../../../store/hooks";
import {
  fetchWorkoutPlans, fetchWorkoutSessions, fetchRoutineExercises, startSessionFromRoutine,
} from "../../../store/slices/workoutsSlice";
import { todayISO } from "../../../lib/uiHelpers";
import RoutinesDesigner from "../RoutinesDesigner";
import WorkoutSessionLogger from "../WorkoutSessionLogger";
import ProgressionView from "../ProgressionView";
import StravaImportPanel from "../../shared/StravaImportPanel";
import GarminSyncPanel from "../../shared/GarminSyncPanel";
import MuscleMapCard from "../../shared/MuscleMapCard";
import type { WorkoutRoutine } from "../../../store/types";

type TabId = "design" | "log" | "progress";
const TABS: { id: TabId; label: string; icon: typeof Dumbbell }[] = [
  { id: "design", label: "Design", icon: Dumbbell },
  { id: "log", label: "Log", icon: ClipboardList },
  { id: "progress", label: "Progress", icon: TrendingUp },
];

/** Strength training: design routines → log workouts → track progress, over a
 *  Strava/Garmin import + muscle-recovery header. */
export default function StrengthPane() {
  const dispatch = useAppDispatch();
  const [tab, setTab] = useState<TabId>("design");
  const [startedSessionId, setStartedSessionId] = useState<string | null>(null);

  useEffect(() => {
    dispatch(fetchWorkoutPlans());
    dispatch(fetchWorkoutSessions());
  }, [dispatch]);

  const refresh = () => {
    dispatch(fetchWorkoutPlans());
    dispatch(fetchWorkoutSessions());
  };

  // Start a logged workout from a routine, then jump to the Log tab with it open.
  async function handleStart(routine: WorkoutRoutine) {
    const { items } = await dispatch(fetchRoutineExercises(routine.id)).unwrap();
    const res = await dispatch(startSessionFromRoutine({ routine, exercises: items, date: todayISO() })).unwrap();
    setStartedSessionId(res.session.id);
    setTab("log");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <StravaImportPanel mode="workouts" onImported={refresh} />
      <GarminSyncPanel mode="activities" onSynced={refresh} />

      <div style={{ marginTop: 16 }}>
        <MuscleMapCard showSync />
      </div>

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", margin: "24px 0 20px", flexWrap: "wrap" }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "none", border: "none", cursor: "pointer",
              padding: "8px 14px", marginRight: 4, fontSize: 13, fontWeight: 600,
              color: tab === id ? "var(--accent)" : "var(--text-muted)",
              borderBottom: `2px solid ${tab === id ? "var(--accent)" : "transparent"}`,
            }}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === "design" && <RoutinesDesigner onStart={handleStart} />}
      {tab === "log" && <WorkoutSessionLogger initialExpandedId={startedSessionId} />}
      {tab === "progress" && <ProgressionView />}
    </div>
  );
}
