// Comparing two serialised timestamps for equality.
//
// Its own module, importing nothing, so it can be tested without instantiating
// a Supabase client the way importing lib/api.ts would.
//
// ─── The bug this exists to prevent ──────────────────────────────────────────
// Vault's save-conflict guard compares "when did I last see this row change"
// against "when did it last change", and it did so with `!==` on the raw
// strings. `vault_content.updated_at` is a `timestamptz`, and the two sides came
// from different serialisers:
//
//     cached by the client after saving   2026-08-27T16:47:41.628Z
//     returned by PostgREST when reading  2026-08-27T16:47:41.628+00:00
//
// The same instant, spelled two ways. So every note reported "changed by the
// other user — reload before saving over it" on its second save and every save
// after, with nobody else involved. The first save of a session passed only
// because the cache had been seeded from a READ, making both sides PostgREST's
// spelling; the first WRITE reseeded it with `new Date().toISOString()` and the
// formats diverged permanently.
//
// The lesson generalises past this one field: a timestamp that crosses a
// serialisation boundary is a VALUE, not a string, and `===` on it is a bug
// waiting for the two ends to disagree about spelling.

/**
 * Whether two serialised timestamps describe the same instant.
 *
 * Returns false when either side is missing or unparseable — callers use this
 * to decide whether a row changed underneath them, and "I could not tell"
 * must fall through to the careful path rather than silently assert equality
 * and disable the guard.
 */
export function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

/**
 * "4 min ago", "yesterday", "12 Aug".
 *
 * `now` is a parameter rather than a `Date.now()` call so the function is
 * testable without freezing the clock.
 *
 * Lives here rather than in versionDiff.ts, where it started: the save-status
 * line in the editor toolbar needs it too, and pulling it from a module about
 * diffing documents would have been a misleading import in a file that does no
 * diffing.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "unknown";
  const secs = Math.round((now - t) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
