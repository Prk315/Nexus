// The week view's aggregate read.

import {
  TASK_SELECT_CTX, expandScheduleEntries, mapCourseAssignment, mapDeadline, mapGoal, mapPlan, mapScheduleEntry, mapTaskWithContext, supabase, getUserId,
} from "./_shared";
import { getTeamOrFilter } from "./teams";
import type {
  WeekItems,
} from "../../types";
import { mapTrainingSession, expandTrainingSessions } from "./training";

// ═══════════════════════════════════════════════════════════════════════════
// WEEK VIEW
// ═══════════════════════════════════════════════════════════════════════════

export const getWeekItems = async (startDate: string, endDate: string): Promise<WeekItems> => {
  const orFilter = await getTeamOrFilter();

  let tasksQ = supabase.from("pf_tasks")
    .select(TASK_SELECT_CTX)
    .gte("due_date", startDate).lte("due_date", endDate);
  tasksQ = orFilter ? tasksQ.or(orFilter) : tasksQ.eq("user_id", getUserId());

  let plansQ = supabase.from("pf_plans")
    .select("*").eq("status", "active")
    .not("deadline", "is", null).gte("deadline", startDate).lte("deadline", endDate);
  plansQ = orFilter ? plansQ.or(orFilter) : plansQ.eq("user_id", getUserId());

  const [
    { data: tasks },
    { data: plans },
    { data: goals },
    { data: deadlines },
    { data: assignments },
    { data: seOneOff },
    { data: seRecurring },
    { data: trainingSessions },
    { data: recurringTrainingSessions },
  ] = await Promise.all([
    // TASK_SELECT_CTX, not a hand-written select: omitting the
    // pf_task_planning embed does not fail, it silently yields planning: null,
    // and every task then reads as default urgency/stage. A task that is urgent
    // on the board would quietly look ordinary here.
    // Completed tasks ARE returned. Filtering them out here made the week
    // completion score structurally impossible: HeaderPanel computes
    // `tasks.filter(t => t.done).length / tasks.length`, so with no done rows the
    // numerator was always 0 and finishing a task merely shrank the denominator
    // — the score could only ever read 0%. The consumers all filter for
    // themselves (the right rail even has a done-tasks section that had never
    // once been populated), so the fix belongs here rather than at each of them.
    tasksQ,
    plansQ,
    supabase.from("pf_goals")
      .select("*, pf_goal_groups(name, color)").eq("user_id", getUserId()).eq("status", "active"),
    supabase.from("pf_deadlines")
      .select("*").eq("user_id", getUserId()).gte("due_date", startDate).lte("due_date", endDate),
    supabase.from("pf_course_assignments")
      .select("*, pf_plans(title)").not("due_date", "is", null)
      .gte("due_date", startDate).lte("due_date", endDate),
    // Schedule entries — one-off (has a concrete date)
    supabase.from("pf_schedule_entries")
      .select("*, pf_plans(title)").eq("user_id", getUserId()).eq("is_recurring", false)
      .gte("date", startDate).lte("date", endDate),
    // Schedule entries — recurring (overlaps range)
    supabase.from("pf_schedule_entries")
      .select("*, pf_plans(title)").eq("user_id", getUserId()).eq("is_recurring", true)
      .lte("series_start_date", endDate)
      .or(`series_end_date.is.null,series_end_date.gte.${startDate}`),
    // Training sessions — one-off scheduled in range
    supabase.from("pf_training_sessions")
      .select("*, pf_training_plans(title, plan_type)")
      .eq("user_id", getUserId())
      .eq("is_recurring", false)
      .not("scheduled_date", "is", null)
      .gte("scheduled_date", startDate).lte("scheduled_date", endDate),
    // Training sessions — recurring (series overlaps range)
    supabase.from("pf_training_sessions")
      .select("*, pf_training_plans(title, plan_type)")
      .eq("user_id", getUserId())
      .eq("is_recurring", true)
      .lte("series_start_date", endDate)
      .or(`series_end_date.is.null,series_end_date.gte.${startDate}`),
  ]);

  const expandedRecurring = (seRecurring ?? []).flatMap((e) =>
    expandScheduleEntries(e, startDate, endDate)
  );
  const expandedRecurringSessions = (recurringTrainingSessions ?? []).flatMap((r) =>
    expandTrainingSessions(r, startDate, endDate)
  );

  return {
    tasks:              (tasks       ?? []).map((t) => mapTaskWithContext(t)),
    goals:              (goals       ?? []).map((g) => mapGoal(g)),
    plans:              (plans       ?? []).map((p) => mapPlan(p)),
    deadlines:          (deadlines   ?? []).map(mapDeadline),
    course_assignments: (assignments ?? []).map(mapCourseAssignment),
    schedule_entries:   [
      ...(seOneOff ?? []).map((e) => mapScheduleEntry(e)),
      ...expandedRecurring,
    ],
    training_sessions:  [
      ...(trainingSessions ?? []).map((r) => mapTrainingSession(r)),
      ...expandedRecurringSessions,
    ],
  };
};
