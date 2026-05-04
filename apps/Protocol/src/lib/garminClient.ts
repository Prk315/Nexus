import { invoke } from "@tauri-apps/api/core";

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

export interface GarminStatus {
  connected: boolean;
}

async function run<T>(command: string, args: string[]): Promise<T> {
  const raw = await invoke<string>("garminRun", { command, args });
  return JSON.parse(raw) as T;
}

export async function garminCheckStatus(): Promise<GarminStatus> {
  return run<GarminStatus>("status", []);
}

export async function garminFetchSleep(date: string, days: number): Promise<GarminSleepRaw[]> {
  return run<GarminSleepRaw[]>("sleep", ["--date", date, "--days", String(days)]);
}

export async function garminFetchBodyStats(date: string, days: number): Promise<GarminBodyRaw[]> {
  return run<GarminBodyRaw[]>("body_stats", ["--date", date, "--days", String(days)]);
}

export async function garminFetchActivities(date: string, days: number): Promise<GarminActivityRaw[]> {
  return run<GarminActivityRaw[]>("activities", ["--date", date, "--days", String(days)]);
}

export async function garminBridgePath(): Promise<string> {
  return invoke<string>("garminBridgePath");
}

export interface GarminAuthResult {
  ok?: boolean;
  mfa_required?: boolean;
}

export async function garminAuth(
  email: string,
  password: string,
  otp?: string,
): Promise<GarminAuthResult> {
  const raw = await invoke<string>("garminAuth", {
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
