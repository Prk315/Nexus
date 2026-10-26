// Every write the board can make, as one dispatch over `PathfinderApi`.
//
// It is a separate module from the rendering for two reasons. It is the only
// code in the board that CHANGES anything, so it is the piece the tests have to
// pin — and they pin it against a mocked api, never the personal account. And
// keeping it out of the component means the rules ("a delete needs a confirm",
// "the gate's message is the answer") are not buried in a key handler.
//
// ⚠️ Nothing here touches a table directly. `setStage` carries the scheduling
// gate (no `active` without calendar minutes behind it) and `patchTask` splits a
// flat patch across the pf_tasks / pf_task_planning ISA hierarchy; neither rule
// exists in the database, so a raw update would break both in silence.

import type { PathfinderApi, PfTask, TaskStage } from "@nexus/core/pathfinder";

export type BoardAction =
  | { kind: "done"; task: PfTask; done: boolean }
  | { kind: "stage"; task: PfTask; stage: TaskStage }
  | { kind: "kanban"; task: PfTask; status: string }
  | { kind: "edit"; task: PfTask; title?: string; due?: string | null }
  | { kind: "delete"; task: PfTask }
  | { kind: "add"; title: string; planId: number | null };

/** Titles are long and the status line is one line. */
export function shortTitle(title: string, max = 44): string {
  return title.length > max ? `${title.slice(0, max - 1)}…` : title;
}

export function describe(a: BoardAction): string {
  switch (a.kind) {
    case "done":
      return `${a.done ? "done" : "re-opened"}: ${a.task.id} ${shortTitle(a.task.title)}`;
    case "stage":
      return `stage → ${a.stage}: ${a.task.id} ${shortTitle(a.task.title)}`;
    case "kanban":
      return `status → ${a.status}: ${a.task.id} ${shortTitle(a.task.title)}`;
    case "edit":
      return `edited: ${a.task.id} ${shortTitle(a.title ?? a.task.title)}`;
    case "delete":
      return `deleted: ${a.task.id} ${shortTitle(a.task.title)}`;
    case "add":
      return `added: ${shortTitle(a.title)}${a.planId != null ? ` (plan ${a.planId})` : ""}`;
  }
}

/**
 * Runs one action and returns the status line for it.
 *
 * Errors are NOT caught here: the caller shows the message verbatim. A
 * SchedulingGateError's text *is* the rule ("Schedule calendar time for this
 * task before starting it"), and rewording it into "couldn't set stage" would
 * throw away the only explanation the user gets.
 */
export async function runAction(api: PathfinderApi, a: BoardAction): Promise<string> {
  switch (a.kind) {
    case "done": {
      const t = await api.toggleTask(a.task.id, a.done);
      return describe({ ...a, task: t });
    }
    case "stage": {
      const t = await api.setStage(a.task.id, a.stage);
      return describe({ ...a, task: t });
    }
    case "kanban": {
      const t = await api.setKanbanStatus(a.task.id, a.status);
      return describe({ ...a, task: t, status: t.kanban_status });
    }
    case "edit": {
      const patch: Record<string, unknown> = {};
      if (a.title !== undefined && a.title !== a.task.title) patch.title = a.title;
      // An empty due date CLEARS it (null), which is different from leaving it
      // alone (undefined). Absent is not zero here either.
      if (a.due !== undefined && a.due !== a.task.due_date) patch.due_date = a.due;
      if (Object.keys(patch).length === 0) return `unchanged: ${a.task.id} ${shortTitle(a.task.title)}`;
      const t = await api.patchTask(a.task.id, patch);
      return describe({ ...a, task: t, title: t.title });
    }
    case "delete": {
      await api.deleteTask(a.task.id);
      return describe(a);
    }
    case "add": {
      const t = await api.createTask({ title: a.title, plan_id: a.planId });
      return describe({ ...a, title: t.title });
    }
  }
}

/** YYYY-MM-DD, or empty to clear. Returns undefined when the input is not usable. */
export function parseDueInput(raw: string): { due: string | null } | { error: string } {
  const s = raw.trim();
  if (!s) return { due: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    return { error: `invalid date "${s}": expected YYYY-MM-DD, or empty to clear` };
  }
  return { due: s };
}
