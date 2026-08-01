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
  name: string;
  scheduled_date: string;
  duration_min?: number | null;
  calories_burned?: number | null;
  avg_heart_rate?: number | null;
  notes?: string | null;
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

/** Nutrient values are always per 100g/100ml — servings apply a multiplier. */
export interface Food {
  id: string;
  source: FoodSource;
  external_id: string | null;
  name: string;
  brand: string | null;
  serving_qty: number;
  serving_unit: string;
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
  created_at: string;
}

export type CreateFood = Omit<Food, "id" | "created_at">;

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
