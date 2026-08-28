// Vault-only custom field VALUES on PathFinder tasks.
//
// The sibling of vaultTaskTags.ts, and it makes the same choices for the same
// reasons — read that file first; this one records what differs.
//
// ── The value is text; the type lives in the block spec ─────────────────────
// `vault_task_fields.value` is a text column for every type. The type is a
// property of the COLUMN (in the note), not of the value, so two notes may show
// the same key as a number and as free text without either being wrong. It also
// makes the type a LENS rather than a constraint: changing a column from number
// to text and back never destroys what was typed. See the migration header.
//
// Coercion therefore happens here, on the way out — which is also where the
// rule that matters belongs: an EMPTY value is null, never zero. A task nobody
// has given a budget has no budget, and a column summing it must not count it
// as 0.

import { supabase, getUserId } from "./supabase";
import { isMissingSchema } from "./taskTags";
import { normalizeFieldKey, FIELD_VALUE_MAX } from "./taskFields";

// The pure half lives in taskFields.ts because lib/pathfinderBlock.ts — which
// is on the schema path — needs it and must not reach a Supabase client.
export {
  coerceField, normalizeFieldKey, FIELD_TYPES, FIELD_KEY_MAX, FIELD_VALUE_MAX,
  type FieldType,
} from "./taskFields";

export const TASK_FIELDS_TABLE = "vault_task_fields";

export interface TaskFieldIndex {
  /** taskId → key → raw stored text. */
  byTask: Map<number, Record<string, string>>;
  /** False when the table does not exist yet — a state of its own, not an
   *  error and not an empty result. The block then hides its custom columns
   *  rather than showing every task as blank. */
  available: boolean;
}

export const EMPTY_FIELDS: TaskFieldIndex = { byTask: new Map(), available: false };

function fail(e: any): never {
  throw new Error(e?.message ?? String(e));
}

export async function loadTaskFields(): Promise<TaskFieldIndex> {
  const uid = getUserId();
  const { data, error } = await supabase
    .from(TASK_FIELDS_TABLE)
    .select("task_id, key, value")
    .eq("user_id", uid);

  if (error) {
    if (isMissingSchema(error)) return { byTask: new Map(), available: false };
    fail(error);
  }

  const byTask = new Map<number, Record<string, string>>();
  for (const row of data ?? []) {
    const id = Number(row.task_id);
    const bag = byTask.get(id) ?? {};
    bag[String(row.key)] = String(row.value ?? "");
    byTask.set(id, bag);
  }
  return { byTask, available: true };
}

/**
 * Write one cell.
 *
 * An empty value DELETES the row rather than storing "". Storing it would leave
 * a table full of blanks that read identically to "no value" but cost a row
 * each, and would make "has anyone filled this column in" unanswerable.
 */
export async function setTaskField(taskId: number, key: string, value: string): Promise<void> {
  const k = normalizeFieldKey(key);
  if (!k) return;
  const v = value.slice(0, FIELD_VALUE_MAX);

  if (!v.trim()) {
    const { error } = await supabase
      .from(TASK_FIELDS_TABLE)
      .delete()
      .eq("user_id", getUserId())
      .eq("task_id", taskId)
      .eq("key", k);
    if (error && !isMissingSchema(error)) fail(error);
    return;
  }

  const { error } = await supabase
    .from(TASK_FIELDS_TABLE)
    .upsert(
      { user_id: getUserId(), task_id: taskId, key: k, value: v, updated_at: new Date().toISOString() },
      { onConflict: "user_id,task_id,key" },
    );
  if (error) fail(error);
}

/** Renaming a column carries its values. One statement, atomic — see the
 *  migration for why this is not N client round trips. */
export async function renameTaskField(from: string, to: string): Promise<number> {
  const { data, error } = await supabase.rpc("vault_rename_task_field", {
    p_old: normalizeFieldKey(from),
    p_new: normalizeFieldKey(to),
  });
  if (error) fail(error);
  return Number(data ?? 0);
}

/** Removing a column from a block does NOT call this. Deleting the values is a
 *  separate, explicit act — a column removed from one note is very often still
 *  shown in another. */
export async function deleteTaskFieldEverywhere(key: string): Promise<number> {
  const { data, error } = await supabase.rpc("vault_delete_task_field", {
    p_key: normalizeFieldKey(key),
  });
  if (error) fail(error);
  return Number(data ?? 0);
}
