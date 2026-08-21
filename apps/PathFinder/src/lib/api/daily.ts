// The dashboard day: today focus, routines, daily template, daily goals and habits.

import {
  TASK_SELECT, err, mapSystem, mapTaskWithContext, num, supabase, getUserId,
} from "./_shared";
import type {
  DailyGoals, DailyHabit, DailyItemWithStatus, DailyPlan, DailyPrimaryGoal, DailySecGoal, DailySection, HabitStack, HabitSubtask, HabitWithCompletion, RoutineItem, Routines, TodayFocus,
} from "../../types";
import { isSystemDue } from "../systems";

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

export const getTodayFocus = async (): Promise<TodayFocus> => {
  const today = new Date().toISOString().split("T")[0];

  const [{ data: plans }, { data: tasks }, { data: systems }] = await Promise.all([
    supabase.from("pf_plans").select("id, title, goal_id, pf_goals(id, title)").eq("user_id", getUserId()),
    supabase.from("pf_tasks").select(TASK_SELECT).eq("user_id", getUserId()).eq("done", false)
      .not("due_date", "is", null).lte("due_date", today),
    supabase.from("pf_systems").select("*").eq("user_id", getUserId()),
  ]);

  const plansMap = new Map((plans ?? []).map((p) => [num(p.id), p]));
  const allTasks = (tasks ?? []).map((t) => mapTaskWithContext(t, plansMap));

  // Shared rule — see lib/systems.ts. This used to be an inline copy that
  // disagreed with the other two about monthly and about unknown frequencies.
  const systemsDue = (systems ?? []).map(mapSystem).filter((s) => isSystemDue(s, today));

  return {
    tasks_due_today: allTasks.filter((t) => t.due_date === today),
    overdue_tasks:   allTasks.filter((t) => t.due_date! < today),
    systems_due:     systemsDue,
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// ROUTINES
// ═══════════════════════════════════════════════════════════════════════════

export const getRoutines = async (date: string): Promise<Routines> => {
  const { data: routines, error } = await supabase
    .from("pf_routines").select("*").eq("user_id", getUserId()).order("sort_order");
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
    .from("pf_routines").insert({ user_id: getUserId(), kind, title });
  if (error) err(error);
};

export const deleteRoutineItem = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_routines").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// DAILY TEMPLATE
// ═══════════════════════════════════════════════════════════════════════════

export const getDailyPlan = async (date: string): Promise<DailyPlan> => {
  const { data: sections, error } = await supabase
    .from("pf_daily_sections")
    .select("*, pf_daily_items(*)")
    .eq("user_id", getUserId())
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
    .from("pf_daily_sections").insert({ user_id: getUserId(), ...payload });
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
    supabase.from("pf_daily_primary_goal").select("text, time_estimate_min").eq("user_id", getUserId()).eq("date", date).maybeSingle(),
    supabase.from("pf_daily_secondary_goals").select("*").eq("user_id", getUserId()).eq("date", date).order("sort_order"),
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
    .upsert({ user_id: getUserId(), date, text: payload.text, time_estimate_min: payload.time_estimate_min }, { onConflict: "user_id,date" });
  if (error) err(error);
};

export const clearDailyPrimaryGoal = async (date: string): Promise<void> => {
  const { error } = await supabase
    .from("pf_daily_primary_goal").delete().eq("user_id", getUserId()).eq("date", date);
  if (error) err(error);
};

export const addDailySecondaryGoal = async (date: string, text: string, time_estimate_min?: number | null): Promise<DailySecGoal> => {
  const { data, error } = await supabase
    .from("pf_daily_secondary_goals").insert({ user_id: getUserId(), date, text, time_estimate_min: time_estimate_min ?? null }).select().single();
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
// DAILY HABITS
// ═══════════════════════════════════════════════════════════════════════════

export const getHabitsForDate = async (date: string): Promise<HabitWithCompletion[]> => {
  const { data: habits, error } = await supabase
    .from("pf_daily_habits").select("*").eq("user_id", getUserId()).order("sort_order");
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
    .from("pf_daily_habits").insert({ user_id: getUserId(), ...payload }).select().single();
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
    .from("pf_habit_stacks").select("*").eq("user_id", getUserId()).order("sort_order");
  if (error) err(error);
  return (data ?? []).map((s) => ({ id: num(s.id), title: s.title, color: s.color, sort_order: s.sort_order }));
};

export const createHabitStack = async (payload: { title: string; color?: string }): Promise<HabitStack> => {
  const { data, error } = await supabase
    .from("pf_habit_stacks").insert({ user_id: getUserId(), ...payload }).select().single();
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
    .from("pf_habit_subtasks").insert({ habit_id: habitId, user_id: getUserId(), title });
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
