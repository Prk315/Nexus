export type Theme = "light" | "dark" | "system";

export interface SleepEntry {
  id: string;
  date: string;
  duration_min: number;
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
