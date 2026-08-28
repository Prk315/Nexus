// The pure half of Vault's custom task fields: key normalisation and coercion,
// no client.
//
// ⚠️ This split is not tidiness. `lib/pathfinderBlock.ts` is on the SCHEMA
// path — `extensions/PathfinderBlock.ts` imports it, and the schema guard
// builds the note schema by calling `buildNoteExtensions()`. If anything
// reachable from there imported `lib/supabase`, building the schema would
// transitively call `createClient()` at module scope and throw
// "supabaseUrl is required" when the env vars are absent.
//
// Deciding whether a note is safe to open would then depend on a configured
// network client, which is backwards: the guard exists to run when things are
// broken. `taskTags.ts` is the same split for the same reason, and
// `schemaPath.test.ts` asserts it rather than trusting it.

export type FieldType = "text" | "number" | "check";

export const FIELD_TYPES: FieldType[] = ["text", "number", "check"];
export const FIELD_KEY_MAX = 32;
export const FIELD_VALUE_MAX = 200;

/** Keys are normalised the way tags are: a key differing only by case or
 *  spacing would be a second column that looks like the first. */
export function normalizeFieldKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "_").slice(0, FIELD_KEY_MAX);
}

/**
 * A stored string as the column's type sees it.
 *
 * ⚠️ Empty is null for every type — never 0, never false. A task nobody has
 * given a budget has no budget; counting it as zero drags a sum's average down
 * and makes a checkbox column claim everyone said "no".
 */
export function coerceField(
  raw: string | undefined,
  type: FieldType,
): number | boolean | string | null {
  if (raw === undefined || raw.trim() === "") return null;
  if (type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "check") {
    // Only an explicit truthy marker counts. Anything else — including the
    // string "false" — is false rather than null, because the row exists.
    return raw === "1" || raw === "true" || raw === "yes";
  }
  return raw;
}
