import { supabase } from "../supabase";

/**
 * Protocol (health) data access for Nexus Local — habits, supplements, meal
 * logging and sleep, against the same `protocol_*` tables the Protocol app
 * owns.
 *
 * Same rules as `lib/pathfinder/api.ts`: these tables are owner-scoped
 * (`auth.uid()` RLS), so everything goes through the authed `supabase` client
 * and requires a session. The anon client would return empty sets, not errors.
 *
 * Deliberately *not* here: nutrition math. Protocol computes calories/macros
 * by scaling nutrient columns across foods, meal items and quantities
 * (`lib/mealNutrition.ts`); duplicating that here would give the two apps
 * subtly different numbers — the garmin-import lesson. This surface logs and
 * displays; Protocol analyses.
 */

// ── Habits ──────────────────────────────────────────────────────────────────

export type Habit = {
  id: string;
  name: string;
  target_per_week: number;
  scheduled_time: string | null;
  stack_id: string | null;
};

export type HabitCompletion = { habit_id: string; date: string };

export async function fetchHabits(userId: string): Promise<Habit[]> {
  const { data, error } = await supabase
    .from("protocol_habits")
    .select("id,name,target_per_week,scheduled_time,stack_id")
    .eq("user_id", userId)
    .eq("archived", false)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Habit[];
}

export async function fetchHabitCompletions(userId: string, sinceDate: string): Promise<HabitCompletion[]> {
  const { data, error } = await supabase
    .from("protocol_habit_completions")
    .select("habit_id,date")
    .eq("user_id", userId)
    .gte("date", sinceDate);
  if (error) throw new Error(error.message);
  return (data ?? []) as HabitCompletion[];
}

/**
 * Delete-then-insert, mirroring the habit-toggle edge function: the table has
 * no unique constraint, so this stays idempotent against double-taps.
 */
export async function setHabitDone(userId: string, habitId: string, date: string, done: boolean): Promise<void> {
  const del = await supabase
    .from("protocol_habit_completions")
    .delete()
    .eq("user_id", userId)
    .eq("habit_id", habitId)
    .eq("date", date);
  if (del.error) throw new Error(del.error.message);
  if (done) {
    const ins = await supabase
      .from("protocol_habit_completions")
      .insert({ user_id: userId, habit_id: habitId, date });
    if (ins.error) throw new Error(ins.error.message);
  }
}

// ── Supplements ─────────────────────────────────────────────────────────────

export type Supplement = {
  id: string;
  name: string;
  brand: string | null;
  dose: string | null;
  stack_id: string | null;
  sort_order: number;
};

export type SupplementStack = { id: string; name: string; sort_order: number };
export type SupplementLog = { supplement_id: string; date: string };

export async function fetchSupplements(userId: string): Promise<Supplement[]> {
  const { data, error } = await supabase
    .from("protocol_supplements")
    .select("id,name,brand,dose,stack_id,sort_order")
    .eq("user_id", userId)
    .eq("archived", false)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Supplement[];
}

export async function fetchSupplementStacks(userId: string): Promise<SupplementStack[]> {
  const { data, error } = await supabase
    .from("protocol_supplement_stacks")
    .select("id,name,sort_order")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as SupplementStack[];
}

export async function fetchSupplementLogs(userId: string, sinceDate: string): Promise<SupplementLog[]> {
  const { data, error } = await supabase
    .from("protocol_supplement_logs")
    .select("supplement_id,date")
    .eq("user_id", userId)
    .gte("date", sinceDate);
  if (error) throw new Error(error.message);
  return (data ?? []) as SupplementLog[];
}

export async function setSupplementTaken(
  userId: string,
  supplementId: string,
  date: string,
  taken: boolean,
): Promise<void> {
  const del = await supabase
    .from("protocol_supplement_logs")
    .delete()
    .eq("user_id", userId)
    .eq("supplement_id", supplementId)
    .eq("date", date);
  if (del.error) throw new Error(del.error.message);
  if (taken) {
    const ins = await supabase
      .from("protocol_supplement_logs")
      .insert({ user_id: userId, supplement_id: supplementId, date });
    if (ins.error) throw new Error(ins.error.message);
  }
}

// ── Meals ───────────────────────────────────────────────────────────────────

export const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export type MealPlanEntry = {
  id: string;
  date: string;
  slot: string;
  food_id: string | null;
  meal_id: string | null;
  quantity: number;
  logged: boolean;
  /** Resolved display name — joined client-side from meals/foods. */
  name: string;
};

export type MealRef = { id: string; name: string };

export async function fetchMeals(): Promise<MealRef[]> {
  // Shared library: read-all RLS, so no user filter — any user's saved meal
  // can be logged (matching Protocol's meal planner).
  const { data, error } = await supabase
    .from("protocol_meals")
    .select("id,name")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MealRef[];
}

export async function searchFoods(query: string, limit = 12): Promise<MealRef[]> {
  const { data, error } = await supabase
    .from("protocol_foods")
    .select("id,name")
    .ilike("name", `%${query}%`)
    .order("name", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as MealRef[];
}

export async function fetchMealPlanEntries(userId: string, date: string): Promise<MealPlanEntry[]> {
  const { data, error } = await supabase
    .from("protocol_meal_plan_entries")
    .select("id,date,slot,food_id,meal_id,quantity,logged,protocol_meals(name),protocol_foods(name)")
    .eq("user_id", userId)
    .eq("date", date)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => {
    const meal = r.protocol_meals as { name?: string } | null;
    const food = r.protocol_foods as { name?: string } | null;
    return {
      id: r.id as string,
      date: r.date as string,
      slot: r.slot as string,
      food_id: (r.food_id as string | null) ?? null,
      meal_id: (r.meal_id as string | null) ?? null,
      quantity: Number(r.quantity ?? 1),
      logged: Boolean(r.logged),
      name: meal?.name ?? food?.name ?? "Unknown",
    };
  });
}

export async function setEntryLogged(id: string, logged: boolean): Promise<void> {
  const { error } = await supabase.from("protocol_meal_plan_entries").update({ logged }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Quick log: add an entry for `date`/`slot` already marked as eaten. */
export async function quickLogEntry(
  userId: string,
  date: string,
  slot: MealSlot,
  ref: { meal_id?: string; food_id?: string },
): Promise<void> {
  const { error } = await supabase.from("protocol_meal_plan_entries").insert({
    user_id: userId,
    date,
    slot,
    meal_id: ref.meal_id ?? null,
    food_id: ref.food_id ?? null,
    quantity: 1,
    logged: true,
  });
  if (error) throw new Error(error.message);
}

export async function deleteMealPlanEntry(id: string): Promise<void> {
  const { error } = await supabase.from("protocol_meal_plan_entries").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Sleep ───────────────────────────────────────────────────────────────────

export type SleepNight = {
  date: string;
  quality_score: number | null;
  duration_min: number | null;
  deep_sleep_min: number | null;
  rem_sleep_min: number | null;
  light_sleep_min: number | null;
};

export async function fetchSleepNights(userId: string, limit = 14): Promise<SleepNight[]> {
  const { data, error } = await supabase
    .from("protocol_sleep")
    .select("date,quality_score,duration_min,deep_sleep_min,rem_sleep_min,light_sleep_min")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  // Oldest-first for charting.
  return ((data ?? []) as SleepNight[]).reverse();
}

// ── Shared helpers ──────────────────────────────────────────────────────────

export function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
