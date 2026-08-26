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
  type PfGoal,
  type PfPlan,
  type PfTask,
  type PfTeam,
  type PfTeamMember,
} from "@nexus/core/pathfinder";

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
};

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
      const [tasks, plans, goals, teams] = await Promise.all([
        pathfinderApi.loadTasks(),
        pathfinderApi.loadPlans(),
        pathfinderApi.loadGoals(),
        // Teams are loaded even for a solo user: the result is an empty list,
        // which is what tells the filter bar to hide the team controls entirely
        // rather than showing an empty dropdown.
        pathfinderApi.loadTeams(),
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
  snapshot = { ...snapshot, tasks };
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

export function removeTask(id: number): void {
  snapshot = { ...snapshot, tasks: snapshot.tasks.filter((t) => t.id !== id) };
  emit();
}

/** Test seam / sign-out hook: forget everything. */
export function resetStore(): void {
  snapshot = EMPTY;
  inFlight = null;
  emit();
}
