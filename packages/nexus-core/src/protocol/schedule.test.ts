import { describe, expect, it } from "vitest";
import {
  addMinutes,
  datesInRange,
  hhmm,
  isDueOn,
  localHHMM,
  mealItems,
  protocolWeekday,
  recordedBy,
  routineItems,
  runItem,
  sortItems,
  supplementItems,
  workoutItem,
} from "./schedule";
import { isImportedRow } from "../../../../supabase/functions/garmin-import/match";
import type { HabitRow, MealEntryRow, RunRow, StackRow, SupplementRow, WorkoutRow } from "./types";

const MON = "2026-11-23";
const TUE = "2026-11-24";
const SUN = "2026-11-29";
const LONG_AGO = "2026-01-01T12:00:00Z";

const stack = (over: Partial<StackRow> = {}): StackRow => ({
  id: "s1", name: "Morning", sort_order: 0, scheduled_time: null, duration_min: null, repeat_days: null, ...over,
});
const habit = (over: Partial<HabitRow> = {}): HabitRow => ({
  id: "h1", name: "Make the bed", stack_id: "s1", scheduled_time: null, duration_min: null,
  repeat_days: null, sort_order: 0, created_at: LONG_AGO, ...over,
});

describe("weekday convention", () => {
  it("is Monday = 0 … Sunday = 6, NOT getUTCDay's Sunday = 0", () => {
    expect(protocolWeekday(MON)).toBe(0);
    expect(protocolWeekday(TUE)).toBe(1);
    expect(protocolWeekday(SUN)).toBe(6);
  });

  it("treats null and [] as every day", () => {
    expect(isDueOn(null, TUE)).toBe(true);
    expect(isDueOn([], TUE)).toBe(true);
    expect(isDueOn([0], MON)).toBe(true);
    expect(isDueOn([0], TUE)).toBe(false);
  });
});

describe("time primitives", () => {
  it("normalises Postgres time and refuses garbage", () => {
    expect(hhmm("06:00:00")).toBe("06:00");
    expect(hhmm("6:05")).toBe("06:05");
    expect(hhmm("25:00")).toBeNull();
    expect(hhmm(null)).toBeNull();
    expect(hhmm("")).toBeNull();
  });

  it("clamps at 23:59 instead of wrapping past midnight", () => {
    expect(addMinutes("09:30", 45)).toBe("10:15");
    expect(addMinutes("23:30", 60)).toBe("23:59");
  });

  it("reads a timestamptz as LOCAL wall-clock time", () => {
    const iso = new Date(2026, 10, 23, 17, 4).toISOString();
    expect(localHHMM(iso)).toBe("17:04");
    expect(localHHMM(null)).toBeNull();
  });

  it("ranges are inclusive and empty when reversed", () => {
    expect(datesInRange(MON, "2026-11-25")).toEqual([MON, TUE, "2026-11-25"]);
    expect(datesInRange(TUE, MON)).toEqual([]);
  });
});

describe("routines (habit stacks)", () => {
  it("an unscheduled stack produces NOTHING rather than a midnight block", () => {
    expect(routineItems([stack()], [habit()], [], [MON])).toEqual([]);
  });

  it("falls back to the earliest due habit's time, and sums durations", () => {
    const [item] = routineItems(
      [stack()],
      [
        habit({ id: "a", scheduled_time: "06:05:00", duration_min: 5 }),
        habit({ id: "b", scheduled_time: "06:00:00", duration_min: 60 }),
      ],
      [],
      [MON],
    );
    expect(item.start_time).toBe("06:00");
    expect(item.end_time).toBe("07:05");
    expect(item.recurring).toBe(true);
  });

  it("a stack's own time and duration win over its habits'", () => {
    const [item] = routineItems(
      [stack({ scheduled_time: "21:00:00", duration_min: 20 })],
      [habit({ scheduled_time: "06:00:00", duration_min: 60 })],
      [],
      [MON],
    );
    expect(item.start_time).toBe("21:00");
    expect(item.end_time).toBe("21:20");
  });

  it("honours the stack's days AND each habit's days", () => {
    const s = stack({ scheduled_time: "07:00", repeat_days: [0, 1] });
    expect(routineItems([s], [habit()], [], [MON, TUE, SUN]).map((i) => i.date)).toEqual([MON, TUE]);
    // No habit due on Tuesday → no Tuesday block, even though the stack allows it.
    expect(routineItems([s], [habit({ repeat_days: [0] })], [], [MON, TUE]).map((i) => i.date)).toEqual([MON]);
  });

  it("a habit created after a day is not part of that day", () => {
    const created = new Date(2026, 10, 24, 9, 0).toISOString(); // Tuesday, local
    const items = routineItems([stack({ scheduled_time: "07:00" })], [habit({ created_at: created })], [], [MON, TUE]);
    expect(items.map((i) => i.date)).toEqual([TUE]);
  });

  it("reports partial progress and is done only when every part is", () => {
    const items = routineItems(
      [stack({ scheduled_time: "07:00" })],
      [habit({ id: "a" }), habit({ id: "b" })],
      [{ ref_id: "a", date: MON }, { ref_id: "a", date: TUE }, { ref_id: "b", date: TUE }],
      [MON, TUE],
    );
    expect(items[0].progress).toEqual({ done: 1, total: 2 });
    expect(items[0].done).toBe(false);
    expect(items[1].done).toBe(true);
  });

  it("a timed habit with no stack is a routine of one", () => {
    const [item] = routineItems([], [habit({ id: "solo", stack_id: null, scheduled_time: "22:00" })], [], [MON]);
    expect(item.ref).toBe("habit:solo");
    expect(item.parts.map((p) => p.id)).toEqual(["solo"]);
  });
});

describe("supplements", () => {
  const supp = (over: Partial<SupplementRow> = {}): SupplementRow => ({
    id: "p1", name: "Creatine", dose: "5 g", stack_id: "s1", sort_order: 0, created_at: LONG_AGO, ...over,
  });

  it("an unscheduled stack produces nothing", () => {
    expect(supplementItems([stack()], [supp()], [], [MON])).toEqual([]);
  });

  it("ticks parts from logs", () => {
    const [item] = supplementItems(
      [stack({ scheduled_time: "08:00" })],
      [supp({ id: "a" }), supp({ id: "b", name: "Omega 3" })],
      [{ ref_id: "b", date: MON }],
      [MON],
    );
    expect(item.parts.map((p) => [p.label, p.done])).toEqual([["Creatine", false], ["Omega 3", true]]);
    expect(item.done).toBe(false);
  });

  it("an empty stack produces nothing (a block with zero parts would read as done)", () => {
    expect(supplementItems([stack({ scheduled_time: "08:00" })], [], [], [MON])).toEqual([]);
  });
});

describe("meals", () => {
  const entry = (over: Partial<MealEntryRow> = {}): MealEntryRow => ({
    id: "e1", date: MON, slot: "lunch", start_time: null, quantity: 1, logged: false, sort_order: 0, name: "Chicken", ...over,
  });

  it("groups entries by (date, slot) and marks a fallback time as a default", () => {
    const items = mealItems([entry(), entry({ id: "e2", name: "Rice" }), entry({ id: "e3", slot: "dinner" })]);
    const lunch = items.find((i) => i.ref === "lunch")!;
    expect(lunch.parts).toHaveLength(2);
    expect(lunch.start_time).toBe("12:00");
    expect(lunch.timeIsDefault).toBe(true);
    expect(lunch.subtitle).toBe("Chicken, Rice");
  });

  it("an explicit time beats the default and is not flagged as one", () => {
    const [item] = mealItems([entry({ start_time: "12:45:00" })]);
    expect(item.start_time).toBe("12:45");
    expect(item.timeIsDefault).toBe(false);
  });

  it("is done only when every entry is logged", () => {
    expect(mealItems([entry({ logged: true }), entry({ id: "e2" })])[0].done).toBe(false);
    expect(mealItems([entry({ logged: true }), entry({ id: "e2", logged: true })])[0].done).toBe(true);
  });
});

describe("workouts and runs", () => {
  const workout = (over: Partial<WorkoutRow> = {}): WorkoutRow => ({
    id: "w1", name: "Leg A", scheduled_date: MON, start_time: null, started_at: null, duration_min: null,
    completed: false, external_id: null, routine_id: "r1", notes: null, ...over,
  });

  it("a planned time wins over when Garmin says it happened", () => {
    const started = new Date(2026, 10, 23, 18, 10).toISOString();
    expect(workoutItem(workout({ start_time: "17:00:00", started_at: started })).start_time).toBe("17:00");
    expect(workoutItem(workout({ started_at: started })).start_time).toBe("18:10");
  });

  it("a dated session with no time is all-day, not midnight", () => {
    const item = workoutItem(workout());
    expect(item.start_time).toBeNull();
    expect(item.end_time).toBeNull();
  });

  it("uses the default duration when none is stored", () => {
    expect(workoutItem(workout({ start_time: "17:00" })).end_time).toBe("18:00");
  });

  it("reconstructs a run's duration from pace × distance", () => {
    const run: RunRow = {
      id: "r", date: MON, start_time: "07:00", started_at: null, duration_min: null, planned_km: 5,
      actual_km: 6, avg_pace_s_per_km: 300, completed: true, external_id: "garmin:1", notes: null,
    };
    const item = runItem(run);
    expect(item.end_time).toBe("07:30");
    expect(item.title).toBe("Run · 6 km");
    expect(item.recordedBy).toBe("Garmin");
  });
});

describe("ordering", () => {
  it("timed before untimed within a day", () => {
    const w = (id: string, start: string | null): WorkoutRow => ({
      id, name: id, scheduled_date: MON, start_time: start, started_at: null, duration_min: null,
      completed: false, external_id: null, routine_id: null, notes: null,
    });
    const out = sortItems([workoutItem(w("untimed", null)), workoutItem(w("late", "19:00")), workoutItem(w("early", "07:00"))]);
    expect(out.map((i) => i.ref)).toEqual(["early", "late", "untimed"]);
  });
});

describe("recorded sessions", () => {
  it("external_id IS NULL is not 'planned' — Oura and Strava rows are recorded too", () => {
    expect(recordedBy(null, "Synced from Oura")).toBe("Oura");
    expect(recordedBy(null, "Strava: Lunch Run")).toBe("Strava");
    expect(recordedBy(null, "Strava (Svømning)")).toBe("Strava");
    expect(recordedBy("garmin:23910675150", null)).toBe("Garmin");
    expect(recordedBy(null, "felt strong")).toBeNull();
    expect(recordedBy(null, null)).toBeNull();
  });

  it("agrees with garmin-import's isImportedRow on every note it knows", () => {
    const notes = ["Synced from Oura", "Garmin import", "Strava: Lunch Run", "Strava (Svømning)", "Stravaganza", "felt strong", "", null];
    for (const n of notes) expect(recordedBy(null, n) != null, String(n)).toBe(isImportedRow(n));
  });
});
