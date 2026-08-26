import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAllTasks, getPlans, createTask, updateTask, toggleTask, deleteTask,
  moveTask, reorderTasks, setTaskKanbanStatus, patchTask,
} from "../lib/api";
import { qk } from "../lib/queryClient";
import type { TaskWithContext, Plan, Priority } from "../types";

// ── Reads ────────────────────────────────────────────────────────────────────

export function useTasks() {
  return useQuery({ queryKey: qk.tasks, queryFn: getAllTasks });
}

export function usePlans() {
  return useQuery({ queryKey: qk.plans, queryFn: getPlans });
}

// ── Optimistic-mutation plumbing ─────────────────────────────────────────────
//
// Every task mutation patches the cached ["tasks"] list *before* the network
// round-trip and rolls back on error, so the UI feels instant and survives a
// dropped request. onSettled reconciles with the server (picks up server-side
// fields like plan_title, sort_order, computed goal linkage).

type TasksCtx = { prev?: TaskWithContext[] };

/** Shared optimistic hook: apply `patch` to the tasks cache, run `mutationFn`, roll back on error. */
function useTaskMutation<TVars>(
  mutationFn: (vars: TVars) => Promise<unknown>,
  patch: (tasks: TaskWithContext[], vars: TVars) => TaskWithContext[],
) {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, TVars, TasksCtx>({
    mutationFn,
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: qk.tasks });
      const prev = qc.getQueryData<TaskWithContext[]>(qk.tasks);
      if (prev) qc.setQueryData<TaskWithContext[]>(qk.tasks, patch(prev, vars));
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.tasks, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.tasks }),
  });
}

export function useToggleTask() {
  return useTaskMutation<number>(
    (id) => toggleTask(id),
    (tasks, id) => tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
  );
}

export function useDeleteTask() {
  return useTaskMutation<number>(
    (id) => deleteTask(id),
    (tasks, id) => tasks.filter((t) => t.id !== id),
  );
}

export type TaskPatch = {
  id: number;
  title: string;
  priority: Priority;
  due_date?: string | null;
  time_estimate?: number | null;
};

export function useUpdateTask() {
  return useTaskMutation<TaskPatch>(
    ({ id, ...p }) => updateTask(id, p),
    (tasks, { id, ...p }) => tasks.map((t) => (t.id === id ? { ...t, ...p } : t)),
  );
}

/** Reschedule is just a due_date update; kept separate for a clearer call site. */
export function useRescheduleTask() {
  return useTaskMutation<{ task: TaskWithContext; due_date: string | null }>(
    ({ task, due_date }) =>
      updateTask(task.id, {
        title: task.title,
        priority: task.priority,
        due_date,
        time_estimate: task.time_estimate,
      }),
    (tasks, { task, due_date }) =>
      tasks.map((t) => (t.id === task.id ? { ...t, due_date } : t)),
  );
}

export function useMoveTask(plans: Plan[]) {
  return useTaskMutation<{ id: number; planId: number | null }>(
    ({ id, planId }) => moveTask(id, planId),
    (tasks, { id, planId }) => {
      const plan = plans.find((p) => p.id === planId) ?? null;
      return tasks.map((t) =>
        t.id === id
          ? { ...t, plan_id: planId, plan_title: plan?.title ?? null, goal_id: plan?.goal_id ?? t.goal_id }
          : t,
      );
    },
  );
}

/** Set kanban status — used by the Status-lens drag-and-drop. */
export function useSetKanbanStatus() {
  return useTaskMutation<{ id: number; status: string }>(
    ({ id, status }) => setTaskKanbanStatus(id, status),
    (tasks, { id, status }) => tasks.map((t) => (t.id === id ? { ...t, kanban_status: status } : t)),
  );
}

/** Set priority — used by the Priority-lens drag-and-drop. */
export function useSetPriority() {
  return useTaskMutation<{ task: TaskWithContext; priority: Priority }>(
    ({ task, priority }) =>
      updateTask(task.id, {
        title: task.title,
        priority,
        due_date: task.due_date,
        time_estimate: task.time_estimate,
      }),
    (tasks, { task, priority }) =>
      tasks.map((t) => (t.id === task.id ? { ...t, priority } : t)),
  );
}

/** Set who a team task is for — null = unassigned, "all" = everyone, else a member's uid. */
export function useSetAssignee() {
  return useTaskMutation<{ id: number; assigned_to: string | null }>(
    ({ id, assigned_to }) => patchTask(id, { assigned_to }),
    (tasks, { id, assigned_to }) => tasks.map((t) => (t.id === id ? { ...t, assigned_to } : t)),
  );
}

export function useReorderTasks() {
  return useTaskMutation<number[]>(
    (orderedIds) => reorderTasks(orderedIds),
    (tasks, orderedIds) => {
      const rank = new Map(orderedIds.map((id, i) => [id, i]));
      return tasks.map((t) => (rank.has(t.id) ? { ...t, sort_order: rank.get(t.id)! } : t));
    },
  );
}

// Create can't be optimistic (server assigns id + denormalized context); just
// invalidate so the new row streams in.
export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTask,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tasks }),
  });
}
