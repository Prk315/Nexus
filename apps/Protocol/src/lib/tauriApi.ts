/**
 * Data layer — all operations go directly to Supabase.
 * This file replaces the original invoke()-based implementation so that
 * the Redux slices work without any Rust commands.
 */
import type {
  BodyMetric, CreateBodyMetric,
  CreateNutritionEntry, CreateSleepEntry,
  CreateWorkoutPlan, CreateWorkoutSession, CreateExercise,
  CreateRunningPlan, CreateRunningSession,
  Exercise, NutritionEntry, RunningPlan, RunningSession,
  SleepEntry, WorkoutPlan, WorkoutSession,
} from "../store/types";
import {
  fetchSleepFromCloud, pushSleepToCloud, deleteSleepFromCloud,
  fetchNutritionFromCloud, pushNutritionToCloud, deleteNutritionFromCloud,
  fetchBodyMetricsFromCloud, pushBodyMetricToCloud, deleteBodyMetricFromCloud,
  fetchWorkoutPlansFromCloud, pushWorkoutPlanToCloud, deleteWorkoutPlanFromCloud,
  fetchWorkoutSessionsFromCloud, pushWorkoutSessionToCloud,
  completeWorkoutSessionInCloud, deleteWorkoutSessionFromCloud,
  fetchExercisesFromCloud, pushExerciseToCloud, deleteExerciseFromCloud,
  fetchRunningPlansFromCloud, pushRunningPlanToCloud, deleteRunningPlanFromCloud,
  fetchRunningSessionsFromCloud, pushRunningSessionToCloud,
  completeRunningSessionInCloud, deleteRunningSessionFromCloud,
} from "./api";

// ── Sleep ─────────────────────────────────────────────────────────────────────

export const getSleepEntries = (): Promise<SleepEntry[]> => fetchSleepFromCloud();

export async function createSleepEntry(entry: CreateSleepEntry): Promise<SleepEntry> {
  const id = crypto.randomUUID();
  await pushSleepToCloud({ ...entry, id });
  return {
    id, ...entry,
    deep_sleep_min: entry.deep_sleep_min ?? null,
    rem_sleep_min: entry.rem_sleep_min ?? null,
    light_sleep_min: entry.light_sleep_min ?? null,
    awake_time_min: entry.awake_time_min ?? null,
    respiratory_rate: entry.respiratory_rate ?? null,
    temperature_deviation: entry.temperature_deviation ?? null,
    bedtime_start: entry.bedtime_start ?? null,
    bedtime_end: entry.bedtime_end ?? null,
    notes: entry.notes ?? null,
    created_at: new Date().toISOString(),
  };
}

export async function updateSleepEntry(id: string, entry: CreateSleepEntry): Promise<void> {
  await pushSleepToCloud({ ...entry, id });
}

export const deleteSleepEntry = (id: string): Promise<void> => deleteSleepFromCloud(id);

// ── Nutrition ─────────────────────────────────────────────────────────────────

export const getNutritionEntries = (): Promise<NutritionEntry[]> => fetchNutritionFromCloud();

export async function createNutritionEntry(entry: CreateNutritionEntry): Promise<NutritionEntry> {
  const id = crypto.randomUUID();
  await pushNutritionToCloud({ ...entry, id });
  return {
    id, ...entry,
    calories: entry.calories ?? null,
    protein_g: entry.protein_g ?? null,
    carbs_g: entry.carbs_g ?? null,
    fat_g: entry.fat_g ?? null,
    foods: entry.foods ?? null,
    notes: entry.notes ?? null,
    created_at: new Date().toISOString(),
  };
}

export const deleteNutritionEntry = (id: string): Promise<void> => deleteNutritionFromCloud(id);

// ── Body Metrics ──────────────────────────────────────────────────────────────

export const getBodyMetrics = (): Promise<BodyMetric[]> => fetchBodyMetricsFromCloud();

export async function createBodyMetric(entry: CreateBodyMetric): Promise<BodyMetric> {
  const id = crypto.randomUUID();
  await pushBodyMetricToCloud({ ...entry, id });
  return {
    id, ...entry,
    weight_kg: entry.weight_kg ?? null,
    hrv_ms: entry.hrv_ms ?? null,
    resting_hr_bpm: entry.resting_hr_bpm ?? null,
    spo2_pct: entry.spo2_pct ?? null,
    readiness_score: entry.readiness_score ?? null,
    temperature_deviation: entry.temperature_deviation ?? null,
    recovery_index: entry.recovery_index ?? null,
    notes: entry.notes ?? null,
    created_at: new Date().toISOString(),
  };
}

export const deleteBodyMetric = (id: string): Promise<void> => deleteBodyMetricFromCloud(id);

// ── Workout Plans ─────────────────────────────────────────────────────────────

export const getWorkoutPlans = (): Promise<WorkoutPlan[]> => fetchWorkoutPlansFromCloud();

export async function createWorkoutPlan(plan: CreateWorkoutPlan): Promise<WorkoutPlan> {
  const full: WorkoutPlan = {
    id: crypto.randomUUID(),
    ...plan,
    description: plan.description ?? null,
    created_at: new Date().toISOString(),
  };
  await pushWorkoutPlanToCloud(full);
  return full;
}

export const deleteWorkoutPlan = (id: string): Promise<void> => deleteWorkoutPlanFromCloud(id);

// ── Workout Sessions ──────────────────────────────────────────────────────────

export const getWorkoutSessions = (planId?: string): Promise<WorkoutSession[]> =>
  fetchWorkoutSessionsFromCloud(planId);

export async function createWorkoutSession(session: CreateWorkoutSession): Promise<WorkoutSession> {
  const id = crypto.randomUUID();
  await pushWorkoutSessionToCloud({ ...session, id, completed: false });
  return {
    id, ...session,
    plan_id: session.plan_id ?? null,
    duration_min: session.duration_min ?? null,
    calories_burned: session.calories_burned ?? null,
    avg_heart_rate: session.avg_heart_rate ?? null,
    notes: session.notes ?? null,
    completed: false,
    created_at: new Date().toISOString(),
  };
}

export async function completeWorkoutSessionApi(id: string): Promise<void> {
  await completeWorkoutSessionInCloud(id);
}

export const deleteWorkoutSession = (id: string): Promise<void> =>
  deleteWorkoutSessionFromCloud(id);

// ── Exercises ─────────────────────────────────────────────────────────────────

export const getExercises = (sessionId: string): Promise<Exercise[]> =>
  fetchExercisesFromCloud(sessionId);

export async function createExercise(exercise: CreateExercise): Promise<Exercise> {
  const id = crypto.randomUUID();
  await pushExerciseToCloud({ ...exercise, id });
  return {
    id, ...exercise,
    sets: exercise.sets ?? null,
    reps: exercise.reps ?? null,
    weight_kg: exercise.weight_kg ?? null,
    duration_min: exercise.duration_min ?? null,
    notes: exercise.notes ?? null,
  };
}

export const deleteExercise = (id: string): Promise<void> => deleteExerciseFromCloud(id);

// ── Running Plans ─────────────────────────────────────────────────────────────

export const getRunningPlans = (): Promise<RunningPlan[]> => fetchRunningPlansFromCloud();

export async function createRunningPlan(plan: CreateRunningPlan): Promise<RunningPlan> {
  const full: RunningPlan = {
    id: crypto.randomUUID(),
    ...plan,
    target_date: plan.target_date ?? null,
    created_at: new Date().toISOString(),
  };
  await pushRunningPlanToCloud(full);
  return full;
}

export const deleteRunningPlan = (id: string): Promise<void> => deleteRunningPlanFromCloud(id);

// ── Running Sessions ──────────────────────────────────────────────────────────

export const getRunningSessions = (planId?: string): Promise<RunningSession[]> =>
  fetchRunningSessionsFromCloud(planId);

export async function createRunningSession(session: CreateRunningSession): Promise<RunningSession> {
  const id = crypto.randomUUID();
  await pushRunningSessionToCloud({ ...session, id, completed: false });
  return {
    id, ...session,
    plan_id: session.plan_id ?? null,
    planned_km: session.planned_km ?? null,
    actual_km: session.actual_km ?? null,
    avg_pace_s_per_km: session.avg_pace_s_per_km ?? null,
    heart_rate_avg: session.heart_rate_avg ?? null,
    heart_rate_max: session.heart_rate_max ?? null,
    elevation_gain_m: session.elevation_gain_m ?? null,
    cadence_avg: session.cadence_avg ?? null,
    calories: session.calories ?? null,
    notes: session.notes ?? null,
    completed: false,
    created_at: new Date().toISOString(),
  };
}

export async function completeRunningSessionApi(
  id: string,
  actualKm?: number | null,
  avgPaceSPerKm?: number | null,
  heartRateAvg?: number | null,
): Promise<void> {
  await completeRunningSessionInCloud(id, actualKm, avgPaceSPerKm, heartRateAvg);
}

export const deleteRunningSession = (id: string): Promise<void> =>
  deleteRunningSessionFromCloud(id);
