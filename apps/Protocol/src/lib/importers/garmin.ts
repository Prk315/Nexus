import {
  pushSleepToCloud,
  pushBodyMetricToCloud,
  pushRunningSessionToCloud,
  pushWorkoutSessionToCloud,
} from "../api";
import {
  garminFetchSleep,
  garminFetchBodyStats,
  garminFetchActivities,
  type GarminSleepRaw,
  type GarminBodyRaw,
  type GarminActivityRaw,
} from "../garminClient";
import type { CreateSleepEntry, CreateBodyMetric, CreateRunningSession, CreateWorkoutSession } from "../../store/types";

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
    quality_score: raw.quality_score,
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
  const raw = await garminFetchBodyStats(date, days);
  return syncItems(
    raw.map(mapBodyRaw),
    pushBodyMetricToCloud,
    (e) => `Body ${e.date}`,
  );
}

export async function syncGarminActivities(
  date: string,
  days: number,
): Promise<{ runCount: number; workoutCount: number; warnings: string[] }> {
  const raw = await garminFetchActivities(date, days);
  const warnings: string[] = [];
  let runCount = 0;
  let workoutCount = 0;
  for (const r of raw) {
    try {
      const mapped = mapActivityRaw(r);
      if (mapped.kind === "run") {
        await pushRunningSessionToCloud(mapped.entry);
        runCount++;
      } else {
        await pushWorkoutSessionToCloud(mapped.entry);
        workoutCount++;
      }
    } catch (e) {
      warnings.push(`Activity ${r.date} ${r.name}: ${String(e)}`);
    }
  }
  return { runCount, workoutCount, warnings };
}
