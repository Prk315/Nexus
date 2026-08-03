import {
  pushSleepToCloud,
  pushBodyMetricToCloud,
  pushRunningSessionToCloud,
  pushWorkoutSessionToCloud,
  replaceExerciseSetsInCloud,
  fetchDataSourceSettingsFromCloud,
} from "../api";
import {
  garminFetchSleep,
  garminFetchBodyStats,
  garminFetchActivities,
  garminFetchExerciseSets,
  type GarminSleepRaw,
  type GarminBodyRaw,
  type GarminActivityRaw,
  type GarminExerciseSetRaw,
} from "../garminClient";
import type { CreateSleepEntry, CreateBodyMetric, CreateRunningSession, CreateWorkoutSession, CreateExerciseSet } from "../../store/types";
import { DEFAULT_DATA_SOURCE_SETTINGS } from "../../store/types";
import { isoDate } from "../uiHelpers";

/** Fetched fresh on every sync call (not cached) — these are explicit user
 * button clicks, not a hot path, and staleness would be worse than the extra
 * round trip. Falls back to the app-wide defaults when the user has never
 * opened Settings, so behavior is unchanged until they touch a toggle. */
async function getDataSourceSettings() {
  const settings = await fetchDataSourceSettingsFromCloud();
  return settings ?? DEFAULT_DATA_SOURCE_SETTINGS;
}

async function syncItems<T>(
  items: T[],
  push: (item: T) => Promise<void>,
  label: (item: T) => string,
): Promise<{ count: number; warnings: string[] }> {
  const warnings: string[] = [];
  let count = 0;
  for (const item of items) {
    try {
      await push(item);
      count++;
    } catch (e) {
      warnings.push(`${label(item)}: ${String(e)}`);
    }
  }
  return { count, warnings };
}

function mapSleepRaw(raw: GarminSleepRaw): CreateSleepEntry & { id: string } {
  return {
    id: crypto.randomUUID(),
    date: raw.date,
    duration_min: raw.duration_min,
    // Garmin's sleep score is 0-100 natively; the app's quality_score column
    // is 0-10 everywhere else (manual entry, Oura import, all UI/scoring).
    quality_score: Math.round(raw.quality_score) / 10,
    deep_sleep_min: raw.deep_sleep_min,
    rem_sleep_min: raw.rem_sleep_min,
    light_sleep_min: raw.light_sleep_min,
    awake_time_min: raw.awake_time_min,
    respiratory_rate: raw.respiratory_rate,
    temperature_deviation: raw.temperature_deviation,
    bedtime_start: raw.bedtime_start,
    bedtime_end: raw.bedtime_end,
    notes: raw.notes || null,
  };
}

function mapBodyRaw(raw: GarminBodyRaw): CreateBodyMetric & { id: string } {
  return {
    id: crypto.randomUUID(),
    date: raw.date,
    weight_kg: raw.weight_kg,
    hrv_ms: raw.hrv_ms,
    resting_hr_bpm: raw.resting_hr_bpm,
    spo2_pct: raw.spo2_pct,
    readiness_score: raw.readiness_score,
    temperature_deviation: raw.temperature_deviation,
    recovery_index: raw.recovery_index,
    notes: raw.notes || null,
  };
}

function mapActivityRaw(
  raw: GarminActivityRaw,
):
  | { kind: "run"; entry: CreateRunningSession & { id: string; completed: boolean } }
  | { kind: "workout"; entry: CreateWorkoutSession & { id: string; completed: boolean } } {
  if (raw.type === "run") {
    return {
      kind: "run",
      entry: {
        id: crypto.randomUUID(),
        plan_id: null,
        date: raw.date,
        planned_km: null,
        actual_km: raw.actual_km ?? null,
        avg_pace_s_per_km: raw.avg_pace_s_per_km ?? null,
        heart_rate_avg: raw.heart_rate_avg ?? null,
        heart_rate_max: raw.heart_rate_max ?? null,
        elevation_gain_m: raw.elevation_gain_m ?? null,
        cadence_avg: raw.cadence_avg ?? null,
        calories: raw.calories ?? null,
        completed: true,
        notes: raw.name,
      },
    };
  }
  return {
    kind: "workout",
    entry: {
      id: crypto.randomUUID(),
      plan_id: null,
      name: raw.name,
      scheduled_date: raw.date,
      completed: true,
      duration_min: raw.duration_min ?? null,
      calories_burned: raw.calories_burned ?? raw.calories ?? null,
      avg_heart_rate: raw.avg_heart_rate ?? raw.heart_rate_avg ?? null,
      notes: "Garmin import",
    },
  };
}

export async function syncGarminSleep(
  date: string,
  days: number,
): Promise<{ count: number; warnings: string[] }> {
  const settings = await getDataSourceSettings();
  if (settings.sleep_source !== "garmin") {
    return { count: 0, warnings: ["Skipped — Oura is the selected sleep source (change in Settings)"] };
  }
  const raw = await garminFetchSleep(date, days);
  return syncItems(
    raw.map(mapSleepRaw),
    pushSleepToCloud,
    (e) => `Sleep ${e.date}`,
  );
}

export async function syncGarminBodyStats(
  date: string,
  days: number,
): Promise<{ count: number; warnings: string[] }> {
  const settings = await getDataSourceSettings();
  if (settings.body_vitals_source !== "garmin") {
    return { count: 0, warnings: ["Skipped — Oura is the selected body vitals source (change in Settings)"] };
  }
  const raw = await garminFetchBodyStats(date, days);
  return syncItems(
    raw.map(mapBodyRaw),
    pushBodyMetricToCloud,
    (e) => `Body ${e.date}`,
  );
}

function mapExerciseSetRaw(raw: GarminExerciseSetRaw): CreateExerciseSet & { id: string } {
  return {
    id: crypto.randomUUID(),
    date: raw.date,
    activity_name: raw.activity_name || null,
    category: raw.category,
    exercise_name: raw.exercise_name,
    reps: raw.reps,
    weight_kg: raw.weight_kg,
    notes: "Garmin import",
  };
}

export async function syncGarminExerciseSets(
  date: string,
  days: number,
): Promise<{ count: number }> {
  const raw = await garminFetchExerciseSets(date, days);
  const end = new Date(`${date}T00:00:00`);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  await replaceExerciseSetsInCloud(isoDate(start), isoDate(end), raw.map(mapExerciseSetRaw));
  return { count: raw.length };
}

export async function syncGarminActivities(
  date: string,
  days: number,
): Promise<{ runCount: number; workoutCount: number; warnings: string[] }> {
  const settings = await getDataSourceSettings();
  const raw = await garminFetchActivities(date, days);
  const warnings: string[] = [];
  let runCount = 0;
  let workoutCount = 0;
  let skippedWorkouts = 0;
  for (const r of raw) {
    try {
      const mapped = mapActivityRaw(r);
      if (mapped.kind === "run") {
        // Running isn't one of the 3 gated data-source categories — always synced.
        await pushRunningSessionToCloud(mapped.entry);
        runCount++;
      } else if (settings.workouts_source === "garmin") {
        await pushWorkoutSessionToCloud(mapped.entry);
        workoutCount++;
      } else {
        skippedWorkouts++;
      }
    } catch (e) {
      warnings.push(`Activity ${r.date} ${r.name}: ${String(e)}`);
    }
  }
  if (skippedWorkouts > 0) {
    warnings.push(`Skipped ${skippedWorkouts} workout(s) — Oura is the selected workouts source (change in Settings)`);
  }
  return { runCount, workoutCount, warnings };
}
