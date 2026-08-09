import { getSupabaseClient, getUserId } from "./supabase";
import { NUTRIENT_KEYS, type NutrientValues } from "./nutrients";
import type {
  Supplement, CreateSupplement, SupplementLog,
  BodyMetric, CreateBodyMetric,
  CreateNutritionEntry, CreateSleepEntry,
  Exercise, CreateExercise, RunningPlan, RunningSession, CreateRunningSession,
  SleepEntry, WorkoutPlan, WorkoutSession, CreateWorkoutSession,
  WorkoutRoutine, CreateWorkoutRoutine, RoutineExercise, CreateRoutineExercise, ExerciseHistory,
  NutritionEntry, Habit, CreateHabit, UpdateHabit, HabitCompletion,
  HabitStack, CreateHabitStack,
  Food, CreateFood, Meal, CreateMeal, MealItem, CreateMealItem,
  MealPlanEntry, CreateMealPlanEntry, NutritionGoals, UpdateNutritionGoals,
  ExerciseSet, CreateExerciseSet,
  DataSourceSettings,
} from "../store/types";

// ── Sleep ────────────────────────────────────────────────────────────────────

export async function fetchSleepFromCloud(): Promise<SleepEntry[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_sleep")
    .select("*")
    .eq("user_id", getUserId())
    .order("date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToSleep);
}

/** Keys on (user_id, date) rather than `entry.id` so repeat syncs for the same
 * date update the existing row in place instead of accumulating duplicates —
 * a blind `.upsert()` on a freshly client-generated id inserted a new row
 * every call. Only `entry.id` is used (and only on first insert); an existing
 * row's id is left untouched so manual-entry forms' optimistic UI (keyed on
 * the id they generated) never gets silently swapped out from under them. */
export async function pushSleepToCloud(entry: CreateSleepEntry & { id: string }): Promise<void> {
  const sb = getSupabaseClient();
  const userId = getUserId();
  const fields = {
    duration_min: entry.duration_min,
    quality_score: entry.quality_score,
    deep_sleep_min: entry.deep_sleep_min ?? null,
    rem_sleep_min: entry.rem_sleep_min ?? null,
    light_sleep_min: entry.light_sleep_min ?? null,
    awake_time_min: entry.awake_time_min ?? null,
    sleep_latency_min: entry.sleep_latency_min ?? null,
    respiratory_rate: entry.respiratory_rate ?? null,
    temperature_deviation: entry.temperature_deviation ?? null,
    bedtime_start: entry.bedtime_start ?? null,
    bedtime_end: entry.bedtime_end ?? null,
    notes: entry.notes ?? null,
  };

  const { data: existing, error: selectError } = await sb
    .from("protocol_sleep")
    .select("id")
    .eq("user_id", userId)
    .eq("date", entry.date)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);

  if (existing) {
    const { error } = await sb.from("protocol_sleep").update(fields).eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb.from("protocol_sleep").insert({ id: entry.id, user_id: userId, date: entry.date, ...fields });
    if (error) throw new Error(error.message);
  }
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
    sleep_latency_min: row.sleep_latency_min as number | null,
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
    .eq("user_id", getUserId())
    .order("date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToNutrition);
}

export async function pushNutritionToCloud(entry: CreateNutritionEntry & { id: string }): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_nutrition").upsert({
    id: entry.id,
    user_id: getUserId(),
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
    .eq("user_id", getUserId())
    .order("date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToBodyMetric);
}

/** Same (user_id, date)-keyed update-or-insert as `pushSleepToCloud` — see
 * its comment for why. */
export async function pushBodyMetricToCloud(entry: CreateBodyMetric & { id: string }): Promise<void> {
  const sb = getSupabaseClient();
  const userId = getUserId();
  // Only include keys the caller actually provided — an `undefined` field is
  // omitted so the update never clobbers a value owned by the other source
  // (e.g. Garmin writing only its per-metric-selected fields). An explicit
  // `null` still clears the column.
  const fields: Record<string, unknown> = {};
  const add = (key: string, val: number | string | null | undefined) => {
    if (val !== undefined) fields[key] = val;
  };
  add("weight_kg", entry.weight_kg);
  add("hrv_ms", entry.hrv_ms);
  add("resting_hr_bpm", entry.resting_hr_bpm);
  add("spo2_pct", entry.spo2_pct);
  add("readiness_score", entry.readiness_score);
  add("temperature_deviation", entry.temperature_deviation);
  add("recovery_index", entry.recovery_index);
  add("notes", entry.notes);
  if (Object.keys(fields).length === 0) return;

  const { data: existing, error: selectError } = await sb
    .from("protocol_body_metrics")
    .select("id")
    .eq("user_id", userId)
    .eq("date", entry.date)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);

  if (existing) {
    const { error } = await sb.from("protocol_body_metrics").update(fields).eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb.from("protocol_body_metrics").insert({ id: entry.id, user_id: userId, date: entry.date, ...fields });
    if (error) throw new Error(error.message);
  }
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
    avg_heart_rate_bpm: row.avg_heart_rate_bpm as number | null,
    min_heart_rate_bpm: row.min_heart_rate_bpm as number | null,
    max_heart_rate_bpm: row.max_heart_rate_bpm as number | null,
    stress_high_min: row.stress_high_min as number | null,
    stress_recovery_min: row.stress_recovery_min as number | null,
    stress_summary: row.stress_summary as string | null,
    resilience_level: row.resilience_level as string | null,
    resilience_sleep_recovery: row.resilience_sleep_recovery as number | null,
    resilience_daytime_recovery: row.resilience_daytime_recovery as number | null,
    resilience_stress: row.resilience_stress as number | null,
    cardio_age: row.cardio_age as number | null,
    pulse_wave_velocity: row.pulse_wave_velocity as number | null,
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
    .eq("user_id", getUserId())
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as WorkoutPlan[];
}

export async function pushWorkoutPlanToCloud(plan: WorkoutPlan): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_workout_plans").upsert({ ...plan, user_id: getUserId() });
  if (error) throw new Error(error.message);
}

// ── Workout Sessions ──────────────────────────────────────────────────────────

export async function fetchWorkoutSessionsFromCloud(planId?: string): Promise<WorkoutSession[]> {
  const sb = getSupabaseClient();
  let q = sb.from("protocol_workout_sessions").select("*").eq("user_id", getUserId());
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

// ── Training routines (program designer) ─────────────────────────────────────

export async function fetchRoutinesFromCloud(): Promise<WorkoutRoutine[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_workout_routines")
    .select("*")
    .eq("user_id", getUserId())
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as WorkoutRoutine[];
}

export async function pushRoutineToCloud(r: CreateWorkoutRoutine & { id: string }): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_workout_routines").upsert({
    id: r.id,
    user_id: getUserId(),
    plan_id: r.plan_id ?? null,
    name: r.name,
    day_label: r.day_label ?? null,
    sort_order: r.sort_order ?? 0,
    notes: r.notes ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function deleteRoutineFromCloud(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_workout_routines").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function fetchRoutineExercisesFromCloud(routineId: string): Promise<RoutineExercise[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_routine_exercises")
    .select("*")
    .eq("routine_id", routineId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RoutineExercise[];
}

export async function pushRoutineExerciseToCloud(e: CreateRoutineExercise & { id: string }): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_routine_exercises").upsert({
    id: e.id,
    user_id: getUserId(),
    routine_id: e.routine_id,
    name: e.name,
    target_sets: e.target_sets ?? null,
    target_reps: e.target_reps ?? null,
    rest_sec: e.rest_sec ?? null,
    target_weight_kg: e.target_weight_kg ?? null,
    target_rpe: e.target_rpe ?? null,
    tempo: e.tempo ?? null,
    sort_order: e.sort_order ?? 0,
    notes: e.notes ?? null,
    primary_muscles: e.primary_muscles ?? null,
    secondary_muscles: e.secondary_muscles ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function deleteRoutineExerciseFromCloud(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_routine_exercises").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** All logged exercises across the given sessions, joined to each session's date
 *  — drives the progression charts. */
export async function fetchExerciseHistoryFromCloud(
  sessions: { id: string; date: string }[],
): Promise<ExerciseHistory[]> {
  if (sessions.length === 0) return [];
  const sb = getSupabaseClient();
  const dateById = new Map(sessions.map((s) => [s.id, s.date]));
  const { data, error } = await sb
    .from("protocol_exercises")
    .select("session_id, name, sets, reps, weight_kg")
    .in("session_id", sessions.map((s) => s.id));
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    name: r.name as string,
    date: dateById.get(r.session_id as string) ?? "",
    sets: (r.sets as number | null) ?? null,
    reps: (r.reps as number | null) ?? null,
    weight_kg: (r.weight_kg as number | null) ?? null,
  })).filter((e) => e.date);
}

// ── Running Plans ─────────────────────────────────────────────────────────────

export async function fetchRunningPlansFromCloud(): Promise<RunningPlan[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_running_plans")
    .select("*")
    .eq("user_id", getUserId())
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as RunningPlan[];
}

// ── Running Sessions ──────────────────────────────────────────────────────────

export async function fetchRunningSessionsFromCloud(planId?: string): Promise<RunningSession[]> {
  const sb = getSupabaseClient();
  let q = sb.from("protocol_running_sessions").select("*").eq("user_id", getUserId());
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
    user_id: getUserId(),
    external_id: session.external_id ?? null,
    plan_id: session.plan_id ?? null,
    routine_id: session.routine_id ?? null,
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
  const { error } = await sb.from("protocol_running_plans").upsert({ ...plan, user_id: getUserId() });
  if (error) throw new Error(error.message);
}

export async function pushRunningSessionToCloud(
  session: CreateRunningSession & { id: string; completed?: boolean },
): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_running_sessions").upsert({
    id: session.id,
    user_id: getUserId(),
    external_id: session.external_id ?? null,
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

// ── Habits ────────────────────────────────────────────────────────────────────

function rowToHabit(row: Record<string, unknown>): Habit {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | null,
    scheduled_time: row.scheduled_time as string | null,
    duration_min: row.duration_min as number | null,
    repeat_days: row.repeat_days as number[] | null,
    stack_id: row.stack_id as string | null,
    target_per_week: row.target_per_week as number,
    sort_order: row.sort_order as number,
    archived: row.archived as boolean,
    created_at: row.created_at as string,
  };
}

export async function fetchHabitsFromCloud(): Promise<Habit[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_habits")
    .select("*")
    .eq("user_id", getUserId())
    .eq("archived", false)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToHabit);
}

export async function pushHabitToCloud(habit: CreateHabit & { id: string }): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_habits").upsert({
    id: habit.id,
    user_id: getUserId(),
    name: habit.name,
    description: habit.description ?? null,
    scheduled_time: habit.scheduled_time ?? null,
    duration_min: habit.duration_min ?? null,
    repeat_days: habit.repeat_days ?? null,
    stack_id: habit.stack_id ?? null,
    target_per_week: habit.target_per_week ?? 7,
    sort_order: habit.sort_order ?? 0,
  });
  if (error) throw new Error(error.message);
}

export async function updateHabitInCloud(habit: UpdateHabit): Promise<void> {
  const sb = getSupabaseClient();
  const { id, ...fields } = habit;
  const { error } = await sb.from("protocol_habits").update(fields).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function archiveHabitInCloud(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_habits").update({ archived: true }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Habit stacks ─────────────────────────────────────────────────────────────

function rowToHabitStack(row: Record<string, unknown>): HabitStack {
  return {
    id: row.id as string,
    name: row.name as string,
    sort_order: row.sort_order as number,
    created_at: row.created_at as string,
  };
}

export async function fetchHabitStacksFromCloud(): Promise<HabitStack[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_habit_stacks")
    .select("*")
    .eq("user_id", getUserId())
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToHabitStack);
}

export async function pushHabitStackToCloud(stack: CreateHabitStack & { id: string }): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_habit_stacks").upsert({
    id: stack.id,
    user_id: getUserId(),
    name: stack.name,
    sort_order: stack.sort_order ?? 0,
  });
  if (error) throw new Error(error.message);
}

export async function deleteHabitStackFromCloud(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_habit_stacks").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function fetchHabitCompletionsFromCloud(sinceDate: string): Promise<HabitCompletion[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_habit_completions")
    .select("id, habit_id, date")
    .eq("user_id", getUserId())
    .gte("date", sinceDate);
  if (error) throw new Error(error.message);
  return (data ?? []) as HabitCompletion[];
}

export async function addHabitCompletionToCloud(habitId: string, date: string): Promise<HabitCompletion> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_habit_completions")
    .insert({ habit_id: habitId, user_id: getUserId(), date })
    .select("id, habit_id, date")
    .single();
  if (error) throw new Error(error.message);
  return data as HabitCompletion;
}

export async function removeHabitCompletionFromCloud(habitId: string, date: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from("protocol_habit_completions")
    .delete()
    .eq("habit_id", habitId)
    .eq("date", date)
    .eq("user_id", getUserId());
  if (error) throw new Error(error.message);
}

// ── Meal planner: Foods ─────────────────────────────────────────────────────

/** Pull the full nutrient block off a row (foods and supplements share it). */
function readNutrients(row: Record<string, unknown>): NutrientValues {
  const out = {} as NutrientValues;
  for (const k of NUTRIENT_KEYS) out[k] = (row[k] as number | null) ?? null;
  return out;
}

/** Just the nutrient keys of an object, for writing back to the DB. */
function nutrientCols(src: Partial<NutrientValues>): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const k of NUTRIENT_KEYS) out[k] = src[k] ?? null;
  return out;
}

function rowToFood(row: Record<string, unknown>): Food {
  return {
    id: row.id as string,
    user_id: (row.user_id as string | null) ?? null,
    source: row.source as Food["source"],
    external_id: row.external_id as string | null,
    name: row.name as string,
    brand: row.brand as string | null,
    serving_qty: row.serving_qty as number,
    serving_unit: row.serving_unit as string,
    created_at: row.created_at as string,
    ...readNutrients(row),
  };
}

// The food catalog is a SHARED library: every signed-in user reads every row.
// Contribution is still attributed (user_id), and RLS only lets you edit/delete
// your own rows — see migration 20260807120000_protocol_shared_foods.sql.
export async function fetchFoodsFromCloud(): Promise<Food[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_foods")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToFood);
}

export async function pushFoodToCloud(food: CreateFood & { id: string }): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_foods").upsert({ ...food, user_id: getUserId() });
  if (error) throw new Error(error.message);
}

/** Edit an existing food. RLS silently no-ops if it isn't yours. */
export async function updateFoodInCloud(food: CreateFood & { id: string }): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from("protocol_foods")
    .update({ ...food, user_id: getUserId() })
    .eq("id", food.id)
    .eq("user_id", getUserId());
  if (error) throw new Error(error.message);
}

/** Remove a food you contributed. RLS blocks deleting others' rows. */
export async function deleteFoodFromCloud(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from("protocol_foods")
    .delete()
    .eq("id", id)
    .eq("user_id", getUserId());
  if (error) throw new Error(error.message);
}

// ── Meal planner: Meals & meal items ────────────────────────────────────────

export async function fetchMealsFromCloud(): Promise<Meal[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_meals")
    .select("*")
    .eq("user_id", getUserId())
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Meal[];
}

export async function pushMealToCloud(meal: CreateMeal & { id: string }): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_meals").upsert({
    id: meal.id,
    user_id: getUserId(),
    name: meal.name,
    description: meal.description ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function deleteMealFromCloud(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_meals").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function fetchMealItemsFromCloud(mealId: string): Promise<MealItem[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_meal_items")
    .select("*")
    .eq("meal_id", mealId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MealItem[];
}

export async function pushMealItemToCloud(item: CreateMealItem & { id: string }): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_meal_items").upsert({
    id: item.id,
    meal_id: item.meal_id,
    food_id: item.food_id,
    quantity: item.quantity,
    sort_order: item.sort_order ?? 0,
  });
  if (error) throw new Error(error.message);
}

export async function deleteMealItemFromCloud(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_meal_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Meal planner: Weekly plan entries ───────────────────────────────────────

export async function fetchMealPlanEntriesFromCloud(startDate: string, endDate: string): Promise<MealPlanEntry[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_meal_plan_entries")
    .select("*")
    .eq("user_id", getUserId())
    .gte("date", startDate)
    .lte("date", endDate)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MealPlanEntry[];
}

export async function pushMealPlanEntryToCloud(entry: CreateMealPlanEntry & { id: string }): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_meal_plan_entries").upsert({
    id: entry.id,
    user_id: getUserId(),
    date: entry.date,
    slot: entry.slot,
    food_id: entry.food_id ?? null,
    meal_id: entry.meal_id ?? null,
    quantity: entry.quantity ?? 1,
    logged: entry.logged ?? false,
    sort_order: entry.sort_order ?? 0,
  });
  if (error) throw new Error(error.message);
}

export async function setMealPlanEntryLoggedInCloud(id: string, logged: boolean): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_meal_plan_entries").update({ logged }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteMealPlanEntryFromCloud(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_meal_plan_entries").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Meal planner: Nutrition goals ───────────────────────────────────────────

export async function fetchNutritionGoalsFromCloud(): Promise<NutritionGoals | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_nutrition_goals")
    .select("*")
    .eq("user_id", getUserId())
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as NutritionGoals | null;
}

export async function upsertNutritionGoalsInCloud(id: string, goals: UpdateNutritionGoals): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_nutrition_goals").upsert({
    id,
    user_id: getUserId(),
    ...goals,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

// ── Supplement stack ────────────────────────────────────────────────────────

function rowToSupplement(row: Record<string, unknown>): Supplement {
  return {
    id: row.id as string,
    user_id: (row.user_id as string | null) ?? null,
    name: row.name as string,
    brand: row.brand as string | null,
    dose: row.dose as string | null,
    sort_order: (row.sort_order as number) ?? 0,
    archived: (row.archived as boolean) ?? false,
    created_at: row.created_at as string,
    ...readNutrients(row),
  };
}

export async function fetchSupplementsFromCloud(): Promise<Supplement[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_supplements")
    .select("*")
    .eq("user_id", getUserId())
    .eq("archived", false)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToSupplement);
}

export async function pushSupplementToCloud(s: CreateSupplement & { id: string }): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_supplements").upsert({
    id: s.id,
    user_id: getUserId(),
    name: s.name,
    brand: s.brand ?? null,
    dose: s.dose ?? null,
    sort_order: s.sort_order ?? 0,
    ...nutrientCols(s),
  });
  if (error) throw new Error(error.message);
}

/** Soft-delete: archive so historical logs stay intact (cascade would wipe them). */
export async function archiveSupplementInCloud(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from("protocol_supplements")
    .update({ archived: true })
    .eq("id", id)
    .eq("user_id", getUserId());
  if (error) throw new Error(error.message);
}

export async function fetchSupplementLogsFromCloud(sinceDate: string): Promise<SupplementLog[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_supplement_logs")
    .select("id, supplement_id, date")
    .eq("user_id", getUserId())
    .gte("date", sinceDate);
  if (error) throw new Error(error.message);
  return (data ?? []) as SupplementLog[];
}

export async function addSupplementLogToCloud(supplementId: string, date: string): Promise<SupplementLog> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_supplement_logs")
    .insert({ supplement_id: supplementId, user_id: getUserId(), date })
    .select("id, supplement_id, date")
    .single();
  if (error) throw new Error(error.message);
  return data as SupplementLog;
}

export async function removeSupplementLogFromCloud(supplementId: string, date: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from("protocol_supplement_logs")
    .delete()
    .eq("supplement_id", supplementId)
    .eq("date", date)
    .eq("user_id", getUserId());
  if (error) throw new Error(error.message);
}

// ── Exercise Sets (Garmin) ──────────────────────────────────────────────────

export async function fetchExerciseSetsFromCloud(sinceDate: string): Promise<ExerciseSet[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_exercise_sets")
    .select("*")
    .eq("user_id", getUserId())
    .gte("date", sinceDate)
    .order("date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ExerciseSet[];
}

/** Replaces every set in [startDate, endDate] with `entries` — re-running a
 * sync over the same window shouldn't accumulate duplicate set rows. */
export async function replaceExerciseSetsInCloud(
  startDate: string,
  endDate: string,
  entries: (CreateExerciseSet & { id: string })[],
): Promise<void> {
  const sb = getSupabaseClient();
  const userId = getUserId();

  const { error: deleteError } = await sb
    .from("protocol_exercise_sets")
    .delete()
    .eq("user_id", userId)
    .gte("date", startDate)
    .lte("date", endDate);
  if (deleteError) throw new Error(deleteError.message);

  if (entries.length === 0) return;

  const { error: insertError } = await sb.from("protocol_exercise_sets").insert(
    entries.map((e) => ({ ...e, user_id: userId })),
  );
  if (insertError) throw new Error(insertError.message);
}

// ── Data source settings ─────────────────────────────────────────────────────

/** `null` means the user has never opened Settings — callers should fall
 * back to `DEFAULT_DATA_SOURCE_SETTINGS` rather than treat this as an error. */
export async function fetchDataSourceSettingsFromCloud(): Promise<DataSourceSettings | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_data_source_settings")
    .select("sleep_source, workouts_source, hrv_source, resting_hr_source, readiness_source, recovery_source, spo2_source, temperature_source")
    .eq("user_id", getUserId())
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as DataSourceSettings | null;
}

export async function upsertDataSourceSettingsInCloud(settings: DataSourceSettings): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.from("protocol_data_source_settings").upsert({
    user_id: getUserId(),
    ...settings,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}
