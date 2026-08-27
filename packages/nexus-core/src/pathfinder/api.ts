// PathFinder's task CRUD, for apps that are not PathFinder.
//
// The client is injected rather than constructed here, exactly as
// `createMailApi` and `createJobsApi` do: `pf_tasks` and its neighbours are
// scoped to `auth.uid()` for the `authenticated` role, so the correct client is
// the app's own **session** client — `supabase`, never `supabasePublic`. Getting
// that backwards returns an **empty set, not an error**, which renders as a
// perfectly plausible empty task list. Apps with no session pass `null` and the
// caller says "sign in" instead of "nothing to do".
//
// ── Why this exists at all ──────────────────────────────────────────────────
//
// Three invariants of the pf_tasks ISA hierarchy live in application code rather
// than in the database, and every one of them fails SILENTLY when a second app
// writes the tables directly:
//
//   1. `stage = 'active'` is gated on the task having calendar minutes behind
//      it. The predicate spans three tables, so PathFinder deliberately did not
//      make it a trigger — which means it is only enforced by going through
//      `setStage` here. A Kanban card dragged straight to "active" with a raw
//      UPDATE defeats the one rule the lifecycle exists for.
//   2. A flat patch has to be SPLIT across relations. `urgency` and `stage` live
//      on `pf_task_planning`; writing them onto `pf_tasks` does not error, it
//      just does not happen.
//   3. `task_type` is a generated column and `aggregate_estimate` is
//      trigger-maintained. Writing either errors or is overwritten.
//
// There were already three hand-written copies of the pf_tasks read in this
// repo when this module was added, and the newest of them
// (`apps/NexusLocal/src/lib/pathfinder/api.ts`) had already dropped the
// `pf_task_planning` embed — so every task it renders reads as default urgency
// and stage. That is the drift this module exists to stop, not a hypothetical.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GOALS_TABLE,
  PLANS_TABLE,
  TASKS_TABLE,
  TASK_PLANNING_TABLE,
  TASK_SELECT_CTX,
  TEAMS_TABLE,
  TEAM_MEMBERS_TABLE,
  memberName,
  type PfGoal,
  type PfPlan,
  type PfTask,
  type PfTeam,
  type PfTeamMember,
  type Priority,
  type TaskPlanning,
  type TaskStage,
  type TaskType,
} from "./types";

/**
 * Ceiling on one read. PathFinder is a personal planner in the hundreds of
 * tasks; this is a runaway guard, not a pagination scheme. `loadTasks` reports
 * when it comes back full so a caller never presents a capped window as the
 * whole table.
 */
export const TASK_FETCH_LIMIT = 2000;

/** Columns that live on the supertype. Everything else belongs to `pf_task_planning`. */
const BASE_COLUMNS = new Set([
  "plan_id", "parent_id", "goal_id", "title", "done", "sort_order", "priority",
  "due_date", "time_estimate", "kanban_status", "category", "team_id", "assigned_to",
]);

/**
 * Splits a flat patch across the hierarchy.
 *
 * Mirrors PathFinder's own `splitPatch`. `task_type` and `aggregate_estimate`
 * are dropped: both are database-maintained, and writing either would error or
 * be silently overwritten on the next recompute.
 */
export function splitPatch(patch: Record<string, unknown>): {
  base: Record<string, unknown>;
  planning: Record<string, unknown>;
} {
  const base: Record<string, unknown> = {};
  const planning: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === "task_type" || k === "aggregate_estimate" || k === "planning") continue;
    if (k.startsWith("__")) continue;
    if (BASE_COLUMNS.has(k)) base[k] = v;
    else planning[k] = v;
  }
  return { base, planning };
}

function num(v: unknown): number {
  return Number(v);
}

function mapPlanning(r: any): TaskPlanning | null {
  // PostgREST gives a one-to-one embed as an object but an array when it can
  // only infer one-to-many. Accept both, so a relationship-cache change cannot
  // silently blank every task's planning row.
  const p = Array.isArray(r?.pf_task_planning) ? r.pf_task_planning[0] : r?.pf_task_planning;
  if (!p) return null;
  return {
    urgency: p.urgency ?? "medium",
    stage: p.stage ?? "refine",
    completion_mode: p.completion_mode ?? "binary",
    target_count: p.target_count ?? null,
    notes: p.notes ?? null,
  };
}

export function mapTask(r: any): PfTask {
  const plan = r.pf_plans;
  // A task reaches a goal two ways and the DIRECT link wins — it is the more
  // specific statement, and preferring it is what keeps this answer identical to
  // the one `pf_goals_with_counts` computes server-side.
  const direct = Array.isArray(r.pf_goals) ? r.pf_goals[0] : r.pf_goals;
  const goalId = r.goal_id != null ? num(r.goal_id) : plan?.goal_id != null ? num(plan.goal_id) : null;
  const goalTitle = (r.goal_id != null ? direct?.title : plan?.pf_goals?.title) ?? null;

  return {
    id: num(r.id),
    plan_id: r.plan_id != null ? num(r.plan_id) : null,
    parent_id: r.parent_id != null ? num(r.parent_id) : null,
    goal_id: goalId,
    task_type: (r.task_type ?? r.category ?? "task") as TaskType,
    title: r.title ?? "",
    done: !!r.done,
    sort_order: r.sort_order ?? 0,
    priority: (r.priority ?? "medium") as Priority,
    due_date: r.due_date ?? null,
    created_at: r.created_at ?? "",
    time_estimate: r.time_estimate ?? null,
    aggregate_estimate: r.aggregate_estimate ?? r.time_estimate ?? 0,
    kanban_status: r.kanban_status ?? "backlog",
    category: r.category ?? null,
    team_id: r.team_id ?? null,
    assigned_to: r.assigned_to ?? null,
    planning: mapPlanning(r),
    plan_title: plan?.title ?? null,
    goal_title: goalTitle,
  };
}

export interface TaskSnapshot {
  tasks: PfTask[];
  /** True when the read came back at TASK_FETCH_LIMIT — the window may be partial. */
  capped: boolean;
}

export interface CreateTaskInput {
  title: string;
  plan_id?: number | null;
  goal_id?: number | null;
  parent_id?: number | null;
  priority?: Priority;
  due_date?: string | null;
  time_estimate?: number | null;
  category?: string | null;
  kanban_status?: string;
  urgency?: string;
  stage?: TaskStage;
  /** Share the task with a team. Null (the default) keeps it personal. */
  team_id?: string | null;
  /** null = unassigned, `"all"` = everyone, else a member's uid. Meaningless without team_id. */
  assigned_to?: string | null;
  [key: string]: unknown;
}

export interface PathfinderApi {
  loadTasks(): Promise<TaskSnapshot>;
  loadPlans(): Promise<PfPlan[]>;
  loadGoals(): Promise<PfGoal[]>;
  loadTeams(): Promise<{ teams: PfTeam[]; members: PfTeamMember[] }>;
  getTask(id: number): Promise<PfTask>;
  createTask(input: CreateTaskInput): Promise<PfTask>;
  patchTask(id: number, patch: Record<string, unknown>): Promise<PfTask>;
  toggleTask(id: number, done: boolean): Promise<PfTask>;
  setKanbanStatus(id: number, status: string): Promise<PfTask>;
  setStage(id: number, stage: TaskStage): Promise<PfTask>;
  deleteTask(id: number): Promise<void>;
}

/** Thrown by `setStage` when the scheduling gate refuses. Carries a message meant for the user. */
export class SchedulingGateError extends Error {
  constructor(message = "Schedule calendar time for this task before starting it.") {
    super(message);
    this.name = "SchedulingGateError";
  }
}

export function createPathfinderApi(
  client: SupabaseClient | null | undefined,
  getUserId: () => string | null,
): PathfinderApi {
  function need(): { db: SupabaseClient; uid: string } {
    const uid = getUserId();
    if (!client || !uid) throw new Error("PathFinder: not signed in");
    return { db: client, uid };
  }

  function fail(e: any): never {
    throw new Error(e?.message ?? String(e));
  }

  /**
   * The `.or()` fragment that broadens a "mine only" read to "mine + my teams'".
   *
   * Copied from PathFinder's `getTeamOrFilter`. Without it every read here would
   * be `.eq("user_id", uid)` and a task a teammate shared — which RLS is
   * perfectly happy to return — would simply not appear, indistinguishably from
   * not existing. Returns null when the caller is in no team, so a solo user
   * keeps the plain, narrower filter.
   */
  let teamIdsPromise: Promise<string[]> | null = null;

  async function myTeamIds(): Promise<string[]> {
    if (!teamIdsPromise) {
      teamIdsPromise = (async () => {
        const { db } = need();
        // RLS on pf_teams already scopes this to "teams I am a member of", so
        // no user_id filter is possible or needed.
        const { data, error } = await db.from(TEAMS_TABLE).select("id");
        if (error) fail(error);
        return (data ?? []).map((r: any) => String(r.id));
      })().catch((e) => {
        // Don't cache a failure — a transient error must not permanently
        // narrow every subsequent read back to personal-only.
        teamIdsPromise = null;
        throw e;
      });
    }
    return teamIdsPromise;
  }

  async function teamOrFilter(): Promise<string | null> {
    const { uid } = need();
    const ids = await myTeamIds();
    if (ids.length === 0) return null;
    return `user_id.eq.${uid},team_id.in.(${ids.join(",")})`;
  }

  async function getTask(id: number): Promise<PfTask> {
    const { db } = need();
    const { data, error } = await db.from(TASKS_TABLE).select(TASK_SELECT_CTX).eq("id", id).single();
    if (error) fail(error);
    return mapTask(data);
  }

  /**
   * Committed calendar minutes across a task's whole subtree.
   *
   * Both one-off blocks and recurring series count — a task worked every Tuesday
   * is scheduled. Series are counted over a bounded horizon, because an
   * open-ended one would otherwise contribute infinite minutes; here the only
   * question is "> 0", so one occurrence is enough and the horizon just has to
   * be finite.
   */
  // Note the deliberate narrowness: calendar blocks stay scoped to the caller,
  // matching PathFinder's own `getTaskScheduling`. Time a teammate scheduled
  // against a shared task therefore does not satisfy this gate. That is
  // PathFinder's existing behaviour, and diverging here would mean the same
  // task could be startable in Vault and not in PathFinder.
  async function scheduledMinutes(taskIds: number[]): Promise<number> {
    if (taskIds.length === 0) return 0;
    const { db, uid } = need();
    const [oneOff, series] = await Promise.all([
      db.from("pf_cal_blocks").select("start_time, end_time, task_id")
        .eq("user_id", uid).in("task_id", taskIds),
      db.from("pf_recurring_cal_blocks").select("start_time, end_time, task_id")
        .eq("user_id", uid).in("task_id", taskIds),
    ]);

    const minutes = (a: string | null, b: string | null): number => {
      if (!a || !b) return 0;
      const toMin = (t: string) => {
        const [h, m] = t.split(":").map(Number);
        return (h || 0) * 60 + (m || 0);
      };
      return Math.max(0, toMin(b) - toMin(a));
    };

    let total = 0;
    for (const r of oneOff.data ?? []) total += minutes(r.start_time, r.end_time);
    for (const r of series.data ?? []) total += minutes(r.start_time, r.end_time);
    return total;
  }

  /**
   * Every descendant id of `rootId`, plus the root. One full read and a walk,
   * like PathFinder's `getSubtree` — a recursive CTE would need an RPC, and at
   * this scale the walk is cheaper anyway.
   *
   * Broadened to team rows: a step of a shared task may be owned by a teammate,
   * and a personal-only read would silently treat that subtree as a leaf.
   */
  async function subtreeIds(rootId: number): Promise<number[]> {
    const { db, uid } = need();
    const or = await teamOrFilter();
    let q = db.from(TASKS_TABLE).select("id, parent_id");
    q = or ? q.or(or) : q.eq("user_id", uid);
    const { data, error } = await q;
    if (error) fail(error);

    const kids = new Map<number, number[]>();
    for (const r of data ?? []) {
      if (r.parent_id == null) continue;
      const p = num(r.parent_id);
      const list = kids.get(p);
      if (list) list.push(num(r.id));
      else kids.set(p, [num(r.id)]);
    }

    const out: number[] = [];
    const seen = new Set<number>();
    const walk = (id: number) => {
      if (seen.has(id)) return;
      seen.add(id);
      out.push(id);
      for (const c of kids.get(id) ?? []) walk(c);
    };
    walk(rootId);
    return out;
  }

  async function patchTask(id: number, patch: Record<string, unknown>): Promise<PfTask> {
    const { db } = need();
    const { base, planning } = splitPatch(patch);

    if (Object.keys(base).length > 0) {
      const { error } = await db.from(TASKS_TABLE).update(base).eq("id", id);
      if (error) fail(error);
    }
    if (Object.keys(planning).length > 0) {
      // Ignored rather than errored on a sparse kind: a reminder has no planning
      // row by design, and refusing the write would make every generic call site
      // branch on subtype.
      const { error } = await db.from(TASK_PLANNING_TABLE).update(planning).eq("task_id", id);
      if (error) fail(error);
    }
    return getTask(id);
  }

  return {
    async loadTasks(): Promise<TaskSnapshot> {
      const { db, uid } = need();
      const or = await teamOrFilter();
      let q = db.from(TASKS_TABLE).select(TASK_SELECT_CTX);
      q = or ? q.or(or) : q.eq("user_id", uid);
      const { data, error } = await q.order("sort_order").limit(TASK_FETCH_LIMIT);
      if (error) fail(error);
      const tasks = (data ?? []).map(mapTask);
      return { tasks, capped: tasks.length >= TASK_FETCH_LIMIT };
    },

    async loadTeams(): Promise<{ teams: PfTeam[]; members: PfTeamMember[] }> {
      const { db } = need();
      // Both tables are RLS-scoped to the caller's teams, so neither read needs
      // a user_id filter — same as PathFinder's own teams.ts.
      const [teamsRes, membersRes] = await Promise.all([
        db.from(TEAMS_TABLE).select("id, name, created_by"),
        db.from(TEAM_MEMBERS_TABLE).select("team_id, user_id"),
      ]);
      if (teamsRes.error) fail(teamsRes.error);
      if (membersRes.error) fail(membersRes.error);

      return {
        teams: (teamsRes.data ?? []).map((r: any) => ({
          id: String(r.id), name: r.name ?? "Team", created_by: r.created_by ?? "",
        })),
        members: (membersRes.data ?? []).map((r: any) => ({
          team_id: String(r.team_id),
          user_id: String(r.user_id),
          display_name: memberName(String(r.user_id)),
        })),
      };
    },

    async loadPlans(): Promise<PfPlan[]> {
      const { db, uid } = need();
      const or = await teamOrFilter();
      let q = db.from(PLANS_TABLE).select("id, goal_id, title, status, deadline, team_id");
      q = or ? q.or(or) : q.eq("user_id", uid);
      const { data, error } = await q.order("title");
      if (error) fail(error);
      return (data ?? []).map((r: any) => ({
        id: num(r.id),
        goal_id: r.goal_id != null ? num(r.goal_id) : null,
        title: r.title ?? "",
        status: r.status ?? "active",
        deadline: r.deadline ?? null,
        team_id: r.team_id ?? null,
      }));
    },

    async loadGoals(): Promise<PfGoal[]> {
      const { db, uid } = need();
      const { data, error } = await db
        .from(GOALS_TABLE)
        .select("id, title, status")
        .eq("user_id", uid)
        .order("title");
      if (error) fail(error);
      return (data ?? []).map((r: any) => ({
        id: num(r.id),
        title: r.title ?? "",
        status: r.status ?? "active",
      }));
    },

    getTask,
    patchTask,

    async createTask(input: CreateTaskInput): Promise<PfTask> {
      const { db, uid } = need();
      const { base, planning } = splitPatch({ ...input });

      const { data, error } = await db
        .from(TASKS_TABLE)
        .insert({ user_id: uid, ...base })
        .select(TASK_SELECT_CTX)
        .single();
      if (error) fail(error);

      const created = mapTask(data);
      // The planning row is materialised by a trigger for every 'task'-type row,
      // so this only fills in non-defaults — and only where there is a planning
      // relation to fill.
      if (Object.keys(planning).length > 0 && created.task_type === "task") {
        return patchTask(created.id, planning);
      }
      return created;
    },

    async toggleTask(id: number, done: boolean): Promise<PfTask> {
      const { db } = need();
      const { error } = await db.from(TASKS_TABLE).update({ done }).eq("id", id);
      if (error) fail(error);

      // Keep `stage` and `done` from disagreeing. Un-ticking a completed task
      // drops it back to 'active', not all the way to 'refine': it was scheduled
      // once, and un-ticking a box is not a request to re-plan it from scratch.
      const current = await getTask(id);
      if (current.task_type === "task" && current.planning) {
        const stage = done
          ? "done"
          : current.planning.stage === "done"
            ? "active"
            : current.planning.stage;
        if (stage !== current.planning.stage) {
          const { error: e2 } = await db
            .from(TASK_PLANNING_TABLE).update({ stage }).eq("task_id", id);
          if (e2) fail(e2);
          return getTask(id);
        }
      }
      return current;
    },

    async setKanbanStatus(id: number, status: string): Promise<PfTask> {
      const { db } = need();
      const { error } = await db.from(TASKS_TABLE).update({ kanban_status: status }).eq("id", id);
      if (error) fail(error);
      return getTask(id);
    },

    /**
     * Moves a task through the lifecycle, enforcing the rule that makes the
     * lifecycle worth having: **you cannot start work you have not scheduled.**
     *
     * This is the whole reason a Kanban board in another app has to come through
     * here rather than issuing its own UPDATE.
     */
    async setStage(id: number, stage: TaskStage): Promise<PfTask> {
      const task = await getTask(id);
      // Only the 'task' subtype has a lifecycle; the sparse kinds have no
      // planning row, so there is nothing to gate and nothing to write.
      if (task.task_type !== "task") return task;

      if (stage === "active") {
        const ids = await subtreeIds(id);
        const total = await scheduledMinutes(ids.length ? ids : [id]);
        if (total === 0) throw new SchedulingGateError();
      }

      return patchTask(id, stage === "done" ? { stage, done: true } : { stage });
    },

    async deleteTask(id: number): Promise<void> {
      const { db } = need();
      const ids = await subtreeIds(id);
      const scope = ids.length ? ids : [id];
      const today = new Date().toISOString().slice(0, 10);

      // Past blocks record time actually spent and must survive — deleting the
      // task should not rewrite history. Future commitments to work that no
      // longer exists are just clutter, so those go.
      await Promise.all([
        db.from("pf_cal_blocks").delete().in("task_id", scope).gte("date", today),
        db.from("pf_recurring_cal_blocks").delete().in("task_id", scope),
      ]);

      const { error } = await db.from(TASKS_TABLE).delete().eq("id", id);
      if (error) fail(error);
    },
  };
}
