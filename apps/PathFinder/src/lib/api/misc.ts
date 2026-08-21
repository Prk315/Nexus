// Cross-cutting reads: global search and the JSON export.

import {
  num, supabase, getUserId,
} from "./_shared";
import type {
  SearchResult,
} from "../../types";
import { getGoals } from "./goals";
import { getPlans } from "./plans";
import { getAllTasks } from "./tasks";
import { getSystems } from "./systems";

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════════════════

export const search = async (query: string): Promise<SearchResult[]> => {
  const q = `%${query}%`;
  const [{ data: goals }, { data: plans }, { data: tasks }, { data: systems }] =
    await Promise.all([
      supabase.from("pf_goals").select("id, title, status").eq("user_id", getUserId()).ilike("title", q).limit(5),
      supabase.from("pf_plans").select("id, title, status").eq("user_id", getUserId()).ilike("title", q).limit(5),
      supabase.from("pf_tasks").select("id, title, pf_plans(title)").eq("user_id", getUserId()).ilike("title", q).limit(5),
      supabase.from("pf_systems").select("id, title, frequency").eq("user_id", getUserId()).ilike("title", q).limit(5),
    ]);

  return [
    ...(goals   ?? []).map((g) => ({ kind: "goal"   as const, id: num(g.id), title: g.title, subtitle: g.status })),
    ...(plans   ?? []).map((p) => ({ kind: "plan"   as const, id: num(p.id), title: p.title, subtitle: p.status })),
    ...(tasks   ?? []).map((t) => ({ kind: "task"   as const, id: num(t.id), title: t.title, subtitle: (t as any).pf_plans?.title ?? null })),
    ...(systems ?? []).map((s) => ({ kind: "system" as const, id: num(s.id), title: s.title, subtitle: s.frequency })),
  ];
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
