// Tasks: the ISA hierarchy, breakdown, scheduling coverage and the work-session ledger.

import {
  TASK_SELECT, TASK_SELECT_CTX, err, expandRecurring, mapPlanning, mapTask, mapTaskSession, mapTaskWithContext, num, supabase, getUserId,
} from "./_shared";
import type {
  CalBlock, CompletionMode, Priority, SystemEntry, Task, TaskCoverage, TaskPlanning, TaskSession, TaskStage, TaskType, TaskWithContext, Urgency,
} from "../../types";
import { coverageByTask } from "../taskTree";
import { createSystem } from "./systems";

// ═══════════════════════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════════════════════

export const getTasks = async (planId: number): Promise<Task[]> => {
  const { data, error } = await supabase
    .from("pf_tasks")
    .select(TASK_SELECT)
    .eq("plan_id", planId)
    .order("sort_order");
  if (error) err(error);
  return (data ?? []).map(mapTask);
};

export const getAllTasks = async (): Promise<TaskWithContext[]> => {
  const { data, error } = await supabase
    .from("pf_tasks")
    .select(TASK_SELECT_CTX)
    .eq("user_id", getUserId())
    .order("created_at", { ascending: false });
  if (error) err(error);
  return (data ?? []).map((r) => mapTaskWithContext(r));
};

/**
 * Which columns live on the supertype. Anything else in a patch belongs to the
 * `task` subtype and is routed to pf_task_planning — see `splitPatch`.
 */
const BASE_COLUMNS = new Set([
  "plan_id", "parent_id", "title", "done", "sort_order", "priority",
  "due_date", "time_estimate", "kanban_status", "category",
]);

/**
 * Splits a flat patch across the hierarchy.
 *
 * Callers think in terms of "a task" and shouldn't have to know which relation
 * each attribute lives in. `task_type` and `aggregate_estimate` are dropped —
 * both are database-maintained (a generated column and a trigger), and writing
 * either would either error or be silently overwritten.
 */
function splitPatch(patch: Record<string, any>) {
  const base: Record<string, any> = {};
  const planning: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === "task_type" || k === "aggregate_estimate" || k === "planning") continue;
    if (BASE_COLUMNS.has(k)) base[k] = v;
    else planning[k] = v;
  }
  return { base, planning };
}

export const createTask = async (payload: {
  plan_id?: number | null; title: string; priority?: string;
  due_date?: string | null; time_estimate?: number | null;
  category?: string | null;
  parent_id?: number | null; urgency?: Urgency; stage?: TaskStage;
  completion_mode?: CompletionMode; target_count?: number | null;
  notes?: string | null; sort_order?: number;
}): Promise<Task> => {
  const { base, planning } = splitPatch(payload);

  const { data, error } = await supabase
    .from("pf_tasks")
    .insert({ user_id: getUserId(), ...base })
    .select(TASK_SELECT)
    .single();
  if (error) err(error);

  // The planning row is created by a database trigger for every 'task'-type row,
  // so this only has to fill in non-default attributes — and only when the row
  // actually has a planning relation to fill.
  const created = mapTask(data!);
  if (Object.keys(planning).length > 0 && created.task_type === "task") {
    return updateTaskPlanning(created.id, planning);
  }
  return created;
};

export const updateTask = async (id: number, payload: {
  title: string; priority: string; due_date?: string | null; time_estimate?: number | null;
  category?: string | null;
} & Partial<TaskPlanning>): Promise<Task> => patchTask(id, payload as any);

/** Updates the `task` subtype's row and returns the whole task. */
const updateTaskPlanning = async (
  id: number, planning: Record<string, any>,
): Promise<Task> => {
  const { error } = await supabase
    .from("pf_task_planning").update(planning).eq("task_id", id);
  if (error) err(error);
  return getTask(id);
};

/**
 * Lifts a freshly-created Task into the TaskWithContext shape the pages cache
 * optimistically.
 *
 * Pages used to hand-write this object literal, which meant every column added
 * to the supertype silently produced a half-populated task in their local state
 * until someone noticed. Going through here keeps them in step.
 */
export const toTaskWithContext = (
  t: Task,
  ctx?: { plan_title?: string | null; goal_id?: number | null; goal_title?: string | null },
): TaskWithContext => ({
  ...t,
  plan_title: ctx?.plan_title ?? null,
  goal_id: ctx?.goal_id ?? null,
  goal_title: ctx?.goal_title ?? null,
});

export const getTask = async (id: number): Promise<Task> => {
  const { data, error } = await supabase
    .from("pf_tasks").select(TASK_SELECT).eq("id", id).single();
  if (error) err(error);
  return mapTask(data!);
};

/**
 * Patch any subset of a task's fields, across the hierarchy.
 *
 * `updateTask` requires title+priority because every existing caller sends the
 * whole form; the breakdown UI edits one cell at a time and needs a partial.
 * Planning attributes on a sparse kind are ignored rather than erroring — a
 * reminder has no planning row by design, and refusing the write would make
 * generic call sites have to branch on subtype.
 */
export const patchTask = async (
  id: number,
  patch: Partial<Omit<Task, "id" | "created_at">> & Partial<TaskPlanning>,
): Promise<Task> => {
  const { base, planning } = splitPatch(patch as Record<string, any>);

  if (Object.keys(base).length > 0) {
    const { error } = await supabase.from("pf_tasks").update(base).eq("id", id);
    if (error) err(error);
  }
  if (Object.keys(planning).length > 0) {
    const { error } = await supabase
      .from("pf_task_planning").update(planning).eq("task_id", id);
    if (error) err(error);
  }
  return getTask(id);
};

/** Both axes of the matrix at once, so a drag lands as one action. */
export const setTaskMatrix = async (
  id: number, importance: Priority, urgency: Urgency,
): Promise<Task> => patchTask(id, { priority: importance, urgency });

/**
 * Every quick task — the reminder / chore / shopping kinds.
 *
 * These are created almost entirely from Nexus Local on the phone, so they
 * arrive without a plan and without a deadline and were never meant to sit in
 * the dashboard's project-task list. One query covers all three categories;
 * callers group by `category` themselves.
 */
export const getQuickTasks = async (): Promise<Task[]> => {
  const { data, error } = await supabase
    .from("pf_tasks")
    .select(TASK_SELECT)
    .eq("user_id", getUserId())
    .not("category", "is", null)
    .order("created_at", { ascending: false });
  if (error) err(error);
  return (data ?? []).map(mapTask);
};

// ─── Sparse subtypes ────────────────────────────────────────────────────────
//
// One accessor pair per non-'task' kind. They are deliberately tiny: a reminder
// is a bell and a lead time, a shopping item is a quantity and a shop. Rows are
// created on demand rather than by trigger, because unlike planning these carry
// no defaults worth materialising — a chore with no area needs no row at all.

const SUBTYPE_TABLE: Record<Exclude<TaskType, "task">, string> = {
  reminder: "pf_task_reminders",
  chore: "pf_task_chores",
  shopping: "pf_task_shopping",
};

/** The subtype attributes of a sparse task, or null when it has no row yet. */
export const getTaskSubtype = async (
  id: number, type: Exclude<TaskType, "task">,
): Promise<Record<string, any> | null> => {
  const { data, error } = await supabase
    .from(SUBTYPE_TABLE[type]).select("*").eq("task_id", id).maybeSingle();
  if (error) err(error);
  return data ?? null;
};

/**
 * Upserts the subtype attributes of a sparse task.
 *
 * A guard trigger refuses a row whose supertype has the wrong `task_type`, so a
 * mismatched call fails loudly here rather than quietly creating a chore row
 * against a reminder.
 */
export const saveTaskSubtype = async (
  id: number, type: Exclude<TaskType, "task">, attrs: Record<string, any>,
): Promise<void> => {
  const { error } = await supabase
    .from(SUBTYPE_TABLE[type])
    .upsert({ task_id: id, user_id: getUserId(), ...attrs }, { onConflict: "task_id" });
  if (error) err(error);
};

/** All subtype rows of one sparse kind, for panels that need them in bulk. */
export const getTaskSubtypeRows = async (
  type: Exclude<TaskType, "task">,
): Promise<Record<string, any>[]> => {
  const { data, error } = await supabase
    .from(SUBTYPE_TABLE[type]).select("*").eq("user_id", getUserId());
  if (error) err(error);
  return data ?? [];
};

/**
 * Turns a chore into a recurring system, then deletes the chore.
 *
 * Recurrence lives in exactly one place — pf_systems — so a chore that should
 * come back becomes a system with `frequency: 'interval'` rather than growing a
 * second engine on pf_tasks. `interval` recurs N days after the last completion,
 * which is what a chore means; 'weekly' would pin it to a fixed weekday.
 *
 * Destructive on the task, deliberately: leaving both behind would show the
 * chore twice, once in Chores and once in Systems, with only one of them
 * recurring. The title and area survive on the system.
 */
export const promoteChoreToSystem = async (
  taskId: number, intervalDays: number,
): Promise<SystemEntry> => {
  const { data: task, error: e1 } = await supabase
    .from("pf_tasks").select("title, task_type").eq("id", taskId).single();
  if (e1) err(e1);
  if (task!.task_type !== "chore") throw "Only chores can be made recurring.";

  const sub = await getTaskSubtype(taskId, "chore");
  const area = sub?.area ? String(sub.area) : null;

  const system = await createSystem({
    title: task!.title,
    description: area ? `Area: ${area}` : null,
    frequency: "interval",
    interval_days: Math.max(1, Math.round(intervalDays)),
  });

  // Only after the system exists — a failure above must not lose the chore.
  await deleteTask(taskId);
  return system;
};

// ─── Breakdown ──────────────────────────────────────────────────────────────

/** Every task in `rootId`'s subtree, including the root itself. */
export const getSubtree = async (rootId: number): Promise<Task[]> => {
  // Recursive CTEs need an RPC; at PathFinder's scale (hundreds of tasks) it is
  // cheaper and far simpler to pull the user's tasks once and walk them here.
  const { data, error } = await supabase
    .from("pf_tasks").select(TASK_SELECT).eq("user_id", getUserId());
  if (error) err(error);
  const rows = (data ?? []).map(mapTask);

  const childrenOf = new Map<number, Task[]>();
  for (const t of rows) {
    if (t.parent_id == null) continue;
    const b = childrenOf.get(t.parent_id);
    if (b) b.push(t); else childrenOf.set(t.parent_id, [t]);
  }

  const root = rows.find((t) => t.id === rootId);
  if (!root) return [];
  const out: Task[] = [];
  const walk = (t: Task, seen: Set<number>) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    out.push(t);
    for (const c of childrenOf.get(t.id) ?? []) walk(c, seen);
  };
  walk(root, new Set());
  return out;
};

/**
 * Adds a subtask under `parentId`, inheriting the parent's plan and axes.
 *
 * Inheriting matters: a subtask of an urgent, important task is urgent and
 * important until told otherwise, and making the user re-pick both axes for
 * every child is exactly the friction that stops people breaking work down.
 */
export const addSubtask = async (
  parentId: number,
  title: string,
  opts?: { time_estimate?: number | null; due_date?: string | null },
): Promise<Task> => {
  const { data: parent, error: e1 } = await supabase
    .from("pf_tasks")
    .select("plan_id, priority, due_date, category, pf_task_planning(urgency)")
    .eq("id", parentId).single();
  if (e1) err(e1);

  const { data: siblings } = await supabase
    .from("pf_tasks").select("sort_order").eq("parent_id", parentId)
    .order("sort_order", { ascending: false }).limit(1);
  const nextOrder = (siblings?.[0]?.sort_order ?? -1) + 1;

  return createTask({
    plan_id: parent!.plan_id ? num(parent!.plan_id) : null,
    parent_id: parentId,
    title,
    priority: parent!.priority,
    // A step of a full task is itself a full task — it needs the same planning
    // surface. Breaking a chore down keeps the children chores.
    category: (parent!.category ?? null) as any,
    urgency: mapPlanning(parent)?.urgency ?? "medium",
    // A step starts with NO due date, and deliberately does not inherit the
    // parent's. Inheriting looked helpful and was actively harmful: every step
    // landed on the parent's date, so the week overview showed a task broken
    // into five steps as six separate items all due the same day. The whole
    // point of the breakdown is that steps land on their own dates — so the
    // date is something you set, not something you have to clear.
    due_date: opts?.due_date ?? null,
    time_estimate: opts?.time_estimate ?? null,
    sort_order: nextOrder,
    stage: "refine",
  });
};

/** Re-parent a task (null = promote to top level). The DB trigger rejects cycles. */
export const setTaskParent = async (id: number, parentId: number | null): Promise<Task> =>
  patchTask(id, { parent_id: parentId });

// ─── Lifecycle ──────────────────────────────────────────────────────────────

/**
 * Moves a task through the lifecycle, enforcing the one rule that makes the
 * whole thing worth having: **you cannot start work you have not scheduled.**
 *
 * The check lives here rather than in a database trigger because the predicate
 * spans three tables, and a trigger evaluating it on every task write would tax
 * unrelated bulk updates (reorder writes one row per task). This is the only
 * write path the UI uses to change `stage`.
 *
 * Only the 'task' subtype has a lifecycle at all — the sparse kinds have no
 * planning row, so there is nothing to gate and this is a no-op for them.
 */
export const setTaskStage = async (id: number, stage: TaskStage): Promise<Task> => {
  const { data: task, error: e1 } = await supabase
    .from("pf_tasks").select("task_type").eq("id", id).single();
  if (e1) err(e1);
  if (task!.task_type !== "task") return getTask(id);

  if (stage === "active") {
    const ids = (await getSubtree(id)).map((t) => t.id);
    const covered = await getTaskScheduling(ids.length ? ids : [id]);
    const total = ids.reduce((s, tid) => s + (covered.get(tid)?.scheduledMin ?? 0), 0);
    if (total === 0) {
      throw "Schedule calendar time for this task before starting it.";
    }
  }
  // Completing via the stage control should also tick the checkbox, so the two
  // representations of "done" can never disagree.
  return patchTask(id, stage === "done" ? { stage, done: true } : { stage });
};

// ─── Scheduling coverage ────────────────────────────────────────────────────

/** How far ahead an open-ended recurring series is counted as committed time. */
const RECURRING_HORIZON_DAYS = 365;

/**
 * Committed calendar minutes per task.
 *
 * One-off blocks are summed directly. Recurring series are expanded the same way
 * `getCalBlocks` expands them, over a bounded horizon — an open-ended series
 * would otherwise contribute infinite scheduled time and every task attached to
 * one would read as permanently over-committed.
 *
 * Pass `taskIds` to scope the read; omit it for every linked block.
 */
export const getTaskScheduling = async (
  taskIds?: number[],
): Promise<Map<number, TaskCoverage>> => {
  if (taskIds && taskIds.length === 0) return new Map();

  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + RECURRING_HORIZON_DAYS * 86_400_000)
    .toISOString().slice(0, 10);

  let oneOff = supabase.from("pf_cal_blocks")
    .select("id, date, start_time, end_time, task_id")
    .eq("user_id", getUserId()).not("task_id", "is", null);
  let series = supabase.from("pf_recurring_cal_blocks")
    .select("*").eq("user_id", getUserId()).not("task_id", "is", null);
  if (taskIds) {
    oneOff = oneOff.in("task_id", taskIds);
    series = series.in("task_id", taskIds);
  }

  const [{ data: blocks, error: e1 }, { data: recurring, error: e2 }] =
    await Promise.all([oneOff, series]);
  if (e1) err(e1);
  if (e2) err(e2);

  const expanded = (recurring ?? []).flatMap((r) =>
    expandRecurring(r, r.start_date > today ? r.start_date : today, horizon),
  );

  return coverageByTask([
    ...(blocks ?? []).map((b) => ({
      ...(b as any),
      date: b.date, start_time: b.start_time, end_time: b.end_time,
      task_id: b.task_id != null ? num(b.task_id) : null,
    })) as any,
    ...expanded,
  ] as any);
};

/** Every calendar commitment against a task, newest first — the planner's list. */
export const getTaskBlocks = async (taskIds: number[]): Promise<CalBlock[]> => {
  if (taskIds.length === 0) return [];
  const [{ data: blocks }, { data: recurring }] = await Promise.all([
    supabase.from("pf_cal_blocks").select("*").eq("user_id", getUserId()).in("task_id", taskIds),
    supabase.from("pf_recurring_cal_blocks").select("*").eq("user_id", getUserId()).in("task_id", taskIds),
  ]);

  const oneOff: CalBlock[] = (blocks ?? []).map((b) => ({
    id: num(b.id), date: b.date, title: b.title, start_time: b.start_time,
    end_time: b.end_time, color: b.color, description: b.description,
    location: b.location, created_at: b.created_at,
    is_recurring: false, recurring_id: null, recurrence: null,
    days_of_week: null, series_start_date: null, series_end_date: null,
    task_id: b.task_id ? num(b.task_id) : null,
    category: b.category ?? null,
  }));

  // Series are returned as a single representative entry (dated at the series
  // start) rather than every occurrence — the planner lists commitments, and a
  // three-times-weekly series is one commitment to edit, not 150 rows to scroll.
  const seriesRows: CalBlock[] = (recurring ?? []).map((r) => ({
    id: -num(r.id) * 100_000, date: r.start_date, title: r.title,
    start_time: r.start_time, end_time: r.end_time, color: r.color,
    description: r.description, location: r.location, created_at: r.created_at,
    is_recurring: true, recurring_id: num(r.id), recurrence: r.recurrence,
    days_of_week: r.days_of_week, series_start_date: r.start_date,
    series_end_date: r.end_date, task_id: r.task_id ? num(r.task_id) : null,
    category: r.category ?? null,
  }));

  return [...oneOff, ...seriesRows].sort(
    (a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time),
  );
};

// ─── Work sessions ──────────────────────────────────────────────────────────

/**
 * Every session logged in a date range, for the calendar surfaces.
 *
 * Week and Dashboard need to know which *occurrences* have been ticked off, and
 * they know their date window rather than a task list — so this is scoped by
 * date, unlike `getTaskSessions` which is scoped by subtree.
 */
export const getTaskSessionsInRange = async (
  startDate: string, endDate: string,
): Promise<TaskSession[]> => {
  const { data, error } = await supabase
    .from("pf_task_sessions").select("*")
    .eq("user_id", getUserId())
    .gte("date", startDate).lte("date", endDate);
  if (error) err(error);
  return (data ?? []).map(mapTaskSession);
};

export const getTaskSessions = async (taskIds: number[]): Promise<TaskSession[]> => {
  if (taskIds.length === 0) return [];
  const { data, error } = await supabase
    .from("pf_task_sessions").select("*")
    .eq("user_id", getUserId()).in("task_id", taskIds)
    .order("date", { ascending: false });
  if (error) err(error);
  return (data ?? []).map(mapTaskSession);
};

/**
 * Records work done on a task.
 *
 * `cal_block_id` may be the negative virtual id of a recurring occurrence — the
 * unique index on (task_id, cal_block_id) makes ticking the same occurrence
 * twice a no-op instead of double-counting, so an upsert is the right verb.
 */
export const logTaskSession = async (payload: {
  task_id: number; date: string; minutes: number;
  cal_block_id?: number | null; note?: string | null;
}): Promise<TaskSession> => {
  const row = { user_id: getUserId(), ...payload, cal_block_id: payload.cal_block_id ?? null };
  const q = payload.cal_block_id != null
    ? supabase.from("pf_task_sessions").upsert(row, { onConflict: "task_id,cal_block_id" })
    : supabase.from("pf_task_sessions").insert(row);
  const { data, error } = await q.select().single();
  if (error) err(error);
  return mapTaskSession(data!);
};

export const deleteTaskSession = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_task_sessions").delete().eq("id", id);
  if (error) err(error);
};

/** Removes the session logged against a specific calendar occurrence, if any. */
export const unlogTaskOccurrence = async (taskId: number, calBlockId: number): Promise<void> => {
  const { error } = await supabase.from("pf_task_sessions").delete()
    .eq("task_id", taskId).eq("cal_block_id", calBlockId);
  if (error) err(error);
};

export const toggleTask = async (id: number): Promise<Task> => {
  const { data: cur, error: e1 } = await supabase
    .from("pf_tasks").select("done, task_type, pf_task_planning(stage)").eq("id", id).single();
  if (e1) err(e1);

  const done = !cur!.done;
  const { error } = await supabase.from("pf_tasks").update({ done }).eq("id", id);
  if (error) err(error);

  // Keep `stage` and `done` from disagreeing — but only where a stage exists at
  // all. Un-ticking a completed task drops it back to 'active' rather than all
  // the way to 'refine': it was scheduled once, and un-ticking a box is not a
  // request to re-plan it from scratch.
  const planning = mapPlanning(cur);
  if (cur!.task_type === "task" && planning) {
    const stage = done ? "done" : planning.stage === "done" ? "active" : planning.stage;
    if (stage !== planning.stage) {
      const { error: e2 } = await supabase
        .from("pf_task_planning").update({ stage }).eq("task_id", id);
      if (e2) err(e2);
    }
  }

  return getTask(id);
};

/**
 * Deletes a task. Its subtasks go with it (ON DELETE CASCADE — a subtask has no
 * meaning without the task it decomposes).
 *
 * Calendar blocks are FK'd ON DELETE SET NULL, so they survive. That is right for
 * *past* blocks — they record time actually spent, and deleting the task should
 * not rewrite history — but a future commitment to work that no longer exists is
 * just clutter, so those are removed explicitly.
 */
export const deleteTask = async (id: number): Promise<void> => {
  const ids = (await getSubtree(id)).map((t) => t.id);
  const scope = ids.length ? ids : [id];
  const today = new Date().toISOString().slice(0, 10);

  await Promise.all([
    supabase.from("pf_cal_blocks").delete().in("task_id", scope).gte("date", today),
    supabase.from("pf_recurring_cal_blocks").delete().in("task_id", scope),
  ]);

  const { error } = await supabase.from("pf_tasks").delete().eq("id", id);
  if (error) err(error);
};

export const setTaskKanbanStatus = async (id: number, status: string): Promise<Task> => {
  const { data, error } = await supabase
    .from("pf_tasks")
    .update({ kanban_status: status })
    .eq("id", id)
    .select(TASK_SELECT)
    .single();
  if (error) err(error);
  return mapTask(data!);
};

// Move a task to a different plan (null = unassigned). Goal linkage follows the plan.
export const moveTask = async (id: number, planId: number | null): Promise<Task> => {
  const { data, error } = await supabase
    .from("pf_tasks")
    .update({ plan_id: planId })
    .eq("id", id)
    .select(TASK_SELECT)
    .single();
  if (error) err(error);
  return mapTask(data!);
};

// Persist a new ordering: assigns sort_order = position for each id in the list.
export const reorderTasks = async (orderedIds: number[]): Promise<void> => {
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("pf_tasks").update({ sort_order: index }).eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) err(failed.error);
};
