/**
 * Per-activity tracking config — which biomarkers to chart, which specific
 * exercises' weight to track (strength), and which run metrics like speed to track
 * (running). Source of truth is the `protocol_progress_config` Supabase table
 * (syncs across devices); localStorage is a cache for instant first render and an
 * offline / signed-out fallback.
 */

import { fetchProgressConfig, upsertProgressConfig } from "./progressConfigApi";

export type Activity = "running" | "strength";

export interface TrackingConfig {
  /** Biomarker keys (see BIOMARKER_OPTIONS) shown in the biomarker chart. */
  biomarkers: string[];
  /** Strength only — exercise names whose weight / est-1RM is tracked as a line. */
  exercises: string[];
  /** Running only — metric keys (see RUN_METRIC_OPTIONS) tracked as lines. */
  runMetrics: string[];
}

export const RUN_METRIC_OPTIONS: { key: string; name: string; color: string; unit: string; higherBetter: boolean }[] = [
  { key: "speed", name: "Speed", color: "#38bdf8", unit: "km/h", higherBetter: true },
  { key: "distance", name: "Distance", color: "#22c55e", unit: "km", higherBetter: true },
  { key: "hr", name: "Avg HR", color: "#ef4444", unit: "bpm", higherBetter: false },
  { key: "cadence", name: "Cadence", color: "#f59e0b", unit: "spm", higherBetter: true },
];

const DEFAULTS: Record<Activity, TrackingConfig> = {
  running: { biomarkers: ["readiness", "hrv", "rhr", "recovery"], exercises: [], runMetrics: ["speed", "distance"] },
  strength: { biomarkers: ["readiness", "hrv", "rhr", "recovery"], exercises: [], runMetrics: [] },
};

const storeKey = (a: Activity) => `protocol_progress_cfg_${a}`;

/** Synchronous read from the localStorage cache (or defaults) — used to seed React
 *  state so the card renders instantly before the Supabase round-trip resolves. */
export function getCachedConfig(a: Activity): TrackingConfig {
  try {
    const raw = localStorage.getItem(storeKey(a));
    if (raw) return { ...DEFAULTS[a], ...JSON.parse(raw) };
  } catch {
    /* localStorage unavailable — fall through to defaults */
  }
  return { ...DEFAULTS[a] };
}

function writeCache(a: Activity, cfg: TrackingConfig): void {
  try { localStorage.setItem(storeKey(a), JSON.stringify(cfg)); } catch { /* ignore */ }
}

/** Load the config from Supabase (source of truth), caching it locally. Falls back
 *  to the cache/defaults when signed out, offline, or no row exists yet. */
export async function loadTrackingConfig(a: Activity): Promise<TrackingConfig> {
  try {
    const remote = await fetchProgressConfig(a);
    if (remote) { writeCache(a, remote); return remote; }
  } catch {
    /* not authenticated / offline — use the cache */
  }
  return getCachedConfig(a);
}

/** Persist the config: write the cache immediately, then upsert to Supabase. */
export async function saveTrackingConfig(a: Activity, cfg: TrackingConfig): Promise<void> {
  writeCache(a, cfg);
  try { await upsertProgressConfig(a, cfg); } catch { /* best effort — cache still holds it */ }
}
