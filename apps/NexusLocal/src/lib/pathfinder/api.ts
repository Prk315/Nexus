import { supabase } from "../supabase";

/**
 * PathFinder task CRUD for Nexus Local.
 *
 * Talks to the same `pf_tasks` table as the PathFinder app, with the same
 * shapes — this is a second *surface*, not a second data model. Two things
 * differ from the timetracker stack and are worth stating loudly:
 *
 * - **`supabase`, not `supabasePublic`.** `pf_tasks` is owner-scoped
 *   (`user_id = auth.uid()` RLS) since the PathFinder auth migration. Reading
 *   it with the anon client returns an empty set, not an error — the classic
 *   trap. Every call here therefore requires a signed-in session, and the page
 *   gates on one.
 * - **`category`** is the quick-task discriminator added 2026-08-13:
 *   `null` = regular project task, `'reminder' | 'chore' | 'shopping'` = the
 *   standing lists that the home-screen widget also reads.
 */

export type QuickCategory = "reminder" | "chore" | "shopping";

export type PfTask = {
  id: number;
  title: string;
  done: boolean;
  priority: "high" | "medium" | "low";
  due_date: string | null;
  category: QuickCategory | null;
  plan_id: number | null;
  plan_title: string | null;
  created_at: string;
};

function mapRow(r: Record<string, unknown>): PfTask {
  const plan = r.pf_plans as { title?: string } | null;
  return {
    id: Number(r.id),
    title: r.title as string,
    done: r.done as boolean,
    priority: (r.priority as PfTask["priority"]) ?? "medium",
    due_date: (r.due_date as string | null) ?? null,
    category: (r.category as QuickCategory | null) ?? null,
    plan_id: r.plan_id != null ? Number(r.plan_id) : null,
    plan_title: plan?.title ?? null,
    created_at: r.created_at as string,
  };
}

const SELECT = "id,title,done,priority,due_date,category,plan_id,created_at,pf_plans(title)";

/** Open tasks, soonest-due first (undated last, matching the widget's order). */
export async function fetchOpenTasks(userId: string): Promise<PfTask[]> {
  const { data, error } = await supabase
    .from("pf_tasks")
    .select(SELECT)
    .eq("user_id", userId)
    .eq("done", false)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

/**
 * Recently completed, so a mis-tap can be undone. `created_at` is the only
 * timestamp the table has — good enough for "the stuff I just ticked off".
 */
export async function fetchRecentDone(userId: string, limit = 20): Promise<PfTask[]> {
  const { data, error } = await supabase
    .from("pf_tasks")
    .select(SELECT)
    .eq("user_id", userId)
    .eq("done", true)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

export async function createTask(
  userId: string,
  payload: {
    title: string;
    category?: QuickCategory | null;
    priority?: PfTask["priority"];
    due_date?: string | null;
  },
): Promise<PfTask> {
  const { data, error } = await supabase
    .from("pf_tasks")
    .insert({
      user_id: userId,
      // Quick tasks never belong to a plan — the category *is* the container.
      plan_id: null,
      title: payload.title,
      category: payload.category ?? null,
      priority: payload.priority ?? "medium",
      due_date: payload.due_date ?? null,
    })
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data!);
}

export async function updateTask(
  id: number,
  patch: {
    title?: string;
    category?: QuickCategory | null;
    priority?: PfTask["priority"];
    due_date?: string | null;
  },
): Promise<PfTask> {
  const { data, error } = await supabase
    .from("pf_tasks")
    .update(patch)
    .eq("id", id)
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data!);
}

export async function setTaskDone(id: number, done: boolean): Promise<void> {
  const { error } = await supabase.from("pf_tasks").update({ done }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteTask(id: number): Promise<void> {
  const { error } = await supabase.from("pf_tasks").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
