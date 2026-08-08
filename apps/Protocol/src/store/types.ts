import type { NutrientValues } from "../lib/nutrients";

export type Theme = "light" | "dark" | "system";

export interface SleepEntry {
  id: string;
  date: string;
  duration_min: number;
  /** 0-10 scale (manual entry, Oura import, and all UI/scoring agree on this — importers must normalize to it). */
  quality_score: number;
  deep_sleep_min: number | null;
  rem_sleep_min: number | null;
  light_sleep_min: number | null;
  awake_time_min: number | null;
  /** Minutes to fall asleep after getting into bed (Oura `latency`). */
  sleep_latency_min: number | null;
  respiratory_rate: number | null;
  temperature_deviation: number | null;
  bedtime_start: string | null;
  bedtime_end: string | null;
  notes: string | null;
  created_at: string;
}

export interface CreateSleepEntry {
  date: string;
  duration_min: number;
  /** 0-10 scale (manual entry, Oura import, and all UI/scoring agree on this — importers must normalize to it). */
  quality_score: number;
  deep_sleep_min?: number | null;
  rem_sleep_min?: number | null;
  light_sleep_min?: number | null;
  awake_time_min?: number | null;
  sleep_latency_min?: number | null;
  respiratory_rate?: number | null;
  temperature_deviation?: number | null;
  bedtime_start?: string | null;
  bedtime_end?: string | null;
  notes?: string | null;
}

export interface NutritionEntry {
  id: string;
  date: string;
  meal_type: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  foods: string | null;
  notes: string | null;
  created_at: string;
}

export interface CreateNutritionEntry {
  date: string;
  meal_type: string;
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  foods?: string | null;
  notes?: string | null;
}

export interface BodyMetric {
  id: string;
  date: string;
  weight_kg: number | null;
  hrv_ms: number | null;
  resting_hr_bpm: number | null;
  spo2_pct: number | null;
  readiness_score: number | null;
  temperature_deviation: number | null;
  recovery_index: number | null;
  avg_heart_rate_bpm: number | null;
  min_heart_rate_bpm: number | null;
  max_heart_rate_bpm: number | null;
  stress_high_min: number | null;
  stress_recovery_min: number | null;
  stress_summary: string | null;
  resilience_level: string | null;
  resilience_sleep_recovery: number | null;
  resilience_daytime_recovery: number | null;
  resilience_stress: number | null;
  cardio_age: number | null;
  pulse_wave_velocity: number | null;
  notes: string | null;
  created_at: string;
}

export interface CreateBodyMetric {
  date: string;
  weight_kg?: number | null;
  hrv_ms?: number | null;
  resting_hr_bpm?: number | null;
  spo2_pct?: number | null;
  readiness_score?: number | null;
  temperature_deviation?: number | null;
  recovery_index?: number | null;
  avg_heart_rate_bpm?: number | null;
  min_heart_rate_bpm?: number | null;
  max_heart_rate_bpm?: number | null;
  stress_high_min?: number | null;
  stress_recovery_min?: number | null;
  stress_summary?: string | null;
  resilience_level?: string | null;
  resilience_sleep_recovery?: number | null;
  resilience_daytime_recovery?: number | null;
  resilience_stress?: number | null;
  cardio_age?: number | null;
  pulse_wave_velocity?: number | null;
  notes?: string | null;
}

export interface ExerciseSet {
  id: string;
  date: string;
  activity_name: string | null;
  category: string;
  exercise_name: string | null;
  reps: number | null;
  weight_kg: number | null;
  notes: string | null;
  created_at: string;
}

export interface CreateExerciseSet {
  date: string;
  activity_name?: string | null;
  category: string;
  exercise_name?: string | null;
  reps?: number | null;
  weight_kg?: number | null;
  notes?: string | null;
}

export interface WorkoutPlan {
  id: string;
  name: string;
  description: string | null;
  days_per_week: number;
  created_at: string;
}

export interface CreateWorkoutPlan {
  name: string;
  description?: string | null;
  days_per_week: number;
}

export interface WorkoutSession {
  id: string;
  plan_id: string | null;
  routine_id: string | null;
  name: string;
  scheduled_date: string;
  completed: boolean;
  duration_min: number | null;
  calories_burned: number | null;
  avg_heart_rate: number | null;
  notes: string | null;
  created_at: string;
}

export interface CreateWorkoutSession {
  plan_id?: string | null;
  routine_id?: string | null;
  name: string;
  scheduled_date: string;
  duration_min?: number | null;
  calories_burned?: number | null;
  avg_heart_rate?: number | null;
  notes?: string | null;
}

// ── Training-program designer ────────────────────────────────────────────────

/** A training day within a program (WorkoutPlan) — e.g. "Push A". Holds an
 *  ordered list of prescribed exercises (RoutineExercise). */
export interface WorkoutRoutine {
  id: string;
  plan_id: string | null;
  name: string;
  day_label: string | null;
  sort_order: number;
  notes: string | null;
  created_at: string;
}

export interface CreateWorkoutRoutine {
  plan_id?: string | null;
  name: string;
  day_label?: string | null;
  sort_order?: number;
  notes?: string | null;
}

export type UpdateWorkoutRoutine = CreateWorkoutRoutine & { id: string };

/** A prescribed exercise inside a routine — the target you design, not what you
 *  logged. `target_reps` is text so ranges like "8-12" are allowed. */
export interface RoutineExercise {
  id: string;
  routine_id: string;
  name: string;
  target_sets: number | null;
  target_reps: string | null;
  rest_sec: number | null;
  target_weight_kg: number | null;
  target_rpe: number | null;
  tempo: string | null;
  sort_order: number;
  notes: string | null;
}

export interface CreateRoutineExercise {
  routine_id: string;
  name: string;
  target_sets?: number | null;
  target_reps?: string | null;
  rest_sec?: number | null;
  target_weight_kg?: number | null;
  target_rpe?: number | null;
  tempo?: string | null;
  sort_order?: number;
  notes?: string | null;
}

export type UpdateRoutineExercise = CreateRoutineExercise & { id: string };

/** A logged exercise joined to its session date — for progression charts. */
export interface ExerciseHistory {
  name: string;
  date: string;
  sets: number | null;
  reps: number | null;
  weight_kg: number | null;
}

export interface Exercise {
  id: string;
  session_id: string;
  name: string;
  sets: number | null;
  reps: number | null;
  weight_kg: number | null;
  duration_min: number | null;
  notes: string | null;
}

export interface CreateExercise {
  session_id: string;
  name: string;
  sets?: number | null;
  reps?: number | null;
  weight_kg?: number | null;
  duration_min?: number | null;
  notes?: string | null;
}

export interface RunningPlan {
  id: string;
  name: string;
  goal_type: string;
  target_date: string | null;
  weekly_km_base: number;
  fitness_level: string;
  created_at: string;
}

export interface CreateRunningPlan {
  name: string;
  goal_type: string;
  target_date?: string | null;
  weekly_km_base: number;
  fitness_level: string;
}

export interface RunningSession {
  id: string;
  plan_id: string | null;
  date: string;
  planned_km: number | null;
  actual_km: number | null;
  avg_pace_s_per_km: number | null;
  heart_rate_avg: number | null;
  heart_rate_max: number | null;
  elevation_gain_m: number | null;
  cadence_avg: number | null;
  calories: number | null;
  completed: boolean;
  notes: string | null;
  created_at: string;
}

export interface CreateRunningSession {
  plan_id?: string | null;
  date: string;
  planned_km?: number | null;
  actual_km?: number | null;
  avg_pace_s_per_km?: number | null;
  heart_rate_avg?: number | null;
  heart_rate_max?: number | null;
  elevation_gain_m?: number | null;
  cadence_avg?: number | null;
  calories?: number | null;
  notes?: string | null;
}

export interface HabitStack {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface CreateHabitStack {
  name: string;
  sort_order?: number;
}

/** Days of week a habit repeats on, 0=Monday..6=Sunday. `null` means every day. */
export type RepeatDays = number[] | null;

export interface Habit {
  id: string;
  name: string;
  description: string | null;
  scheduled_time: string | null;
  duration_min: number | null;
  repeat_days: RepeatDays;
  stack_id: string | null;
  target_per_week: number;
  sort_order: number;
  archived: boolean;
  created_at: string;
}

export interface CreateHabit {
  name: string;
  description?: string | null;
  scheduled_time?: string | null;
  duration_min?: number | null;
  repeat_days?: RepeatDays;
  stack_id?: string | null;
  target_per_week?: number;
  sort_order?: number;
}

export interface UpdateHabit {
  id: string;
  name?: string;
  description?: string | null;
  scheduled_time?: string | null;
  duration_min?: number | null;
  repeat_days?: RepeatDays;
  stack_id?: string | null;
  sort_order?: number;
}

export interface HabitCompletion {
  id: string;
  habit_id: string;
  date: string;
}

// ── Meal planner ─────────────────────────────────────────────────────────────

export type FoodSource = "usda" | "openfoodfacts" | "frida" | "manual";

/** Nutrient values are always per 100g/100ml — servings apply a multiplier.
 *  The full nutrient set (macros + sub-categories + minerals + vitamins) comes
 *  from NutrientValues; see lib/nutrients.ts. */
export interface Food extends NutrientValues {
  id: string;
  /** Contributor. The catalog is a SHARED library — everyone reads every row,
   *  but only the contributor may edit or delete their own. */
  user_id: string | null;
  source: FoodSource;
  external_id: string | null;
  name: string;
  brand: string | null;
  serving_qty: number;
  serving_unit: string;
  created_at: string;
}

export type CreateFood = Omit<Food, "id" | "user_id" | "created_at">;

/** A supplement in the daily stack. Nutrient values are ABSOLUTE per dose (a
 *  serving already), not per 100g — so they add directly when taken. */
export interface Supplement extends NutrientValues {
  id: string;
  user_id: string | null;
  name: string;
  brand: string | null;
  dose: string | null;
  sort_order: number;
  archived: boolean;
  created_at: string;
}

export type CreateSupplement = Omit<Supplement, "id" | "user_id" | "archived" | "created_at">;
export type UpdateSupplement = CreateSupplement & { id: string };

/** One "taken it today" record — presence means taken, like a habit completion. */
export interface SupplementLog {
  id: string;
  supplement_id: string;
  date: string;
}

export interface Meal {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface CreateMeal {
  name: string;
  description?: string | null;
}

export interface MealItem {
  id: string;
  meal_id: string;
  food_id: string;
  quantity: number;
  sort_order: number;
}

export interface CreateMealItem {
  meal_id: string;
  food_id: string;
  quantity: number;
  sort_order?: number;
}

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";

export interface MealPlanEntry {
  id: string;
  date: string;
  slot: MealSlot;
  food_id: string | null;
  meal_id: string | null;
  quantity: number;
  logged: boolean;
  sort_order: number;
  created_at: string;
}

export interface CreateMealPlanEntry {
  date: string;
  slot: MealSlot;
  food_id?: string | null;
  meal_id?: string | null;
  quantity?: number;
  logged?: boolean;
  sort_order?: number;
}

export interface NutritionGoals {
  id: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
  potassium_mg: number | null;
  calcium_mg: number | null;
  iron_mg: number | null;
  vitamin_c_mg: number | null;
  vitamin_d_mcg: number | null;
  updated_at: string;
}

export type UpdateNutritionGoals = Partial<Omit<NutritionGoals, "id" | "updated_at">>;

export type GarminSyncStatus = "idle" | "syncing" | "success" | "error";

export interface GarminSyncState {
  status: GarminSyncStatus;
  lastSynced: string | null;
  error: string | null;
}

// ── Data source settings ────────────────────────────────────────────────────

export type DataSource = "garmin" | "oura";

export interface DataSourceSettings {
  sleep_source: DataSource;
  body_vitals_source: DataSource;
  workouts_source: DataSource;
}

export const DEFAULT_DATA_SOURCE_SETTINGS: DataSourceSettings = {
  sleep_source: "oura",
  body_vitals_source: "oura",
  workouts_source: "garmin",
};
