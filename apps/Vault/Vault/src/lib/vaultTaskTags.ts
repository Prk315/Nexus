// Vault's own tags on PathFinder tasks.
//
// These live only here. PathFinder never sees them, its widgets never render
// them, and a teammate looking at the same shared task sees their own set, not
// yours — all of which falls out of the table being keyed
// `(user_id, task_id, tag)` rather than being a column on `pf_tasks`. See
// supabase/migrations/20260827140000_vault_task_tags.sql.
//
// ⚠️ **A missing table must not take the task blocks down with it.**
// The migration is applied by hand and separately from any deploy (see
// supabase/migrations/APPLY.md), so a Vault build WILL run against a database
// that has no `vault_task_tags` — that window is normal, not an error. PostgREST
// answers an unknown relation with a hard error, so a naive read of this table
// inside the snapshot's `Promise.all` would reject the whole thing and every
// task block in the note would read "Couldn't load tasks". That is precisely how
// dropping `pf_reminders` took PathFinder's entire dashboard down (CLAUDE.md,
// "One database, every branch"), with the roles reversed.
//
// So `loadTaskTags` distinguishes *no tags* from *no tag table* and reports the
// second as a state of its own. Tags then degrade to "unavailable, here is what
// to do about it" while everything else keeps working.

// The pure helpers this module needs — and every one it re-exports — live in
// ./taskTags.ts, which imports nothing. That split is load-bearing: this file
// touches `./supabase`, and anything importing it constructs a Supabase client
// at module load. `lib/pathfinderBlock.ts` is part of the note SCHEMA, so it
// must reach `normalizeTagList` and `TagMode` without ever landing here. See the
// header of ./taskTags.ts.

import { supabase, getUserId } from "./supabase";
import { isMissingSchema, normalizeTag, normalizeTagList } from "./taskTags";

export {
  isMissingSchema,
  matchesTags,
  normalizeTag,
  normalizeTagList,
  TAG_MAX_CHARS,
  TAG_MODES,
  TAG_MODE_LABELS,
  type TagMode,
} from "./taskTags";

export const TASK_TAGS_TABLE = "vault_task_tags";

export interface TaskTagIndex {
  /** taskId → its tags, sorted. Absent means "no tags", never "unknown". */
  byTask: Map<number, string[]>;
  /** Every tag in use, sorted — the filter's vocabulary. */
  all: string[];
  /**
   * False when the table does not exist yet. Distinct from `all: []`, which
   * means the table is there and empty.
   */
  available: boolean;
}

export const EMPTY_TAG_INDEX: TaskTagIndex = { byTask: new Map(), all: [], available: true };

function fail(e: any): never {
  throw new Error(e?.message ?? String(e));
}

/**
 * Every tag the signed-in user has applied, in one read.
 *
 * One query for the whole vocabulary rather than one per task: this is a
 * personal annotation layer over a few hundred tasks, so the table is small and
 * a join per block would be all cost and no benefit. The result is folded into
 * the shared PathFinder snapshot, so four blocks in a note share this read the
 * same way they share the task read.
 */
export async function loadTaskTags(): Promise<TaskTagIndex> {
  const uid = getUserId();
  const { data, error } = await supabase
    .from(TASK_TAGS_TABLE)
    .select("task_id, tag")
    .eq("user_id", uid);

  if (error) {
    if (isMissingSchema(error)) return { byTask: new Map(), all: [], available: false };
    fail(error);
  }

  const byTask = new Map<number, string[]>();
  const all = new Set<string>();
  for (const row of data ?? []) {
    const id = Number(row.task_id);
    const tag = String(row.tag);
    all.add(tag);
    const list = byTask.get(id);
    if (list) list.push(tag);
    else byTask.set(id, [tag]);
  }
  for (const list of byTask.values()) list.sort();

  return { byTask, all: [...all].sort(), available: true };
}

/**
 * Tag colours, shared with Vault's note tags.
 *
 * The same `vault_tag_colors` table, deliberately: "reading" should be one
 * colour on a note in the graph and on a task chip in a block, because to the
 * person using it, it is one tag. Keying task colours separately would let the
 * same word render two ways on the same screen.
 *
 * Read here rather than through `useGraph` because a block is a ProseMirror node
 * view — there is no React context path from App.tsx down into it, and threading
 * one through the editor for a colour lookup would be a lot of plumbing for a
 * table with a handful of rows.
 */
export async function loadTagColors(): Promise<Record<string, string>> {
  const uid = getUserId();
  const { data, error } = await supabase
    .from("vault_tag_colors")
    .select("tag, color")
    .eq("user_id", uid);
  if (error) {
    if (isMissingSchema(error)) return {};
    fail(error);
  }
  const out: Record<string, string> = {};
  for (const row of data ?? []) out[String(row.tag).toLowerCase()] = String(row.color);
  return out;
}

export async function addTaskTag(taskId: number, raw: string): Promise<string> {
  const tag = normalizeTag(raw);
  if (!tag) throw new Error("A tag needs at least one character.");
  const uid = getUserId();
  // `upsert`, not `insert`: re-adding a tag a task already has is a no-op the
  // user meant, not a primary-key violation they have to read about.
  const { error } = await supabase
    .from(TASK_TAGS_TABLE)
    .upsert({ user_id: uid, task_id: taskId, tag }, { onConflict: "user_id,task_id,tag" });
  if (error) fail(error);
  return tag;
}

export async function removeTaskTag(taskId: number, tag: string): Promise<void> {
  const uid = getUserId();
  const { error } = await supabase
    .from(TASK_TAGS_TABLE)
    .delete()
    .eq("user_id", uid)
    .eq("task_id", taskId)
    .eq("tag", tag);
  if (error) fail(error);
}

/**
 * Replaces one task's whole tag set.
 *
 * Computes the difference rather than delete-then-insert: a blind delete
 * followed by a failed insert would leave the task with no tags at all, and
 * this runs from a detail panel where the user is looking straight at them.
 */
export async function setTaskTags(taskId: number, next: readonly string[]): Promise<string[]> {
  const uid = getUserId();
  const wanted = normalizeTagList(next);

  const { data, error } = await supabase
    .from(TASK_TAGS_TABLE)
    .select("tag")
    .eq("user_id", uid)
    .eq("task_id", taskId);
  if (error) fail(error);

  const current = new Set((data ?? []).map((r: any) => String(r.tag)));
  const toAdd = wanted.filter((t) => !current.has(t));
  const toRemove = [...current].filter((t) => !wanted.includes(t));

  if (toAdd.length > 0) {
    const { error: e } = await supabase
      .from(TASK_TAGS_TABLE)
      .upsert(
        toAdd.map((tag) => ({ user_id: uid, task_id: taskId, tag })),
        { onConflict: "user_id,task_id,tag" },
      );
    if (e) fail(e);
  }
  if (toRemove.length > 0) {
    const { error: e } = await supabase
      .from(TASK_TAGS_TABLE)
      .delete()
      .eq("user_id", uid)
      .eq("task_id", taskId)
      .in("tag", toRemove);
    if (e) fail(e);
  }

  return wanted;
}

/**
 * Renames a tag everywhere, in one statement.
 *
 * Through the RPC rather than a client-side loop because the loop is not
 * atomic: fail halfway and the tag exists under both names, with no way for the
 * user to tell which tasks got which. Same reasoning as `vault_rename_tag` for
 * note tags. Returns the number of rows moved.
 */
export async function renameTaskTag(oldTag: string, newTag: string): Promise<number> {
  const next = normalizeTag(newTag);
  if (!next) throw new Error("A tag needs at least one character.");
  const { data, error } = await supabase.rpc("vault_rename_task_tag", {
    p_old: oldTag,
    p_new: next,
  });
  if (error) fail(error);
  return Number(data ?? 0);
}

export async function deleteTaskTag(tag: string): Promise<number> {
  const { data, error } = await supabase.rpc("vault_delete_task_tag", { p_tag: tag });
  if (error) fail(error);
  return Number(data ?? 0);
}
