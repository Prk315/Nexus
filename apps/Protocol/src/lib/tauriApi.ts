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
  Habit, CreateHabit, UpdateHabit, HabitCompletion, HabitStack, CreateHabitStack,
  Food, CreateFood, Meal, CreateMeal, MealItem, CreateMealItem,
  MealPlanEntry, CreateMealPlanEntry, NutritionGoals, UpdateNutritionGoals,
} from "../store/types";
import { getUserId } from "./supabase";
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
  fetchHabitsFromCloud, pushHabitToCloud, updateHabitInCloud, archiveHabitInCloud,
  fetchHabitCompletionsFromCloud, addHabitCompletionToCloud, removeHabitCompletionFromCloud,
  fetchHabitStacksFromCloud, pushHabitStackToCloud, deleteHabitStackFromCloud,
  fetchFoodsFromCloud, pushFoodToCloud, updateFoodInCloud, deleteFoodFromCloud,
  fetchMealsFromCloud, pushMealToCloud, deleteMealFromCloud,
  fetchMealItemsFromCloud, pushMealItemToCloud, deleteMealItemFromCloud,
  fetchMealPlanEntriesFromCloud, pushMealPlanEntryToCloud, setMealPlanEntryLoggedInCloud, deleteMealPlanEntryFromCloud,
  fetchNutritionGoalsFromCloud, upsertNutritionGoalsInCloud,
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
    avg_heart_rate_bpm: entry.avg_heart_rate_bpm ?? null,
    min_heart_rate_bpm: entry.min_heart_rate_bpm ?? null,
    max_heart_rate_bpm: entry.max_heart_rate_bpm ?? null,
    stress_high_min: entry.stress_high_min ?? null,
    stress_recovery_min: entry.stress_recovery_min ?? null,
    stress_summary: entry.stress_summary ?? null,
    resilience_level: entry.resilience_level ?? null,
    resilience_sleep_recovery: entry.resilience_sleep_recovery ?? null,
    resilience_daytime_recovery: entry.resilience_daytime_recovery ?? null,
    resilience_stress: entry.resilience_stress ?? null,
    cardio_age: entry.cardio_age ?? null,
    pulse_wave_velocity: entry.pulse_wave_velocity ?? null,
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

// ── Habits ────────────────────────────────────────────────────────────────────

export const getHabits = (): Promise<Habit[]> => fetchHabitsFromCloud();

export async function createHabit(habit: CreateHabit): Promise<Habit> {
  const id = crypto.randomUUID();
  await pushHabitToCloud({ ...habit, id });
  return {
    id,
    name: habit.name,
    description: habit.description ?? null,
    scheduled_time: habit.scheduled_time ?? null,
    duration_min: habit.duration_min ?? null,
    repeat_days: habit.repeat_days ?? null,
    stack_id: habit.stack_id ?? null,
    target_per_week: habit.target_per_week ?? 7,
    sort_order: habit.sort_order ?? 0,
    archived: false,
    created_at: new Date().toISOString(),
  };
}

export const updateHabit = (habit: UpdateHabit): Promise<void> => updateHabitInCloud(habit);

export const archiveHabit = (id: string): Promise<void> => archiveHabitInCloud(id);

export const getHabitCompletions = (sinceDate: string): Promise<HabitCompletion[]> =>
  fetchHabitCompletionsFromCloud(sinceDate);

export const addHabitCompletion = (habitId: string, date: string): Promise<HabitCompletion> =>
  addHabitCompletionToCloud(habitId, date);

export const removeHabitCompletion = (habitId: string, date: string): Promise<void> =>
  removeHabitCompletionFromCloud(habitId, date);

// ── Habit stacks ─────────────────────────────────────────────────────────────

export const getHabitStacks = (): Promise<HabitStack[]> => fetchHabitStacksFromCloud();

export async function createHabitStack(stack: CreateHabitStack): Promise<HabitStack> {
  const id = crypto.randomUUID();
  await pushHabitStackToCloud({ ...stack, id });
  return {
    id,
    name: stack.name,
    sort_order: stack.sort_order ?? 0,
    created_at: new Date().toISOString(),
  };
}

export const deleteHabitStack = (id: string): Promise<void> => deleteHabitStackFromCloud(id);

// ── Meal planner: Foods ──────────────────────────────────────────────────────

export const getFoods = (): Promise<Food[]> => fetchFoodsFromCloud();

export async function createFood(food: CreateFood): Promise<Food> {
  const id = crypto.randomUUID();
  await pushFoodToCloud({ ...food, id });
  return { id, user_id: getUserId(), ...food, created_at: new Date().toISOString() };
}

export async function updateFood(food: CreateFood & { id: string }): Promise<Food> {
  await updateFoodInCloud(food);
  return { ...food, user_id: getUserId(), created_at: new Date().toISOString() };
}

export const deleteFood = (id: string): Promise<void> => deleteFoodFromCloud(id);

// ── Meal planner: Meals & meal items ────────────────────────────────────────

export const getMeals = (): Promise<Meal[]> => fetchMealsFromCloud();

export async function createMeal(meal: CreateMeal): Promise<Meal> {
  const id = crypto.randomUUID();
  await pushMealToCloud({ ...meal, id });
  return { id, name: meal.name, description: meal.description ?? null, created_at: new Date().toISOString() };
}

export async function updateMeal(meal: CreateMeal & { id: string; created_at?: string }): Promise<Meal> {
  await pushMealToCloud(meal); // upsert by id
  return {
    id: meal.id,
    name: meal.name,
    description: meal.description ?? null,
    created_at: meal.created_at ?? new Date().toISOString(),
  };
}

export const deleteMeal = (id: string): Promise<void> => deleteMealFromCloud(id);

export const getMealItems = (mealId: string): Promise<MealItem[]> => fetchMealItemsFromCloud(mealId);

export async function addMealItem(item: CreateMealItem): Promise<MealItem> {
  const id = crypto.randomUUID();
  await pushMealItemToCloud({ ...item, id });
  return { id, meal_id: item.meal_id, food_id: item.food_id, quantity: item.quantity, sort_order: item.sort_order ?? 0 };
}

export const removeMealItem = (id: string): Promise<void> => deleteMealItemFromCloud(id);

// ── Meal planner: Weekly plan entries ───────────────────────────────────────

export const getMealPlanEntries = (startDate: string, endDate: string): Promise<MealPlanEntry[]> =>
  fetchMealPlanEntriesFromCloud(startDate, endDate);

export async function addMealPlanEntry(entry: CreateMealPlanEntry): Promise<MealPlanEntry> {
  const id = crypto.randomUUID();
  await pushMealPlanEntryToCloud({ ...entry, id });
  return {
    id,
    date: entry.date,
    slot: entry.slot,
    food_id: entry.food_id ?? null,
    meal_id: entry.meal_id ?? null,
    quantity: entry.quantity ?? 1,
    logged: entry.logged ?? false,
    sort_order: entry.sort_order ?? 0,
    created_at: new Date().toISOString(),
  };
}

export const setMealPlanEntryLogged = (id: string, logged: boolean): Promise<void> =>
  setMealPlanEntryLoggedInCloud(id, logged);

export const removeMealPlanEntry = (id: string): Promise<void> => deleteMealPlanEntryFromCloud(id);

// ── Meal planner: Nutrition goals ───────────────────────────────────────────

export const getNutritionGoals = (): Promise<NutritionGoals | null> => fetchNutritionGoalsFromCloud();

export async function saveNutritionGoals(
  current: NutritionGoals | null,
  goals: UpdateNutritionGoals,
): Promise<NutritionGoals> {
  const id = current?.id ?? crypto.randomUUID();
  await upsertNutritionGoalsInCloud(id, goals);
  return {
    calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null,
    sodium_mg: null, potassium_mg: null, calcium_mg: null, iron_mg: null, vitamin_c_mg: null, vitamin_d_mcg: null,
    ...current,
    ...goals,
    id,
    updated_at: new Date().toISOString(),
  };
}
