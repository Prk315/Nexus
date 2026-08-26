// Plans and the project-goal checklists under them.

import {
  err, mapPlan, num, supabase, getUserId,
} from "./_shared";
import { getTeamOrFilter } from "./teams";
import type {
  Plan, ProjectGoal,
} from "../../types";

// ═══════════════════════════════════════════════════════════════════════════
// PLANS
// ═══════════════════════════════════════════════════════════════════════════

export const getPlans = async (): Promise<Plan[]> => {
  // Counts aggregated server-side by pf_plans_with_counts — one round-trip, and
  // no longer ships every task row just to tally it.
  const orFilter = await getTeamOrFilter();
  let q = supabase.from("pf_plans_with_counts").select("*");
  q = orFilter ? q.or(orFilter) : q.eq("user_id", getUserId());
  const { data: plans, error } = await q.order("created_at", { ascending: false });
  if (error) err(error);
  return (plans ?? []).map((p) => mapPlan(p, num(p.task_count), num(p.done_count)));
};

export const createPlan = async (payload: {
  goal_id?: number | null; parent_id?: number | null; title: string; description?: string | null;
  deadline?: string | null; tags?: string | null; is_course?: boolean;
  is_lifestyle?: boolean; is_schedule?: boolean; lifestyle_area_id?: number | null;
  purpose?: string | null; problem?: string | null; solution?: string | null;
  team_id?: string | null;
}): Promise<Plan> => {
  const { data, error } = await supabase
    .from("pf_plans")
    .insert({ user_id: getUserId(), ...payload })
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
