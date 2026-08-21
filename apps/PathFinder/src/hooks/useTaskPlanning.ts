// Reads and mutations for the three planning stages: breaking a task down,
// committing calendar time to it, and logging the work that measures completion.
//
// The plain task list already lives in useTasks.ts and stays there — these hooks
// cover only what the planner needs on top of it.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addSubtask, patchTask, setTaskParent, setTaskStage, setTaskMatrix,
  getTaskScheduling, getTaskBlocks, getTaskSessions,
  logTaskSession, unlogTaskOccurrence, deleteTaskSession,
  createCalBlock, deleteCalBlock, createRecurringCalBlock, deleteRecurringCalBlock,
} from "../lib/api";
import { qk } from "../lib/queryClient";
import { applyTaskPatch } from "../lib/taskTree";
import type {
  Priority, Urgency, TaskStage, TaskWithContext, Task,
} from "../types";

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * Committed minutes per task across the whole board.
 *
 * One query feeds every coverage readout in the UI — the row badges, the matrix
 * cells and the stage gate. Kept board-wide rather than per-task so opening the
 * board doesn't fan out one request per row.
 */
export function useTaskScheduling() {
  return useQuery({
    queryKey: qk.taskScheduling,
    queryFn: () => getTaskScheduling(),
    staleTime: 30_000,
  });
}

/** The calendar commitments of a subtree — the planner's schedule list. */
export function useTaskBlocks(rootId: number | null, subtreeIds: number[]) {
  return useQuery({
    queryKey: qk.taskBlocks(rootId ?? -1),
    queryFn: () => getTaskBlocks(subtreeIds),
    enabled: rootId != null && subtreeIds.length > 0,
  });
}

/** The work-session ledger of a subtree — what drives sessions/time progress. */
export function useTaskSessions(rootId: number | null, subtreeIds: number[]) {
  return useQuery({
    queryKey: qk.taskSessions(rootId ?? -1),
    queryFn: () => getTaskSessions(subtreeIds),
    enabled: rootId != null && subtreeIds.length > 0,
  });
}

// ── Mutation plumbing ────────────────────────────────────────────────────────

/**
 * Invalidates every read a planning mutation can affect.
 *
 * Breakdown, scheduling and completion are entangled by design — adding a
 * subtask changes the parent's rolled-up estimate, scheduling it changes the
 * parent's coverage and therefore whether the parent may go active. Refreshing
 * the whole set is the honest move; these are four small queries.
 */
function useInvalidatePlanning(rootId: number | null) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.tasks });
    qc.invalidateQueries({ queryKey: qk.taskScheduling });
    if (rootId != null) {
      qc.invalidateQueries({ queryKey: qk.taskBlocks(rootId) });
      qc.invalidateQueries({ queryKey: qk.taskSessions(rootId) });
    }
  };
}

// ── Breakdown ────────────────────────────────────────────────────────────────

export function useAddSubtask(rootId: number | null) {
  const done = useInvalidatePlanning(rootId);
  return useMutation({
    mutationFn: (v: { parentId: number; title: string; time_estimate?: number | null }) =>
      addSubtask(v.parentId, v.title, { time_estimate: v.time_estimate ?? null }),
    onSuccess: done,
  });
}

/**
 * Patches one field of one task.
 *
 * Optimistic against the tasks cache so typing an estimate or picking a date in
 * the breakdown tree doesn't wait on a round-trip and doesn't make the row jump
 * as the list re-sorts underneath the cursor.
 */
export function usePatchTask(rootId: number | null) {
  const optimistic = useOptimisticPatch(rootId);
  return useMutation<Task, unknown, { id: number; patch: Record<string, unknown> }, PatchCtx>({
    mutationFn: ({ id, patch }) => patchTask(id, patch as any),
    ...optimistic(({ id, patch }) => ({ id, patch })),
  });
}

type PatchCtx = { prev?: TaskWithContext[] };

/**
 * Shared optimistic plumbing for anything that patches a task.
 *
 * `applyTaskPatch` routes each key to the right level of the hierarchy, so a
 * planning attribute lands under `planning` rather than as a dead property on
 * the task — without it the matrix pad and stage rail appear frozen until the
 * refetch returns.
 */
function useOptimisticPatch(rootId: number | null) {
  const qc = useQueryClient();
  const done = useInvalidatePlanning(rootId);

  return <TVars>(toPatch: (vars: TVars) => { id: number; patch: Record<string, unknown> }) => ({
    onMutate: async (vars: TVars): Promise<PatchCtx> => {
      const { id, patch } = toPatch(vars);
      await qc.cancelQueries({ queryKey: qk.tasks });
      const prev = qc.getQueryData<TaskWithContext[]>(qk.tasks);
      if (prev) {
        qc.setQueryData<TaskWithContext[]>(
          qk.tasks,
          prev.map((t) => (t.id === id ? applyTaskPatch(t, patch) : t)),
        );
      }
      return { prev };
    },
    onError: (_e: unknown, _v: TVars, ctx?: PatchCtx) => {
      if (ctx?.prev) qc.setQueryData(qk.tasks, ctx.prev);
    },
    onSettled: done,
  });
}

export function useSetTaskParent(rootId: number | null) {
  const done = useInvalidatePlanning(rootId);
  return useMutation({
    mutationFn: (v: { id: number; parentId: number | null }) => setTaskParent(v.id, v.parentId),
    onSuccess: done,
  });
}

/** Both axes in one action. Optimistic — a matrix drag that lags reads as broken. */
export function useSetTaskMatrix(rootId: number | null = null) {
  const optimistic = useOptimisticPatch(rootId);
  return useMutation<Task, unknown, { id: number; importance: Priority; urgency: Urgency }, PatchCtx>({
    mutationFn: (v) => setTaskMatrix(v.id, v.importance, v.urgency),
    ...optimistic((v) => ({ id: v.id, patch: { priority: v.importance, urgency: v.urgency } })),
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Advances a task's stage. Rejects `active` for an unscheduled task — the error
 * surfaces as a message the caller shows, rather than a silent no-op, because a
 * gate that fails quietly reads as a broken button.
 */
export function useSetTaskStage(rootId: number | null = null) {
  const optimistic = useOptimisticPatch(rootId);
  return useMutation<Task, unknown, { id: number; stage: TaskStage }, PatchCtx>({
    mutationFn: (v) => setTaskStage(v.id, v.stage),
    // Optimistic, and rolled back by onError when the gate refuses — so a
    // rejected move visibly snaps back *and* the caller gets the reason.
    ...optimistic((v) => ({
      id: v.id,
      patch: v.stage === "done" ? { stage: v.stage, done: true } : { stage: v.stage },
    })),
  });
}

// ── Scheduling ───────────────────────────────────────────────────────────────

export function useScheduleTask(rootId: number | null) {
  const done = useInvalidatePlanning(rootId);
  return useMutation({
    mutationFn: (v: {
      taskId: number; title: string; date: string;
      startTime: string; endTime: string; color: string;
    }) => createCalBlock(v.date, v.title, v.startTime, v.endTime, v.color, null, null, v.taskId),
    onSuccess: done,
  });
}

/** Commits a repeating series to a task — the recurrence half of the ask. */
export function useScheduleTaskSeries(rootId: number | null) {
  const done = useInvalidatePlanning(rootId);
  return useMutation({
    mutationFn: (v: {
      taskId: number; title: string; startTime: string; endTime: string; color: string;
      recurrence: string; daysOfWeek: string | null; startDate: string; endDate: string | null;
    }) => createRecurringCalBlock(
      v.title, v.startTime, v.endTime, v.color, v.recurrence,
      v.daysOfWeek, v.startDate, v.endDate, null, null, v.taskId,
    ),
    onSuccess: done,
  });
}

/** Removes a commitment. Negative ids are recurring series (see expandRecurring). */
export function useUnscheduleTask(rootId: number | null) {
  const done = useInvalidatePlanning(rootId);
  return useMutation({
    mutationFn: (v: { id: number; recurringId: number | null }) =>
      v.recurringId != null ? deleteRecurringCalBlock(v.recurringId) : deleteCalBlock(v.id),
    onSuccess: done,
  });
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export function useLogSession(rootId: number | null) {
  const done = useInvalidatePlanning(rootId);
  return useMutation({
    mutationFn: (v: {
      task_id: number; date: string; minutes: number;
      cal_block_id?: number | null; note?: string | null;
    }) => logTaskSession(v),
    onSuccess: done,
  });
}

export function useUnlogOccurrence(rootId: number | null) {
  const done = useInvalidatePlanning(rootId);
  return useMutation({
    mutationFn: (v: { taskId: number; calBlockId: number }) =>
      unlogTaskOccurrence(v.taskId, v.calBlockId),
    onSuccess: done,
  });
}

export function useDeleteSession(rootId: number | null) {
  const done = useInvalidatePlanning(rootId);
  return useMutation({ mutationFn: (id: number) => deleteTaskSession(id), onSuccess: done });
}
