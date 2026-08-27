// One PathFinder snapshot, shared by every task block in the app.
//
// A note can hold several of these blocks — a board of this week's work, a table
// of a plan, a to-do list — and they all want the same rows. Without a shared
// store each block mounts its own fetch, so a note with four blocks makes four
// identical round trips on open, four more on every refresh, and each block ends
// up with its own slightly-different idea of what is done.
//
// Sharing also buys the two things that make the block feel native rather than
// embedded: switching a block between list/board/table is instant because the
// data is already here, and ticking a checkbox in one block updates the other
// three immediately, because they are all rendering the same array.

import { supabase, getUserId } from "./supabase";
import {
  createPathfinderApi,
  subtreeStats,
  type PfGoal,
  type PfPlan,
  type PfTask,
  type PfTeam,
  type PfTeamMember,
  type SubtreeStat,
} from "@nexus/core/pathfinder";
import {
  loadTagColors,
  loadTaskTags,
  normalizeTagList,
  EMPTY_TAG_INDEX,
  type TaskTagIndex,
} from "./vaultTaskTags";

export const pathfinderApi = createPathfinderApi(supabase, () => {
  try {
    return getUserId();
  } catch {
    // Signed out. The api throws its own "not signed in" on use; returning null
    // here is what lets the store report `signedOut` as a state of its own
    // rather than as an error string.
    return null;
  }
});

/**
 * The store's state.
 *
 * `signedOut` and `error` are separate from `ready` with zero rows, and that
 * separation is the point. `pf_tasks` is `auth.uid()`-scoped, so reading it
 * without a session returns an **empty set, not an error** — a block that
 * rendered that as "Nothing to do ✓" would be lying in exactly the way the
 * `blocking_state` invariant exists to prevent. An empty list means "nothing
 * matched"; every other outcome has to say what actually happened.
 */
export type PfStatus = "idle" | "loading" | "ready" | "error" | "signedOut";

export interface PfSnapshot {
  status: PfStatus;
  tasks: PfTask[];
  plans: PfPlan[];
  goals: PfGoal[];
  teams: PfTeam[];
  members: PfTeamMember[];
  /** The signed-in user, so "assigned to me" can be evaluated client-side. */
  myUid: string | null;
  error: string | null;
  /** epoch ms of the last successful load, or 0. */
  loadedAt: number;
  /** True when the read came back at the fetch ceiling — the window may be partial. */
  capped: boolean;

  /** Vault's own tags — see lib/vaultTaskTags.ts. Never leaves Vault. */
  tags: Map<number, string[]>;
  /** Every tag in use, sorted: the filter's vocabulary and the editor's autocomplete. */
  allTags: string[];
  /**
   * False when `vault_task_tags` does not exist yet. Kept separate from
   * `allTags: []` so the UI can say "run the migration" instead of showing an
   * empty tag picker that silently never fills.
   */
  tagsAvailable: boolean;
  /** tag (lowercased) → colour, from `vault_tag_colors` — shared with note tags. */
  tagColors: Record<string, string>;

  /**
   * Descendant roll-ups per task, recomputed with the snapshot.
   *
   * Here rather than in the block because it is O(n) over every task and every
   * block in the note wants the same answer — computing it per block per render
   * is the same waste the shared snapshot exists to avoid.
   */
  stats: Map<number, SubtreeStat>;
}

const EMPTY: PfSnapshot = {
  status: "idle",
  tasks: [],
  plans: [],
  goals: [],
  teams: [],
  members: [],
  myUid: null,
  error: null,
  loadedAt: 0,
  capped: false,
  tags: new Map(),
  allTags: [],
  tagsAvailable: true,
  tagColors: {},
  stats: new Map(),
};

/** One task's Vault tags, or an empty array — never undefined at a call site. */
export function tagsFor(snap: PfSnapshot, taskId: number): string[] {
  return snap.tags.get(taskId) ?? [];
}

/**
 * A tag's colour, or undefined.
 *
 * Looked up case-insensitively: task tags are normalized to lowercase
 * (`normalizeTag`) but `vault_tag_colors` predates that and holds whatever case
 * the note side wrote. A case-sensitive lookup would silently drop the colour of
 * every tag a user had already created as "Reading".
 */
export function tagColorFor(snap: PfSnapshot, tag: string): string | undefined {
  return snap.tagColors[tag] ?? snap.tagColors[tag.toLowerCase()];
}

let snapshot: PfSnapshot = EMPTY;
const listeners = new Set<() => void>();

/** Coalesces concurrent refreshes: four blocks mounting at once share one fetch. */
let inFlight: Promise<void> | null = null;

/** How long a snapshot is served without a re-read. Long enough that mounting a
 *  note doesn't refetch, short enough that a change made in PathFinder shows up
 *  on the next block interaction. Manual refresh always bypasses it. */
export const PF_TTL_MS = 60_000;

function emit() {
  snapshot = { ...snapshot };
  for (const l of listeners) l();
}

export function getSnapshot(): PfSnapshot {
  return snapshot;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function refresh(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (!force && snapshot.status === "ready" && Date.now() - snapshot.loadedAt < PF_TTL_MS) return;

  let uid: string | null = null;
  try {
    uid = getUserId();
  } catch {
    uid = null;
  }
  if (!uid) {
    snapshot = { ...EMPTY, status: "signedOut" };
    emit();
    return;
  }

  // Keep the previous rows on screen while reloading. A list that blanks itself
  // on every refresh reads as data loss, and there is nothing to gain from
  // hiding rows that are almost certainly still correct.
  snapshot = { ...snapshot, status: "loading", error: null };
  emit();

  inFlight = (async () => {
    try {
      const [tasks, plans, goals, teams, tagIndex, tagColors] = await Promise.all([
        pathfinderApi.loadTasks(),
        pathfinderApi.loadPlans(),
        pathfinderApi.loadGoals(),
        // Teams are loaded even for a solo user: the result is an empty list,
        // which is what tells the filter bar to hide the team controls entirely
        // rather than showing an empty dropdown.
        pathfinderApi.loadTeams(),
        // Tags are a Vault-only annotation layer whose table is applied by hand
        // and separately from any deploy, so a build running before the
        // migration lands is NORMAL. Its failure is caught here rather than
        // being allowed to reject the whole snapshot: letting a missing tag
        // table blank every task block in the note is the `pf_reminders`
        // incident with the roles reversed. `loadTaskTags` already reports a
        // missing table as `available: false`; this catch covers everything
        // else, because no tag problem is worth losing the task list over.
        loadTaskTags().catch(() => ({ ...EMPTY_TAG_INDEX, available: false })),
        // Colours are cosmetic — a failure here must not cost the task list, and
        // an uncoloured chip is a perfectly readable chip.
        loadTagColors().catch(() => ({}) as Record<string, string>),
      ]);
      snapshot = {
        status: "ready",
        tasks: tasks.tasks,
        plans,
        goals,
        teams: teams.teams,
        members: teams.members,
        myUid: uid,
        error: null,
        loadedAt: Date.now(),
        capped: tasks.capped,
        tags: tagIndex.byTask,
        allTags: tagIndex.all,
        tagsAvailable: tagIndex.available,
        tagColors,
        stats: subtreeStats(tasks.tasks),
      };
    } catch (e: any) {
      // Rows are kept. A transient failure must not empty every block in the
      // note — the footer says the refresh failed and the stale data stays
      // readable, which is the same "fail toward the last known state" rule the
      // enforcement path follows.
      snapshot = { ...snapshot, status: "error", error: e?.message ?? String(e) };
    } finally {
      inFlight = null;
      emit();
    }
  })();

  return inFlight;
}

/**
 * Replaces one task in the cache without a round trip.
 *
 * Used for optimistic writes and to fold a server response back in. Every block
 * re-renders from the same array, so a checkbox ticked in the list view also
 * moves the card on the board above it.
 */
export function upsertTask(task: PfTask): void {
  const i = snapshot.tasks.findIndex((t) => t.id === task.id);
  const tasks = i >= 0
    ? snapshot.tasks.map((t) => (t.id === task.id ? task : t))
    : [...snapshot.tasks, task];
  // Recomputed, not patched. Ticking one step changes the "3/12" on every
  // ancestor above it, and adding a subtask changes the parent's shape — a
  // roll-up that only refreshes on the next fetch is a number that visibly
  // jumps a minute later, which is the exact complaint `aggregate_estimate`'s
  // trigger exists to prevent server-side.
  snapshot = { ...snapshot, tasks, stats: subtreeStats(tasks) };
  emit();
}

/** Applies a shallow patch to one cached task, for optimistic updates. */
export function patchCachedTask(id: number, patch: Partial<PfTask>): PfTask | null {
  const found = snapshot.tasks.find((t) => t.id === id);
  if (!found) return null;
  const next = { ...found, ...patch };
  upsertTask(next);
  return found; // the PREVIOUS value, so a failed write can roll back to it
}

/**
 * Drops a task and its whole subtree from the cache.
 *
 * `deleteTask` cascades in the database — deleting a parent deletes its steps —
 * so removing only the row the user clicked would leave orphaned descendants on
 * screen, nested under a parent that no longer exists. They would survive until
 * the next fetch and stay tickable in the meantime, writing to rows that are
 * already gone.
 */
export function removeTask(id: number): void {
  const kids = new Map<number, number[]>();
  for (const t of snapshot.tasks) {
    if (t.parent_id == null) continue;
    const list = kids.get(t.parent_id);
    if (list) list.push(t.id);
    else kids.set(t.parent_id, [t.id]);
  }

  const doomed = new Set<number>();
  const stack = [id];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (doomed.has(next)) continue; // cycle guard — see tree.ts
    doomed.add(next);
    for (const c of kids.get(next) ?? []) stack.push(c);
  }

  const tasks = snapshot.tasks.filter((t) => !doomed.has(t.id));
  const tags = new Map(snapshot.tags);
  for (const d of doomed) tags.delete(d);

  snapshot = { ...snapshot, tasks, tags, allTags: collectTags(tags), stats: subtreeStats(tasks) };
  emit();
}

// ── Tags ────────────────────────────────────────────────────────────────────

function collectTags(byTask: Map<number, string[]>): string[] {
  const all = new Set<string>();
  for (const list of byTask.values()) for (const t of list) all.add(t);
  return [...all].sort();
}

/**
 * Replaces one task's cached tags.
 *
 * `allTags` is rebuilt from the map rather than appended to: removing the last
 * task carrying a tag has to remove it from the filter's vocabulary too, or the
 * picker slowly fills with dead options that match nothing.
 */
export function setCachedTaskTags(taskId: number, next: readonly string[]): string[] {
  const before = snapshot.tags.get(taskId) ?? [];
  const tags = new Map(snapshot.tags);
  const list = normalizeTagList(next);
  if (list.length > 0) tags.set(taskId, list);
  else tags.delete(taskId);
  snapshot = { ...snapshot, tags, allTags: collectTags(tags) };
  emit();
  return before; // the PREVIOUS value, so a failed write can roll back to it
}

/** Folds a whole freshly-read tag index in — used after a rename or a bulk delete. */
export function setCachedTagIndex(index: TaskTagIndex): void {
  snapshot = {
    ...snapshot,
    tags: index.byTask,
    allTags: index.all,
    tagsAvailable: index.available,
  };
  emit();
}

/** Test seam / sign-out hook: forget everything. */
export function resetStore(): void {
  snapshot = EMPTY;
  inFlight = null;
  emit();
}
