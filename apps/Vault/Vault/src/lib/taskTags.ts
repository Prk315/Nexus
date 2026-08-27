// The pure half of Vault's task tags: normalization and matching, no client.
//
// ⚠️ **This file must never import `./supabase`, directly or transitively.**
//
// `lib/pathfinderBlock.ts` needs `normalizeTagList` and the `TagMode` domain to
// parse a block's stored spec, and that file is part of the note SCHEMA —
// `noteExtensions.ts` imports it, and `noteSchemaGuard.ts` builds the schema
// before any editor exists, in order to audit stored content before mounting
// one. Constructing a Supabase client on that path throws
// `supabaseUrl is required` in any context without Vite env vars, which takes
// the guard down and, with it, the check that stops an unknown node type
// blanking a note.
//
// It is the same rule `PathfinderBlockLazy` exists to enforce from the other
// direction, and it was broken the moment the tag helpers and the tag queries
// shared one module. They don't any more: everything here is a pure function,
// `vaultTaskTags.ts` holds the reads and writes and re-exports these, and the
// split is what makes both halves testable — `matchesTags` is a filter
// predicate, and a filter predicate that needs a database to test is one nobody
// tests.

/** Longer than this is a sentence, not a tag, and it stops fitting on a chip. */
export const TAG_MAX_CHARS = 48;

/**
 * The canonical form of a tag.
 *
 * Lowercased, deliberately. `vault_task_tags`' primary key is on the literal
 * text, so without this "Reading" and "reading" would be two different tags that
 * render identically on a chip — the filter would match one and miss the other,
 * silently. Case is not information here; it is a typo waiting to fork a
 * vocabulary.
 *
 * Returns null for anything that isn't a usable tag, so callers have one check
 * rather than three.
 */
export function normalizeTag(raw: string): string | null {
  const t = raw.trim().replace(/\s+/g, " ").toLowerCase().slice(0, TAG_MAX_CHARS);
  return t.length > 0 ? t : null;
}

/** Normalizes, drops blanks, dedupes, sorts — the shape every stored list takes. */
export function normalizeTagList(raw: readonly string[]): string[] {
  const out = new Set<string>();
  for (const r of raw) {
    const t = normalizeTag(r);
    if (t) out.add(t);
  }
  return [...out].sort();
}

export type TagMode = "any" | "all" | "none";

export const TAG_MODES: TagMode[] = ["any", "all", "none"];

export const TAG_MODE_LABELS: Record<TagMode, string> = {
  any: "Any of",
  all: "All of",
  none: "None of",
};

/**
 * The tag half of a block's query.
 *
 * `untaggedOnly` is a HARD gate rather than another clause AND-ed with the list:
 * "untagged, and also tagged `reading`" is a contradiction, and a filter that can
 * be configured into matching nothing at all is a filter people conclude is
 * broken. The control that sets it disables the tag list for the same reason.
 *
 * Passed straight into `runQuery`/`runTreeQuery` as their `extra` predicate, so
 * it runs BEFORE the limit — filtering after the cap would let a block render an
 * empty list while matching rows sat just past the window.
 */
export function matchesTags(
  taskTags: readonly string[],
  wanted: readonly string[],
  mode: TagMode,
  untaggedOnly: boolean,
): boolean {
  if (untaggedOnly) return taskTags.length === 0;
  if (wanted.length === 0) return true;

  const have = new Set(taskTags);
  switch (mode) {
    case "all":
      return wanted.every((w) => have.has(w));
    case "none":
      return wanted.every((w) => !have.has(w));
    default:
      return wanted.some((w) => have.has(w));
  }
}

/**
 * True when an error means "this relation/function isn't in the database yet"
 * rather than "the read failed".
 *
 * PostgREST reports the first as `PGRST205` (table missing from its schema
 * cache) or `PGRST202` (function missing); Postgres itself reports `42P01` /
 * `42883` when the request gets that far. The message check is the belt to that
 * braces — the codes have changed across PostgREST majors before, and getting
 * this wrong fails in the loud direction (tags reported unavailable when they
 * merely errored), never the silent one.
 */
export function isMissingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code && ["PGRST202", "PGRST205", "42P01", "42883"].includes(error.code)) return true;
  return /does not exist|schema cache/i.test(error.message ?? "");
}
