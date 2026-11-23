// Shapes for Protocol items shown — and edited — in other apps.
//
// A SyncedItem is a PROJECTION of Protocol rows, never a copy. It carries no
// state of its own: its date, time and done-ness are read from the Protocol
// row every time, and every edit is written straight back to that row. That is
// the whole sync model — with one copy there is nothing to reconcile.

/** What kind of Protocol thing a synced item is. */
export type SyncedKind = "workout" | "run" | "meal" | "supplements" | "routine";

export const SYNCED_KINDS: readonly SyncedKind[] = ["workout", "run", "meal", "supplements", "routine"];

export const SYNCED_KIND_LABEL: Record<SyncedKind, string> = {
  workout: "Training",
  run: "Run",
  meal: "Meal",
  supplements: "Supplements",
  routine: "Routine",
};

/**
 * One tickable thing inside an item — a habit in a routine, a pill in a
 * supplement stack, a food in a meal slot. Workouts and runs have none: the
 * session itself is the unit.
 */
export interface SyncedPart {
  /** The Protocol row it writes to: habit id, supplement id, meal-entry id. */
  id: string;
  label: string;
  detail: string | null;
  done: boolean;
}

export interface SyncedItem {
  /** `${kind}:${ref}:${date}` — unique per occurrence, stable across reloads. */
  key: string;
  kind: SyncedKind;
  /** Session id (workout/run), slot name (meal) or stack id (supplements/routine). */
  ref: string;
  /** YYYY-MM-DD, local. */
  date: string;
  /** HH:MM, or null when the item has a date but no time (shown all-day). */
  start_time: string | null;
  end_time: string | null;
  /** True when the time is a fallback (a meal slot's default), not one anyone set. */
  timeIsDefault: boolean;
  title: string;
  subtitle: string | null;
  parts: SyncedPart[];
  done: boolean;
  progress: { done: number; total: number };
  /**
   * The schedule lives on a STACK and repeats. Moving it moves every
   * occurrence, and it cannot change day — Protocol has no per-occurrence
   * override, so "move Tuesday's" would silently mean "move all of them".
   */
  recurring: boolean;
  /**
   * Workouts/runs only: which importer RECORDED this ("Garmin", "Oura",
   * "Strava"), or null for a session someone planned. A recorded session
   * happened; it cannot be moved, deleted or un-done from here, because the
   * importer would put it back on its next pass (oura-sync deletes and
   * re-inserts its whole window).
   */
  recordedBy: string | null;
}

// ── Row shapes, as read ────────────────────────────────────────────────────

export interface WorkoutRow {
  id: string;
  name: string;
  scheduled_date: string;
  start_time: string | null;
  started_at: string | null;
  duration_min: number | null;
  completed: boolean;
  external_id: string | null;
  routine_id: string | null;
  notes: string | null;
}

export interface RunRow {
  id: string;
  date: string;
  start_time: string | null;
  started_at: string | null;
  duration_min: number | null;
  planned_km: number | null;
  actual_km: number | null;
  avg_pace_s_per_km: number | null;
  completed: boolean;
  external_id: string | null;
  notes: string | null;
}

export type MealSlot = "breakfast" | "lunch" | "snack" | "dinner";

export interface MealEntryRow {
  id: string;
  date: string;
  slot: string;
  start_time: string | null;
  quantity: number | null;
  logged: boolean;
  sort_order: number | null;
  /** Resolved name of the food or saved meal the entry points at. */
  name: string | null;
}

/** Shared by habit stacks and supplement stacks — the columns are identical. */
export interface StackRow {
  id: string;
  name: string;
  sort_order: number | null;
  scheduled_time: string | null;
  duration_min: number | null;
  /** Monday = 0 … Sunday = 6; null = every day. */
  repeat_days: number[] | null;
}

export interface HabitRow {
  id: string;
  name: string;
  stack_id: string | null;
  scheduled_time: string | null;
  duration_min: number | null;
  repeat_days: number[] | null;
  sort_order: number | null;
  created_at: string;
}

export interface SupplementRow {
  id: string;
  name: string;
  dose: string | null;
  stack_id: string | null;
  sort_order: number | null;
  created_at: string;
}

/** A completion or a log: "this habit / supplement was done on this date". */
export interface DoneMark {
  ref_id: string;
  date: string;
}
