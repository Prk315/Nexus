// The query a PathFinder block asks of the task list — filtering, sorting and
// grouping — as pure functions over an already-fetched array.
//
// Filtering happens client-side, deliberately. Half the useful axes (urgency,
// stage) live on the embedded `pf_task_planning` relation, and filtering an
// embedded column server-side needs `!inner` syntax that changes the shape of
// the read; mixing server-side and client-side predicates then makes `limit`
// meaningless, because the server would cap the window *before* the client
// filters it and a block could show nothing while matching rows sat unread.
//
// Pulling the user's tasks once and walking them here is also the decision
// PathFinder's own `getSubtree` already made, for the same reason: at this scale
// (hundreds of tasks) one read is cheaper than a query per predicate. The payoff
// is that every axis is uniformly available and all of it is testable without a
// database.

import type {
  PfTask,
  Priority,
  TaskStage,
  TaskType,
  Urgency,
} from "./types";

export type DueWindow = "any" | "overdue" | "today" | "week" | "month" | "none" | "dated";
export type DoneFilter = "open" | "done" | "all";
/** Ownership: a personal task carries no `team_id`; a shared one does. */
export type OwnerScope = "any" | "personal" | "team";
/**
 * Who a task is for. `me` is NOT `assigned_to === myUid` — it is PathFinder's
 * own relevance rule, under which an unclaimed or everyone-assigned team task is
 * still mine. See `isTaskRelevantToMe`.
 */
export type AssigneeFilter = "any" | "me" | "unassigned" | (string & {});
export type SortKey =
  | "manual"
  | "due"
  | "priority"
  | "urgency"
  | "title"
  | "created"
  | "estimate"
  | "plan";
export type SortDir = "asc" | "desc";
export type BoardAxis =
  | "kanban_status" | "stage" | "priority" | "urgency" | "plan" | "task_type" | "assignee";

export interface TaskFilter {
  /** Empty array = no constraint on this axis. */
  planIds: number[];
  goalIds: number[];
  taskTypes: TaskType[];
  priorities: Priority[];
  urgencies: Urgency[];
  stages: TaskStage[];
  kanbanStatuses: string[];
  done: DoneFilter;
  due: DueWindow;
  /** Case-insensitive substring over the title. */
  search: string;
  /** Exclude subtasks — show only tasks with no parent. */
  rootsOnly: boolean;
  /** Exclude the three quick-task kinds, leaving project tasks only. */
  excludeQuick: boolean;
  /** Personal tasks, team tasks, or both. */
  scope: OwnerScope;
  /** Specific teams. Empty = no constraint. */
  teamIds: string[];
  /** Who the task is for. */
  assignee: AssigneeFilter;
}

export const DEFAULT_FILTER: TaskFilter = {
  planIds: [],
  goalIds: [],
  taskTypes: [],
  priorities: [],
  urgencies: [],
  stages: [],
  kanbanStatuses: [],
  done: "open",
  due: "any",
  search: "",
  rootsOnly: false,
  excludeQuick: false,
  scope: "any",
  teamIds: [],
  assignee: "any",
};

/**
 * Whether a task belongs on `myUid`'s surfaces.
 *
 * Copied deliberately from PathFinder's `lib/team.ts` rather than re-derived: a
 * personal task is always relevant, and a TEAM task is relevant to everyone on
 * the team unless it names a specific *other* member — `assigned_to` of `null`
 * or the `"all"` sentinel still means everyone. Getting this backwards would
 * make a Vault block disagree with PathFinder's own Dashboard about whose work
 * something is, which is worse than not offering the filter.
 */
export function isTaskRelevantToMe(
  task: { team_id: string | null; assigned_to: string | null },
  myUid: string | null,
): boolean {
  if (!task.team_id) return true;
  if (task.assigned_to == null || task.assigned_to === "all") return true;
  return myUid != null && task.assigned_to === myUid;
}

const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Local YYYY-MM-DD — the calendar day as the user sees it, not UTC's. */
export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Does a due date fall in the window?
 *
 * `today` is passed in rather than read from the clock so this stays pure and a
 * test can pin the day. Dates are compared as strings, which is correct for
 * ISO-8601 and avoids constructing a Date per task per render.
 */
export function matchesDue(due: string | null, window: DueWindow, today: string): boolean {
  if (window === "any") return true;
  if (window === "none") return due == null;
  if (due == null) return false;
  if (window === "dated") return true;
  if (window === "overdue") return due < today;
  if (window === "today") return due === today;

  const days = window === "week" ? 7 : 30;
  const end = new Date(today + "T00:00:00");
  end.setDate(end.getDate() + days);
  // Overdue work is *more* urgent than work due this week, so a forward window
  // includes it. A "this week" list that hides last week's misses is how things
  // get quietly dropped.
  return due <= isoDay(end);
}

function has<T>(list: T[], value: T): boolean {
  return list.length === 0 || list.includes(value);
}

export function matchesFilter(
  task: PfTask,
  filter: TaskFilter,
  today: string,
  myUid: string | null = null,
): boolean {
  if (filter.done === "open" && task.done) return false;
  if (filter.done === "done" && !task.done) return false;

  if (filter.rootsOnly && task.parent_id != null) return false;
  if (filter.excludeQuick && task.category != null) return false;

  // ── Team axes ─────────────────────────────────────────────────────────────
  if (filter.scope === "personal" && task.team_id != null) return false;
  if (filter.scope === "team" && task.team_id == null) return false;

  if (filter.teamIds.length > 0 && (task.team_id == null || !filter.teamIds.includes(task.team_id))) {
    return false;
  }

  if (filter.assignee === "me") {
    if (!isTaskRelevantToMe(task, myUid)) return false;
  } else if (filter.assignee === "unassigned") {
    // Only meaningful for a team task — a personal task has nobody to assign it
    // to and `assigned_to` is documented as meaningless when `team_id` is null.
    if (task.team_id == null || (task.assigned_to != null && task.assigned_to !== "all")) return false;
  } else if (filter.assignee !== "any") {
    if (task.assigned_to !== filter.assignee) return false;
  }

  if (filter.planIds.length > 0 && (task.plan_id == null || !filter.planIds.includes(task.plan_id))) {
    return false;
  }
  if (filter.goalIds.length > 0 && (task.goal_id == null || !filter.goalIds.includes(task.goal_id))) {
    return false;
  }
  if (!has(filter.taskTypes, task.task_type)) return false;
  if (!has(filter.priorities, task.priority)) return false;
  if (!has(filter.kanbanStatuses, task.kanban_status)) return false;

  // Urgency and stage live on the sparse subtype. A reminder has no planning row
  // at all, so constraining either axis excludes every sparse kind — which is
  // the honest answer, not a bug: "urgency = high" cannot describe a thing that
  // has no urgency.
  if (filter.urgencies.length > 0) {
    if (!task.planning || !filter.urgencies.includes(task.planning.urgency)) return false;
  }
  if (filter.stages.length > 0) {
    if (!task.planning || !filter.stages.includes(task.planning.stage)) return false;
  }

  if (!matchesDue(task.due_date, filter.due, today)) return false;

  if (filter.search.trim()) {
    const q = filter.search.trim().toLowerCase();
    const hay = `${task.title} ${task.plan_title ?? ""} ${task.goal_title ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }

  return true;
}

/**
 * Sorts a copy. Nulls always sort last regardless of direction — a task with no
 * due date is not "due first", and flipping the direction should reorder the
 * dated ones without dragging the undated pile to the top.
 */
export function sortTasks(tasks: PfTask[], key: SortKey, dir: SortDir): PfTask[] {
  if (key === "manual") {
    return [...tasks].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }

  const sign = dir === "asc" ? 1 : -1;

  const cmp = (a: PfTask, b: PfTask): number => {
    switch (key) {
      case "due":
        return nullsLast(a.due_date, b.due_date, (x, y) => x.localeCompare(y), sign);
      case "priority":
        return sign * (RANK[a.priority] - RANK[b.priority]);
      case "urgency":
        return nullsLast(
          a.planning?.urgency ?? null,
          b.planning?.urgency ?? null,
          (x, y) => RANK[x] - RANK[y],
          sign,
        );
      case "title":
        return sign * a.title.localeCompare(b.title);
      case "created":
        return sign * a.created_at.localeCompare(b.created_at);
      case "estimate":
        return sign * ((a.aggregate_estimate ?? 0) - (b.aggregate_estimate ?? 0));
      case "plan":
        return nullsLast(a.plan_title, b.plan_title, (x, y) => x.localeCompare(y), sign);
      default:
        return 0;
    }
  };

  // id as the final tiebreak so the order is stable across refetches — without
  // it, two equal-priority tasks can swap places on every poll and the list
  // visibly shuffles under the cursor.
  return [...tasks].sort((a, b) => cmp(a, b) || a.id - b.id);
}

function nullsLast<T>(
  a: T | null,
  b: T | null,
  compare: (x: T, y: T) => number,
  sign: number,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return sign * compare(a, b);
}

export interface TaskGroup {
  key: string;
  label: string;
  tasks: PfTask[];
}

/** The value a task takes on a board axis, or null when the axis doesn't apply. */
export function axisValue(task: PfTask, axis: BoardAxis): string | null {
  switch (axis) {
    case "kanban_status":
      return task.kanban_status || "backlog";
    case "stage":
      return task.planning?.stage ?? null;
    case "priority":
      return task.priority;
    case "urgency":
      return task.planning?.urgency ?? null;
    case "task_type":
      return task.task_type;
    case "plan":
      return task.plan_id == null ? null : String(task.plan_id);
    case "assignee":
      // Only a team task has an assignee. A personal one falls to the trailing
      // bucket rather than being filed under whoever happens to own it — that
      // column would say "Bastian" about work that was never assigned at all.
      if (task.team_id == null) return null;
      return task.assigned_to == null ? "__unassigned__" : task.assigned_to;
    default:
      return null;
  }
}

/**
 * Buckets tasks for the board.
 *
 * `columns` fixes the order and guarantees empty columns still render — a Kanban
 * board that hides its empty columns has no drop target for the state you are
 * trying to move a card *into*, which makes the board unusable exactly when it
 * matters. Anything whose axis value isn't in `columns` (including null, e.g. a
 * reminder on the `stage` axis) lands in a trailing bucket rather than vanishing.
 */
export function groupTasks(
  tasks: PfTask[],
  axis: BoardAxis,
  columns: Array<{ key: string; label: string }>,
  unmatchedLabel = "Other",
): TaskGroup[] {
  const byKey = new Map<string, PfTask[]>();
  for (const c of columns) byKey.set(c.key, []);
  const other: PfTask[] = [];

  for (const t of tasks) {
    const v = axisValue(t, axis);
    const bucket = v != null ? byKey.get(v) : undefined;
    if (bucket) bucket.push(t);
    else other.push(t);
  }

  const groups = columns.map((c) => ({ key: c.key, label: c.label, tasks: byKey.get(c.key) ?? [] }));
  if (other.length > 0) groups.push({ key: "__other__", label: unmatchedLabel, tasks: other });
  return groups;
}

export interface QueryResult {
  /** After filter + sort + limit — what the view renders. */
  tasks: PfTask[];
  /** How many matched before the limit was applied. */
  matched: number;
  /** True when `matched > tasks.length`, so the view can say so out loud. */
  truncated: boolean;
}

/**
 * Filter, sort, cap.
 *
 * The cap is reported rather than silently applied. A truncated list presented
 * as a whole one is the same lie as an empty panel that means "never loaded" —
 * the footer says "showing 50 of 214" so the number on screen is never mistaken
 * for the number that exists.
 */
export function runQuery(
  tasks: PfTask[],
  filter: TaskFilter,
  sort: { key: SortKey; dir: SortDir },
  limit: number,
  today: string,
  myUid: string | null = null,
): QueryResult {
  const matched = tasks.filter((t) => matchesFilter(t, filter, today, myUid));
  const sorted = sortTasks(matched, sort.key, sort.dir);
  const capped = limit > 0 ? sorted.slice(0, limit) : sorted;
  return { tasks: capped, matched: matched.length, truncated: capped.length < matched.length };
}

/**
 * The task fields a new task should inherit from the block's own filter.
 *
 * This is what makes "+ Add task" inside a filtered block do the obvious thing:
 * a block showing plan "Thesis" creates tasks *in* "Thesis". Only unambiguous
 * single-value constraints are inherited — a filter listing three plans says
 * nothing about which one a new task belongs to, so it contributes nothing.
 */
export function creationDefaults(filter: TaskFilter): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (filter.planIds.length === 1) out.plan_id = filter.planIds[0];
  if (filter.goalIds.length === 1) out.goal_id = filter.goalIds[0];
  if (filter.priorities.length === 1) out.priority = filter.priorities[0];
  if (filter.urgencies.length === 1) out.urgency = filter.urgencies[0];
  if (filter.kanbanStatuses.length === 1) out.kanban_status = filter.kanbanStatuses[0];
  // A block showing one team's work creates INTO that team, and one that is
  // filtered to a person assigns to them. `me` and `unassigned` deliberately
  // contribute nothing: "relevant to me" spans unclaimed team work, so honouring
  // it as an assignment would claim a task nobody asked to claim.
  if (filter.teamIds.length === 1) out.team_id = filter.teamIds[0];
  if (filter.assignee !== "any" && filter.assignee !== "me" && filter.assignee !== "unassigned") {
    out.assigned_to = filter.assignee;
  }
  // `category` is the writable discriminator; `task_type` is generated from it.
  if (filter.taskTypes.length === 1) {
    const t = filter.taskTypes[0];
    out.category = t === "task" ? null : t;
  }
  // A due window is a range, not a date — except "today", which is exactly one.
  if (filter.due === "today") out.__dueToday = true;
  return out;
}

/** True when the filter constrains nothing — used to label a block "All tasks". */
export function isUnfiltered(filter: TaskFilter): boolean {
  return (
    filter.planIds.length === 0 &&
    filter.goalIds.length === 0 &&
    filter.taskTypes.length === 0 &&
    filter.priorities.length === 0 &&
    filter.urgencies.length === 0 &&
    filter.stages.length === 0 &&
    filter.kanbanStatuses.length === 0 &&
    filter.due === "any" &&
    !filter.search.trim() &&
    !filter.rootsOnly &&
    !filter.excludeQuick &&
    filter.scope === "any" &&
    filter.teamIds.length === 0 &&
    filter.assignee === "any"
  );
}

/** How many axes the filter constrains — the badge on the collapsed filter bar. */
export function activeFilterCount(filter: TaskFilter): number {
  let n = 0;
  if (filter.planIds.length) n++;
  if (filter.goalIds.length) n++;
  if (filter.taskTypes.length) n++;
  if (filter.priorities.length) n++;
  if (filter.urgencies.length) n++;
  if (filter.stages.length) n++;
  if (filter.kanbanStatuses.length) n++;
  if (filter.due !== "any") n++;
  if (filter.search.trim()) n++;
  if (filter.rootsOnly) n++;
  if (filter.excludeQuick) n++;
  if (filter.done !== "open") n++;
  if (filter.scope !== "any") n++;
  if (filter.teamIds.length) n++;
  if (filter.assignee !== "any") n++;
  return n;
}
