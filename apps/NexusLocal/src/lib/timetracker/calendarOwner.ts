import { invoke } from "@tauri-apps/api/core";

/**
 * The `user_id` that PathFinder's calendar tables (`pf_cal_blocks`,
 * `pf_recurring_cal_blocks`) are keyed by — the *authed PathFinder account*,
 * not this node's `nodeUserId()`.
 *
 * # Why this is a different identity
 *
 * `nodeUserId()` is the productivity-stack key (`~/.nexuslocalrc` `user_id`,
 * historically `"default"`): meal_sessions, blocked_sites, blocking_state.
 * PathFinder rows are keyed by `auth.uid()` of the signed-in account. On this
 * machine those are different strings, so calendar reads/writes issued under
 * the node id can never meet PathFinder's rows — the coverage panel read an
 * empty "planned" band and meal/gap logging never landed a row (bug found
 * 2026-08-21; the RLS policies `widget_anon_read` / `coverage_anon_insert`
 * on both tables are pinned to this uid too, so a wrong id is *rejected*
 * rather than silently siloed).
 *
 * `tt_active_profile_get` reads `active_user_id` from `~/.nexuslocalrc` —
 * the same value the usage daemon exports under. The fallback covers plain
 * browser runs (no Tauri bridge) and configs predating the field; it is the
 * one real account behind every widget_anon_read policy.
 */
const FALLBACK = "a33625c2-4dd2-44fa-b2e5-4d455eeac59d";

/** Cached as the in-flight promise — same rationale as `nodeUserId()`. */
let cached: Promise<string> | null = null;

export function calendarOwnerUid(): Promise<string> {
  if (!cached) {
    cached = invoke<string>("tt_active_profile_get")
      .then((id) => (typeof id === "string" && id.trim() ? id.trim() : FALLBACK))
      .catch(() => FALLBACK);
  }
  return cached;
}
