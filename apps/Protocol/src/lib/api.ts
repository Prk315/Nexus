import { getSupabaseClient, USER_ID } from "./supabase";
import type {
  BodyMetric, CreateBodyMetric,
  CreateNutritionEntry, CreateSleepEntry,
  Exercise, NutritionEntry, RunningPlan, RunningSession,
  SleepEntry, WorkoutPlan, WorkoutSession,
} from "../store/types";

// ── Sleep ────────────────────────────────────────────────────────────────────

export async function fetchSleepFromCloud(): Promise<SleepEntry[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_sleep")
    .select("*")
    .eq("user_id", USER_ID)
    .order("date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToSleep);
}

export async function pushSleepToCloud(entry: CreateSleepEntry & { id: string }): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_sleep").upsert({
    id: entry.id,
    user_id: USER_ID,
    date: entry.date,
    duration_min: entry.duration_min,
    quality_score: entry.quality_score,
    deep_sleep_min: entry.deep_sleep_min ?? null,
    rem_sleep_min: entry.rem_sleep_min ?? null,
    light_sleep_min: entry.light_sleep_min ?? null,
    awake_time_min: entry.awake_time_min ?? null,
    respiratory_rate: entry.respiratory_rate ?? null,
    temperature_deviation: entry.temperature_deviation ?? null,
    bedtime_start: entry.bedtime_start ?? null,
    bedtime_end: entry.bedtime_end ?? null,
    notes: entry.notes ?? null,
  });
  if (error) throw new Error(error.message);
}

function rowToSleep(row: Record<string, unknown>): SleepEntry {
  return {
    id: row.id as string,
    date: row.date as string,
    duration_min: row.duration_min as number,
    quality_score: row.quality_score as number,
    deep_sleep_min: row.deep_sleep_min as number | null,
    rem_sleep_min: row.rem_sleep_min as number | null,
    light_sleep_min: row.light_sleep_min as number | null,
    awake_time_min: row.awake_time_min as number | null,
    respiratory_rate: row.respiratory_rate as number | null,
    temperature_deviation: row.temperature_deviation as number | null,
    bedtime_start: row.bedtime_start as string | null,
    bedtime_end: row.bedtime_end as string | null,
    notes: row.notes as string | null,
    created_at: row.created_at as string,
  };
}

// ── Nutrition ─────────────────────────────────────────────────────────────────

export async function fetchNutritionFromCloud(): Promise<NutritionEntry[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_nutrition")
    .select("*")
    .eq("user_id", USER_ID)
    .order("date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToNutrition);
}

export async function pushNutritionToCloud(entry: CreateNutritionEntry & { id: string }): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_nutrition").upsert({
    id: entry.id,
    user_id: USER_ID,
    date: entry.date,
    meal_type: entry.meal_type,
    calories: entry.calories ?? null,
    protein_g: entry.protein_g ?? null,
    carbs_g: entry.carbs_g ?? null,
    fat_g: entry.fat_g ?? null,
    foods: entry.foods ?? null,
    notes: entry.notes ?? null,
  });
  if (error) throw new Error(error.message);
}

function rowToNutrition(row: Record<string, unknown>): NutritionEntry {
  return {
    id: row.id as string,
    date: row.date as string,
    meal_type: row.meal_type as string,
    calories: row.calories as number | null,
    protein_g: row.protein_g as number | null,
    carbs_g: row.carbs_g as number | null,
    fat_g: row.fat_g as number | null,
    foods: row.foods as string | null,
    notes: row.notes as string | null,
    created_at: row.created_at as string,
  };
}

// ── Body Metrics ──────────────────────────────────────────────────────────────

export async function fetchBodyMetricsFromCloud(): Promise<BodyMetric[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_body_metrics")
    .select("*")
    .eq("user_id", USER_ID)
    .order("date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToBodyMetric);
}

export async function pushBodyMetricToCloud(entry: CreateBodyMetric & { id: string }): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_body_metrics").upsert({
    id: entry.id,
    user_id: USER_ID,
    date: entry.date,
    weight_kg: entry.weight_kg ?? null,
    hrv_ms: entry.hrv_ms ?? null,
    resting_hr_bpm: entry.resting_hr_bpm ?? null,
    spo2_pct: entry.spo2_pct ?? null,
    readiness_score: entry.readiness_score ?? null,
    temperature_deviation: entry.temperature_deviation ?? null,
    recovery_index: entry.recovery_index ?? null,
    notes: entry.notes ?? null,
  });
  if (error) throw new Error(error.message);
}

function rowToBodyMetric(row: Record<string, unknown>): BodyMetric {
  return {
    id: row.id as string,
    date: row.date as string,
    weight_kg: row.weight_kg as number | null,
    hrv_ms: row.hrv_ms as number | null,
    resting_hr_bpm: row.resting_hr_bpm as number | null,
    spo2_pct: row.spo2_pct as number | null,
    readiness_score: row.readiness_score as number | null,
    temperature_deviation: row.temperature_deviation as number | null,
    recovery_index: row.recovery_index as number | null,
    notes: row.notes as string | null,
    created_at: row.created_at as string,
  };
}

// ── Workout Plans ─────────────────────────────────────────────────────────────

export async function fetchWorkoutPlansFromCloud(): Promise<WorkoutPlan[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_workout_plans")
    .select("*")
    .eq("user_id", USER_ID)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as WorkoutPlan[];
}

export async function pushWorkoutPlanToCloud(plan: WorkoutPlan): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_workout_plans").upsert({ ...plan, user_id: USER_ID });
  if (error) throw new Error(error.message);
}

// ── Workout Sessions ──────────────────────────────────────────────────────────

export async function fetchWorkoutSessionsFromCloud(planId?: string): Promise<WorkoutSession[]> {
  const sb = getSupabaseClient();
  let q = sb.from("protocol_workout_sessions").select("*").eq("user_id", USER_ID);
  if (planId) q = q.eq("plan_id", planId);
  const { data, error } = await q.order("scheduled_date", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...r,
    completed: Boolean(r.completed),
  })) as WorkoutSession[];
}

// ── Exercises ─────────────────────────────────────────────────────────────────

export async function fetchExercisesFromCloud(sessionId: string): Promise<Exercise[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_exercises")
    .select("*")
    .eq("session_id", sessionId);
  if (error) throw new Error(error.message);
  return (data ?? []) as Exercise[];
}

// ── Running Plans ─────────────────────────────────────────────────────────────

export async function fetchRunningPlansFromCloud(): Promise<RunningPlan[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_running_plans")
    .select("*")
    .eq("user_id", USER_ID)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as RunningPlan[];
}

// ── Running Sessions ──────────────────────────────────────────────────────────

export async function fetchRunningSessionsFromCloud(planId?: string): Promise<RunningSession[]> {
  const sb = getSupabaseClient();
  let q = sb.from("protocol_running_sessions").select("*").eq("user_id", USER_ID);
  if (planId) q = q.eq("plan_id", planId);
  const { data, error } = await q.order("date", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...r,
    completed: Boolean(r.completed),
  })) as RunningSession[];
}

// ── Delete helpers ────────────────────────────────────────────────────────────

export async function deleteSleepFromCloud(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_sleep").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteNutritionFromCloud(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_nutrition").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteBodyMetricFromCloud(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_body_metrics").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteWorkoutPlanFromCloud(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_workout_plans").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteWorkoutSessionFromCloud(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_workout_sessions").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteExerciseFromCloud(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_exercises").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteRunningPlanFromCloud(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_running_plans").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteRunningSessionFromCloud(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_running_sessions").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Create / update helpers ───────────────────────────────────────────────────

export async function pushWorkoutSessionToCloud(
  session: CreateWorkoutSession & { id: string; completed?: boolean },
): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_workout_sessions").upsert({
    id: session.id,
    user_id: USER_ID,
    plan_id: session.plan_id ?? null,
    name: session.name,
    scheduled_date: session.scheduled_date,
    completed: session.completed ?? false,
    duration_min: session.duration_min ?? null,
    calories_burned: session.calories_burned ?? null,
    avg_heart_rate: session.avg_heart_rate ?? null,
    notes: session.notes ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function completeWorkoutSessionInCloud(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from("protocol_workout_sessions")
    .update({ completed: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function pushExerciseToCloud(
  exercise: CreateExercise & { id: string },
): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_exercises").upsert({
    id: exercise.id,
    session_id: exercise.session_id,
    name: exercise.name,
    sets: exercise.sets ?? null,
    reps: exercise.reps ?? null,
    weight_kg: exercise.weight_kg ?? null,
    duration_min: exercise.duration_min ?? null,
    notes: exercise.notes ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function pushRunningPlanToCloud(plan: RunningPlan): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_running_plans").upsert({ ...plan, user_id: USER_ID });
  if (error) throw new Error(error.message);
}

export async function pushRunningSessionToCloud(
  session: CreateRunningSession & { id: string; completed?: boolean },
): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_running_sessions").upsert({
    id: session.id,
    user_id: USER_ID,
    plan_id: session.plan_id ?? null,
    date: session.date,
    planned_km: session.planned_km ?? null,
    actual_km: session.actual_km ?? null,
    avg_pace_s_per_km: session.avg_pace_s_per_km ?? null,
    heart_rate_avg: session.heart_rate_avg ?? null,
    heart_rate_max: session.heart_rate_max ?? null,
    elevation_gain_m: session.elevation_gain_m ?? null,
    cadence_avg: session.cadence_avg ?? null,
    calories: session.calories ?? null,
    completed: session.completed ?? false,
    notes: session.notes ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function completeRunningSessionInCloud(
  id: string,
  actualKm?: number | null,
  avgPaceSPerKm?: number | null,
  heartRateAvg?: number | null,
): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from("protocol_running_sessions")
    .update({
      completed: true,
      ...(actualKm != null && { actual_km: actualKm }),
      ...(avgPaceSPerKm != null && { avg_pace_s_per_km: avgPaceSPerKm }),
      ...(heartRateAvg != null && { heart_rate_avg: heartRateAvg }),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
