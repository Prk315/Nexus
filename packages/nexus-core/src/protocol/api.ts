// Protocol's schedulable items — workouts, runs, meals, supplement stacks and
// routines — read and written from apps that are not Protocol.
//
// The client is injected, exactly as `createPathfinderApi` does. Every
// `protocol_*` table here is owner-scoped to `auth.uid()`, so the correct
// client is the app's SESSION client (`supabase`, never `supabasePublic`).
// Getting that backwards returns an EMPTY SET, not an error — which renders as
// a calm, plausible day with nothing planned.
//
// ── The sync model ──────────────────────────────────────────────────────────
//
// Protocol owns each item, its date, its time and whether it is done. This
// module keeps no copy: reads project Protocol rows into `SyncedItem`s, writes
// go straight back to those rows. "Ticked in PathFinder shows as ticked in
// Protocol" is therefore not a feature to maintain — there is only one tick.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  datesInRange,
  hhmm,
  mealItems,
  routineItems,
  runItem,
  sortItems,
  supplementItems,
  workoutItem,
} from "./schedule";
import type {
  DoneMark,
  HabitRow,
  MealEntryRow,
  MealSlot,
  RunRow,
  StackRow,
  SupplementRow,
  SyncedItem,
  SyncedKind,
  WorkoutRow,
} from "./types";

/** A domain that failed to load, said out loud instead of rendered as empty. */
export interface SyncedLoadError {
  kind: SyncedKind;
  message: string;
}

export interface SyncedLoad {
  items: SyncedItem[];
  errors: SyncedLoadError[];
}

export interface RoutineOption {
  id: string;
  name: string;
  plan_id: string | null;
  plan_name: string | null;
}

export interface ProtocolCatalog {
  routines: RoutineOption[];
  habitStacks: StackRow[];
  supplementStacks: StackRow[];
  meals: { id: string; name: string }[];
}

export interface StackSchedule {
  /** HH:MM, or null to unschedule. */
  scheduled_time: string | null;
  duration_min: number | null;
  /** Monday = 0 … Sunday = 6; null = every day. */
  repeat_days: number[] | null;
}

export interface MoveTo {
  /** Omit to keep the day. Recurring items refuse a different day. */
  date?: string;
  start_time: string;
  duration_min?: number;
}

/**
 * Thrown for an edit that would be silently undone or misread, so the UI can
 * show the reason rather than a generic failure.
 */
export class SyncedEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncedEditError";
  }
}

export interface ProtocolApi {
  loadRange(start: string, end: string): Promise<SyncedLoad>;
  loadCatalog(): Promise<ProtocolCatalog>;
  searchFoods(query: string): Promise<{ id: string; name: string; brand: string | null }[]>;

  setPartDone(item: SyncedItem, partId: string, done: boolean): Promise<void>;
  setDone(item: SyncedItem, done: boolean): Promise<void>;
  move(item: SyncedItem, to: MoveTo): Promise<void>;
  remove(item: SyncedItem): Promise<void>;

  scheduleWorkout(input: {
    routine_id: string | null;
    plan_id: string | null;
    name: string;
    date: string;
    start_time: string | null;
    duration_min: number | null;
    notes?: string | null;
  }): Promise<string>;
  scheduleRun(input: {
    date: string;
    start_time: string | null;
    duration_min: number | null;
    planned_km: number | null;
    notes?: string | null;
  }): Promise<string>;
  planMeal(input: {
    date: string;
    slot: MealSlot;
    start_time: string | null;
    entries: { food_id?: string; meal_id?: string; quantity: number }[];
  }): Promise<void>;
  scheduleStack(kind: "routine" | "supplements", stackId: string, schedule: StackSchedule): Promise<void>;
  renameSession(item: SyncedItem, name: string): Promise<void>;
}

const STACK_COLS = "id, name, sort_order, scheduled_time, duration_min, repeat_days";

/** "HH:MM" → Postgres `time`; null stays null. */
function pgTime(t: string | null | undefined): string | null {
  const v = hhmm(t ?? null);
  return v ? `${v}:00` : null;
}

function fail(kind: SyncedKind, error: { message: string } | null): void {
  if (error) throw Object.assign(new Error(error.message), { kind });
}

export function createProtocolApi(sb: SupabaseClient, userId: string): ProtocolApi {
  // Every read and write is scoped to the user explicitly, on top of RLS: a
  // service-role client (the MCP, a script) has no auth.uid() to lean on.
  // Typed as identity because PostgREST's `.eq` returns the same builder — a
  // structural constraint here sends tsc into infinite instantiation (TS2589).
  function own<T>(q: T): T {
    return (q as { eq(c: string, v: string): T }).eq("user_id", userId);
  }

  async function loadWorkouts(start: string, end: string): Promise<SyncedItem[]> {
    const { data, error } = await own(
      sb.from("protocol_workout_sessions")
        .select("id, name, scheduled_date, start_time, started_at, duration_min, completed, external_id, routine_id, notes"),
    ).gte("scheduled_date", start).lte("scheduled_date", end);
    fail("workout", error);
    return ((data ?? []) as WorkoutRow[]).map((r) => workoutItem({ ...r, completed: Boolean(r.completed) }));
  }

  async function loadRuns(start: string, end: string): Promise<SyncedItem[]> {
    const { data, error } = await own(
      sb.from("protocol_running_sessions")
        .select("id, date, start_time, started_at, duration_min, planned_km, actual_km, avg_pace_s_per_km, completed, external_id, notes"),
    ).gte("date", start).lte("date", end);
    fail("run", error);
    return ((data ?? []) as RunRow[]).map((r) => runItem({ ...r, completed: Boolean(r.completed) }));
  }

  async function loadMeals(start: string, end: string): Promise<SyncedItem[]> {
    const { data, error } = await own(
      sb.from("protocol_meal_plan_entries")
        .select("id, date, slot, start_time, quantity, logged, sort_order, protocol_foods(name), protocol_meals(name)"),
    ).gte("date", start).lte("date", end);
    fail("meal", error);
    const rows: MealEntryRow[] = ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      date: r.date,
      slot: r.slot,
      start_time: r.start_time,
      quantity: r.quantity,
      logged: Boolean(r.logged),
      sort_order: r.sort_order,
      name: r.protocol_meals?.name ?? r.protocol_foods?.name ?? null,
    }));
    return mealItems(rows);
  }

  // A routine is three tables, and they load or fail TOGETHER: habits without
  // their completions would render every routine as untouched.
  async function loadRoutines(start: string, end: string): Promise<SyncedItem[]> {
    const [stacks, habits, done] = await Promise.all([
      own(sb.from("protocol_habit_stacks").select(STACK_COLS)),
      own(sb.from("protocol_habits")
        .select("id, name, stack_id, scheduled_time, duration_min, repeat_days, sort_order, created_at"))
        .eq("archived", false),
      own(sb.from("protocol_habit_completions").select("habit_id, date")).gte("date", start).lte("date", end),
    ]);
    fail("routine", stacks.error ?? habits.error ?? done.error);
    const marks: DoneMark[] = ((done.data ?? []) as any[]).map((c) => ({ ref_id: c.habit_id, date: c.date }));
    return routineItems((stacks.data ?? []) as StackRow[], (habits.data ?? []) as HabitRow[], marks, datesInRange(start, end));
  }

  async function loadSupplements(start: string, end: string): Promise<SyncedItem[]> {
    const [stacks, supps, logs] = await Promise.all([
      own(sb.from("protocol_supplement_stacks").select(STACK_COLS)),
      // Named columns only: the table carries ~100 nutrient columns.
      own(sb.from("protocol_supplements").select("id, name, dose, stack_id, sort_order, created_at"))
        .eq("archived", false),
      own(sb.from("protocol_supplement_logs").select("supplement_id, date")).gte("date", start).lte("date", end),
    ]);
    fail("supplements", stacks.error ?? supps.error ?? logs.error);
    const marks: DoneMark[] = ((logs.data ?? []) as any[]).map((l) => ({ ref_id: l.supplement_id, date: l.date }));
    return supplementItems((stacks.data ?? []) as StackRow[], (supps.data ?? []) as SupplementRow[], marks, datesInRange(start, end));
  }

  async function setHabit(habitId: string, date: string, done: boolean) {
    const q = done
      ? sb.from("protocol_habit_completions")
          .upsert({ habit_id: habitId, user_id: userId, date }, { onConflict: "habit_id,date", ignoreDuplicates: true })
      : own(sb.from("protocol_habit_completions").delete()).eq("habit_id", habitId).eq("date", date);
    const { error } = await q;
    if (error) throw new Error(error.message);
  }

  async function setSupplement(supplementId: string, date: string, done: boolean) {
    const q = done
      ? sb.from("protocol_supplement_logs")
          .upsert({ supplement_id: supplementId, user_id: userId, date }, { onConflict: "supplement_id,date", ignoreDuplicates: true })
      : own(sb.from("protocol_supplement_logs").delete()).eq("supplement_id", supplementId).eq("date", date);
    const { error } = await q;
    if (error) throw new Error(error.message);
  }

  function refuseGarmin(item: SyncedItem, what: string) {
    if (item.recordedBy) {
      throw new SyncedEditError(
        `This session was recorded by Garmin, so it can't be ${what} — the next sync would put it back.`,
      );
    }
  }

  async function run(q: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await q;
    if (error) throw new Error(error.message);
  }

  const api: ProtocolApi = {
    async loadRange(start, end) {
      const loaders: [SyncedKind, () => Promise<SyncedItem[]>][] = [
        ["workout", () => loadWorkouts(start, end)],
        ["run", () => loadRuns(start, end)],
        ["meal", () => loadMeals(start, end)],
        ["routine", () => loadRoutines(start, end)],
        ["supplements", () => loadSupplements(start, end)],
      ];
      // One failing domain must not take the others — or the rest of the
      // calendar — down with it. That was the pf_reminders incident's shape.
      const settled = await Promise.allSettled(loaders.map(([, load]) => load()));
      const items: SyncedItem[] = [];
      const errors: SyncedLoadError[] = [];
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") items.push(...r.value);
        else errors.push({ kind: loaders[i][0], message: r.reason instanceof Error ? r.reason.message : String(r.reason) });
      });
      return { items: sortItems(items), errors };
    },

    async loadCatalog() {
      const [routines, plans, habitStacks, supplementStacks, meals] = await Promise.all([
        own(sb.from("protocol_workout_routines").select("id, name, plan_id, sort_order")).order("sort_order"),
        own(sb.from("protocol_workout_plans").select("id, name")),
        own(sb.from("protocol_habit_stacks").select(STACK_COLS)).order("sort_order"),
        own(sb.from("protocol_supplement_stacks").select(STACK_COLS)).order("sort_order"),
        // Saved meals are shared read-all across users (see CLAUDE.md); offer
        // the user's own first, then everyone else's.
        sb.from("protocol_meals").select("id, name, user_id").order("name"),
      ]);
      const firstError = routines.error ?? plans.error ?? habitStacks.error ?? supplementStacks.error ?? meals.error;
      if (firstError) throw new Error(firstError.message);
      const planName = new Map(((plans.data ?? []) as any[]).map((p) => [p.id, p.name as string]));
      return {
        routines: ((routines.data ?? []) as any[]).map((r) => ({
          id: r.id, name: r.name, plan_id: r.plan_id, plan_name: r.plan_id ? planName.get(r.plan_id) ?? null : null,
        })),
        habitStacks: (habitStacks.data ?? []) as StackRow[],
        supplementStacks: (supplementStacks.data ?? []) as StackRow[],
        meals: ((meals.data ?? []) as any[])
          .sort((a, b) => Number(b.user_id === userId) - Number(a.user_id === userId))
          .map((m) => ({ id: m.id, name: m.name })),
      };
    },

    async searchFoods(query) {
      const q = query.trim();
      if (q.length < 2) return [];
      const { data, error } = await sb.from("protocol_foods").select("id, name, brand")
        .ilike("name", `%${q.replace(/[%_]/g, "")}%`).order("name").limit(20);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; name: string; brand: string | null }[];
    },

    async setPartDone(item, partId, done) {
      if (!item.parts.some((p) => p.id === partId)) throw new SyncedEditError("That part isn't in this item.");
      if (item.kind === "routine") return setHabit(partId, item.date, done);
      if (item.kind === "supplements") return setSupplement(partId, item.date, done);
      if (item.kind === "meal") {
        return run(own(sb.from("protocol_meal_plan_entries").update({ logged: done })).eq("id", partId));
      }
      throw new SyncedEditError("Workouts and runs have no parts — tick the session itself.");
    },

    async setDone(item, done) {
      if (item.kind === "workout" || item.kind === "run") {
        if (!done) refuseGarmin(item, "marked not done");
        const table = item.kind === "workout" ? "protocol_workout_sessions" : "protocol_running_sessions";
        return run(own(sb.from(table).update({ completed: done })).eq("id", item.ref));
      }
      // Sequential, not Promise.all: one request per part is the connection
      // shape that wedged Supabase on 2026-08-15. A stack is a handful of rows.
      for (const p of item.parts) {
        if (p.done !== done) await api.setPartDone(item, p.id, done);
      }
    },

    async move(item, to) {
      const start = pgTime(to.start_time);
      if (!start) throw new SyncedEditError("A move needs a valid start time.");
      const date = to.date ?? item.date;
      if (item.recurring && date !== item.date) {
        throw new SyncedEditError(
          "This repeats every day it's due, so it can't move to another day — change its time, or its days in Protocol.",
        );
      }
      const duration = to.duration_min != null && to.duration_min > 0 ? Math.round(to.duration_min) : undefined;

      switch (item.kind) {
        case "workout":
          refuseGarmin(item, "rescheduled");
          return run(own(sb.from("protocol_workout_sessions")
            .update({ scheduled_date: date, start_time: start, ...(duration && { duration_min: duration }) }))
            .eq("id", item.ref));
        case "run":
          refuseGarmin(item, "rescheduled");
          return run(own(sb.from("protocol_running_sessions")
            .update({ date, start_time: start, ...(duration && { duration_min: duration }) }))
            .eq("id", item.ref));
        case "meal":
          // The block IS every entry in the slot, so all of them move.
          return run(own(sb.from("protocol_meal_plan_entries").update({ date, start_time: start }))
            .eq("date", item.date).eq("slot", item.ref));
        case "routine":
          if (item.ref.startsWith("habit:")) {
            return run(own(sb.from("protocol_habits")
              .update({ scheduled_time: start, ...(duration && { duration_min: duration }) }))
              .eq("id", item.ref.slice("habit:".length)));
          }
          return run(own(sb.from("protocol_habit_stacks")
            .update({ scheduled_time: start, ...(duration && { duration_min: duration }) }))
            .eq("id", item.ref));
        case "supplements":
          return run(own(sb.from("protocol_supplement_stacks")
            .update({ scheduled_time: start, ...(duration && { duration_min: duration }) }))
            .eq("id", item.ref));
      }
    },

    async remove(item) {
      switch (item.kind) {
        case "workout":
          refuseGarmin(item, "deleted");
          return run(own(sb.from("protocol_workout_sessions").delete()).eq("id", item.ref));
        case "run":
          refuseGarmin(item, "deleted");
          return run(own(sb.from("protocol_running_sessions").delete()).eq("id", item.ref));
        case "meal":
          return run(own(sb.from("protocol_meal_plan_entries").delete()).eq("date", item.date).eq("slot", item.ref));
        case "supplements":
          // Recurring: "remove" means unschedule the stack. The supplements
          // and their history stay — they belong to Protocol, not to a slot.
          return run(own(sb.from("protocol_supplement_stacks").update({ scheduled_time: null })).eq("id", item.ref));
        case "routine": {
          if (item.ref.startsWith("habit:")) {
            return run(own(sb.from("protocol_habits").update({ scheduled_time: null }))
              .eq("id", item.ref.slice("habit:".length)));
          }
          const { data, error } = await own(sb.from("protocol_habit_stacks").select("scheduled_time")).eq("id", item.ref).single();
          if (error) throw new Error(error.message);
          if (!data?.scheduled_time) {
            // The time comes from the habits' own times; clearing the
            // stack's (already empty) time would appear to do nothing.
            throw new SyncedEditError(
              "This routine's time comes from its habits' own times — clear those in Protocol to unschedule it.",
            );
          }
          return run(own(sb.from("protocol_habit_stacks").update({ scheduled_time: null })).eq("id", item.ref));
        }
      }
    },

    async scheduleWorkout(input) {
      const { data, error } = await sb.from("protocol_workout_sessions").insert({
        user_id: userId,
        routine_id: input.routine_id,
        plan_id: input.plan_id,
        name: input.name.trim() || "Workout",
        scheduled_date: input.date,
        start_time: pgTime(input.start_time),
        duration_min: input.duration_min,
        notes: input.notes ?? null,
        completed: false,
      }).select("id").single();
      if (error) throw new Error(error.message);
      return data!.id as string;
    },

    async scheduleRun(input) {
      const { data, error } = await sb.from("protocol_running_sessions").insert({
        user_id: userId,
        date: input.date,
        start_time: pgTime(input.start_time),
        duration_min: input.duration_min,
        planned_km: input.planned_km,
        notes: input.notes ?? null,
        completed: false,
      }).select("id").single();
      if (error) throw new Error(error.message);
      return data!.id as string;
    },

    async planMeal(input) {
      if (input.entries.length === 0) throw new SyncedEditError("Pick at least one food or meal.");
      if (input.entries.some((e) => !e.food_id === !e.meal_id)) {
        throw new SyncedEditError("Each entry is either a food or a saved meal.");
      }
      const { data: existing, error: readError } = await own(sb.from("protocol_meal_plan_entries").select("sort_order, start_time"))
        .eq("date", input.date).eq("slot", input.slot);
      if (readError) throw new Error(readError.message);
      const rows = (existing ?? []) as { sort_order: number | null; start_time: string | null }[];
      const base = rows.reduce((n, r) => Math.max(n, (r.sort_order ?? 0) + 1), 0);
      // Joining a slot that already has a time keeps it, so one meal block
      // doesn't split into two at different times.
      const start = pgTime(input.start_time) ?? rows.find((r) => r.start_time)?.start_time ?? null;
      const { error } = await sb.from("protocol_meal_plan_entries").insert(
        input.entries.map((e, i) => ({
          user_id: userId,
          date: input.date,
          slot: input.slot,
          food_id: e.food_id ?? null,
          meal_id: e.meal_id ?? null,
          quantity: e.quantity,
          logged: false,
          sort_order: base + i,
          start_time: start,
        })),
      );
      if (error) throw new Error(error.message);
    },

    async scheduleStack(kind, stackId, schedule) {
      const days = schedule.repeat_days && schedule.repeat_days.length > 0 && schedule.repeat_days.length < 7
        ? [...new Set(schedule.repeat_days)].sort()
        : null;
      if (days?.some((d) => d < 0 || d > 6)) throw new SyncedEditError("Weekdays run Monday = 0 to Sunday = 6.");
      const table = kind === "routine" ? "protocol_habit_stacks" : "protocol_supplement_stacks";
      return run(own(sb.from(table).update({
        scheduled_time: pgTime(schedule.scheduled_time),
        duration_min: schedule.duration_min && schedule.duration_min > 0 ? Math.round(schedule.duration_min) : null,
        repeat_days: days,
      })).eq("id", stackId));
    },

    async renameSession(item, name) {
      const v = name.trim();
      if (!v) throw new SyncedEditError("A name can't be empty.");
      if (item.kind !== "workout") throw new SyncedEditError("Only training sessions have their own name.");
      return run(own(sb.from("protocol_workout_sessions").update({ name: v })).eq("id", item.ref));
    },
  };
  return api;
}
