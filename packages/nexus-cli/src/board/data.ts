// `nexus board` — the data shaping, with no React in it.
//
// Everything the board decides about WHAT to show lives here: which tasks are
// current, how upcoming work buckets, how much of a plan is done. It is pure so
// that the rules can be tested without a terminal and without a database — the
// rendering layer only formats what these functions return.
//
// Three rules from the `brief` skill are load-bearing here:
//
//   1. COUNT LEAVES, NOT NODES. A plan of 29 "tasks" was 20 leaves and 9
//      containers; reporting the node count overstates the work every time.
//   2. A subtask does not necessarily carry its parent's `plan_id`, so a plan's
//      work is the CLOSURE over descendants of its tasks, not `plan_id = n`.
//   3. `pf_tasks.due_date` is TEXT. It is compared as an ISO string against
//      today's LOCAL date; a `Date` cast would throw on anything that is not a
//      clean ISO date, and `toISOString()` would answer yesterday before 01:00
//      Copenhagen time.

import type { PfGoal, PfPlan, PfTask, Priority, Urgency } from "@nexus/core/pathfinder";
import { childrenIndex } from "../pf/tree.ts";

// ── dates ────────────────────────────────────────────────────────────────────

/** Today as YYYY-MM-DD in the machine's LOCAL zone — the zone due dates were typed in. */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * True only for a real calendar date, validated by ROUND TRIP.
 * `Date.UTC(2026, 12, 1)` does not fail — it rolls over into January 2027, so a
 * shape check alone accepts "2026-13-01" and "2026-02-30".
 */
export function isIsoDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** ISO date + n days, in UTC so no zone can shift the arithmetic by a day. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  const p = (x: number) => String(x).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

/** The due date the board may compare and bucket. A malformed value is not one. */
export function comparableDue(t: PfTask): string | null {
  return isIsoDate(t.due_date) ? t.due_date : null;
}

// ── ranking ──────────────────────────────────────────────────────────────────

const URGENCY_RANK: Record<Urgency, number> = { high: 0, medium: 1, low: 2 };
const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** A sparse-kind task (reminder/chore/shopping) has no planning row, so no urgency. */
export function urgencyRank(t: PfTask): number {
  const u = t.planning?.urgency;
  return u ? URGENCY_RANK[u] : URGENCY_RANK.medium;
}

export function priorityRank(t: PfTask): number {
  return PRIORITY_RANK[t.priority] ?? PRIORITY_RANK.medium;
}

/** Undated sorts LAST, never first: absent is not "due at the beginning of time". */
function byDue(a: PfTask, b: PfTask): number {
  const da = comparableDue(a);
  const db = comparableDue(b);
  if (da && db) return da.localeCompare(db);
  if (da) return -1;
  if (db) return 1;
  return 0;
}

// ── leaves ───────────────────────────────────────────────────────────────────

export interface LeafCounts {
  done: number;
  total: number;
}

/**
 * Every task reachable from `roots` through `parent_id`, the roots included.
 *
 * Cycle-guarded: nothing in `pf_tasks` stops an UPDATE making a task its own
 * grandparent, and this walk is exactly where that would hang the terminal.
 */
export function subtreeIds(tasks: PfTask[], rootIds: Iterable<number>, kids = childrenIndex(tasks)): Set<number> {
  const seen = new Set<number>();
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const c of kids.get(id) ?? []) stack.push(c.id);
  }
  return seen;
}

/**
 * Done/total LEAVES over a set of task ids.
 *
 * A leaf is a task with no children **in the whole dataset** — not "no children
 * in this set". A container whose children were filtered out is still a heading,
 * and counting it as work is the mistake the brief skill exists to prevent.
 */
export function leafCounts(tasks: PfTask[], ids: ReadonlySet<number>, kids = childrenIndex(tasks)): LeafCounts {
  let done = 0;
  let total = 0;
  for (const t of tasks) {
    if (!ids.has(t.id)) continue;
    if ((kids.get(t.id)?.length ?? 0) > 0) continue;
    total++;
    if (t.done) done++;
  }
  return { done, total };
}

/**
 * The goal a task counts toward. A DIRECT `goal_id` beats the one inherited via
 * its plan — the more specific statement — and preferring it is what stops a
 * task that reaches a goal both ways being counted twice. PathFinder's
 * `mapTaskWithContext` and `pf_goals_with_counts` implement the same precedence.
 */
export function goalOfTask(t: PfTask, plansById: ReadonlyMap<number, PfPlan>): number | null {
  if (t.goal_id != null) return t.goal_id;
  if (t.plan_id != null) return plansById.get(t.plan_id)?.goal_id ?? null;
  return null;
}

/** The plan's work: its own tasks plus every descendant, since a step may carry no plan_id. */
export function planTaskIds(tasks: PfTask[], planId: number, kids = childrenIndex(tasks)): Set<number> {
  return subtreeIds(tasks, tasks.filter((t) => t.plan_id === planId).map((t) => t.id), kids);
}

export function planLeafCounts(tasks: PfTask[], planId: number, kids = childrenIndex(tasks)): LeafCounts {
  return leafCounts(tasks, planTaskIds(tasks, planId, kids), kids);
}

export function goalTaskIds(
  tasks: PfTask[],
  plansById: ReadonlyMap<number, PfPlan>,
  goalId: number,
  kids = childrenIndex(tasks),
): Set<number> {
  return subtreeIds(tasks, tasks.filter((t) => goalOfTask(t, plansById) === goalId).map((t) => t.id), kids);
}

export function goalLeafCounts(
  tasks: PfTask[],
  plansById: ReadonlyMap<number, PfPlan>,
  goalId: number,
  kids = childrenIndex(tasks),
): LeafCounts {
  return leafCounts(tasks, goalTaskIds(tasks, plansById, goalId, kids), kids);
}

/**
 * The plan's roots: tasks in the plan whose parent is outside it (or absent),
 * each with the done/total leaves of its own subtree. Read the counts off the
 * whole dataset, never off what is displayed — a roll-up that changes when you
 * change a view is not a roll-up.
 */
export function planTopLevel(tasks: PfTask[], planId: number, kids = childrenIndex(tasks)): RoadmapTask[] {
  const ids = planTaskIds(tasks, planId, kids);
  return tasks
    .filter((t) => ids.has(t.id) && (t.parent_id == null || !ids.has(t.parent_id)))
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
    .map((t) => ({ task: t, counts: leafCounts(tasks, subtreeIds(tasks, [t.id], kids), kids) }));
}

const BAR_FULL = "█";
const BAR_EMPTY = "░";

/**
 * `███░░░░░░░ 3/10`. An EMPTY bar over zero leaves is not "0% done" — a plan
 * with nothing under it has nothing to measure, so it renders as a blank track
 * with `0/0` beside it and never as a filled-in claim. Same rule the meters in
 * Vault follow: absent is not zero.
 */
export function bar(counts: LeafCounts, width = 10): string {
  if (counts.total <= 0) return BAR_EMPTY.repeat(width);
  const filled = Math.round((counts.done / counts.total) * width);
  return BAR_FULL.repeat(Math.min(width, filled)) + BAR_EMPTY.repeat(Math.max(0, width - filled));
}

export function pct(counts: LeafCounts): string {
  if (counts.total <= 0) return "  -";
  return `${String(Math.round((counts.done / counts.total) * 100)).padStart(3)}`;
}

// ── the model ────────────────────────────────────────────────────────────────

export interface BoardCounts {
  /** null means "the brief did not answer" — never 0, which would read as "nothing open". */
  open: number | null;
  roots: number | null;
  active: number | null;
  overdue: number | null;
}

/** A plan's top-level task, with the leaf counts of its own subtree. */
export interface RoadmapTask {
  task: PfTask;
  counts: LeafCounts;
}

export interface RoadmapPlan {
  id: number;
  title: string;
  status: string;
  deadline: string | null;
  counts: LeafCounts;
  tasks: RoadmapTask[];
}

export interface RoadmapGoal {
  /** null is the synthetic bucket for plans and work that reach no goal. */
  id: number | null;
  title: string;
  status: string;
  priority: string | null;
  deadline: string | null;
  counts: LeafCounts;
  plans: RoadmapPlan[];
}

export interface BoardModel {
  tasks: PfTask[];
  plans: PfPlan[];
  goals: RoadmapGoal[];
  counts: BoardCounts;
  today: string;
  /** True when `loadTasks()` came back at the row cap — every count below is a floor. */
  capped: boolean;
  /** Non-null when `pf_agent_brief` failed; the headline numbers are then unknown, not zero. */
  briefError: string | null;
  loadedAt: Date;
}

export interface BriefShape {
  counts?: { open_tasks?: number; open_root_tasks?: number; active?: number; overdue?: number } | null;
  goals?: Array<{ id?: number; title?: string; status?: string; priority?: string | null; deadline?: string | null }> | null;
}

const NO_GOAL_TITLE = "(no goal)";

export interface BuildModelInput {
  tasks: PfTask[];
  plans: PfPlan[];
  goals: PfGoal[];
  brief: BriefShape | null;
  briefError?: string | null;
  capped?: boolean;
  today?: string;
  loadedAt?: Date;
}

/**
 * Folds one snapshot into what the four panes render.
 *
 * Goal `priority` and `deadline` come from the brief: `loadGoals()` in
 * @nexus/core/pathfinder selects only `id, title, status`, and widening that
 * shared read is not this CLI's call to make. A goal the brief did not mention
 * keeps null for both rather than a guessed default.
 */
export function buildModel(input: BuildModelInput): BoardModel {
  const { tasks, plans, goals, brief } = input;
  const kids = childrenIndex(tasks);
  const plansById = new Map(plans.map((p) => [p.id, p]));

  const briefGoals = new Map<number, { priority: string | null; deadline: string | null; status?: string; title?: string }>();
  for (const g of brief?.goals ?? []) {
    if (typeof g?.id !== "number") continue;
    briefGoals.set(g.id, { priority: g.priority ?? null, deadline: g.deadline ?? null, status: g.status, title: g.title });
  }

  const plansForGoal = (goalId: number | null): RoadmapPlan[] =>
    plans
      .filter((p) => (p.goal_id ?? null) === goalId)
      .map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        deadline: p.deadline,
        counts: planLeafCounts(tasks, p.id, kids),
        tasks: planTopLevel(tasks, p.id, kids),
      }))
      .sort((a, b) => a.title.localeCompare(b.title) || a.id - b.id);

  const seenGoalIds = new Set<number>();
  const rows: RoadmapGoal[] = [];
  for (const g of goals) {
    seenGoalIds.add(g.id);
    const meta = briefGoals.get(g.id);
    rows.push({
      id: g.id,
      title: g.title,
      status: g.status,
      priority: meta?.priority ?? null,
      deadline: meta?.deadline ?? null,
      counts: goalLeafCounts(tasks, plansById, g.id, kids),
      plans: plansForGoal(g.id),
    });
  }
  // A goal the brief knows and loadGoals() did not return still belongs on the
  // roadmap — silently dropping it would read as "that goal does not exist".
  for (const [id, meta] of briefGoals) {
    if (seenGoalIds.has(id)) continue;
    rows.push({
      id,
      title: meta.title ?? `goal ${id}`,
      status: meta.status ?? "active",
      priority: meta.priority,
      deadline: meta.deadline,
      counts: goalLeafCounts(tasks, plansById, id, kids),
      plans: plansForGoal(id),
    });
  }
  rows.sort((a, b) => a.title.localeCompare(b.title) || (a.id ?? 0) - (b.id ?? 0));

  // ⚠️ The "(no goal)" bucket is what is LEFT OVER, not "tasks whose goal is
  // null". A step carries neither `plan_id` nor `goal_id` of its own — 101 and
  // 102 in the fixture — so it reaches no goal directly while sitting squarely
  // inside its ancestor's goal closure. Taking the second reading counts it
  // twice, and the goal totals on the Roadmap and Progress panes stop summing to
  // the work that exists.
  const claimed = new Set<number>();
  for (const g of rows) {
    if (g.id == null) continue;
    for (const id of goalTaskIds(tasks, plansById, g.id, kids)) claimed.add(id);
  }
  const orphanPlans = plansForGoal(null);
  const orphanTaskIds = new Set(tasks.filter((t) => !claimed.has(t.id)).map((t) => t.id));
  if (orphanPlans.length || orphanTaskIds.size) {
    rows.push({
      id: null,
      title: NO_GOAL_TITLE,
      status: "",
      priority: null,
      deadline: null,
      counts: leafCounts(tasks, orphanTaskIds, kids),
      plans: orphanPlans,
    });
  }

  const c = brief?.counts ?? null;
  const n = (v: unknown): number | null => (typeof v === "number" ? v : null);

  return {
    tasks,
    plans,
    goals: rows,
    counts: {
      open: n(c?.open_tasks),
      roots: n(c?.open_root_tasks),
      active: n(c?.active),
      overdue: n(c?.overdue),
    },
    today: input.today ?? todayIso(),
    capped: input.capped ?? false,
    briefError: input.briefError ?? null,
    loadedAt: input.loadedAt ?? new Date(),
  };
}

// ── the buckets ──────────────────────────────────────────────────────────────

/** In flight: stage `active`, plus anything open that is due today or already past. */
export function isCurrent(t: PfTask, today: string): boolean {
  if (t.done) return false;
  if (t.planning?.stage === "active") return true;
  const due = comparableDue(t);
  return due != null && due <= today;
}

export function isOverdue(t: PfTask, today: string): boolean {
  const due = comparableDue(t);
  return due != null && due < today;
}

/** Overdue first, then by due date, then by urgency. Ties break by id so the order is stable. */
export function currentTasks(tasks: PfTask[], today: string): PfTask[] {
  return tasks
    .filter((t) => isCurrent(t, today))
    .sort(
      (a, b) =>
        Number(isOverdue(b, today)) - Number(isOverdue(a, today)) ||
        byDue(a, b) ||
        urgencyRank(a) - urgencyRank(b) ||
        a.id - b.id,
    );
}

export interface UpcomingGroups {
  week: PfTask[];
  later: PfTask[];
  undated: PfTask[];
}

/** Days ahead that still count as "this week". */
export const WEEK_HORIZON_DAYS = 7;

/**
 * Open work that is not already in Current — so the two panes partition the open
 * backlog instead of showing the same overdue task twice.
 *
 * A due date the database holds but that is not a real calendar date buckets as
 * undated: it cannot be compared, and pretending it can would sort it somewhere
 * arbitrary. The raw value still renders in the row, so it is visible.
 */
export function upcomingGroups(tasks: PfTask[], today: string, horizonDays = WEEK_HORIZON_DAYS): UpcomingGroups {
  const horizon = addDays(today, horizonDays);
  const out: UpcomingGroups = { week: [], later: [], undated: [] };
  for (const t of tasks) {
    if (t.done || isCurrent(t, today)) continue;
    const due = comparableDue(t);
    if (due == null) out.undated.push(t);
    else if (due <= horizon) out.week.push(t);
    else out.later.push(t);
  }
  const dated = (a: PfTask, b: PfTask) => byDue(a, b) || priorityRank(a) - priorityRank(b) || a.id - b.id;
  out.week.sort(dated);
  out.later.sort(dated);
  out.undated.sort((a, b) => priorityRank(a) - priorityRank(b) || a.id - b.id);
  return out;
}

// ── rows ─────────────────────────────────────────────────────────────────────

export type PaneId = "roadmap" | "current" | "upcoming" | "progress";
export const PANES: PaneId[] = ["roadmap", "current", "upcoming", "progress"];
export const PANE_LABELS: Record<PaneId, string> = {
  roadmap: "Roadmap",
  current: "Current",
  upcoming: "Upcoming",
  progress: "Progress",
};

export interface ColumnSpec {
  label: string;
  width: number;
  align?: "right";
  /** Terminal width below which this column is dropped. Undefined = always shown. */
  minCols?: number;
}

/** id and title are drawn by the renderer; these are the columns after the title. */
export const PANE_COLUMNS: Record<PaneId, ColumnSpec[]> = {
  roadmap: [
    { label: "progress", width: 10 },
    { label: "%", width: 3, align: "right" },
    { label: "done/total", width: 10, align: "right" },
    { label: "status", width: 9, minCols: 92 },
    { label: "deadline", width: 10, minCols: 100 },
  ],
  current: [
    { label: "due", width: 10 },
    { label: "urg", width: 6 },
    { label: "kanban", width: 11, minCols: 90 },
    { label: "plan", width: 18, minCols: 100 },
  ],
  upcoming: [
    { label: "due", width: 10 },
    { label: "pri", width: 6 },
    { label: "stage", width: 9, minCols: 90 },
    { label: "plan", width: 18, minCols: 100 },
  ],
  progress: [
    { label: "progress", width: 10 },
    { label: "%", width: 3, align: "right" },
    { label: "done/total", width: 10, align: "right" },
  ],
};

export interface BoardRow {
  /** Stable across refreshes: selection and expansion survive a re-fetch. */
  key: string;
  kind: "goal" | "plan" | "task" | "group" | "note";
  depth: number;
  expandable: boolean;
  expanded: boolean;
  id: number | null;
  title: string;
  cells: string[];
  /** Present on task rows only — the only rows a write can act on. */
  task?: PfTask;
  /** The plan a task added while this row is selected inherits. */
  planId: number | null;
}

function fmtCounts(c: LeafCounts): string {
  return `${c.done}/${c.total}`;
}

export function matches(filter: string, ...fields: Array<string | null | undefined>): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

function taskRow(t: PfTask, pane: PaneId, depth: number, planId: number | null): BoardRow {
  const cells =
    pane === "current"
      ? [t.due_date ?? "", t.planning?.urgency ?? "", t.kanban_status, t.plan_title ?? ""]
      : [t.due_date ?? "", t.priority, t.planning?.stage ?? "", t.plan_title ?? ""];
  return {
    key: `t:${t.id}`,
    kind: "task",
    depth,
    expandable: false,
    expanded: false,
    id: t.id,
    title: `${t.done ? "[x] " : "[ ] "}${t.title}`,
    cells,
    task: t,
    planId: planId ?? t.plan_id,
  };
}

/**
 * Goal → plan → top-level tasks. Under a filter an ancestor is kept when a
 * descendant matches and is force-expanded, so a search never hides the row it
 * found behind a collapsed parent.
 */
export function roadmapRows(model: BoardModel, expanded: ReadonlySet<string>, filter = ""): BoardRow[] {
  const rows: BoardRow[] = [];
  const q = filter.trim();
  for (const g of model.goals) {
    const gKey = g.id == null ? "g:none" : `g:${g.id}`;
    const goalHit = matches(q, g.title);

    const planEntries = g.plans.map((p) => {
      const planHit = goalHit || matches(q, p.title);
      const taskHits = p.tasks.filter((rt) => planHit || matches(q, rt.task.title));
      return { plan: p, keep: !q || planHit || taskHits.length > 0, tasks: q && !planHit ? taskHits : p.tasks };
    });
    const keptPlans = planEntries.filter((e) => e.keep);
    if (q && !goalHit && keptPlans.length === 0) continue;

    const gExpanded = q ? true : expanded.has(gKey);
    rows.push({
      key: gKey,
      kind: "goal",
      depth: 0,
      expandable: keptPlans.length > 0,
      expanded: gExpanded,
      id: g.id,
      title: g.title,
      cells: [bar(g.counts), pct(g.counts), fmtCounts(g.counts), g.status, g.deadline ?? ""],
      planId: null,
    });
    if (!gExpanded) continue;

    for (const { plan: p, tasks } of keptPlans) {
      const pKey = `p:${p.id}`;
      const pExpanded = q ? true : expanded.has(pKey);
      rows.push({
        key: pKey,
        kind: "plan",
        depth: 1,
        expandable: tasks.length > 0,
        expanded: pExpanded,
        id: p.id,
        title: p.title,
        cells: [bar(p.counts), pct(p.counts), fmtCounts(p.counts), p.status, p.deadline ?? ""],
        planId: p.id,
      });
      if (!pExpanded) continue;
      for (const { task: t, counts } of tasks) {
        rows.push({
          ...taskRow(t, "roadmap", 2, p.id),
          // Stable under the plan it is shown beneath: the same task may be a
          // top-level task of exactly one plan, but the prefix keeps the key
          // unambiguous if that ever stops being true.
          key: `p:${p.id}:t:${t.id}`,
          cells: [bar(counts), pct(counts), fmtCounts(counts), t.planning?.stage ?? t.kanban_status, t.due_date ?? ""],
        });
      }
    }
  }
  return rows;
}

export function currentRows(model: BoardModel, filter = ""): BoardRow[] {
  const list = currentTasks(model.tasks, model.today).filter((t) => matches(filter, t.title, t.plan_title));
  if (!list.length) return [emptyNote("nothing active and nothing due — Upcoming has the rest")];
  return list.map((t) => taskRow(t, "current", 0, t.plan_id));
}

export function upcomingRows(model: BoardModel, filter = ""): BoardRow[] {
  const g = upcomingGroups(model.tasks, model.today);
  const rows: BoardRow[] = [];
  const section = (label: string, key: string, list: PfTask[]) => {
    const kept = list.filter((t) => matches(filter, t.title, t.plan_title));
    rows.push({
      key: `grp:${key}`,
      kind: "group",
      depth: 0,
      expandable: false,
      expanded: true,
      id: null,
      title: `${label} (${kept.length})`,
      cells: [],
      planId: null,
    });
    for (const t of kept) rows.push(taskRow(t, "upcoming", 1, t.plan_id));
  };
  section(`due within ${WEEK_HORIZON_DAYS} days`, "week", g.week);
  section("due later", "later", g.later);
  section("no date", "undated", g.undated);
  return rows;
}

export function progressRows(model: BoardModel, filter = ""): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const g of model.goals) {
    if (!matches(filter, g.title)) continue;
    rows.push({
      key: g.id == null ? "pg:none" : `pg:${g.id}`,
      kind: "goal",
      depth: 0,
      expandable: false,
      expanded: false,
      id: g.id,
      title: g.title,
      cells: [bar(g.counts), pct(g.counts), fmtCounts(g.counts)],
      planId: null,
    });
  }
  if (!rows.length) rows.push(emptyNote("no goals match"));
  return rows;
}

function emptyNote(text: string): BoardRow {
  return { key: `note:${text}`, kind: "note", depth: 0, expandable: false, expanded: false, id: null, title: text, cells: [], planId: null };
}

export function rowsFor(pane: PaneId, model: BoardModel, expanded: ReadonlySet<string>, filter = ""): BoardRow[] {
  switch (pane) {
    case "roadmap":
      return roadmapRows(model, expanded, filter);
    case "current":
      return currentRows(model, filter);
    case "upcoming":
      return upcomingRows(model, filter);
    case "progress":
      return progressRows(model, filter);
  }
}

/** The headline line of the Progress pane. `?` where the brief did not answer. */
export function headlineCounts(model: BoardModel): string {
  const v = (n: number | null) => (n == null ? "?" : String(n));
  return `open ${v(model.counts.open)}  roots ${v(model.counts.roots)}  active ${v(model.counts.active)}  overdue ${v(model.counts.overdue)}`;
}

/**
 * The slice of rows a viewport of `size` lines shows with `selected` inside it.
 *
 * Stateless, so it cannot implement "scroll only once the cursor reaches the
 * edge" — that needs to remember where the window was. It centres the selection
 * and clamps to the ends instead, which is the behaviour that does not depend on
 * how you arrived at a row: jumping to a row with `/` and walking to it with `j`
 * land on the same screen.
 */
export function scrollWindow(count: number, selected: number, size: number): { start: number; end: number } {
  if (size <= 0 || count <= 0) return { start: 0, end: 0 };
  if (count <= size) return { start: 0, end: count };
  const wanted = Math.max(0, selected) - Math.floor(size / 2);
  const start = Math.min(Math.max(0, wanted), count - size);
  return { start, end: start + size };
}

/** Clamps a selection into a row list; -1 when there is nothing selectable. */
export function clampSelection(count: number, index: number): number {
  if (count <= 0) return -1;
  return Math.min(Math.max(0, index), count - 1);
}
