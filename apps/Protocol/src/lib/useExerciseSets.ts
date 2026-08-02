import { useCallback, useEffect, useState } from "react";
import { fetchExerciseSetsFromCloud } from "./api";
import { isoDate } from "./uiHelpers";
import type { ExerciseSet } from "../store/types";

const MUSCLE_MAP_HISTORY_DAYS = 45;

function subDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

/** Shared by every place that renders MuscleMap — fetches the sync window
 * Garmin's exercise-set data needs for the fatigue/recovery model. */
export function useExerciseSets() {
  const [exerciseSets, setExerciseSets] = useState<ExerciseSet[]>([]);

  const reload = useCallback(() => {
    fetchExerciseSetsFromCloud(subDays(MUSCLE_MAP_HISTORY_DAYS)).then(setExerciseSets);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { exerciseSets, reload };
}
