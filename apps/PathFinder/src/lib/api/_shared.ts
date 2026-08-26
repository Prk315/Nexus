// Shared internals for the api modules: the Supabase client, the two error/number
// helpers, the row mappers, and the task select constants.
//
// api.ts was a single 3,000+ line file that every feature had to edit, which is
// how the same mistake landed in four places at once (a pf_tasks read that omits
// the pf_task_planning embed silently yields default urgency and stage). Keeping
// the mappers and the TASK_SELECT constants in one module is what makes that
// mistake hard to repeat — there is now one obvious thing to import.
//
// Everything here is internal to lib/api/. Call sites import from "../lib/api",
// which is the barrel in ./index.ts.

import { supabase, getUserId } from "../supabase";

// Re-exported so every api module has a single import source for the client.
export { supabase, getUserId };
import type {
  BookReadingLog, BookSection, CalBlock, CourseAssignment, CourseBook, Deadline, Goal, PipelineStep, Plan, RoadmapItem, ScheduleEntry, SystemEntry, Task, TaskPlanning, TaskSession, TaskType, TaskWithContext,
} from "../../types";


// ─── helpers ────────────────────────────────────────────────────────────────

export function err(e: any): never {
  throw e?.message ?? String(e);
}

export function num(v: any): number {
  return Number(v);
}

// ─── mappers ────────────────────────────────────────────────────────────────

export function mapGoal(
  r: any,
  taskCount = 0,
  doneCount = 0,
): Goal {
  return {
    id: num(r.id),
    group_id: r.group_id ? num(r.group_id) : null,
    // Accepts both shapes: flat columns from pf_goals_with_counts, or the
    // embedded pf_goal_groups(...) join used by create/updateGoal.
    group_name: r.group_name ?? r.pf_goal_groups?.name ?? null,
    group_color: r.group_color ?? r.pf_goal_groups?.color ?? null,
    title: r.title,
    description: r.description,
    deadline: r.deadline,
    status: r.status,
    priority: r.priority,
    created_at: r.created_at,
    task_count: taskCount,
    done_count: doneCount,
  };
}

export function mapPlan(r: any, taskCount = 0, doneCount = 0): Plan {
  return {
    id: num(r.id),
    goal_id: r.goal_id ? num(r.goal_id) : null,
    parent_id: r.parent_id ? num(r.parent_id) : null,
    title: r.title,
    description: r.description,
    deadline: r.deadline,
    status: r.status,
    created_at: r.created_at,
    task_count: taskCount,
    done_count: doneCount,
    tags: r.tags,
    is_course: r.is_course,
    is_lifestyle: r.is_lifestyle,
    is_schedule: r.is_schedule ?? false,
    lifestyle_area_id: r.lifestyle_area_id ? num(r.lifestyle_area_id) : null,
    purpose: r.purpose,
    problem: r.problem,
    solution: r.solution,
    team_id: r.team_id ?? null,
  };
}

/**
 * The embed every task read needs: the `task` subtype's planning row.
 *
 * PostgREST returns it as an object for a full task and `null` for the sparse
 * kinds, which is exactly the ISA shape — a reminder has no planning row and the
 * client should see that rather than a set of invented defaults.
 */
export const TASK_SELECT = "*, pf_task_planning(*)";
export // `pf_goals!pf_tasks_goal_id_fkey` disambiguates: pf_tasks now reaches pf_goals
// both directly and through pf_plans, and PostgREST refuses an ambiguous embed.
const TASK_SELECT_CTX =
  "*, pf_task_planning(*), pf_goals!pf_tasks_goal_id_fkey(id, title), pf_plans(id, title, goal_id, pf_goals(id, title))";

export function mapPlanning(r: any): TaskPlanning | null {
  // Two very different situations both end in `null`, and only one is legitimate:
  //
  //   key present, value null -> a sparse subtype. Correct: it has no planning row.
  //   key absent entirely     -> the caller's `select` omitted the embed. The task
  //                              silently reads as default urgency and stage.
  //
  // The second is a bug that cannot fail loudly on its own — PostgREST returns
  // 200 and the UI just shows the wrong axes. Callers should use TASK_SELECT /
  // TASK_SELECT_CTX; this catches the ones that don't.
  if (import.meta.env.DEV && r?.task_type === "task" && !("pf_task_planning" in (r ?? {}))) {
    console.warn(
      `[pf_tasks] task ${r?.id} was read without the pf_task_planning embed — ` +
      "urgency and stage will fall back to defaults. Use TASK_SELECT or TASK_SELECT_CTX.",
    );
  }

  // PostgREST gives a one-to-one embed as an object, but returns an array when
  // it can only infer a one-to-many. Accept both so a relationship-cache change
  // can't silently blank out every task's planning row.
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

export function mapTaskBase(r: any) {
  return {
    id: num(r.id),
    plan_id: r.plan_id ? num(r.plan_id) : null,
    parent_id: r.parent_id ? num(r.parent_id) : null,
    goal_id: r.goal_id ? num(r.goal_id) : null,
    task_type: (r.task_type ?? r.category ?? "task") as TaskType,
    title: r.title,
    done: r.done,
    sort_order: r.sort_order,
    priority: r.priority,
    due_date: r.due_date,
    created_at: r.created_at,
    time_estimate: r.time_estimate,
    // Falls back to the task's own estimate for a row read through a narrower
    // select that didn't include the maintained column.
    aggregate_estimate: r.aggregate_estimate ?? r.time_estimate ?? 0,
    kanban_status: r.kanban_status ?? "backlog",
    category: r.category ?? null,
    team_id: r.team_id ?? null,
    assigned_to: r.assigned_to ?? null,
  };
}

export function mapTask(r: any): Task {
  return { ...mapTaskBase(r), planning: mapPlanning(r) };
}

export function mapTaskWithContext(r: any, plansMap?: Map<number, any>): TaskWithContext {
  const plan = plansMap?.get(num(r.plan_id)) ?? r.pf_plans;
  const base = mapTaskBase(r);

  // A task reaches a goal two ways, and the direct link wins — it is the more
  // specific statement, and preferring it keeps the client's answer identical to
  // the one pf_goals_with_counts computes.
  const direct = Array.isArray(r.pf_goals) ? r.pf_goals[0] : r.pf_goals;
  const viaPlan = plan?.pf_goals;
  const goalId = base.goal_id ?? (plan?.goal_id ? num(plan.goal_id) : null);
  const goalTitle = (base.goal_id ? direct?.title : viaPlan?.title) ?? null;

  return {
    ...base,
    goal_id: goalId,
    plan_title: plan?.title ?? null,
    goal_title: goalTitle,
    planning: mapPlanning(r),
  };
}

export function mapTaskSession(r: any): TaskSession {
  return {
    id: num(r.id),
    task_id: num(r.task_id),
    date: r.date,
    minutes: r.minutes ?? 0,
    cal_block_id: r.cal_block_id != null ? num(r.cal_block_id) : null,
    note: r.note ?? null,
    created_at: r.created_at,
  };
}

export function mapScheduleEntry(r: any, planTitle = ""): ScheduleEntry {
  return {
    id: num(r.id),
    plan_id: num(r.plan_id),
    plan_title: r.pf_plans?.title ?? planTitle,
    title: r.title,
    description: r.description,
    location: r.location,
    date: r.date ?? null,
    start_time: r.start_time,
    end_time: r.end_time,
    color: r.color ?? "teal",
    category: r.category ?? "other",
    is_recurring: r.is_recurring ?? false,
    recurring_id: null,
    recurrence: r.recurrence,
    days_of_week: r.days_of_week,
    series_start_date: r.series_start_date,
    series_end_date: r.series_end_date,
    created_at: r.created_at,
  };
}

export function expandScheduleEntries(entry: any, startDate: string, endDate: string): ScheduleEntry[] {
  const result: ScheduleEntry[] = [];
  const rangeStart  = new Date(startDate + "T00:00:00Z");
  const rangeEnd    = new Date(endDate   + "T00:00:00Z");
  const seriesStart = new Date(entry.series_start_date + "T00:00:00Z");
  const seriesEnd   = entry.series_end_date ? new Date(entry.series_end_date + "T00:00:00Z") : null;
  const daysOfWeek: number[] = entry.days_of_week
    ? entry.days_of_week.split(",").map(Number)
    : [];

  const epoch  = new Date("2020-01-01T00:00:00Z").getTime();
  const cursor = new Date(Math.max(rangeStart.getTime(), seriesStart.getTime()));

  while (cursor <= rangeEnd && (!seriesEnd || cursor <= seriesEnd)) {
    const dow = cursor.getUTCDay();
    const matches =
      entry.recurrence === "daily" ||
      (entry.recurrence === "weekly" && daysOfWeek.includes(dow));

    if (matches) {
      const dateStr   = cursor.toISOString().split("T")[0];
      const dayOffset = Math.floor((cursor.getTime() - epoch) / 86_400_000);
      result.push({
        id: -(num(entry.id) * 100_000 + dayOffset),
        plan_id: num(entry.plan_id),
        plan_title: entry.pf_plans?.title ?? "",
        title: entry.title,
        description: entry.description,
        location: entry.location,
        date: dateStr,
        start_time: entry.start_time,
        end_time: entry.end_time,
        color: entry.color ?? "teal",
        category: entry.category ?? "other",
        is_recurring: true,
        recurring_id: num(entry.id),
        recurrence: entry.recurrence,
        days_of_week: entry.days_of_week,
        series_start_date: entry.series_start_date,
        series_end_date: entry.series_end_date,
        created_at: entry.created_at,
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export function mapSystem(r: any): SystemEntry {
  return {
    id: num(r.id),
    title: r.title,
    description: r.description,
    frequency: r.frequency,
    days_of_week: r.days_of_week,
    last_done: r.last_done,
    interval_days: r.interval_days ?? null,
    streak_count: r.streak_count,
    streak_updated: r.streak_updated,
    created_at: r.created_at,
    start_time: r.start_time,
    end_time: r.end_time,
    is_lifestyle: r.is_lifestyle,
    lifestyle_area_id: r.lifestyle_area_id ? num(r.lifestyle_area_id) : null,
  };
}

export function mapDeadline(r: any): Deadline {
  return {
    id: num(r.id),
    title: r.title,
    due_date: r.due_date,
    done: r.done,
    created_at: r.created_at,
  };
}

export function mapCourseAssignment(r: any): CourseAssignment {
  return {
    id: num(r.id),
    plan_id: num(r.plan_id),
    plan_title: r.pf_plans?.title ?? "",
    title: r.title,
    assignment_type: r.assignment_type,
    due_date: r.due_date,
    status: r.status,
    priority: r.priority,
    book_title: r.book_title,
    chapter_start: r.chapter_start,
    chapter_end: r.chapter_end,
    page_start: r.page_start,
    page_end: r.page_end,
    page_current: r.page_current,
    notes: r.notes,
    created_at: r.created_at,
    start_time: r.start_time,
    end_time: r.end_time,
    time_estimate: r.time_estimate,
  };
}

export function mapCourseBook(r: any): CourseBook {
  return {
    id: num(r.id),
    plan_id: num(r.plan_id),
    title: r.title,
    author: r.author,
    total_pages: r.total_pages,
    total_chapters: r.total_chapters,
    current_page: r.current_page,
    current_chapter: r.current_chapter,
    daily_pages_goal: r.daily_pages_goal,
    weekly_chapters_goal: r.weekly_chapters_goal,
    created_at: r.created_at,
    sections: (r.pf_book_sections ?? [])
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map(mapBookSection),
    log: (r.pf_book_reading_log ?? [])
      .sort((a: any, b: any) => b.date.localeCompare(a.date))
      .map(mapBookReadingLog),
  };
}

export function mapBookSection(r: any): BookSection {
  return {
    id: num(r.id),
    book_id: num(r.book_id),
    title: r.title,
    kind: r.kind,
    sort_order: r.sort_order,
    page_start: r.page_start,
    page_end: r.page_end,
    due_date: r.due_date,
    time_estimate: r.time_estimate,
    done: r.done,
    done_at: r.done_at,
    notes: r.notes,
    created_at: r.created_at,
  };
}

export function mapBookReadingLog(r: any): BookReadingLog {
  return {
    id: num(r.id),
    book_id: num(r.book_id),
    date: r.date,
    pages_read: r.pages_read,
    chapters_read: r.chapters_read,
    note: r.note,
  };
}

export function mapPipelineStep(r: any): PipelineStep {
  return {
    id: num(r.id),
    template_id: num(r.template_id),
    title: r.title,
    description: r.description,
    sort_order: r.sort_order,
    time_estimate: r.time_estimate,
    step_type: r.step_type,
    attend_type: r.attend_type,
  };
}

export function mapRoadmapItem(r: any): RoadmapItem {
  return {
    id: num(r.id),
    plan_id: num(r.plan_id),
    title: r.title,
    description: r.description,
    due_date: r.due_date,
    status: r.status,
    sort_order: r.sort_order,
    created_at: r.created_at,
  };
}

/** Expands a recurring cal block into virtual CalBlock entries for a date range. */
export function expandRecurring(block: any, startDate: string, endDate: string): CalBlock[] {
  const result: CalBlock[] = [];
  const rangeStart = new Date(startDate + "T00:00:00Z");
  const rangeEnd   = new Date(endDate   + "T00:00:00Z");
  const seriesStart = new Date(block.start_date + "T00:00:00Z");
  const seriesEnd   = block.end_date ? new Date(block.end_date + "T00:00:00Z") : null;

  const daysOfWeek: number[] = block.days_of_week
    ? block.days_of_week.split(",").map(Number)
    : [];

  const epoch = new Date("2020-01-01T00:00:00Z").getTime();
  const cursor = new Date(Math.max(rangeStart.getTime(), seriesStart.getTime()));

  while (cursor <= rangeEnd && (!seriesEnd || cursor <= seriesEnd)) {
    const dow = cursor.getUTCDay();
    const matches =
      block.recurrence === "daily" ||
      (block.recurrence === "weekly" && daysOfWeek.includes(dow));

    if (matches) {
      const dateStr    = cursor.toISOString().split("T")[0];
      const dayOffset  = Math.floor((cursor.getTime() - epoch) / 86_400_000);
      result.push({
        id: -(num(block.id) * 100_000 + dayOffset),
        date: dateStr,
        title: block.title,
        start_time: block.start_time,
        end_time: block.end_time,
        color: block.color,
        description: block.description,
        location: block.location,
        created_at: block.created_at,
        is_recurring: true,
        recurring_id: num(block.id),
        recurrence: block.recurrence,
        days_of_week: block.days_of_week,
        series_start_date: block.start_date,
        series_end_date: block.end_date,
        // Every occurrence carries the series' task link, so a recurring
        // commitment counts once per occurrence in the coverage roll-up.
        task_id: block.task_id != null ? num(block.task_id) : null,
        category: block.category ?? null,
        // Recurring series never nest — a virtual (negative-id) occurrence
        // has no real row for a child to reference, and `pf_recurring_cal_blocks`
        // itself carries no `parent_block_id` column. Always null here,
        // unconditionally, regardless of anything on `block`.
        parent_block_id: null,
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}
