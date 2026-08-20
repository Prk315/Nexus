// Pure math for the task breakdown: building the tree, rolling estimates and
// progress up it, and deciding whether a task has earned the right to be worked
// on. No React, no network — everything here is a function of rows already read.
//
// The rule that shapes most of this file: **a parent is a summary of its
// children, never an independent number.** A task broken into subtasks has its
// estimate, its progress and its scheduling coverage derived from the leaves. Its
// own stored `time_estimate` is only consulted when it has no children. Without
// that rule a 6h parent with 4x2h children reads as 14h of work.

import type {
  CalBlock, TaskCoverage, TaskPlanning, TaskSession, TaskWithContext,
  Urgency, Priority,
} from "../types";

// ── Reading across the ISA hierarchy ─────────────────────────────────────────

/**
 * The planning attributes a sparse subtype implicitly has.
 *
 * A reminder genuinely has no planning row, and most of the UI would rather read
 * a value than branch on subtype everywhere. These defaults are the *reading*
 * convention only — nothing writes them back, so a chore never acquires a
 * planning row by being displayed. Guard real behaviour on `task_type`, not on
 * these values: `isWorkable` does exactly that.
 */
export const IMPLICIT_PLANNING: TaskPlanning = {
  urgency: "medium",
  stage: "refine",
  completion_mode: "binary",
  target_count: null,
  notes: null,
};

export function planningOf(task: TaskWithContext): TaskPlanning {
  return task.planning ?? IMPLICIT_PLANNING;
}

/** True when this task carries the full planning surface (the `task` subtype). */
export function isFullTask(task: TaskWithContext): boolean {
  return task.task_type === "task";
}

/** Attributes that live on the `task` subtype rather than the supertype. */
const PLANNING_KEYS = new Set<keyof TaskPlanning>([
  "urgency", "stage", "completion_mode", "target_count", "notes",
]);

/**
 * Applies a flat patch to a task, routing each key to the right level of the
 * hierarchy — the client-side mirror of api.ts's `splitPatch`.
 *
 * Optimistic cache updates need this. Spreading a patch containing `urgency`
 * straight onto the task would set a property nothing reads (it lives under
 * `planning`), so the matrix pad would appear not to respond until the refetch
 * landed. A patch of planning keys against a sparse subtype is ignored, matching
 * what the server does.
 */
export function applyTaskPatch(
  task: TaskWithContext,
  patch: Record<string, unknown>,
): TaskWithContext {
  const base: Record<string, unknown> = {};
  const planning: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (PLANNING_KEYS.has(k as keyof TaskPlanning)) planning[k] = v;
    else if (k !== "task_type" && k !== "aggregate_estimate" && k !== "planning") base[k] = v;
  }

  const next = { ...task, ...base } as TaskWithContext;
  if (Object.keys(planning).length > 0 && task.planning) {
    next.planning = { ...task.planning, ...planning } as TaskPlanning;
  }
  return next;
}

// ── Tree construction ────────────────────────────────────────────────────────

export interface TaskNode {
  task: TaskWithContext;
  children: TaskNode[];
  /** 0 for a top-level task, 1 for its subtasks, and so on. */
  depth: number;
}

/**
 * Builds the forest of top-level tasks from a flat list.
 *
 * A task whose `parent_id` points outside `tasks` (filtered out, or belonging to
 * another plan) is promoted to the top level rather than dropped — losing work
 * because its parent isn't in the current view would be far worse than showing
 * it one level too high.
 */
export function buildForest(tasks: TaskWithContext[]): TaskNode[] {
  const byId = new Map<number, TaskWithContext>(tasks.map((t) => [t.id, t]));
  const childrenOf = new Map<number | null, TaskWithContext[]>();

  for (const t of tasks) {
    const key = t.parent_id != null && byId.has(t.parent_id) ? t.parent_id : null;
    const bucket = childrenOf.get(key);
    if (bucket) bucket.push(t);
    else childrenOf.set(key, [t]);
  }

  // Siblings order by explicit sort_order, then by creation, so a freshly added
  // subtask lands at the bottom of its group instead of jumping around.
  const order = (a: TaskWithContext, b: TaskWithContext) =>
    a.sort_order - b.sort_order || a.id - b.id;

  const build = (parentId: number | null, depth: number, seen: Set<number>): TaskNode[] =>
    (childrenOf.get(parentId) ?? [])
      .slice()
      .sort(order)
      .filter((t) => !seen.has(t.id))
      .map((t) => {
        // The DB trigger makes cycles impossible, but this list can also come
        // from an optimistic cache mid-edit. Guarding costs one Set.
        const nextSeen = new Set(seen).add(t.id);
        return { task: t, children: build(t.id, depth + 1, nextSeen), depth };
      });

  return build(null, 0, new Set());
}

/** Every task in a subtree, parent first (pre-order). */
export function flatten(node: TaskNode): TaskNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

/** The leaves of a subtree — the tasks that carry real, non-derived numbers. */
export function leaves(node: TaskNode): TaskNode[] {
  return node.children.length === 0 ? [node] : node.children.flatMap(leaves);
}

/** Look up a node anywhere in a forest. */
export function findNode(forest: TaskNode[], id: number): TaskNode | null {
  for (const root of forest) {
    for (const n of flatten(root)) if (n.task.id === id) return n;
  }
  return null;
}

/**
 * The subtree rooted at `rootId`, as a node, taken from an already-loaded task
 * list. The planner uses this rather than re-fetching, so optimistic edits to
 * the shared tasks cache show up in the breakdown tree immediately.
 */
export function subtreeNode(tasks: TaskWithContext[], rootId: number): TaskNode | null {
  const root = tasks.find((t) => t.id === rootId);
  if (!root) return null;

  const childrenOf = new Map<number, TaskWithContext[]>();
  for (const t of tasks) {
    if (t.parent_id == null) continue;
    const b = childrenOf.get(t.parent_id);
    if (b) b.push(t); else childrenOf.set(t.parent_id, [t]);
  }

  const order = (a: TaskWithContext, b: TaskWithContext) =>
    a.sort_order - b.sort_order || a.id - b.id;

  const build = (t: TaskWithContext, depth: number, seen: Set<number>): TaskNode => ({
    task: t,
    depth,
    children: (childrenOf.get(t.id) ?? [])
      .slice().sort(order)
      .filter((c) => !seen.has(c.id))
      .map((c) => build(c, depth + 1, new Set(seen).add(c.id))),
  });

  return build(root, 0, new Set([rootId]));
}

// ── Effort roll-up ───────────────────────────────────────────────────────────

/**
 * Fallback effort used only as a *denominator*, where a zero would divide by
 * zero (the `time` completion mode). Never used to invent effort for display.
 */
export const DEFAULT_TASK_MIN = 10;

/**
 * The aggregate time estimate of a subtree — the number that belongs on a
 * primary task once it has been broken down.
 *
 *     leaf   -> its own time_estimate (0 when unset)
 *     parent -> the sum of its children's aggregates
 *
 * This deliberately mirrors, exactly, the rule the `pf_tasks.aggregate_estimate`
 * trigger uses. The database is the authority — every other consumer (the
 * Dashboard's day math, the Week overlay, the iOS widgets) reads that column —
 * and this recomputes the same value from the loaded tree so an edit shows the
 * right total immediately instead of after a refetch. If the two rules ever
 * diverge, the number visibly jumps on refresh, which is why they are stated
 * together here.
 *
 * An unset estimate contributes 0 rather than a guessed default: inventing time
 * would make a plan of ten unestimated steps look costed when it isn't. Callers
 * render 0 as "no estimate", not as "0m".
 */
export function rollupEstimate(node: TaskNode): number {
  if (node.children.length === 0) return node.task.time_estimate ?? 0;
  return node.children.reduce((sum, c) => sum + rollupEstimate(c), 0);
}

/**
 * The stored aggregate, for a task rendered without its subtree loaded.
 * Prefer `rollupEstimate` whenever the tree is in hand — it reflects
 * uncommitted optimistic edits, which the stored column cannot.
 */
export function storedAggregate(task: TaskWithContext): number {
  return task.aggregate_estimate || task.time_estimate || 0;
}

/** True when this task's estimate is derived from children rather than stored. */
export function isDerivedEstimate(node: TaskNode): boolean {
  return node.children.length > 0;
}

// ── Progress ─────────────────────────────────────────────────────────────────

export interface Progress {
  /** 0..1. */
  fraction: number;
  /** Human-readable numerator/denominator, e.g. "3/7" or "45m/2h". */
  label: string;
  done: boolean;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * How complete a single task is, ignoring its children.
 *
 * `sessions` and `time` modes read the ledger; `binary` reads the checkbox. A
 * sessions-mode task with no target behaves as binary — a target of zero would
 * otherwise divide by zero and read as 100% complete forever.
 */
export function ownProgress(task: TaskWithContext, sessions: TaskSession[]): Progress {
  const { completion_mode, target_count } = planningOf(task);

  if (completion_mode === "sessions" && (target_count ?? 0) > 0) {
    const target = target_count!;
    const count = sessions.length;
    return {
      fraction: clamp01(count / target),
      label: `${count}/${target} sessions`,
      done: task.done || count >= target,
    };
  }

  if (completion_mode === "time") {
    // A zero estimate would divide by zero and read as complete forever.
    const target = task.time_estimate || DEFAULT_TASK_MIN;
    const logged = sessions.reduce((s, x) => s + x.minutes, 0);
    return {
      fraction: clamp01(logged / target),
      label: `${formatMinutes(logged)}/${formatMinutes(target)}`,
      done: task.done || logged >= target,
    };
  }

  return { fraction: task.done ? 1 : 0, label: task.done ? "Done" : "Not started", done: task.done };
}

/**
 * How complete a subtree is.
 *
 * A parent's progress is the *effort-weighted* mean of its children, not a plain
 * count: finishing a 3h subtask should move the bar further than finishing a
 * 10-minute one. Leaves fall through to `ownProgress`.
 */
export function rollupProgress(
  node: TaskNode,
  sessionsByTask: Map<number, TaskSession[]>,
): Progress {
  if (node.children.length === 0) {
    return ownProgress(node.task, sessionsByTask.get(node.task.id) ?? []);
  }

  let weighted = 0;
  let total = 0;
  let doneCount = 0;
  for (const child of node.children) {
    const w = rollupEstimate(child);
    const p = rollupProgress(child, sessionsByTask);
    weighted += p.fraction * w;
    total += w;
    if (p.done) doneCount += 1;
  }

  const fraction = total > 0 ? clamp01(weighted / total) : 0;
  return {
    fraction,
    label: `${doneCount}/${node.children.length} subtasks`,
    // A parent is done when every child is. Its own checkbox is not the source
    // of truth once it has been broken down.
    done: doneCount === node.children.length,
  };
}

// ── Scheduling coverage ──────────────────────────────────────────────────────

/** Minutes between two "HH:MM" strings; 0 when either is unparseable. */
export function blockMinutes(startTime: string, endTime: string): number {
  const toMin = (s: string) => {
    const [h, m] = (s ?? "").split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
  };
  const a = toMin(startTime);
  const b = toMin(endTime);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  // An end before the start means the block wraps past midnight.
  return b >= a ? b - a : 24 * 60 - a + b;
}

/**
 * Groups calendar blocks by the task they commit time to.
 *
 * `blocks` should come from `getCalBlocks`, which already expands recurring
 * series into one entry per occurrence — so a Mon/Wed/Fri series over four weeks
 * correctly counts as twelve commitments, not one.
 */
export function coverageByTask(blocks: CalBlock[]): Map<number, TaskCoverage> {
  const out = new Map<number, TaskCoverage>();
  for (const b of blocks) {
    if (b.task_id == null) continue;
    const cur = out.get(b.task_id) ?? { scheduledMin: 0, blockCount: 0, firstDate: null };
    cur.scheduledMin += blockMinutes(b.start_time, b.end_time);
    cur.blockCount += 1;
    if (cur.firstDate == null || b.date < cur.firstDate) cur.firstDate = b.date;
    out.set(b.task_id, cur);
  }
  return out;
}

/**
 * Coverage for a subtree: a parent inherits every commitment made to its
 * descendants, because scheduling a subtask *is* scheduling part of the parent.
 * This is what makes partial scheduling legible — "4h of 6h committed" on the
 * parent comes entirely from blocks placed on its leaves.
 */
export function rollupCoverage(
  node: TaskNode,
  byTask: Map<number, TaskCoverage>,
): TaskCoverage {
  let scheduledMin = 0;
  let blockCount = 0;
  let firstDate: string | null = null;
  for (const n of flatten(node)) {
    const c = byTask.get(n.task.id);
    if (!c) continue;
    scheduledMin += c.scheduledMin;
    blockCount += c.blockCount;
    if (c.firstDate && (firstDate == null || c.firstDate < firstDate)) firstDate = c.firstDate;
  }
  return { scheduledMin, blockCount, firstDate };
}

/** Minutes of this subtree that still have no calendar time against them. */
export function unscheduledMinutes(node: TaskNode, byTask: Map<number, TaskCoverage>): number {
  return Math.max(0, rollupEstimate(node) - rollupCoverage(node, byTask).scheduledMin);
}

// ── The gate ─────────────────────────────────────────────────────────────────

/**
 * Whether a task may move to `active` — i.e. be worked on.
 *
 * The rule the whole lifecycle rests on: **you cannot work on what you have not
 * committed time to.**
 *
 * Only the `task` subtype is gated. The sparse kinds have no planning row and no
 * lifecycle at all — putting a shopping list behind a scheduling step would make
 * it unusable, and there is nothing there to schedule.
 */
export function isWorkable(node: TaskNode, byTask: Map<number, TaskCoverage>): boolean {
  if (!isFullTask(node.task)) return true;
  return rollupCoverage(node, byTask).scheduledMin > 0;
}

/** Why the gate is closed, for a tooltip. `null` when it is open. */
export function gateReason(node: TaskNode, byTask: Map<number, TaskCoverage>): string | null {
  if (isWorkable(node, byTask)) return null;
  return node.children.length > 0
    ? "Schedule calendar time for at least one subtask before starting this."
    : "Schedule calendar time for this task before starting it.";
}

// ── The importance x urgency matrix ──────────────────────────────────────────

export interface MatrixCell {
  importance: Priority;
  urgency: Urgency;
  key: string;
  label: string;
  /** Short prescription for the corner cells; empty for the soft middle. */
  advice: string;
}

export const AXIS: readonly ("high" | "medium" | "low")[] = ["high", "medium", "low"] as const;

/** Stable cell key so drag-and-drop targets and bucket keys never drift apart. */
export const cellKey = (importance: Priority, urgency: Urgency) => `${importance}:${urgency}`;

/** Parses a cell key back into its axes; null when the string isn't one. */
export function parseCellKey(key: string): { importance: Priority; urgency: Urgency } | null {
  const [i, u] = key.split(":");
  if (!AXIS.includes(i as Priority) || !AXIS.includes(u as Urgency)) return null;
  return { importance: i as Priority, urgency: u as Urgency };
}

/**
 * The classic Eisenhower advice, folded onto a 3x3 grid. Only the four corners
 * get a prescription — the middle row and column are genuinely ambiguous and a
 * confident-sounding label there would be noise.
 */
export function cellAdvice(importance: Priority, urgency: Urgency): string {
  if (importance === "high" && urgency === "high") return "Do now";
  if (importance === "high" && urgency === "low") return "Schedule";
  if (importance === "low" && urgency === "high") return "Do quickly";
  if (importance === "low" && urgency === "low") return "Drop or defer";
  return "";
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** "90" -> "1h30". Shared by every effort readout so they cannot drift. */
export function formatMinutes(min: number): string {
  const n = Math.max(0, Math.round(min));
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m === 0 ? `${h}h` : `${h}h${m}`;
}

/** Adds minutes to a "HH:MM" time, clamping at 23:59 rather than wrapping. */
export function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = (time ?? "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
