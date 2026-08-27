// Task quick-action orchestrators: the async glue behind TaskActionMenu's
// "Schedule today/tomorrow" and "Due today/tomorrow" items. Kept out of the
// component so it's independently testable and reusable from anywhere a task
// row wants a one-click schedule/due action (command palette, widgets, …).
//
// The actual slot math is pure and lives in `lib/quickSchedule.ts` — this
// file only does the I/O: fetch the day's blocks, ask for a slot, write it.

import { getCalBlocks, createCalBlock } from "./calendar";
import { patchTask } from "./tasks";
import { externalDragDurationMin } from "../../components/week/_shared";
import { defaultScheduleWindow, findFreeSlot, todayDateStr, tomorrowDateStr } from "../quickSchedule";
import type { CalBlock, Task } from "../../types";

export type QuickScheduleDay = "today" | "tomorrow";

export interface QuickScheduleTask {
  id: number;
  title: string;
  time_estimate: number | null;
}

/**
 * Schedules `task` into the first free slot on `day`.
 *
 * Duration comes from `externalDragDurationMin` — the SAME heuristic Week's
 * drag-to-schedule uses — called here with `task.time_estimate` standing in
 * for "unscheduled minutes" too (a quick action has no loaded task tree /
 * coverage map to compute the real subtree rollup from, unlike Week.tsx's
 * `computeDragPayload`). For a task with no estimate at all, the heuristic's
 * own flat default (30min) applies.
 *
 * Today's search starts at the next quarter-hour after now (never proposes a
 * time that's already passed); tomorrow's starts at 09:00, a fixed adopted
 * "start of the working day" since there's no "now" to anchor to.
 *
 * Throws a plain, user-readable Error when the day has no room left — the
 * caller (TaskActionMenu) surfaces it via `onError`, verbatim.
 */
export async function scheduleTaskOn(task: QuickScheduleTask, day: QuickScheduleDay): Promise<CalBlock> {
  const now = new Date();
  const date = day === "today" ? todayDateStr(now) : tomorrowDateStr(now);
  const durationMin = externalDragDurationMin(task.time_estimate ?? 0, task.time_estimate);
  const notBefore = day === "today" ? defaultScheduleWindow(now).notBefore : "09:00";

  const dayBlocks = await getCalBlocks(date, date);
  const slot = findFreeSlot(dayBlocks, durationMin, { notBefore });
  if (!slot) {
    throw new Error(`No free time left ${day} to schedule "${task.title}".`);
  }

  return createCalBlock(date, task.title, slot.startTime, slot.endTime, "blue", null, null, task.id);
}

/** Sets a task's due date to today or tomorrow (local time). */
export async function setTaskDue(taskId: number, day: QuickScheduleDay): Promise<Task> {
  const now = new Date();
  const date = day === "today" ? todayDateStr(now) : tomorrowDateStr(now);
  return patchTask(taskId, { due_date: date });
}
