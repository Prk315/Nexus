// Training plans, sessions, performance and the run/workout logs.

import {
  err, num, supabase, getUserId,
} from "./_shared";
import type {
  RunLog, SessionPerformance, TrainingPlan, TrainingSession, WorkoutExercise, WorkoutLog,
} from "../../types";

// ═══════════════════════════════════════════════════════════════════════════
// TRAINING PLANS
// ═══════════════════════════════════════════════════════════════════════════

function mapTrainingPlan(r: any): TrainingPlan {
  return {
    id: num(r.id), user_id: r.user_id, title: r.title,
    description: r.description, color: r.color, goal: r.goal,
    days_per_week: r.days_per_week,
    plan_type: (r.plan_type ?? "other") as TrainingPlan["plan_type"],
    created_at: r.created_at,
  };
}

export function mapTrainingSession(r: any, planTitle?: string | null): TrainingSession {
  return {
    id: num(r.id), user_id: r.user_id,
    plan_id: r.plan_id ? num(r.plan_id) : null,
    plan_title: planTitle ?? r.pf_training_plans?.title ?? null,
    plan_type: r.pf_training_plans?.plan_type ?? null,
    title: r.title, scheduled_date: r.scheduled_date,
    start_time: r.start_time, end_time: r.end_time,
    location: r.location, notes: r.notes,
    completed: r.completed ?? false, created_at: r.created_at,
    is_recurring: r.is_recurring ?? false,
    recurrence: r.recurrence ?? null,
    days_of_week: r.days_of_week ?? null,
    series_start_date: r.series_start_date ?? null,
    series_end_date: r.series_end_date ?? null,
    recurring_id: r.recurring_id ?? null,
  };
}

const SESSION_EPOCH = new Date("2020-01-01T00:00:00Z").getTime();

export function expandTrainingSessions(r: any, startDate: string, endDate: string): TrainingSession[] {
  const result: TrainingSession[] = [];
  const rangeStart  = new Date(startDate + "T00:00:00Z");
  const rangeEnd    = new Date(endDate   + "T00:00:00Z");
  const seriesStart = new Date((r.series_start_date || startDate) + "T00:00:00Z");
  const seriesEnd   = r.series_end_date ? new Date(r.series_end_date + "T00:00:00Z") : null;
  const daysOfWeek: number[] = r.days_of_week ? r.days_of_week.split(",").map(Number) : [];

  const cursor = new Date(Math.max(rangeStart.getTime(), seriesStart.getTime()));
  while (cursor <= rangeEnd && (!seriesEnd || cursor <= seriesEnd)) {
    const dow = cursor.getUTCDay();
    const matches =
      r.recurrence === "daily" ||
      (r.recurrence === "weekly" && daysOfWeek.includes(dow));
    if (matches) {
      const dateStr   = cursor.toISOString().split("T")[0];
      const dayOffset = Math.floor((cursor.getTime() - SESSION_EPOCH) / 86_400_000);
      result.push({
        id: -(num(r.id) * 100_000 + dayOffset),
        user_id: r.user_id,
        plan_id: r.plan_id ? num(r.plan_id) : null,
        plan_title: r.pf_training_plans?.title ?? null,
        plan_type: r.pf_training_plans?.plan_type ?? null,
        title: r.title,
        scheduled_date: dateStr,
        start_time: r.start_time,
        end_time: r.end_time,
        location: r.location,
        notes: r.notes,
        completed: r.completed ?? false,
        created_at: r.created_at,
        is_recurring: true,
        recurrence: r.recurrence,
        days_of_week: r.days_of_week,
        series_start_date: r.series_start_date,
        series_end_date: r.series_end_date,
        recurring_id: num(r.id),
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function mapSessionPerformance(r: any): SessionPerformance {
  return {
    id: num(r.id), user_id: r.user_id, session_id: num(r.session_id),
    metric_name: r.metric_name, value: r.value, unit: r.unit, created_at: r.created_at,
  };
}

export const getTrainingPlans = async (): Promise<TrainingPlan[]> => {
  const { data, error } = await supabase
    .from("pf_training_plans").select("*").eq("user_id", getUserId()).order("created_at");
  if (error) err(error);
  return (data ?? []).map(mapTrainingPlan);
};

export const createTrainingPlan = async (payload: {
  title: string; description?: string | null; color?: string; goal?: string | null; days_per_week?: number | null; plan_type?: string;
}): Promise<TrainingPlan> => {
  const { data, error } = await supabase
    .from("pf_training_plans").insert({ user_id: getUserId(), ...payload }).select().single();
  if (error) err(error);
  return mapTrainingPlan(data!);
};

export const updateTrainingPlan = async (id: number, payload: {
  title: string; description?: string | null; color?: string; goal?: string | null; days_per_week?: number | null; plan_type?: string;
}): Promise<TrainingPlan> => {
  const { data, error } = await supabase
    .from("pf_training_plans").update(payload).eq("id", id).select().single();
  if (error) err(error);
  return mapTrainingPlan(data!);
};

export const deleteTrainingPlan = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_training_plans").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// TRAINING SESSIONS
// ═══════════════════════════════════════════════════════════════════════════

export const getTrainingSessions = async (planId?: number): Promise<TrainingSession[]> => {
  let q = supabase
    .from("pf_training_sessions")
    .select("*, pf_training_plans(title, plan_type)")
    .eq("user_id", getUserId())
    .eq("is_recurring", false)
    .order("scheduled_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (planId !== undefined) q = q.eq("plan_id", planId);
  const { data, error } = await q;
  if (error) err(error);
  return (data ?? []).map((r) => mapTrainingSession(r));
};

export const getRecurringTrainingSessions = async (planId?: number): Promise<TrainingSession[]> => {
  let q = supabase
    .from("pf_training_sessions")
    .select("*, pf_training_plans(title, plan_type)")
    .eq("user_id", getUserId())
    .eq("is_recurring", true)
    .order("series_start_date", { ascending: true });
  if (planId !== undefined) q = q.eq("plan_id", planId);
  const { data, error } = await q;
  if (error) err(error);
  return (data ?? []).map((r) => mapTrainingSession(r));
};

export const getTrainingSessionsForDate = async (date: string): Promise<TrainingSession[]> => {
  const [{ data: oneOff }, { data: recurring }] = await Promise.all([
    supabase
      .from("pf_training_sessions")
      .select("*, pf_training_plans(title, plan_type)")
      .eq("user_id", getUserId())
      .eq("is_recurring", false)
      .eq("scheduled_date", date)
      .order("start_time", { ascending: true, nullsFirst: true }),
    supabase
      .from("pf_training_sessions")
      .select("*, pf_training_plans(title, plan_type)")
      .eq("user_id", getUserId())
      .eq("is_recurring", true)
      .lte("series_start_date", date)
      .or(`series_end_date.is.null,series_end_date.gte.${date}`),
  ]);
  const expanded = (recurring ?? []).flatMap((r) => expandTrainingSessions(r, date, date));
  return [
    ...(oneOff ?? []).map((r) => mapTrainingSession(r)),
    ...expanded,
  ].sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));
};

export const createTrainingSession = async (payload: {
  plan_id?: number | null;
  title: string;
  scheduled_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  notes?: string | null;
  is_recurring?: boolean;
  recurrence?: string | null;
  days_of_week?: string | null;
  series_start_date?: string | null;
  series_end_date?: string | null;
}): Promise<TrainingSession> => {
  const { data, error } = await supabase
    .from("pf_training_sessions").insert({ user_id: getUserId(), ...payload }).select("*, pf_training_plans(title, plan_type)").single();
  if (error) err(error);
  return mapTrainingSession(data!);
};

export const updateTrainingSession = async (id: number, payload: {
  plan_id?: number | null;
  title?: string;
  scheduled_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  notes?: string | null;
  is_recurring?: boolean;
  recurrence?: string | null;
  days_of_week?: string | null;
  series_start_date?: string | null;
  series_end_date?: string | null;
}): Promise<TrainingSession> => {
  const { data, error } = await supabase
    .from("pf_training_sessions").update(payload).eq("id", id).select("*, pf_training_plans(title, plan_type)").single();
  if (error) err(error);
  return mapTrainingSession(data!);
};

export const toggleTrainingSession = async (id: number): Promise<TrainingSession> => {
  // Virtual recurring instances have negative synthetic IDs; resolve to the real row ID.
  const realId = id < 0 ? Math.floor(-id / 100_000) : id;
  const { data: cur } = await supabase.from("pf_training_sessions").select("completed").eq("id", realId).single();
  const { data, error } = await supabase
    .from("pf_training_sessions").update({ completed: !cur!.completed }).eq("id", realId).select("*, pf_training_plans(title, plan_type)").single();
  if (error) err(error);
  return mapTrainingSession(data!);
};

export const deleteTrainingSession = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_training_sessions").delete().eq("id", id);
  if (error) err(error);
};

export const deleteTrainingSessionSeries = async (recurringId: number): Promise<void> => {
  const { error } = await supabase.from("pf_training_sessions").delete().eq("id", recurringId);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// SESSION PERFORMANCE
// ═══════════════════════════════════════════════════════════════════════════

export const getSessionPerformance = async (sessionId: number): Promise<SessionPerformance[]> => {
  const { data, error } = await supabase
    .from("pf_session_performance").select("*").eq("session_id", sessionId).order("created_at");
  if (error) err(error);
  return (data ?? []).map(mapSessionPerformance);
};

export const addSessionPerformance = async (payload: {
  session_id: number; metric_name: string; value: string; unit?: string | null;
}): Promise<SessionPerformance> => {
  const { data, error } = await supabase
    .from("pf_session_performance").insert({ user_id: getUserId(), ...payload }).select().single();
  if (error) err(error);
  return mapSessionPerformance(data!);
};

export const deleteSessionPerformance = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_session_performance").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// RUN LOGS
// ═══════════════════════════════════════════════════════════════════════════

export const getRunLogs = async (): Promise<RunLog[]> => {
  const { data, error } = await supabase
    .from("pf_run_logs").select("*").eq("user_id", getUserId()).order("date", { ascending: false });
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), date: r.date, distance_km: r.distance_km, duration_min: r.duration_min, notes: r.notes, created_at: r.created_at }));
};

export const createRunLog = async (payload: { date: string; distance_km?: number | null; duration_min?: number | null; notes?: string | null }): Promise<RunLog> => {
  const { data, error } = await supabase
    .from("pf_run_logs").insert({ user_id: getUserId(), ...payload }).select().single();
  if (error) err(error);
  return { id: num(data!.id), date: data!.date, distance_km: data!.distance_km, duration_min: data!.duration_min, notes: data!.notes, created_at: data!.created_at };
};

export const deleteRunLog = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_run_logs").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// WORKOUT LOGS
// ═══════════════════════════════════════════════════════════════════════════

export const getWorkoutLogs = async (): Promise<WorkoutLog[]> => {
  const { data, error } = await supabase
    .from("pf_workout_logs")
    .select("*, pf_workout_exercises(*)")
    .eq("user_id", getUserId()).order("date", { ascending: false });
  if (error) err(error);
  return (data ?? []).map((w) => ({
    id: num(w.id), date: w.date, name: w.name, notes: w.notes, created_at: w.created_at,
    exercises: (w.pf_workout_exercises ?? [])
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((e: any): WorkoutExercise => ({ id: num(e.id), workout_id: num(e.workout_id), name: e.name, sets: e.sets, reps: e.reps, weight_kg: e.weight_kg, notes: e.notes, sort_order: e.sort_order })),
  }));
};

export const createWorkoutLog = async (payload: { date: string; name: string; notes?: string | null }): Promise<WorkoutLog> => {
  const { data, error } = await supabase
    .from("pf_workout_logs").insert({ user_id: getUserId(), ...payload }).select().single();
  if (error) err(error);
  return { id: num(data!.id), date: data!.date, name: data!.name, notes: data!.notes, created_at: data!.created_at, exercises: [] };
};

export const deleteWorkoutLog = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_workout_logs").delete().eq("id", id);
  if (error) err(error);
};

async function fetchWorkoutLog(id: number): Promise<WorkoutLog> {
  const { data, error } = await supabase
    .from("pf_workout_logs").select("*, pf_workout_exercises(*)").eq("id", id).single();
  if (error) err(error);
  return { id: num(data!.id), date: data!.date, name: data!.name, notes: data!.notes, created_at: data!.created_at, exercises: (data!.pf_workout_exercises ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order).map((e: any): WorkoutExercise => ({ id: num(e.id), workout_id: num(e.workout_id), name: e.name, sets: e.sets, reps: e.reps, weight_kg: e.weight_kg, notes: e.notes, sort_order: e.sort_order })) };
}

export const addWorkoutExercise = async (payload: { workout_id: number; name: string; sets?: number | null; reps?: number | null; weight_kg?: number | null; notes?: string | null }): Promise<WorkoutLog> => {
  const { error } = await supabase.from("pf_workout_exercises").insert(payload);
  if (error) err(error);
  return fetchWorkoutLog(payload.workout_id);
};

export const deleteWorkoutExercise = async (id: number, workoutId: number): Promise<WorkoutLog> => {
  const { error } = await supabase.from("pf_workout_exercises").delete().eq("id", id);
  if (error) err(error);
  return fetchWorkoutLog(workoutId);
};
