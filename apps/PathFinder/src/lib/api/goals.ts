// Goals and goal groups.

import {
  err, mapGoal, num, supabase, getUserId,
} from "./_shared";
import type {
  Goal, GoalGroup,
} from "../../types";

// ═══════════════════════════════════════════════════════════════════════════
// GOAL GROUPS
// ═══════════════════════════════════════════════════════════════════════════

export const getGoalGroups = async (): Promise<GoalGroup[]> => {
  const { data, error } = await supabase
    .from("pf_goal_groups")
    .select("*")
    .eq("user_id", getUserId())
    .order("sort_order");
  if (error) err(error);
  return (data ?? []).map((r) => ({
    id: num(r.id), name: r.name, color: r.color, sort_order: r.sort_order,
  }));
};

export const createGoalGroup = async (name: string, color: string): Promise<GoalGroup> => {
  const { data, error } = await supabase
    .from("pf_goal_groups")
    .insert({ user_id: getUserId(), name, color })
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
  // task_count/done_count are aggregated server-side by the pf_goals_with_counts
  // view (goals ⋈ plans ⋈ tasks), so this is a single round-trip instead of the
  // former goals→plans→tasks fan-out.
  const { data: goals, error } = await supabase
    .from("pf_goals_with_counts")
    .select("*")
    .eq("user_id", getUserId())
    .order("created_at", { ascending: false });
  if (error) err(error);
  return (goals ?? []).map((g) => mapGoal(g, num(g.task_count), num(g.done_count)));
};

export const createGoal = async (payload: {
  title: string; description?: string | null; deadline?: string | null;
  priority?: string; group_id?: number | null;
}): Promise<Goal> => {
  const { data, error } = await supabase
    .from("pf_goals")
    .insert({ user_id: getUserId(), ...payload })
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
