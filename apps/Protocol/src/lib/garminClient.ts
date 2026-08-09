import { invoke } from "@tauri-apps/api/core";
import { isDesktop, isNodeOnline, runViaGrid } from "./gridClient";

export interface GarminSleepRaw {
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
  notes: string;
}

export interface GarminBodyRaw {
  date: string;
  weight_kg: number | null;
  hrv_ms: number | null;
  resting_hr_bpm: number | null;
  spo2_pct: number | null;
  readiness_score: number | null;
  temperature_deviation: number | null;
  recovery_index: number | null;
  notes: string;
}

export interface GarminActivityRaw {
  type: "run" | "workout";
  /** Garmin's own activity id. Absent on bridges older than 2026-08-09. */
  activity_id?: number | string | null;
  start_time?: string | null;
  date: string;
  name: string;
  actual_km?: number;
  avg_pace_s_per_km?: number;
  heart_rate_avg?: number;
  heart_rate_max?: number;
  elevation_gain_m?: number;
  cadence_avg?: number;
  calories?: number;
  duration_min?: number;
  calories_burned?: number;
  avg_heart_rate?: number;
}

export interface GarminExerciseSetRaw {
  date: string;
  activity_name: string;
  category: string;
  exercise_name: string | null;
  reps: number | null;
  weight_kg: number | null;
}

export interface GarminStatus {
  connected: boolean;
}

// Desktop: call the bundled Tauri command directly. Web: route through the
// Nexus Local grid (enqueue → a node runs the bridge → poll the result).
async function run<T>(command: string, args: string[]): Promise<T> {
  const raw = await invoke<string>("garmin_run", { command, args });
  return JSON.parse(raw) as T;
}

async function callGarmin<T>(
  action: string,
  payload: Record<string, unknown>,
  desktopArgs: string[],
): Promise<T> {
  if (isDesktop()) return run<T>(action, desktopArgs);
  return runViaGrid<T>("garmin", action, payload);
}

export async function garminCheckStatus(): Promise<GarminStatus> {
  if (isDesktop()) return run<GarminStatus>("status", []);
  // On web, "connected" requires a live node with the garmin module. Short-
  // circuit when none is online so the panel doesn't hang on a queued command.
  if (!(await isNodeOnline("garmin"))) return { connected: false };
  return runViaGrid<GarminStatus>("garmin", "status");
}

export async function garminFetchSleep(date: string, days: number): Promise<GarminSleepRaw[]> {
  return callGarmin<GarminSleepRaw[]>("sleep", { date, days }, ["--date", date, "--days", String(days)]);
}

export async function garminFetchBodyStats(date: string, days: number): Promise<GarminBodyRaw[]> {
  return callGarmin<GarminBodyRaw[]>("body_stats", { date, days }, ["--date", date, "--days", String(days)]);
}

export async function garminFetchActivities(date: string, days: number): Promise<GarminActivityRaw[]> {
  return callGarmin<GarminActivityRaw[]>("activities", { date, days }, ["--date", date, "--days", String(days)]);
}

export async function garminFetchExerciseSets(date: string, days: number): Promise<GarminExerciseSetRaw[]> {
  return run<GarminExerciseSetRaw[]>("exercise_sets", ["--date", date, "--days", String(days)]);
}

export async function garminBridgePath(): Promise<string> {
  return invoke<string>("garmin_bridge_path");
}

export interface GarminAuthResult {
  ok?: boolean;
  mfa_required?: boolean;
  error?: string;
}

export async function garminAuth(
  email: string,
  password: string,
  otp?: string,
): Promise<GarminAuthResult> {
  const raw = await invoke<string>("garmin_auth", {
    email,
    password,
    otp: otp ?? null,
  });
  return JSON.parse(raw) as GarminAuthResult;
}

export async function garminLogout(): Promise<void> {
  await run<{ ok: boolean }>("logout", []);
}

export interface GarminCheckResult {
  garminconnect_installed: boolean;
}

export async function garminCheckDeps(): Promise<GarminCheckResult> {
  return run<GarminCheckResult>("check", []);
}
