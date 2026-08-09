/**
 * Per-activity tracking config — which biomarkers to chart, which specific
 * exercises' weight to track (strength), and which run metrics like speed to track
 * (running). Stored in localStorage for now; a Supabase table can back this later
 * for cross-device sync (same shape).
 */

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

export function getTrackingConfig(a: Activity): TrackingConfig {
  try {
    const raw = localStorage.getItem(storeKey(a));
    if (raw) return { ...DEFAULTS[a], ...JSON.parse(raw) };
  } catch {
    /* localStorage unavailable — fall through to defaults */
  }
  return { ...DEFAULTS[a] };
}

export function saveTrackingConfig(a: Activity, cfg: TrackingConfig): void {
  try {
    localStorage.setItem(storeKey(a), JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}
