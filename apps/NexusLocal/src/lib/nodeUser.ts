import { invoke } from "@tauri-apps/api/core";

/**
 * The `user_id` this node's rows are keyed by.
 *
 * # Why this exists
 *
 * Every panel used to hardcode `"default"` while the Rust side read `user_id`
 * from `~/.nexuslocalrc`. On a machine configured for a second account the
 * daemon would scope correctly and the UI would silently read and write the
 * *other* person's rows — a failure that looks exactly like success, which is
 * the worst kind.
 *
 * # Why the fallback is `"default"` and not an error
 *
 * `invoke` fails in a plain browser (no Tauri bridge) and on any build predating
 * the command. Falling back to `"default"` keeps a single-account setup — every
 * existing install — behaving exactly as before. Throwing would blank every
 * panel to fix a problem those users do not have.
 *
 * That fallback is only safe *because* the tables are permissive today. Once RLS
 * is scoped to `auth.uid()` (see the security task), a wrong user id returns an
 * empty set rather than an error, so this must become a hard failure at the same
 * time — otherwise the app quietly shows an empty day instead of saying it can't
 * tell whose data it is.
 */
const FALLBACK = "default";

/**
 * Cached as the in-flight *promise*, not the resolved value: several panels
 * mount at once and each calls this immediately, so caching after resolution
 * would still fire a handful of duplicate IPC calls on every launch.
 */
let cached: Promise<string> | null = null;

export function nodeUserId(): Promise<string> {
  if (!cached) {
    cached = invoke<string>("tt_node_user_id")
      .then((id) => (typeof id === "string" && id.trim() ? id.trim() : FALLBACK))
      .catch(() => FALLBACK);
  }
  return cached;
}

/** Drop the cache so the next read picks up an edited config. Used by tests. */
export function resetNodeUserId(): void {
  cached = null;
}
