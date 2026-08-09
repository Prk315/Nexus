import { getSupabaseClient, getUserId } from "./supabase";
import type { Activity, TrackingConfig } from "./trackingConfig";

/** Read the stored progress-tracking config for one activity, or null if the user
 *  has never saved one. Throws if not authenticated (caller falls back to cache). */
export async function fetchProgressConfig(activity: Activity): Promise<TrackingConfig | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_progress_config")
    .select("biomarkers, exercises, run_metrics")
    .eq("user_id", getUserId())
    .eq("activity", activity)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    biomarkers: data.biomarkers ?? [],
    exercises: data.exercises ?? [],
    runMetrics: data.run_metrics ?? [],
  };
}

/** Upsert the config for one activity (keyed on user_id + activity). */
export async function upsertProgressConfig(activity: Activity, cfg: TrackingConfig): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from("protocol_progress_config")
    .upsert(
      {
        user_id: getUserId(),
        activity,
        biomarkers: cfg.biomarkers,
        exercises: cfg.exercises,
        run_metrics: cfg.runMetrics,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,activity" },
    );
  if (error) throw error;
}
