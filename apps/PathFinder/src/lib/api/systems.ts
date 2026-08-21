// Recurring systems and their subtasks.

import {
  err, mapSystem, num, supabase, getUserId,
} from "./_shared";
import type {
  SubtaskToggleResult, SystemEntry, SystemSubtask,
} from "../../types";

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEMS
// ═══════════════════════════════════════════════════════════════════════════

export const getSystems = async (): Promise<SystemEntry[]> => {
  const { data, error } = await supabase
    .from("pf_systems").select("*").eq("user_id", getUserId()).order("created_at");
  if (error) err(error);
  return (data ?? []).map(mapSystem);
};

export const createSystem = async (payload: {
  title: string; description?: string | null; frequency: string;
  days_of_week?: string | null; start_time?: string | null; end_time?: string | null;
  is_lifestyle?: boolean; lifestyle_area_id?: number | null;
  interval_days?: number | null;
}): Promise<SystemEntry> => {
  const { data, error } = await supabase
    .from("pf_systems").insert({ user_id: getUserId(), ...payload }).select().single();
  if (error) err(error);
  return mapSystem(data!);
};

export const updateSystem = async (id: number, payload: {
  title: string; description?: string | null; frequency: string;
  days_of_week?: string | null; start_time?: string | null; end_time?: string | null;
  is_lifestyle?: boolean; lifestyle_area_id?: number | null;
  interval_days?: number | null;
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
