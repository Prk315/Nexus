import { supabase } from "./supabase";
import type {
  Goal, Plan, Task, TaskWithContext, SystemEntry, TodayFocus, SearchResult,
  DailyPlan, DailySection, DailyItemWithStatus, TimeBlock, Routines, RoutineItem,
  WeekItems, Reminder, QuickNote, BrainEntry, CalEvent, Deadline, Agreement,
  ScheduleEntry,
  DailyGoals, DailySecGoal, DailyPrimaryGoal, CalBlock, RecurringCalBlock, CourseAssignment,
  CaSubtask, LifestyleArea, PipelineTemplate, PipelineStep, PipelineRun,
  PipelineRunStep, PipelineStepSubtask, ProjectGoal, Game, GameFeature,
  GameDevlogEntry, RoadmapItem, CourseBook, BookSection, BookReadingLog,
  HabitWithCompletion, DailyHabit, HabitStack, HabitSubtask, RunLog, WorkoutLog, WorkoutExercise,
  SubtaskToggleResult, SystemSubtask, GoalGroup,
  TrainingPlan, TrainingSession, SessionPerformance, Rule,
} from "../types";

const USER_ID = "default";

// ─── helpers ────────────────────────────────────────────────────────────────

function err(e: any): never {
  throw e?.message ?? String(e);
}

function num(v: any): number {
  return Number(v);
}

// ─── mappers ────────────────────────────────────────────────────────────────

function mapGoal(
  r: any,
  taskCount = 0,
  doneCount = 0,
): Goal {
  return {
    id: num(r.id),
    group_id: r.group_id ? num(r.group_id) : null,
    group_name: r.pf_goal_groups?.name ?? null,
    group_color: r.pf_goal_groups?.color ?? null,
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

function mapPlan(r: any, taskCount = 0, doneCount = 0): Plan {
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
  };
}

function mapTask(r: any): Task {
  return {
    id: num(r.id),
    plan_id: r.plan_id ? num(r.plan_id) : null,
    title: r.title,
    done: r.done,
    sort_order: r.sort_order,
    priority: r.priority,
    due_date: r.due_date,
    time_estimate: r.time_estimate,
    kanban_status: r.kanban_status ?? "backlog",
    created_at: r.created_at,
  };
}

function mapTaskWithContext(r: any, plansMap?: Map<number, any>): TaskWithContext {
  const plan = plansMap?.get(num(r.plan_id)) ?? r.pf_plans;
  return {
    id: num(r.id),
    plan_id: r.plan_id ? num(r.plan_id) : null,
    plan_title: plan?.title ?? null,
    goal_id: plan?.goal_id ? num(plan.goal_id) : null,
    goal_title: plan?.pf_goals?.title ?? null,
    title: r.title,
    done: r.done,
    sort_order: r.sort_order,
    priority: r.priority,
    due_date: r.due_date,
    created_at: r.created_at,
    time_estimate: r.time_estimate,
  };
}

function mapScheduleEntry(r: any, planTitle = ""): ScheduleEntry {
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

function expandScheduleEntries(entry: any, startDate: string, endDate: string): ScheduleEntry[] {
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

function mapSystem(r: any): SystemEntry {
  return {
    id: num(r.id),
    title: r.title,
    description: r.description,
    frequency: r.frequency,
    days_of_week: r.days_of_week,
    last_done: r.last_done,
    streak_count: r.streak_count,
    streak_updated: r.streak_updated,
    created_at: r.created_at,
    start_time: r.start_time,
    end_time: r.end_time,
    is_lifestyle: r.is_lifestyle,
    lifestyle_area_id: r.lifestyle_area_id ? num(r.lifestyle_area_id) : null,
  };
}

function mapReminder(r: any): Reminder {
  return {
    id: num(r.id),
    title: r.title,
    done: r.done,
    due_date: r.due_date,
    created_at: r.created_at,
  };
}

function mapDeadline(r: any): Deadline {
  return {
    id: num(r.id),
    title: r.title,
    due_date: r.due_date,
    done: r.done,
    created_at: r.created_at,
  };
}

function mapCourseAssignment(r: any): CourseAssignment {
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

function mapCourseBook(r: any): CourseBook {
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

function mapBookSection(r: any): BookSection {
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

function mapBookReadingLog(r: any): BookReadingLog {
  return {
    id: num(r.id),
    book_id: num(r.book_id),
    date: r.date,
    pages_read: r.pages_read,
    chapters_read: r.chapters_read,
    note: r.note,
  };
}

function mapPipelineStep(r: any): PipelineStep {
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

function mapRoadmapItem(r: any): RoadmapItem {
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
function expandRecurring(block: any, startDate: string, endDate: string): CalBlock[] {
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
        task_id: null,
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// GOAL GROUPS
// ═══════════════════════════════════════════════════════════════════════════

export const getGoalGroups = async (): Promise<GoalGroup[]> => {
  const { data, error } = await supabase
    .from("pf_goal_groups")
    .select("*")
    .eq("user_id", USER_ID)
    .order("sort_order");
  if (error) err(error);
  return (data ?? []).map((r) => ({
    id: num(r.id), name: r.name, color: r.color, sort_order: r.sort_order,
  }));
};

export const createGoalGroup = async (name: string, color: string): Promise<GoalGroup> => {
  const { data, error } = await supabase
    .from("pf_goal_groups")
    .insert({ user_id: USER_ID, name, color })
    .select()
    .single();
  if (error) err(error);
  return { id: num(data!.id), name: data!.name, color: data!.color, sort_order: data!.sort_order };
};

export const updateGoalGroup = async (id: number, name: string, color: string): Promise<GoalGroup> => {
  const { data, error } = await supabase
    .from("pf_goal_groups")
    .update({ name, color })
    .eq("id", id)
    .select()
    .single();
  if (error) err(error);
  return { id: num(data!.id), name: data!.name, color: data!.color, sort_order: data!.sort_order };
};

export const deleteGoalGroup = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_goal_groups").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// GOALS
// ═══════════════════════════════════════════════════════════════════════════

export const getGoals = async (): Promise<Goal[]> => {
  const { data: goals, error: gErr } = await supabase
    .from("pf_goals")
    .select("*, pf_goal_groups(name, color)")
    .eq("user_id", USER_ID)
    .order("created_at", { ascending: false });
  if (gErr) err(gErr);
  if (!goals?.length) return [];

  // Compute task_count / done_count through plans → tasks
  const goalIds = goals.map((g) => num(g.id));
  const { data: plans } = await supabase
    .from("pf_plans")
    .select("id, goal_id")
    .eq("user_id", USER_ID)
    .in("goal_id", goalIds);

  const planIds = (plans ?? []).map((p) => num(p.id));
  const counts: Record<number, { total: number; done: number }> = {};

  if (planIds.length > 0) {
    const { data: tasks } = await supabase
      .from("pf_tasks")
      .select("id, done, plan_id")
      .in("plan_id", planIds);
    for (const t of tasks ?? []) {
      const plan = (plans ?? []).find((p) => num(p.id) === num(t.plan_id));
      if (plan?.goal_id) {
        const gid = num(plan.goal_id);
        if (!counts[gid]) counts[gid] = { total: 0, done: 0 };
        counts[gid].total++;
        if (t.done) counts[gid].done++;
      }
    }
  }

  return goals.map((g) =>
    mapGoal(g, counts[num(g.id)]?.total ?? 0, counts[num(g.id)]?.done ?? 0)
  );
};

export const createGoal = async (payload: {
  title: string; description?: string | null; deadline?: string | null;
  priority?: string; group_id?: number | null;
}): Promise<Goal> => {
  const { data, error } = await supabase
    .from("pf_goals")
    .insert({ user_id: USER_ID, ...payload })
    .select("*, pf_goal_groups(name, color)")
    .single();
  if (error) err(error);
  return mapGoal(data!);
};

export const updateGoal = async (id: number, payload: {
  title: string; description?: string | null; deadline?: string | null;
  status: string; priority: string; group_id?: number | null;
}): Promise<Goal> => {
  const { data, error } = await supabase
    .from("pf_goals")
    .update(payload)
    .eq("id", id)
    .select("*, pf_goal_groups(name, color)")
    .single();
  if (error) err(error);
  return mapGoal(data!);
};

export const deleteGoal = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_goals").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// PLANS
// ═══════════════════════════════════════════════════════════════════════════

export const getPlans = async (): Promise<Plan[]> => {
  const { data: plans, error } = await supabase
    .from("pf_plans")
    .select("*")
    .eq("user_id", USER_ID)
    .order("created_at", { ascending: false });
  if (error) err(error);
  if (!plans?.length) return [];

  const planIds = plans.map((p) => num(p.id));
  const { data: tasks } = await supabase
    .from("pf_tasks")
    .select("id, done, plan_id")
    .in("plan_id", planIds);

  const counts: Record<number, { total: number; done: number }> = {};
  for (const t of tasks ?? []) {
    const pid = num(t.plan_id);
    if (!counts[pid]) counts[pid] = { total: 0, done: 0 };
    counts[pid].total++;
    if (t.done) counts[pid].done++;
  }

  return plans.map((p) =>
    mapPlan(p, counts[num(p.id)]?.total ?? 0, counts[num(p.id)]?.done ?? 0)
  );
};

export const createPlan = async (payload: {
  goal_id?: number | null; parent_id?: number | null; title: string; description?: string | null;
  deadline?: string | null; tags?: string | null; is_course?: boolean;
  is_lifestyle?: boolean; is_schedule?: boolean; lifestyle_area_id?: number | null;
  purpose?: string | null; problem?: string | null; solution?: string | null;
}): Promise<Plan> => {
  const { data, error } = await supabase
    .from("pf_plans")
    .insert({ user_id: USER_ID, ...payload })
    .select()
    .single();
  if (error) err(error);
  return mapPlan(data!);
};

export const updatePlan = async (id: number, payload: {
  goal_id?: number | null; parent_id?: number | null; title: string; description?: string | null;
  deadline?: string | null; status: string; tags?: string | null;
  is_course?: boolean; is_lifestyle?: boolean; is_schedule?: boolean;
  lifestyle_area_id?: number | null;
  purpose?: string | null; problem?: string | null; solution?: string | null;
}): Promise<Plan> => {
  const { data, error } = await supabase
    .from("pf_plans")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) err(error);
  return mapPlan(data!);
};

export const deletePlan = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_plans").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════════════════════

export const getTasks = async (planId: number): Promise<Task[]> => {
  const { data, error } = await supabase
    .from("pf_tasks")
    .select("*")
    .eq("plan_id", planId)
    .order("sort_order");
  if (error) err(error);
  return (data ?? []).map(mapTask);
};

export const getAllTasks = async (): Promise<TaskWithContext[]> => {
  const { data, error } = await supabase
    .from("pf_tasks")
    .select("*, pf_plans(id, title, goal_id, pf_goals(id, title))")
    .eq("user_id", USER_ID)
    .order("created_at", { ascending: false });
  if (error) err(error);
  return (data ?? []).map((r) => mapTaskWithContext(r));
};

export const createTask = async (payload: {
  plan_id?: number | null; title: string; priority?: string;
  due_date?: string | null; time_estimate?: number | null;
}): Promise<Task> => {
  const { data, error } = await supabase
    .from("pf_tasks")
    .insert({ user_id: USER_ID, ...payload })
    .select()
    .single();
  if (error) err(error);
  return mapTask(data!);
};

export const updateTask = async (id: number, payload: {
  title: string; priority: string; due_date?: string | null; time_estimate?: number | null;
}): Promise<Task> => {
  const { data, error } = await supabase
    .from("pf_tasks")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) err(error);
  return mapTask(data!);
};

export const toggleTask = async (id: number): Promise<Task> => {
  const { data: cur, error: e1 } = await supabase
    .from("pf_tasks").select("done").eq("id", id).single();
  if (e1) err(e1);
  const { data, error } = await supabase
    .from("pf_tasks")
    .update({ done: !cur!.done })
    .eq("id", id)
    .select()
    .single();
  if (error) err(error);
  return mapTask(data!);
};

export const deleteTask = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_tasks").delete().eq("id", id);
  if (error) err(error);
};

export const setTaskKanbanStatus = async (id: number, status: string): Promise<Task> => {
  const { data, error } = await supabase
    .from("pf_tasks")
    .update({ kanban_status: status })
    .eq("id", id)
    .select()
    .single();
  if (error) err(error);
  return mapTask(data!);
};

// ═══════════════════════════════════════════════════════════════════════════
// PROJECT GOALS
// ═══════════════════════════════════════════════════════════════════════════

export const getProjectGoals = async (planId: number): Promise<ProjectGoal[]> => {
  const { data, error } = await supabase
    .from("pf_project_goals")
    .select("*")
    .eq("plan_id", planId)
    .order("sort_order");
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), plan_id: num(r.plan_id), title: r.title, done: r.done, sort_order: r.sort_order }));
};

export const addProjectGoal = async (payload: { plan_id: number; title: string }): Promise<ProjectGoal> => {
  const { data, error } = await supabase
    .from("pf_project_goals").insert(payload).select().single();
  if (error) err(error);
  return { id: num(data!.id), plan_id: num(data!.plan_id), title: data!.title, done: data!.done, sort_order: data!.sort_order };
};

export const toggleProjectGoal = async (id: number): Promise<ProjectGoal> => {
  const { data: cur } = await supabase.from("pf_project_goals").select("done").eq("id", id).single();
  const { data, error } = await supabase
    .from("pf_project_goals").update({ done: !cur!.done }).eq("id", id).select().single();
  if (error) err(error);
  return { id: num(data!.id), plan_id: num(data!.plan_id), title: data!.title, done: data!.done, sort_order: data!.sort_order };
};

export const deleteProjectGoal = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_project_goals").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEMS
// ═══════════════════════════════════════════════════════════════════════════

export const getSystems = async (): Promise<SystemEntry[]> => {
  const { data, error } = await supabase
    .from("pf_systems").select("*").eq("user_id", USER_ID).order("created_at");
  if (error) err(error);
  return (data ?? []).map(mapSystem);
};

export const createSystem = async (payload: {
  title: string; description?: string | null; frequency: string;
  days_of_week?: string | null; start_time?: string | null; end_time?: string | null;
  is_lifestyle?: boolean; lifestyle_area_id?: number | null;
}): Promise<SystemEntry> => {
  const { data, error } = await supabase
    .from("pf_systems").insert({ user_id: USER_ID, ...payload }).select().single();
  if (error) err(error);
  return mapSystem(data!);
};

export const updateSystem = async (id: number, payload: {
  title: string; description?: string | null; frequency: string;
  days_of_week?: string | null; start_time?: string | null; end_time?: string | null;
  is_lifestyle?: boolean; lifestyle_area_id?: number | null;
}): Promise<SystemEntry> => {
  const { data, error } = await supabase
    .from("pf_systems").update(payload).eq("id", id).select().single();
  if (error) err(error);
  return mapSystem(data!);
};

export const deleteSystem = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_systems").delete().eq("id", id);
  if (error) err(error);
};

export const markSystemDone = async (id: number): Promise<SystemEntry> => {
  const { data: sys, error } = await supabase
    .from("pf_systems").select("*").eq("id", id).single();
  if (error) err(error);

  const today     = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split("T")[0];

  if (sys!.last_done === today) return mapSystem(sys!);

  const newStreak = sys!.last_done === yesterday ? sys!.streak_count + 1 : 1;
  const { data, error: e2 } = await supabase
    .from("pf_systems")
    .update({ last_done: today, streak_count: newStreak, streak_updated: today })
    .eq("id", id).select().single();
  if (e2) err(e2);
  return mapSystem(data!);
};

export const unmarkSystemDone = async (id: number): Promise<SystemEntry> => {
  const today = new Date().toISOString().split("T")[0];
  const { data: sys } = await supabase.from("pf_systems").select("*").eq("id", id).single();
  const updates: any = {};
  if (sys!.last_done === today) {
    updates.last_done = null;
    updates.streak_count = Math.max(0, sys!.streak_count - 1);
  }
  if (Object.keys(updates).length === 0) return mapSystem(sys!);
  const { data, error } = await supabase
    .from("pf_systems").update(updates).eq("id", id).select().single();
  if (error) err(error);
  return mapSystem(data!);
};

export const getSystemSubtasks = async (systemId: number, date: string): Promise<SystemSubtask[]> => {
  const { data: subtasks, error } = await supabase
    .from("pf_system_subtasks").select("*").eq("system_id", systemId).order("sort_order");
  if (error) err(error);
  if (!subtasks?.length) return [];

  const ids = subtasks.map((s) => num(s.id));
  const { data: completions } = await supabase
    .from("pf_system_subtask_completions").select("subtask_id")
    .in("subtask_id", ids).eq("date", date);
  const doneSet = new Set((completions ?? []).map((c) => num(c.subtask_id)));

  return subtasks.map((s) => ({
    id: num(s.id), system_id: num(s.system_id),
    title: s.title, sort_order: s.sort_order, done: doneSet.has(num(s.id)),
  }));
};

export const addSystemSubtask = async (systemId: number, title: string): Promise<SystemSubtask[]> => {
  const { error } = await supabase
    .from("pf_system_subtasks").insert({ system_id: systemId, title });
  if (error) err(error);
  return getSystemSubtasks(systemId, new Date().toISOString().split("T")[0]);
};

export const deleteSystemSubtask = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_system_subtasks").delete().eq("id", id);
  if (error) err(error);
};

export const toggleSystemSubtask = async (subtaskId: number, date: string): Promise<SubtaskToggleResult> => {
  const { data: existing } = await supabase
    .from("pf_system_subtask_completions").select("id")
    .eq("subtask_id", subtaskId).eq("date", date).maybeSingle();

  if (existing) {
    await supabase.from("pf_system_subtask_completions").delete().eq("id", existing.id);
  } else {
    await supabase.from("pf_system_subtask_completions").insert({ subtask_id: subtaskId, date });
  }

  const { data: subtask } = await supabase
    .from("pf_system_subtasks").select("system_id").eq("id", subtaskId).single();
  const systemId = num(subtask!.system_id);

  const [subtasks, { data: sys }] = await Promise.all([
    getSystemSubtasks(systemId, date),
    supabase.from("pf_systems").select("*").eq("id", systemId).single(),
  ]);
  return { subtasks, system: mapSystem(sys!) };
};

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

export const getTodayFocus = async (): Promise<TodayFocus> => {
  const today = new Date().toISOString().split("T")[0];

  const [{ data: plans }, { data: tasks }, { data: systems }] = await Promise.all([
    supabase.from("pf_plans").select("id, title, goal_id, pf_goals(id, title)").eq("user_id", USER_ID),
    supabase.from("pf_tasks").select("*").eq("user_id", USER_ID).eq("done", false)
      .not("due_date", "is", null).lte("due_date", today),
    supabase.from("pf_systems").select("*").eq("user_id", USER_ID),
  ]);

  const plansMap = new Map((plans ?? []).map((p) => [num(p.id), p]));
  const allTasks = (tasks ?? []).map((t) => mapTaskWithContext(t, plansMap));

  const systemsDue = (systems ?? []).filter((s) => {
    if (s.last_done === today) return false;
    if (s.frequency === "daily") return true;
    if (s.frequency === "weekly") {
      if (!s.days_of_week) return false;
      const todayDow = new Date().getDay();
      return s.days_of_week.split(",").map(Number).includes(todayDow);
    }
    return false;
  }).map(mapSystem);

  return {
    tasks_due_today: allTasks.filter((t) => t.due_date === today),
    overdue_tasks:   allTasks.filter((t) => t.due_date! < today),
    systems_due:     systemsDue,
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════════════════

export const search = async (query: string): Promise<SearchResult[]> => {
  const q = `%${query}%`;
  const [{ data: goals }, { data: plans }, { data: tasks }, { data: systems }] =
    await Promise.all([
      supabase.from("pf_goals").select("id, title, status").eq("user_id", USER_ID).ilike("title", q).limit(5),
      supabase.from("pf_plans").select("id, title, status").eq("user_id", USER_ID).ilike("title", q).limit(5),
      supabase.from("pf_tasks").select("id, title, pf_plans(title)").eq("user_id", USER_ID).ilike("title", q).limit(5),
      supabase.from("pf_systems").select("id, title, frequency").eq("user_id", USER_ID).ilike("title", q).limit(5),
    ]);

  return [
    ...(goals   ?? []).map((g) => ({ kind: "goal"   as const, id: num(g.id), title: g.title, subtitle: g.status })),
    ...(plans   ?? []).map((p) => ({ kind: "plan"   as const, id: num(p.id), title: p.title, subtitle: p.status })),
    ...(tasks   ?? []).map((t) => ({ kind: "task"   as const, id: num(t.id), title: t.title, subtitle: (t as any).pf_plans?.title ?? null })),
    ...(systems ?? []).map((s) => ({ kind: "system" as const, id: num(s.id), title: s.title, subtitle: s.frequency })),
  ];
};

// ═══════════════════════════════════════════════════════════════════════════
// WEEK VIEW
// ═══════════════════════════════════════════════════════════════════════════

export const getWeekItems = async (startDate: string, endDate: string): Promise<WeekItems> => {
  const [
    { data: tasks },
    { data: plans },
    { data: goals },
    { data: deadlines },
    { data: reminders },
    { data: assignments },
    { data: seOneOff },
    { data: seRecurring },
    { data: trainingSessions },
  ] = await Promise.all([
    supabase.from("pf_tasks")
      .select("*, pf_plans(id, title, goal_id, pf_goals(id, title))")
      .eq("user_id", USER_ID).eq("done", false)
      .gte("due_date", startDate).lte("due_date", endDate),
    supabase.from("pf_plans")
      .select("*").eq("user_id", USER_ID).eq("status", "active")
      .not("deadline", "is", null).gte("deadline", startDate).lte("deadline", endDate),
    supabase.from("pf_goals")
      .select("*, pf_goal_groups(name, color)").eq("user_id", USER_ID).eq("status", "active"),
    supabase.from("pf_deadlines")
      .select("*").eq("user_id", USER_ID).gte("due_date", startDate).lte("due_date", endDate),
    supabase.from("pf_reminders")
      .select("*").eq("user_id", USER_ID).not("due_date", "is", null)
      .gte("due_date", startDate).lte("due_date", endDate),
    supabase.from("pf_course_assignments")
      .select("*, pf_plans(title)").not("due_date", "is", null)
      .gte("due_date", startDate).lte("due_date", endDate),
    // Schedule entries — one-off (has a concrete date)
    supabase.from("pf_schedule_entries")
      .select("*, pf_plans(title)").eq("user_id", USER_ID).eq("is_recurring", false)
      .gte("date", startDate).lte("date", endDate),
    // Schedule entries — recurring (overlaps range)
    supabase.from("pf_schedule_entries")
      .select("*, pf_plans(title)").eq("user_id", USER_ID).eq("is_recurring", true)
      .lte("series_start_date", endDate)
      .or(`series_end_date.is.null,series_end_date.gte.${startDate}`),
    // Training sessions scheduled in range
    supabase.from("pf_training_sessions")
      .select("*, pf_training_plans(title, plan_type)")
      .eq("user_id", USER_ID)
      .not("scheduled_date", "is", null)
      .gte("scheduled_date", startDate).lte("scheduled_date", endDate),
  ]);

  const expandedRecurring = (seRecurring ?? []).flatMap((e) =>
    expandScheduleEntries(e, startDate, endDate)
  );

  return {
    tasks:              (tasks       ?? []).map((t) => mapTaskWithContext(t)),
    goals:              (goals       ?? []).map((g) => mapGoal(g)),
    plans:              (plans       ?? []).map((p) => mapPlan(p)),
    deadlines:          (deadlines   ?? []).map(mapDeadline),
    reminders:          (reminders   ?? []).map(mapReminder),
    course_assignments: (assignments ?? []).map(mapCourseAssignment),
    schedule_entries:   [
      ...(seOneOff ?? []).map((e) => mapScheduleEntry(e)),
      ...expandedRecurring,
    ],
    training_sessions:  (trainingSessions ?? []).map((r) => mapTrainingSession(r)),
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// ROUTINES
// ═══════════════════════════════════════════════════════════════════════════

export const getRoutines = async (date: string): Promise<Routines> => {
  const { data: routines, error } = await supabase
    .from("pf_routines").select("*").eq("user_id", USER_ID).order("sort_order");
  if (error) err(error);
  if (!routines?.length) return { morning: [], evening: [] };

  const ids = routines.map((r) => num(r.id));
  const { data: completions } = await supabase
    .from("pf_routine_completions").select("routine_id").in("routine_id", ids).eq("date", date);
  const doneSet = new Set((completions ?? []).map((c) => num(c.routine_id)));

  const mapItem = (r: any): RoutineItem => ({
    id: num(r.id), kind: r.kind, title: r.title, sort_order: r.sort_order,
    done: doneSet.has(num(r.id)),
  });

  return {
    morning: routines.filter((r) => r.kind === "morning").map(mapItem),
    evening: routines.filter((r) => r.kind === "evening").map(mapItem),
  };
};

export const toggleRoutine = async (id: number, date: string): Promise<boolean> => {
  const { data: existing } = await supabase
    .from("pf_routine_completions").select("id")
    .eq("routine_id", id).eq("date", date).maybeSingle();
  if (existing) {
    await supabase.from("pf_routine_completions").delete().eq("id", existing.id);
    return false;
  }
  await supabase.from("pf_routine_completions").insert({ routine_id: id, date });
  return true;
};

export const addRoutineItem = async (kind: string, title: string): Promise<void> => {
  const { error } = await supabase
    .from("pf_routines").insert({ user_id: USER_ID, kind, title });
  if (error) err(error);
};

export const deleteRoutineItem = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_routines").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// TIME BLOCKS
// ═══════════════════════════════════════════════════════════════════════════

export const getTimeBlocks = async (date: string): Promise<TimeBlock[]> => {
  const { data, error } = await supabase
    .from("pf_time_blocks").select("*").eq("user_id", USER_ID).eq("date", date);
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), date: r.date, slot: r.slot, label: r.label }));
};

export const saveTimeBlock = async (date: string, slot: string, label: string): Promise<void> => {
  const { error } = await supabase
    .from("pf_time_blocks")
    .upsert({ user_id: USER_ID, date, slot, label }, { onConflict: "user_id,date,slot" });
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// DAILY TEMPLATE
// ═══════════════════════════════════════════════════════════════════════════

export const getDailyPlan = async (date: string): Promise<DailyPlan> => {
  const { data: sections, error } = await supabase
    .from("pf_daily_sections")
    .select("*, pf_daily_items(*)")
    .eq("user_id", USER_ID)
    .order("sort_order");
  if (error) err(error);

  const allItems = (sections ?? []).flatMap((s: any) => s.pf_daily_items ?? []);
  const itemIds  = allItems.map((i: any) => num(i.id));
  let doneSet: Set<number> = new Set();

  if (itemIds.length > 0) {
    const { data: completions } = await supabase
      .from("pf_daily_completions").select("item_id").in("item_id", itemIds).eq("date", date);
    doneSet = new Set((completions ?? []).map((c: any) => num(c.item_id)));
  }

  const mappedSections: DailySection[] = (sections ?? []).map((s: any) => ({
    id: num(s.id), title: s.title, color: s.color, sort_order: s.sort_order,
    items: (s.pf_daily_items ?? [])
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((item: any): DailyItemWithStatus => ({
        id: num(item.id), section_id: num(item.section_id),
        title: item.title, sort_order: item.sort_order, done: doneSet.has(num(item.id)),
      })),
  }));

  return {
    date,
    sections: mappedSections,
    total_items: allItems.length,
    done_items:  doneSet.size,
  };
};

export const toggleDailyCompletion = async (itemId: number, date: string): Promise<boolean> => {
  const { data: existing } = await supabase
    .from("pf_daily_completions").select("id").eq("item_id", itemId).eq("date", date).maybeSingle();
  if (existing) {
    await supabase.from("pf_daily_completions").delete().eq("id", existing.id);
    return false;
  }
  await supabase.from("pf_daily_completions").insert({ item_id: itemId, date });
  return true;
};

export const createDailySection = async (payload: { title: string; color?: string | null }): Promise<void> => {
  const { error } = await supabase
    .from("pf_daily_sections").insert({ user_id: USER_ID, ...payload });
  if (error) err(error);
};

export const updateDailySection = async (id: number, payload: { title: string; color: string; sort_order: number }): Promise<void> => {
  const { error } = await supabase.from("pf_daily_sections").update(payload).eq("id", id);
  if (error) err(error);
};

export const deleteDailySection = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_daily_sections").delete().eq("id", id);
  if (error) err(error);
};

export const createDailyItem = async (payload: { section_id: number; title: string }): Promise<void> => {
  const { error } = await supabase.from("pf_daily_items").insert(payload);
  if (error) err(error);
};

export const updateDailyItem = async (id: number, payload: { title: string; sort_order: number }): Promise<void> => {
  const { error } = await supabase.from("pf_daily_items").update(payload).eq("id", id);
  if (error) err(error);
};

export const deleteDailyItem = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_daily_items").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// DAILY GOALS
// ═══════════════════════════════════════════════════════════════════════════

export const getDailyGoals = async (date: string): Promise<DailyGoals> => {
  const [{ data: primary }, { data: secondary }] = await Promise.all([
    supabase.from("pf_daily_primary_goal").select("text, time_estimate_min").eq("user_id", USER_ID).eq("date", date).maybeSingle(),
    supabase.from("pf_daily_secondary_goals").select("*").eq("user_id", USER_ID).eq("date", date).order("sort_order"),
  ]);
  return {
    primary: primary ? { text: primary.text, time_estimate_min: primary.time_estimate_min ?? null } : null,
    secondary: (secondary ?? []).map((r): DailySecGoal => ({
      id: num(r.id), date: r.date, text: r.text, sort_order: r.sort_order, time_estimate_min: r.time_estimate_min ?? null,
    })),
  };
};

export const setDailyPrimaryGoal = async (date: string, payload: DailyPrimaryGoal): Promise<void> => {
  const { error } = await supabase
    .from("pf_daily_primary_goal")
    .upsert({ user_id: USER_ID, date, text: payload.text, time_estimate_min: payload.time_estimate_min }, { onConflict: "user_id,date" });
  if (error) err(error);
};

export const clearDailyPrimaryGoal = async (date: string): Promise<void> => {
  const { error } = await supabase
    .from("pf_daily_primary_goal").delete().eq("user_id", USER_ID).eq("date", date);
  if (error) err(error);
};

export const addDailySecondaryGoal = async (date: string, text: string, time_estimate_min?: number | null): Promise<DailySecGoal> => {
  const { data, error } = await supabase
    .from("pf_daily_secondary_goals").insert({ user_id: USER_ID, date, text, time_estimate_min: time_estimate_min ?? null }).select().single();
  if (error) err(error);
  return { id: num(data!.id), date: data!.date, text: data!.text, sort_order: data!.sort_order, time_estimate_min: data!.time_estimate_min ?? null };
};

export const updateDailySecondaryGoal = async (id: number, payload: { text?: string; time_estimate_min?: number | null }): Promise<void> => {
  const { error } = await supabase.from("pf_daily_secondary_goals").update(payload).eq("id", id);
  if (error) err(error);
};

export const deleteDailySecondaryGoal = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_daily_secondary_goals").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// REMINDERS
// ═══════════════════════════════════════════════════════════════════════════

export const getReminders = async (): Promise<Reminder[]> => {
  const { data, error } = await supabase
    .from("pf_reminders").select("*").eq("user_id", USER_ID).order("created_at", { ascending: false });
  if (error) err(error);
  return (data ?? []).map(mapReminder);
};

export const addReminder = async (title: string, dueDate?: string | null): Promise<Reminder> => {
  const { data, error } = await supabase
    .from("pf_reminders").insert({ user_id: USER_ID, title, due_date: dueDate ?? null }).select().single();
  if (error) err(error);
  return mapReminder(data!);
};

export const toggleReminder = async (id: number): Promise<Reminder> => {
  const { data: cur } = await supabase.from("pf_reminders").select("done").eq("id", id).single();
  const { data, error } = await supabase
    .from("pf_reminders").update({ done: !cur!.done }).eq("id", id).select().single();
  if (error) err(error);
  return mapReminder(data!);
};

export const deleteReminder = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_reminders").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// QUICK NOTES
// ═══════════════════════════════════════════════════════════════════════════

export const getQuickNotes = async (): Promise<QuickNote[]> => {
  const { data, error } = await supabase
    .from("pf_quick_notes").select("*").eq("user_id", USER_ID).order("created_at", { ascending: false });
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), title: r.title, body: r.body, created_at: r.created_at }));
};

export const addQuickNote = async (title: string, body?: string | null): Promise<QuickNote> => {
  const { data, error } = await supabase
    .from("pf_quick_notes").insert({ user_id: USER_ID, title, body: body ?? null }).select().single();
  if (error) err(error);
  return { id: num(data!.id), title: data!.title, body: data!.body, created_at: data!.created_at };
};

export const deleteQuickNote = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_quick_notes").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// BRAIN DUMP
// ═══════════════════════════════════════════════════════════════════════════

export const getBrainDump = async (): Promise<BrainEntry[]> => {
  const { data, error } = await supabase
    .from("pf_brain_dump").select("*").eq("user_id", USER_ID).order("created_at", { ascending: false });
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), content: r.content, created_at: r.created_at }));
};

export const addBrainEntry = async (content: string): Promise<BrainEntry> => {
  const { data, error } = await supabase
    .from("pf_brain_dump").insert({ user_id: USER_ID, content }).select().single();
  if (error) err(error);
  return { id: num(data!.id), content: data!.content, created_at: data!.created_at };
};

export const deleteBrainEntry = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_brain_dump").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════════════════

export const getEvents = async (): Promise<CalEvent[]> => {
  const { data, error } = await supabase
    .from("pf_events").select("*").eq("user_id", USER_ID).order("date");
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), title: r.title, date: r.date, description: r.description, created_at: r.created_at }));
};

export const addEvent = async (title: string, date: string, description?: string | null): Promise<CalEvent> => {
  const { data, error } = await supabase
    .from("pf_events").insert({ user_id: USER_ID, title, date, description: description ?? null }).select().single();
  if (error) err(error);
  return { id: num(data!.id), title: data!.title, date: data!.date, description: data!.description, created_at: data!.created_at };
};

export const deleteEvent = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_events").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// DEADLINES
// ═══════════════════════════════════════════════════════════════════════════

export const getDeadlines = async (): Promise<Deadline[]> => {
  const { data, error } = await supabase
    .from("pf_deadlines").select("*").eq("user_id", USER_ID).order("due_date");
  if (error) err(error);
  return (data ?? []).map(mapDeadline);
};

export const addDeadline = async (title: string, due_date: string): Promise<Deadline> => {
  const { data, error } = await supabase
    .from("pf_deadlines").insert({ user_id: USER_ID, title, due_date }).select().single();
  if (error) err(error);
  return mapDeadline(data!);
};

export const toggleDeadline = async (id: number): Promise<Deadline> => {
  const { data: cur } = await supabase.from("pf_deadlines").select("done").eq("id", id).single();
  const { data, error } = await supabase
    .from("pf_deadlines").update({ done: !cur!.done }).eq("id", id).select().single();
  if (error) err(error);
  return mapDeadline(data!);
};

export const deleteDeadline = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_deadlines").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// AGREEMENTS
// ═══════════════════════════════════════════════════════════════════════════

export const getAgreements = async (): Promise<Agreement[]> => {
  const { data, error } = await supabase
    .from("pf_agreements").select("*").eq("user_id", USER_ID).order("created_at");
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), title: r.title, notes: r.notes, created_at: r.created_at }));
};

export const addAgreement = async (title: string, notes?: string | null): Promise<Agreement> => {
  const { data, error } = await supabase
    .from("pf_agreements").insert({ user_id: USER_ID, title, notes: notes ?? null }).select().single();
  if (error) err(error);
  return { id: num(data!.id), title: data!.title, notes: data!.notes, created_at: data!.created_at };
};

export const deleteAgreement = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_agreements").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// CALENDAR BLOCKS
// ═══════════════════════════════════════════════════════════════════════════

export const getCalBlocks = async (startDate: string, endDate: string): Promise<CalBlock[]> => {
  const [{ data: regular }, { data: recurring }] = await Promise.all([
    supabase.from("pf_cal_blocks").select("*").eq("user_id", USER_ID)
      .gte("date", startDate).lte("date", endDate).order("start_time"),
    supabase.from("pf_recurring_cal_blocks").select("*").eq("user_id", USER_ID)
      .lte("start_date", endDate)
      .or(`end_date.is.null,end_date.gte.${startDate}`),
  ]);

  const regularMapped: CalBlock[] = (regular ?? []).map((b) => ({
    id: num(b.id), date: b.date, title: b.title, start_time: b.start_time,
    end_time: b.end_time, color: b.color, description: b.description,
    location: b.location, created_at: b.created_at,
    is_recurring: false, recurring_id: null, recurrence: null,
    days_of_week: null, series_start_date: null, series_end_date: null,
    task_id: b.task_id ? num(b.task_id) : null,
  }));

  const virtual = (recurring ?? []).flatMap((r) => expandRecurring(r, startDate, endDate));

  return [...regularMapped, ...virtual].sort(
    (a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time)
  );
};

export const createCalBlock = async (
  date: string, title: string, startTime: string, endTime: string,
  color: string, description: string | null, location: string | null,
  taskId?: number | null,
): Promise<CalBlock> => {
  const { data, error } = await supabase
    .from("pf_cal_blocks")
    .insert({ user_id: USER_ID, date, title, start_time: startTime, end_time: endTime, color, description, location, task_id: taskId ?? null })
    .select().single();
  if (error) err(error);
  return { id: num(data!.id), date: data!.date, title: data!.title, start_time: data!.start_time, end_time: data!.end_time, color: data!.color, description: data!.description, location: data!.location, created_at: data!.created_at, is_recurring: false, recurring_id: null, recurrence: null, days_of_week: null, series_start_date: null, series_end_date: null, task_id: data!.task_id ? num(data!.task_id) : null };
};

export const updateCalBlock = async (
  id: number, title: string, startTime: string, endTime: string,
  color: string, description: string | null, location: string | null,
  taskId?: number | null,
): Promise<CalBlock> => {
  const { data, error } = await supabase
    .from("pf_cal_blocks")
    .update({ title, start_time: startTime, end_time: endTime, color, description, location, task_id: taskId ?? null })
    .eq("id", id).select().single();
  if (error) err(error);
  return { id: num(data!.id), date: data!.date, title: data!.title, start_time: data!.start_time, end_time: data!.end_time, color: data!.color, description: data!.description, location: data!.location, created_at: data!.created_at, is_recurring: false, recurring_id: null, recurrence: null, days_of_week: null, series_start_date: null, series_end_date: null, task_id: data!.task_id ? num(data!.task_id) : null };
};

export const deleteCalBlock = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_cal_blocks").delete().eq("id", id);
  if (error) err(error);
};

// ─── Recurring calendar blocks ──────────────────────────────────────────────

export const createRecurringCalBlock = async (
  title: string, startTime: string, endTime: string, color: string,
  recurrence: string, daysOfWeek: string | null, startDate: string,
  endDate: string | null, description: string | null, location: string | null,
): Promise<RecurringCalBlock> => {
  const { data, error } = await supabase
    .from("pf_recurring_cal_blocks")
    .insert({ user_id: USER_ID, title, start_time: startTime, end_time: endTime, color, recurrence, days_of_week: daysOfWeek, start_date: startDate, end_date: endDate, description, location })
    .select().single();
  if (error) err(error);
  return data! as RecurringCalBlock;
};

export const updateRecurringCalBlock = async (
  id: number, title: string, startTime: string, endTime: string, color: string,
  recurrence: string, daysOfWeek: string | null, endDate: string | null,
  description: string | null, location: string | null,
): Promise<void> => {
  const { error } = await supabase
    .from("pf_recurring_cal_blocks")
    .update({ title, start_time: startTime, end_time: endTime, color, recurrence, days_of_week: daysOfWeek, end_date: endDate, description, location })
    .eq("id", id);
  if (error) err(error);
};

export const deleteRecurringCalBlock = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_recurring_cal_blocks").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULE ENTRIES
// ═══════════════════════════════════════════════════════════════════════════

export const getScheduleEntriesByPlan = async (planId: number): Promise<ScheduleEntry[]> => {
  const { data, error } = await supabase
    .from("pf_schedule_entries")
    .select("*, pf_plans(title)")
    .eq("plan_id", planId)
    .order("created_at");
  if (error) err(error);
  return (data ?? []).map((e) => mapScheduleEntry(e));
};

export const getAllScheduleEntries = async (): Promise<ScheduleEntry[]> => {
  const { data, error } = await supabase
    .from("pf_schedule_entries")
    .select("*, pf_plans(title)")
    .eq("user_id", USER_ID)
    .order("start_time");
  if (error) err(error);
  return (data ?? []).map((e) => mapScheduleEntry(e));
};

/** Returns all schedule entries (one-off + expanded recurring) for a single date. */
export const getScheduleEntriesForDate = async (date: string): Promise<ScheduleEntry[]> => {
  const [{ data: oneOff }, { data: recurring }] = await Promise.all([
    supabase.from("pf_schedule_entries")
      .select("*, pf_plans(title)")
      .eq("user_id", USER_ID).eq("is_recurring", false).eq("date", date),
    supabase.from("pf_schedule_entries")
      .select("*, pf_plans(title)")
      .eq("user_id", USER_ID).eq("is_recurring", true)
      .lte("series_start_date", date)
      .or(`series_end_date.is.null,series_end_date.gte.${date}`),
  ]);
  return [
    ...(oneOff  ?? []).map((e) => mapScheduleEntry(e)),
    ...(recurring ?? []).flatMap((e) => expandScheduleEntries(e, date, date)),
  ];
};

export const createScheduleEntry = async (payload: {
  plan_id: number;
  title: string;
  description?: string | null;
  location?: string | null;
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  color?: string;
  category?: string;
  is_recurring?: boolean;
  recurrence?: string | null;
  days_of_week?: string | null;
  series_start_date?: string | null;
  series_end_date?: string | null;
}): Promise<ScheduleEntry> => {
  const { data, error } = await supabase
    .from("pf_schedule_entries")
    .insert({ user_id: USER_ID, ...payload })
    .select("*, pf_plans(title)")
    .single();
  if (error) err(error);
  return mapScheduleEntry(data!);
};

export const updateScheduleEntry = async (id: number, payload: {
  title: string;
  description?: string | null;
  location?: string | null;
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  color?: string;
  category?: string;
  is_recurring?: boolean;
  recurrence?: string | null;
  days_of_week?: string | null;
  series_start_date?: string | null;
  series_end_date?: string | null;
}): Promise<ScheduleEntry> => {
  const { data, error } = await supabase
    .from("pf_schedule_entries")
    .update(payload)
    .eq("id", id)
    .select("*, pf_plans(title)")
    .single();
  if (error) err(error);
  return mapScheduleEntry(data!);
};

export const deleteScheduleEntry = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_schedule_entries").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// JOURNAL
// ═══════════════════════════════════════════════════════════════════════════

export const getJournalEntry = async (date: string): Promise<string> => {
  const { data } = await supabase
    .from("pf_journal_entries").select("content").eq("user_id", USER_ID).eq("date", date).maybeSingle();
  return data?.content ?? "";
};

export const saveJournalEntry = async (date: string, content: string): Promise<void> => {
  const { error } = await supabase
    .from("pf_journal_entries")
    .upsert({ user_id: USER_ID, date, content, updated_at: new Date().toISOString() }, { onConflict: "user_id,date" });
  if (error) err(error);
};

export const getJournalForPeriod = async (date: string, period: string): Promise<string> => {
  const { data } = await supabase
    .from("pf_journal_entries")
    .select("content")
    .eq("user_id", USER_ID)
    .eq("date", date)
    .eq("period", period)
    .maybeSingle();
  return data?.content ?? "";
};

export const saveJournalForPeriod = async (date: string, period: string, content: string): Promise<void> => {
  const { error } = await supabase
    .from("pf_journal_entries")
    .upsert(
      { user_id: USER_ID, date, period, content, updated_at: new Date().toISOString() },
      { onConflict: "user_id,date,period" },
    );
  if (error) throw new Error(error.message);
};

export const getRules = async (): Promise<Rule[]> => {
  const { data, error } = await supabase
    .from("pf_rules").select("*").eq("user_id", USER_ID).order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as Rule[];
};

export const createRule = async (payload: { title: string; body?: string | null }): Promise<Rule> => {
  const { data, error } = await supabase
    .from("pf_rules").insert({ user_id: USER_ID, ...payload }).select().single();
  if (error) throw new Error(error.message);
  return data as Rule;
};

export const updateRule = async (id: number, payload: { title: string; body?: string | null }): Promise<Rule> => {
  const { data, error } = await supabase
    .from("pf_rules")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data as Rule;
};

export const deleteRule = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_rules").delete().eq("id", id);
  if (error) throw new Error(error.message);
};

// ═══════════════════════════════════════════════════════════════════════════
// COURSE ASSIGNMENTS
// ═══════════════════════════════════════════════════════════════════════════

type CAPayload = {
  plan_id: number; title: string; assignment_type: string; due_date?: string | null;
  status: string; priority: string; book_title?: string | null;
  chapter_start?: string | null; chapter_end?: string | null;
  page_start?: number | null; page_end?: number | null; page_current?: number | null;
  notes?: string | null; start_time?: string | null; end_time?: string | null;
  time_estimate?: number | null;
};

export const getCourseAssignments = async (): Promise<CourseAssignment[]> => {
  const { data, error } = await supabase
    .from("pf_course_assignments").select("*, pf_plans(title)").order("created_at", { ascending: false });
  if (error) err(error);
  return (data ?? []).map(mapCourseAssignment);
};

export const createCourseAssignment = async (payload: CAPayload): Promise<CourseAssignment> => {
  const { data, error } = await supabase
    .from("pf_course_assignments").insert(payload).select("*, pf_plans(title)").single();
  if (error) err(error);
  return mapCourseAssignment(data!);
};

export const updateCourseAssignment = async (id: number, payload: CAPayload): Promise<CourseAssignment> => {
  const { data, error } = await supabase
    .from("pf_course_assignments").update(payload).eq("id", id).select("*, pf_plans(title)").single();
  if (error) err(error);
  return mapCourseAssignment(data!);
};

export const deleteCourseAssignment = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_course_assignments").delete().eq("id", id);
  if (error) err(error);
};

// ─── CA subtasks ────────────────────────────────────────────────────────────

export const getCaSubtasks = async (assignmentId: number): Promise<CaSubtask[]> => {
  const { data, error } = await supabase
    .from("pf_ca_subtasks").select("*").eq("assignment_id", assignmentId).order("sort_order");
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), assignment_id: num(r.assignment_id), title: r.title, done: r.done, sort_order: r.sort_order }));
};

export const addCaSubtask = async (assignmentId: number, title: string): Promise<CaSubtask> => {
  const { data, error } = await supabase
    .from("pf_ca_subtasks").insert({ assignment_id: assignmentId, title }).select().single();
  if (error) err(error);
  return { id: num(data!.id), assignment_id: num(data!.assignment_id), title: data!.title, done: data!.done, sort_order: data!.sort_order };
};

export const toggleCaSubtask = async (id: number): Promise<CaSubtask> => {
  const { data: cur } = await supabase.from("pf_ca_subtasks").select("done").eq("id", id).single();
  const { data, error } = await supabase
    .from("pf_ca_subtasks").update({ done: !cur!.done }).eq("id", id).select().single();
  if (error) err(error);
  return { id: num(data!.id), assignment_id: num(data!.assignment_id), title: data!.title, done: data!.done, sort_order: data!.sort_order };
};

export const deleteCaSubtask = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_ca_subtasks").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINES
// ═══════════════════════════════════════════════════════════════════════════

type PipelineStepInput = {
  id?: number | null; title: string; description?: string | null;
  sort_order: number; time_estimate?: number | null;
  step_type?: string | null; attend_type?: string | null;
};

async function fetchPipelineRuns(templateId: number): Promise<PipelineRun[]> {
  const { data: runs, error } = await supabase
    .from("pf_pipeline_runs").select("*").eq("template_id", templateId).order("sort_order");
  if (error) err(error);
  if (!runs?.length) return [];

  const { data: steps } = await supabase
    .from("pf_pipeline_steps").select("*").eq("template_id", templateId).order("sort_order");

  const runIds = runs.map((r) => num(r.id));
  const { data: runSteps } = await supabase
    .from("pf_pipeline_run_steps").select("*").in("run_id", runIds);

  return runs.map((run): PipelineRun => ({
    id: num(run.id), template_id: num(run.template_id),
    title: run.title, notes: run.notes,
    scheduled_date: run.scheduled_date, sort_order: run.sort_order, created_at: run.created_at,
    steps: (steps ?? []).map((step): PipelineRunStep => {
      const rs = (runSteps ?? []).find(
        (x) => num(x.run_id) === num(run.id) && num(x.step_id) === num(step.id)
      );
      return {
        step_id: num(step.id), step_title: step.title,
        step_sort_order: step.sort_order, step_type: step.step_type,
        done: rs?.done ?? false, done_at: rs?.done_at ?? null,
        notes: rs?.notes ?? null, due_date: rs?.due_date ?? null,
        chapter_ref: rs?.chapter_ref ?? null,
        page_start: rs?.page_start ?? null, page_end: rs?.page_end ?? null,
        start_time: rs?.start_time ?? null, end_time: rs?.end_time ?? null,
        location: rs?.location ?? null, time_estimate: rs?.time_estimate ?? null,
        assignment_id: rs?.assignment_id ? num(rs.assignment_id) : null,
        due_date_2: rs?.due_date_2 ?? null,
      };
    }),
  }));
}

export const getPipelineTemplates = async (planId: number): Promise<PipelineTemplate[]> => {
  const { data: templates, error } = await supabase
    .from("pf_pipeline_templates").select("*").eq("plan_id", planId).order("created_at");
  if (error) err(error);
  if (!templates?.length) return [];

  const templateIds = templates.map((t) => num(t.id));
  const [{ data: steps }, { data: runs }, { data: runSteps }] = await Promise.all([
    supabase.from("pf_pipeline_steps").select("*").in("template_id", templateIds).order("sort_order"),
    supabase.from("pf_pipeline_runs").select("id, template_id").in("template_id", templateIds),
    supabase.from("pf_pipeline_run_steps").select("run_id, done"),
  ]);

  return templates.map((t): PipelineTemplate => {
    const tSteps = (steps ?? []).filter((s) => num(s.template_id) === num(t.id));
    const tRuns  = (runs  ?? []).filter((r) => num(r.template_id) === num(t.id));
    const doneRunCount = tRuns.filter((run) => {
      const rs = (runSteps ?? []).filter((x) => num(x.run_id) === num(run.id));
      return rs.length > 0 && rs.every((x) => x.done);
    }).length;

    return {
      id: num(t.id), plan_id: num(t.plan_id), title: t.title,
      description: t.description, color: t.color, created_at: t.created_at,
      steps: tSteps.map(mapPipelineStep),
      run_count: tRuns.length, done_run_count: doneRunCount,
    };
  });
};

export const createPipelineTemplate = async (payload: {
  plan_id: number; title: string; description?: string | null; color?: string;
}): Promise<PipelineTemplate> => {
  const { data, error } = await supabase
    .from("pf_pipeline_templates").insert(payload).select().single();
  if (error) err(error);
  return { id: num(data!.id), plan_id: num(data!.plan_id), title: data!.title, description: data!.description, color: data!.color, created_at: data!.created_at, steps: [], run_count: 0, done_run_count: 0 };
};

export const updatePipelineTemplate = async (id: number, payload: { title: string; description?: string | null; color: string }): Promise<PipelineTemplate> => {
  const { data, error } = await supabase
    .from("pf_pipeline_templates").update(payload).eq("id", id).select().single();
  if (error) err(error);
  const [full] = await getPipelineTemplates(num(data!.plan_id));
  return full;
};

export const deletePipelineTemplate = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_pipeline_templates").delete().eq("id", id);
  if (error) err(error);
};

export const upsertPipelineSteps = async (templateId: number, steps: PipelineStepInput[]): Promise<PipelineStep[]> => {
  const { data: existing } = await supabase
    .from("pf_pipeline_steps").select("id").eq("template_id", templateId);
  const existingIds = new Set((existing ?? []).map((s) => num(s.id)));
  const keepIds     = new Set(steps.filter((s) => s.id).map((s) => s.id!));
  const toDelete    = [...existingIds].filter((id) => !keepIds.has(id));

  if (toDelete.length > 0) {
    await supabase.from("pf_pipeline_steps").delete().in("id", toDelete);
  }

  for (const step of steps) {
    const row = {
      title: step.title, description: step.description ?? null,
      sort_order: step.sort_order, time_estimate: step.time_estimate ?? null,
      step_type: step.step_type ?? "generic", attend_type: step.attend_type ?? null,
    };
    if (step.id) {
      await supabase.from("pf_pipeline_steps").update(row).eq("id", step.id);
    } else {
      await supabase.from("pf_pipeline_steps").insert({ template_id: templateId, ...row });
    }
  }

  const { data } = await supabase
    .from("pf_pipeline_steps").select("*").eq("template_id", templateId).order("sort_order");
  return (data ?? []).map(mapPipelineStep);
};

export const getPipelineRuns = async (templateId: number): Promise<PipelineRun[]> => {
  return fetchPipelineRuns(templateId);
};

export const createPipelineRun = async (payload: {
  template_id: number; title: string; notes?: string | null; scheduled_date?: string | null;
}): Promise<PipelineRun> => {
  const { data: run, error } = await supabase
    .from("pf_pipeline_runs").insert(payload).select().single();
  if (error) err(error);

  // Auto-initialise run_steps; attend steps get scheduled_date pre-filled
  const { data: steps } = await supabase
    .from("pf_pipeline_steps").select("id, step_type, attend_type, title")
    .eq("template_id", payload.template_id);
  if (steps?.length) {
    await supabase.from("pf_pipeline_run_steps").insert(
      steps.map((s) => ({
        run_id:   num(run!.id),
        step_id:  num(s.id),
        ...(s.step_type === "attend" && payload.scheduled_date
          ? { due_date: payload.scheduled_date }
          : {}),
      }))
    );
  }

  // If a date was provided, immediately create the course_assignment for attend steps
  if (payload.scheduled_date && steps?.length) {
    const attendSteps = steps.filter((s) => s.step_type === "attend");
    if (attendSteps.length) {
      const { data: tmpl } = await supabase
        .from("pf_pipeline_templates").select("plan_id").eq("id", payload.template_id).single();
      if (tmpl?.plan_id) {
        const planId = num(tmpl.plan_id);
        for (const s of attendSteps) {
          const title = `${payload.title}${s.title ? ` — ${s.title}` : ""}`;
          const { data: newAsg } = await supabase
            .from("pf_course_assignments")
            .insert({
              plan_id:         planId,
              title,
              assignment_type: s.attend_type ?? "lecture",
              due_date:        payload.scheduled_date,
              status:          "pending",
              priority:        "medium",
            })
            .select("id").single();
          if (newAsg) {
            await supabase.from("pf_pipeline_run_steps")
              .update({ assignment_id: num(newAsg.id) })
              .eq("run_id", num(run!.id))
              .eq("step_id", num(s.id));
          }
        }
      }
    }
  }

  const runs = await fetchPipelineRuns(payload.template_id);
  return runs.find((r) => r.id === num(run!.id))!;
};

export const updatePipelineRun = async (id: number, payload: { title: string; notes?: string | null; scheduled_date?: string | null }): Promise<PipelineRun> => {
  const { data, error } = await supabase
    .from("pf_pipeline_runs").update(payload).eq("id", id).select().single();
  if (error) err(error);
  const runs = await fetchPipelineRuns(num(data!.template_id));
  return runs.find((r) => r.id === id)!;
};

export const deletePipelineRun = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_pipeline_runs").delete().eq("id", id);
  if (error) err(error);
};

export const togglePipelineRunStep = async (runId: number, stepId: number): Promise<PipelineRun> => {
  const { data: existing } = await supabase
    .from("pf_pipeline_run_steps").select("done").eq("run_id", runId).eq("step_id", stepId).maybeSingle();

  if (existing) {
    const nowDone = !existing.done;
    await supabase.from("pf_pipeline_run_steps")
      .update({ done: nowDone, done_at: nowDone ? new Date().toISOString() : null })
      .eq("run_id", runId).eq("step_id", stepId);
  } else {
    await supabase.from("pf_pipeline_run_steps")
      .insert({ run_id: runId, step_id: stepId, done: true, done_at: new Date().toISOString() });
  }

  const { data: run } = await supabase.from("pf_pipeline_runs").select("template_id").eq("id", runId).single();
  const runs = await fetchPipelineRuns(num(run!.template_id));
  return runs.find((r) => r.id === runId)!;
};

export const updatePipelineRunStep = async (
  runId: number, stepId: number,
  payload: { notes: string | null; due_date: string | null; due_date_2: string | null; chapter_ref: string | null; page_start: number | null; page_end: number | null; start_time: string | null; end_time: string | null; location: string | null; time_estimate: number | null },
): Promise<PipelineRun> => {
  await supabase.from("pf_pipeline_run_steps").update(payload).eq("run_id", runId).eq("step_id", stepId);

  // ── Sync attend steps → pf_course_assignments for weekly overview ──────────
  // Only "attend" type steps (lectures, theory sessions, labs) need a calendar
  // entry. Read the step definition and the run's plan context in parallel.
  const [{ data: stepRow }, { data: runRow }] = await Promise.all([
    supabase.from("pf_pipeline_steps")
      .select("step_type, attend_type, title, template_id")
      .eq("id", stepId)
      .single(),
    supabase.from("pf_pipeline_runs")
      .select("title, template_id")
      .eq("id", runId)
      .single(),
  ]);

  if (stepRow?.step_type === "attend" && runRow) {
    // Fetch plan_id from the template and existing assignment_id in parallel.
    const [{ data: templateRow }, { data: rsRow }] = await Promise.all([
      supabase.from("pf_pipeline_templates")
        .select("plan_id")
        .eq("id", runRow.template_id)
        .single(),
      supabase.from("pf_pipeline_run_steps")
        .select("assignment_id")
        .eq("run_id", runId)
        .eq("step_id", stepId)
        .single(),
    ]);

    const planId         = templateRow?.plan_id ? num(templateRow.plan_id) : null;
    const existingAsgId  = rsRow?.assignment_id ? num(rsRow.assignment_id) : null;

    if (planId) {
      const assignmentType = stepRow.attend_type ?? "lecture";
      const title          = `${runRow.title}${stepRow.title ? ` — ${stepRow.title}` : ""}`;

      if (existingAsgId) {
        // Update the already-linked course assignment's schedule fields.
        await supabase.from("pf_course_assignments").update({
          due_date:   payload.due_date,
          start_time: payload.start_time,
          end_time:   payload.end_time,
        }).eq("id", existingAsgId);
      } else if (payload.due_date) {
        // Create a new course assignment and store the back-link.
        const { data: newAsg } = await supabase.from("pf_course_assignments")
          .insert({
            plan_id:         planId,
            title,
            assignment_type: assignmentType,
            due_date:        payload.due_date,
            start_time:      payload.start_time,
            end_time:        payload.end_time,
            status:          "pending",
            priority:        "medium",
          })
          .select("id")
          .single();

        if (newAsg) {
          await supabase.from("pf_pipeline_run_steps")
            .update({ assignment_id: num(newAsg.id) })
            .eq("run_id", runId)
            .eq("step_id", stepId);
        }
      }

      // Keep the run card's scheduled_date in sync with the attend step's date.
      await supabase.from("pf_pipeline_runs")
        .update({ scheduled_date: payload.due_date })
        .eq("id", runId);
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  const { data: run } = await supabase.from("pf_pipeline_runs").select("template_id").eq("id", runId).single();
  const runs = await fetchPipelineRuns(num(run!.template_id));
  return runs.find((r) => r.id === runId)!;
};

// ─── Pipeline step subtasks ──────────────────────────────────────────────────

export const getPipelineStepSubtasks = async (runId: number, stepId: number): Promise<PipelineStepSubtask[]> => {
  const { data, error } = await supabase
    .from("pf_pipeline_step_subtasks").select("*").eq("run_id", runId).eq("step_id", stepId).order("sort_order");
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), run_id: num(r.run_id), step_id: num(r.step_id), title: r.title, done: r.done, sort_order: r.sort_order }));
};

export const addPipelineStepSubtask = async (runId: number, stepId: number, title: string): Promise<PipelineStepSubtask> => {
  const { data, error } = await supabase
    .from("pf_pipeline_step_subtasks").insert({ run_id: runId, step_id: stepId, title }).select().single();
  if (error) err(error);
  return { id: num(data!.id), run_id: num(data!.run_id), step_id: num(data!.step_id), title: data!.title, done: data!.done, sort_order: data!.sort_order };
};

export const togglePipelineStepSubtask = async (id: number): Promise<PipelineStepSubtask> => {
  const { data: cur } = await supabase.from("pf_pipeline_step_subtasks").select("done").eq("id", id).single();
  const { data, error } = await supabase
    .from("pf_pipeline_step_subtasks").update({ done: !cur!.done }).eq("id", id).select().single();
  if (error) err(error);
  return { id: num(data!.id), run_id: num(data!.run_id), step_id: num(data!.step_id), title: data!.title, done: data!.done, sort_order: data!.sort_order };
};

export const deletePipelineStepSubtask = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_pipeline_step_subtasks").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// COURSE BOOKS
// ═══════════════════════════════════════════════════════════════════════════

type CreateCourseBookPayload = { plan_id: number; title: string; author?: string | null; total_pages?: number | null; total_chapters?: number | null; daily_pages_goal?: number; weekly_chapters_goal?: number };
type UpdateCourseBookPayload = { title: string; author?: string | null; total_pages?: number | null; total_chapters?: number | null; current_page: number; current_chapter: number; daily_pages_goal: number; weekly_chapters_goal: number };
type CreateBookReadingLogPayload = { book_id: number; date: string; pages_read: number; chapters_read: number; note?: string | null };
type BookSectionInput = { id?: number | null; title: string; kind: string; sort_order: number; page_start?: number | null; page_end?: number | null; due_date?: string | null; time_estimate?: number | null };

async function fetchCourseBook(id: number): Promise<CourseBook> {
  const { data, error } = await supabase
    .from("pf_course_books")
    .select("*, pf_book_sections(*), pf_book_reading_log(*)")
    .eq("id", id).single();
  if (error) err(error);
  return mapCourseBook(data!);
}

export const getCourseBooks = async (planId: number): Promise<CourseBook[]> => {
  const { data, error } = await supabase
    .from("pf_course_books")
    .select("*, pf_book_sections(*), pf_book_reading_log(*)")
    .eq("plan_id", planId).order("created_at");
  if (error) err(error);
  return (data ?? []).map(mapCourseBook);
};

export const createCourseBook = async (payload: CreateCourseBookPayload): Promise<CourseBook> => {
  const { data, error } = await supabase
    .from("pf_course_books").insert(payload).select().single();
  if (error) err(error);
  return fetchCourseBook(num(data!.id));
};

export const updateCourseBook = async (id: number, payload: UpdateCourseBookPayload): Promise<CourseBook> => {
  const { error } = await supabase.from("pf_course_books").update(payload).eq("id", id);
  if (error) err(error);
  return fetchCourseBook(id);
};

export const deleteCourseBook = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_course_books").delete().eq("id", id);
  if (error) err(error);
};

export const addBookReadingLog = async (payload: CreateBookReadingLogPayload): Promise<CourseBook> => {
  const { error } = await supabase.from("pf_book_reading_log").insert(payload);
  if (error) err(error);
  return fetchCourseBook(payload.book_id);
};

export const deleteBookReadingLog = async (logId: number, bookId: number): Promise<CourseBook> => {
  const { error } = await supabase.from("pf_book_reading_log").delete().eq("id", logId);
  if (error) err(error);
  return fetchCourseBook(bookId);
};

export const upsertBookSections = async (bookId: number, sections: BookSectionInput[]): Promise<CourseBook> => {
  const { data: existing } = await supabase
    .from("pf_book_sections").select("id").eq("book_id", bookId);
  const existingIds = new Set((existing ?? []).map((s) => num(s.id)));
  const keepIds     = new Set(sections.filter((s) => s.id).map((s) => s.id!));
  const toDelete    = [...existingIds].filter((id) => !keepIds.has(id));

  if (toDelete.length > 0) {
    await supabase.from("pf_book_sections").delete().in("id", toDelete);
  }
  for (const s of sections) {
    const row = { title: s.title, kind: s.kind, sort_order: s.sort_order, page_start: s.page_start ?? null, page_end: s.page_end ?? null, due_date: s.due_date ?? null, time_estimate: s.time_estimate ?? null };
    if (s.id) {
      await supabase.from("pf_book_sections").update(row).eq("id", s.id);
    } else {
      await supabase.from("pf_book_sections").insert({ book_id: bookId, ...row });
    }
  }
  return fetchCourseBook(bookId);
};

export const toggleBookSection = async (bookId: number, sectionId: number): Promise<CourseBook> => {
  const { data: cur } = await supabase.from("pf_book_sections").select("done").eq("id", sectionId).single();
  const nowDone = !cur!.done;
  await supabase.from("pf_book_sections")
    .update({ done: nowDone, done_at: nowDone ? new Date().toISOString() : null })
    .eq("id", sectionId);
  return fetchCourseBook(bookId);
};

export const updateBookSection = async (sectionId: number, notes: string | null, dueDate: string | null): Promise<BookSection> => {
  const { data, error } = await supabase
    .from("pf_book_sections")
    .update({ notes, due_date: dueDate })
    .eq("id", sectionId).select().single();
  if (error) err(error);
  return mapBookSection(data!);
};

// ═══════════════════════════════════════════════════════════════════════════
// LIFESTYLE AREAS
// ═══════════════════════════════════════════════════════════════════════════

export const getLifestyleAreas = async (): Promise<LifestyleArea[]> => {
  const { data, error } = await supabase
    .from("pf_lifestyle_areas").select("*").eq("user_id", USER_ID).order("sort_order");
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), name: r.name, color: r.color, sort_order: r.sort_order }));
};

export const createLifestyleArea = async (name: string, color: string): Promise<LifestyleArea> => {
  const { data, error } = await supabase
    .from("pf_lifestyle_areas").insert({ user_id: USER_ID, name, color }).select().single();
  if (error) err(error);
  return { id: num(data!.id), name: data!.name, color: data!.color, sort_order: data!.sort_order };
};

export const updateLifestyleArea = async (id: number, name: string, color: string, sortOrder: number): Promise<LifestyleArea> => {
  const { data, error } = await supabase
    .from("pf_lifestyle_areas").update({ name, color, sort_order: sortOrder }).eq("id", id).select().single();
  if (error) err(error);
  return { id: num(data!.id), name: data!.name, color: data!.color, sort_order: data!.sort_order };
};

export const deleteLifestyleArea = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_lifestyle_areas").delete().eq("id", id);
  if (error) err(error);
};

export const getLifestyleItems = async (areaId: number | null): Promise<{ systems: SystemEntry[]; plans: Plan[] }> => {
  let sQ = supabase.from("pf_systems").select("*").eq("user_id", USER_ID).eq("is_lifestyle", true);
  let pQ = supabase.from("pf_plans").select("*").eq("user_id", USER_ID).eq("is_lifestyle", true);
  if (areaId !== null) {
    sQ = sQ.eq("lifestyle_area_id", areaId);
    pQ = pQ.eq("lifestyle_area_id", areaId);
  }
  const [{ data: systems }, { data: plans }] = await Promise.all([sQ, pQ]);
  return { systems: (systems ?? []).map(mapSystem), plans: (plans ?? []).map((p) => mapPlan(p)) };
};

// ═══════════════════════════════════════════════════════════════════════════
// GAMES
// ═══════════════════════════════════════════════════════════════════════════

export const getGames = async (): Promise<Game[]> => {
  const { data, error } = await supabase
    .from("pf_games")
    .select("*, pf_game_features(id, status)")
    .eq("user_id", USER_ID).order("created_at", { ascending: false });
  if (error) err(error);
  return (data ?? []).map((g) => ({
    id: num(g.id), title: g.title, genre: g.genre, platform: g.platform, engine: g.engine,
    status: g.status, description: g.description, core_mechanic: g.core_mechanic,
    target_audience: g.target_audience, inspiration: g.inspiration, color: g.color,
    created_at: g.created_at,
    feature_count: (g.pf_game_features ?? []).length,
    done_count: (g.pf_game_features ?? []).filter((f: any) => f.status === 'done').length,
  }));
};

export const createGame = async (payload: {
  title: string; genre?: string | null; platform?: string | null; engine?: string | null;
  status?: string; description?: string | null; core_mechanic?: string | null;
  target_audience?: string | null; inspiration?: string | null; color?: string;
}): Promise<Game> => {
  const { data, error } = await supabase
    .from("pf_games").insert({ user_id: USER_ID, ...payload }).select("*, pf_game_features(id, status)").single();
  if (error) err(error);
  return { id: num(data!.id), title: data!.title, genre: data!.genre, platform: data!.platform, engine: data!.engine, status: data!.status, description: data!.description, core_mechanic: data!.core_mechanic, target_audience: data!.target_audience, inspiration: data!.inspiration, color: data!.color, created_at: data!.created_at, feature_count: 0, done_count: 0 };
};

export const updateGame = async (id: number, payload: {
  title: string; genre?: string | null; platform?: string | null; engine?: string | null;
  status: string; description?: string | null; core_mechanic?: string | null;
  target_audience?: string | null; inspiration?: string | null; color: string;
}): Promise<Game> => {
  const { error } = await supabase.from("pf_games").update(payload).eq("id", id);
  if (error) err(error);
  const games = await getGames();
  return games.find((g) => g.id === id)!;
};

export const deleteGame = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_games").delete().eq("id", id);
  if (error) err(error);
};

// ─── Game features ───────────────────────────────────────────────────────────

export const getGameFeatures = async (gameId: number): Promise<GameFeature[]> => {
  const { data, error } = await supabase
    .from("pf_game_features").select("*").eq("game_id", gameId).order("sort_order");
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), game_id: num(r.game_id), title: r.title, description: r.description, status: r.status, priority: r.priority, sort_order: r.sort_order, created_at: r.created_at }));
};

export const createGameFeature = async (payload: { game_id: number; title: string; description?: string | null; status?: string; priority?: string }): Promise<GameFeature> => {
  const { data, error } = await supabase.from("pf_game_features").insert(payload).select().single();
  if (error) err(error);
  return { id: num(data!.id), game_id: num(data!.game_id), title: data!.title, description: data!.description, status: data!.status, priority: data!.priority, sort_order: data!.sort_order, created_at: data!.created_at };
};

export const updateGameFeature = async (id: number, payload: { title: string; description?: string | null; status: string; priority: string }): Promise<GameFeature> => {
  const { data, error } = await supabase.from("pf_game_features").update(payload).eq("id", id).select().single();
  if (error) err(error);
  return { id: num(data!.id), game_id: num(data!.game_id), title: data!.title, description: data!.description, status: data!.status, priority: data!.priority, sort_order: data!.sort_order, created_at: data!.created_at };
};

export const setGameFeatureStatus = async (id: number, status: string): Promise<GameFeature> => {
  const { data, error } = await supabase.from("pf_game_features").update({ status }).eq("id", id).select().single();
  if (error) err(error);
  return { id: num(data!.id), game_id: num(data!.game_id), title: data!.title, description: data!.description, status: data!.status, priority: data!.priority, sort_order: data!.sort_order, created_at: data!.created_at };
};

export const deleteGameFeature = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_game_features").delete().eq("id", id);
  if (error) err(error);
};

// ─── Game devlog ─────────────────────────────────────────────────────────────

export const getGameDevlog = async (gameId: number): Promise<GameDevlogEntry[]> => {
  const { data, error } = await supabase
    .from("pf_game_devlog").select("*").eq("game_id", gameId).order("created_at", { ascending: false });
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), game_id: num(r.game_id), content: r.content, created_at: r.created_at }));
};

export const addGameDevlogEntry = async (payload: { game_id: number; content: string }): Promise<GameDevlogEntry> => {
  const { data, error } = await supabase.from("pf_game_devlog").insert(payload).select().single();
  if (error) err(error);
  return { id: num(data!.id), game_id: num(data!.game_id), content: data!.content, created_at: data!.created_at };
};

export const deleteGameDevlogEntry = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_game_devlog").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// DAILY HABITS
// ═══════════════════════════════════════════════════════════════════════════

export const getHabitsForDate = async (date: string): Promise<HabitWithCompletion[]> => {
  const { data: habits, error } = await supabase
    .from("pf_daily_habits").select("*").eq("user_id", USER_ID).order("sort_order");
  if (error) err(error);
  if (!habits?.length) return [];

  const habitIds = habits.map((h) => num(h.id));
  // Fetch last 60 days for streak + recent_dates
  const since = new Date(date);
  since.setDate(since.getDate() - 59);
  const sinceStr = since.toISOString().split("T")[0];

  const { data: completions } = await supabase
    .from("pf_habit_completions").select("habit_id, date")
    .in("habit_id", habitIds).gte("date", sinceStr);

  // Subtask counts for progress display
  const { data: subtaskRows } = await supabase
    .from("pf_habit_subtasks").select("id, habit_id").in("habit_id", habitIds);
  const subtaskIds = (subtaskRows ?? []).map((s) => num(s.id));
  const { data: subtaskDone } = subtaskIds.length
    ? await supabase.from("pf_habit_subtask_completions").select("subtask_id").in("subtask_id", subtaskIds).eq("date", date)
    : { data: [] };
  const subtaskDoneSet = new Set((subtaskDone ?? []).map((c) => num(c.subtask_id)));

  return habits.map((h): HabitWithCompletion => {
    const hc = (completions ?? []).filter((c) => num(c.habit_id) === num(h.id));
    const doneSet = new Set(hc.map((c) => c.date));
    const recent_dates = hc.filter((c) => {
      const d = new Date(date);
      d.setDate(d.getDate() - 6);
      return c.date >= d.toISOString().split("T")[0];
    }).map((c) => c.date).sort();

    let streak = 0;
    let cur = new Date(date + "T00:00:00Z");
    while (doneSet.has(cur.toISOString().split("T")[0])) {
      streak++;
      cur.setUTCDate(cur.getUTCDate() - 1);
    }

    const mySubtasks = (subtaskRows ?? []).filter((s) => num(s.habit_id) === num(h.id));
    const subtask_count = mySubtasks.length;
    const subtask_done_count = mySubtasks.filter((s) => subtaskDoneSet.has(num(s.id))).length;

    return { id: num(h.id), title: h.title, color: h.color, sort_order: h.sort_order, stack_id: h.stack_id ? num(h.stack_id) : null, done: doneSet.has(date), streak, recent_dates, subtask_count, subtask_done_count };
  });
};

export const createDailyHabit = async (payload: { title: string; color?: string; stack_id?: number | null }): Promise<DailyHabit> => {
  const { data, error } = await supabase
    .from("pf_daily_habits").insert({ user_id: USER_ID, ...payload }).select().single();
  if (error) err(error);
  return { id: num(data!.id), title: data!.title, color: data!.color, sort_order: data!.sort_order, stack_id: data!.stack_id ? num(data!.stack_id) : null };
};

export const updateDailyHabit = async (id: number, payload: { title?: string; color?: string; stack_id?: number | null }): Promise<void> => {
  const { error } = await supabase.from("pf_daily_habits").update(payload).eq("id", id);
  if (error) err(error);
};

export const deleteDailyHabit = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_daily_habits").delete().eq("id", id);
  if (error) err(error);
};

// ── Habit Stacks ─────────────────────────────────────────────────────────────

export const getHabitStacks = async (): Promise<HabitStack[]> => {
  const { data, error } = await supabase
    .from("pf_habit_stacks").select("*").eq("user_id", USER_ID).order("sort_order");
  if (error) err(error);
  return (data ?? []).map((s) => ({ id: num(s.id), title: s.title, color: s.color, sort_order: s.sort_order }));
};

export const createHabitStack = async (payload: { title: string; color?: string }): Promise<HabitStack> => {
  const { data, error } = await supabase
    .from("pf_habit_stacks").insert({ user_id: USER_ID, ...payload }).select().single();
  if (error) err(error);
  return { id: num(data!.id), title: data!.title, color: data!.color, sort_order: data!.sort_order };
};

export const updateHabitStack = async (id: number, payload: { title?: string; color?: string }): Promise<void> => {
  const { error } = await supabase.from("pf_habit_stacks").update(payload).eq("id", id);
  if (error) err(error);
};

export const deleteHabitStack = async (id: number): Promise<void> => {
  // Detach habits first
  await supabase.from("pf_daily_habits").update({ stack_id: null }).eq("stack_id", id);
  const { error } = await supabase.from("pf_habit_stacks").delete().eq("id", id);
  if (error) err(error);
};

export const toggleHabitCompletion = async (habitId: number, date: string): Promise<boolean> => {
  const { data: existing } = await supabase
    .from("pf_habit_completions").select("id").eq("habit_id", habitId).eq("date", date).maybeSingle();
  if (existing) {
    await supabase.from("pf_habit_completions").delete().eq("id", existing.id);
    return false;
  }
  await supabase.from("pf_habit_completions").insert({ habit_id: habitId, date });
  return true;
};

// ── Habit Subtasks ────────────────────────────────────────────────────────────

export const getHabitSubtasks = async (habitId: number, date: string): Promise<HabitSubtask[]> => {
  const { data: subtasks, error } = await supabase
    .from("pf_habit_subtasks").select("*").eq("habit_id", habitId).order("sort_order");
  if (error) err(error);
  if (!subtasks?.length) return [];

  const ids = subtasks.map((s) => num(s.id));
  const { data: completions } = await supabase
    .from("pf_habit_subtask_completions").select("subtask_id")
    .in("subtask_id", ids).eq("date", date);
  const doneSet = new Set((completions ?? []).map((c) => num(c.subtask_id)));

  return subtasks.map((s) => ({
    id: num(s.id), habit_id: num(s.habit_id),
    title: s.title, sort_order: num(s.sort_order), done: doneSet.has(num(s.id)),
  }));
};

export const addHabitSubtask = async (habitId: number, title: string, date: string): Promise<HabitSubtask[]> => {
  const { error } = await supabase
    .from("pf_habit_subtasks").insert({ habit_id: habitId, user_id: USER_ID, title });
  if (error) err(error);
  return getHabitSubtasks(habitId, date);
};

export const deleteHabitSubtask = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_habit_subtasks").delete().eq("id", id);
  if (error) err(error);
};

export const toggleHabitSubtask = async (subtaskId: number, date: string): Promise<HabitSubtask[]> => {
  const { data: existing } = await supabase
    .from("pf_habit_subtask_completions").select("id")
    .eq("subtask_id", subtaskId).eq("date", date).maybeSingle();

  if (existing) {
    await supabase.from("pf_habit_subtask_completions").delete().eq("id", existing.id);
  } else {
    await supabase.from("pf_habit_subtask_completions").insert({ subtask_id: subtaskId, date });
  }

  const { data: subtask } = await supabase
    .from("pf_habit_subtasks").select("habit_id").eq("id", subtaskId).single();
  return getHabitSubtasks(num(subtask!.habit_id), date);
};

// ═══════════════════════════════════════════════════════════════════════════
// RUN LOGS
// ═══════════════════════════════════════════════════════════════════════════

export const getRunLogs = async (): Promise<RunLog[]> => {
  const { data, error } = await supabase
    .from("pf_run_logs").select("*").eq("user_id", USER_ID).order("date", { ascending: false });
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), date: r.date, distance_km: r.distance_km, duration_min: r.duration_min, notes: r.notes, created_at: r.created_at }));
};

export const createRunLog = async (payload: { date: string; distance_km?: number | null; duration_min?: number | null; notes?: string | null }): Promise<RunLog> => {
  const { data, error } = await supabase
    .from("pf_run_logs").insert({ user_id: USER_ID, ...payload }).select().single();
  if (error) err(error);
  return { id: num(data!.id), date: data!.date, distance_km: data!.distance_km, duration_min: data!.duration_min, notes: data!.notes, created_at: data!.created_at };
};

export const deleteRunLog = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_run_logs").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// WORKOUT LOGS
// ═══════════════════════════════════════════════════════════════════════════

export const getWorkoutLogs = async (): Promise<WorkoutLog[]> => {
  const { data, error } = await supabase
    .from("pf_workout_logs")
    .select("*, pf_workout_exercises(*)")
    .eq("user_id", USER_ID).order("date", { ascending: false });
  if (error) err(error);
  return (data ?? []).map((w) => ({
    id: num(w.id), date: w.date, name: w.name, notes: w.notes, created_at: w.created_at,
    exercises: (w.pf_workout_exercises ?? [])
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((e: any): WorkoutExercise => ({ id: num(e.id), workout_id: num(e.workout_id), name: e.name, sets: e.sets, reps: e.reps, weight_kg: e.weight_kg, notes: e.notes, sort_order: e.sort_order })),
  }));
};

export const createWorkoutLog = async (payload: { date: string; name: string; notes?: string | null }): Promise<WorkoutLog> => {
  const { data, error } = await supabase
    .from("pf_workout_logs").insert({ user_id: USER_ID, ...payload }).select().single();
  if (error) err(error);
  return { id: num(data!.id), date: data!.date, name: data!.name, notes: data!.notes, created_at: data!.created_at, exercises: [] };
};

export const deleteWorkoutLog = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_workout_logs").delete().eq("id", id);
  if (error) err(error);
};

async function fetchWorkoutLog(id: number): Promise<WorkoutLog> {
  const { data, error } = await supabase
    .from("pf_workout_logs").select("*, pf_workout_exercises(*)").eq("id", id).single();
  if (error) err(error);
  return { id: num(data!.id), date: data!.date, name: data!.name, notes: data!.notes, created_at: data!.created_at, exercises: (data!.pf_workout_exercises ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order).map((e: any): WorkoutExercise => ({ id: num(e.id), workout_id: num(e.workout_id), name: e.name, sets: e.sets, reps: e.reps, weight_kg: e.weight_kg, notes: e.notes, sort_order: e.sort_order })) };
}

export const addWorkoutExercise = async (payload: { workout_id: number; name: string; sets?: number | null; reps?: number | null; weight_kg?: number | null; notes?: string | null }): Promise<WorkoutLog> => {
  const { error } = await supabase.from("pf_workout_exercises").insert(payload);
  if (error) err(error);
  return fetchWorkoutLog(payload.workout_id);
};

export const deleteWorkoutExercise = async (id: number, workoutId: number): Promise<WorkoutLog> => {
  const { error } = await supabase.from("pf_workout_exercises").delete().eq("id", id);
  if (error) err(error);
  return fetchWorkoutLog(workoutId);
};

// ═══════════════════════════════════════════════════════════════════════════
// ROADMAP
// ═══════════════════════════════════════════════════════════════════════════

export const getRoadmapItems = async (planId: number): Promise<RoadmapItem[]> => {
  const { data, error } = await supabase
    .from("pf_roadmap_items").select("*").eq("plan_id", planId).order("sort_order");
  if (error) err(error);
  return (data ?? []).map(mapRoadmapItem);
};

export const createRoadmapItem = async (payload: { plan_id: number; title: string; description?: string | null; due_date?: string | null }): Promise<RoadmapItem> => {
  const { data, error } = await supabase.from("pf_roadmap_items").insert(payload).select().single();
  if (error) err(error);
  return mapRoadmapItem(data!);
};

export const updateRoadmapItem = async (id: number, payload: { title: string; description?: string | null; due_date?: string | null; status: string }): Promise<RoadmapItem> => {
  const { data, error } = await supabase.from("pf_roadmap_items").update(payload).eq("id", id).select().single();
  if (error) err(error);
  return mapRoadmapItem(data!);
};

export const deleteRoadmapItem = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_roadmap_items").delete().eq("id", id);
  if (error) err(error);
};

export const setRoadmapItemStatus = async (id: number, status: string): Promise<RoadmapItem> => {
  const { data, error } = await supabase.from("pf_roadmap_items").update({ status }).eq("id", id).select().single();
  if (error) err(error);
  return mapRoadmapItem(data!);
};

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT / UTILITY
// ═══════════════════════════════════════════════════════════════════════════

export const exportData = async (): Promise<string> => {
  const [goals, plans, tasks, systems] = await Promise.all([
    getGoals(), getPlans(), getAllTasks(), getSystems(),
  ]);
  return JSON.stringify({ goals, plans, tasks, systems }, null, 2);
};

export const getDbPath = async (): Promise<string> => {
  return `${import.meta.env.VITE_SUPABASE_URL}/rest/v1`;
};

// ═══════════════════════════════════════════════════════════════════════════
// TRAINING PLANS
// ═══════════════════════════════════════════════════════════════════════════

function mapTrainingPlan(r: any): TrainingPlan {
  return {
    id: num(r.id), user_id: r.user_id, title: r.title,
    description: r.description, color: r.color, goal: r.goal,
    days_per_week: r.days_per_week,
    plan_type: (r.plan_type ?? "other") as TrainingPlan["plan_type"],
    created_at: r.created_at,
  };
}

function mapTrainingSession(r: any, planTitle?: string | null): TrainingSession {
  return {
    id: num(r.id), user_id: r.user_id,
    plan_id: r.plan_id ? num(r.plan_id) : null,
    plan_title: planTitle ?? r.pf_training_plans?.title ?? null,
    plan_type: r.pf_training_plans?.plan_type ?? null,
    title: r.title, scheduled_date: r.scheduled_date,
    start_time: r.start_time, end_time: r.end_time,
    location: r.location, notes: r.notes,
    completed: r.completed, created_at: r.created_at,
  };
}

function mapSessionPerformance(r: any): SessionPerformance {
  return {
    id: num(r.id), user_id: r.user_id, session_id: num(r.session_id),
    metric_name: r.metric_name, value: r.value, unit: r.unit, created_at: r.created_at,
  };
}

export const getTrainingPlans = async (): Promise<TrainingPlan[]> => {
  const { data, error } = await supabase
    .from("pf_training_plans").select("*").eq("user_id", USER_ID).order("created_at");
  if (error) err(error);
  return (data ?? []).map(mapTrainingPlan);
};

export const createTrainingPlan = async (payload: {
  title: string; description?: string | null; color?: string; goal?: string | null; days_per_week?: number | null; plan_type?: string;
}): Promise<TrainingPlan> => {
  const { data, error } = await supabase
    .from("pf_training_plans").insert({ user_id: USER_ID, ...payload }).select().single();
  if (error) err(error);
  return mapTrainingPlan(data!);
};

export const updateTrainingPlan = async (id: number, payload: {
  title: string; description?: string | null; color?: string; goal?: string | null; days_per_week?: number | null; plan_type?: string;
}): Promise<TrainingPlan> => {
  const { data, error } = await supabase
    .from("pf_training_plans").update(payload).eq("id", id).select().single();
  if (error) err(error);
  return mapTrainingPlan(data!);
};

export const deleteTrainingPlan = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_training_plans").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// TRAINING SESSIONS
// ═══════════════════════════════════════════════════════════════════════════

export const getTrainingSessions = async (planId?: number): Promise<TrainingSession[]> => {
  let q = supabase
    .from("pf_training_sessions")
    .select("*, pf_training_plans(title, plan_type)")
    .eq("user_id", USER_ID)
    .order("scheduled_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (planId !== undefined) q = q.eq("plan_id", planId);
  const { data, error } = await q;
  if (error) err(error);
  return (data ?? []).map((r) => mapTrainingSession(r));
};

export const getTrainingSessionsForDate = async (date: string): Promise<TrainingSession[]> => {
  const { data, error } = await supabase
    .from("pf_training_sessions")
    .select("*, pf_training_plans(title, plan_type)")
    .eq("user_id", USER_ID)
    .eq("scheduled_date", date)
    .order("start_time", { ascending: true, nullsFirst: true });
  if (error) err(error);
  return (data ?? []).map((r) => mapTrainingSession(r));
};

export const createTrainingSession = async (payload: {
  plan_id?: number | null; title: string; scheduled_date?: string | null;
  start_time?: string | null; end_time?: string | null;
  location?: string | null; notes?: string | null;
}): Promise<TrainingSession> => {
  const { data, error } = await supabase
    .from("pf_training_sessions").insert({ user_id: USER_ID, ...payload }).select("*, pf_training_plans(title, plan_type)").single();
  if (error) err(error);
  return mapTrainingSession(data!);
};

export const updateTrainingSession = async (id: number, payload: {
  plan_id?: number | null; title?: string; scheduled_date?: string | null;
  start_time?: string | null; end_time?: string | null;
  location?: string | null; notes?: string | null;
}): Promise<TrainingSession> => {
  const { data, error } = await supabase
    .from("pf_training_sessions").update(payload).eq("id", id).select("*, pf_training_plans(title, plan_type)").single();
  if (error) err(error);
  return mapTrainingSession(data!);
};

export const toggleTrainingSession = async (id: number): Promise<TrainingSession> => {
  const { data: cur } = await supabase.from("pf_training_sessions").select("completed").eq("id", id).single();
  const { data, error } = await supabase
    .from("pf_training_sessions").update({ completed: !cur!.completed }).eq("id", id).select("*, pf_training_plans(title, plan_type)").single();
  if (error) err(error);
  return mapTrainingSession(data!);
};

export const deleteTrainingSession = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_training_sessions").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// SESSION PERFORMANCE
// ═══════════════════════════════════════════════════════════════════════════

export const getSessionPerformance = async (sessionId: number): Promise<SessionPerformance[]> => {
  const { data, error } = await supabase
    .from("pf_session_performance").select("*").eq("session_id", sessionId).order("created_at");
  if (error) err(error);
  return (data ?? []).map(mapSessionPerformance);
};

export const addSessionPerformance = async (payload: {
  session_id: number; metric_name: string; value: string; unit?: string | null;
}): Promise<SessionPerformance> => {
  const { data, error } = await supabase
    .from("pf_session_performance").insert({ user_id: USER_ID, ...payload }).select().single();
  if (error) err(error);
  return mapSessionPerformance(data!);
};

export const deleteSessionPerformance = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_session_performance").delete().eq("id", id);
  if (error) err(error);
};
