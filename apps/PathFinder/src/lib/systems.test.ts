import { describe, it, expect } from "vitest";
import { isSystemDue, isSystemScheduledOn, frequencyLabel, daysBetween } from "./systems";
import type { SystemEntry } from "../types";

function system(over: Partial<SystemEntry> = {}): SystemEntry {
  return {
    id: 1, title: "s", description: null, frequency: "daily", interval_days: null,
    days_of_week: null, last_done: null, streak_count: 0, streak_updated: null,
    created_at: "", start_time: null, end_time: null, is_lifestyle: false,
    lifestyle_area_id: null, ...over,
  };
}

// 2026-08-21 is a Friday (day 5).
const FRI = "2026-08-21";

describe("daysBetween", () => {
  it("counts whole days", () => {
    expect(daysBetween("2026-08-14", FRI)).toBe(7);
    expect(daysBetween(FRI, FRI)).toBe(0);
    expect(daysBetween("2026-08-22", FRI)).toBe(-1);
  });

  it("is not thrown off by a DST boundary", () => {
    // Europe/Copenhagen ends DST on 2026-10-25; a 25-hour day must still be 1.
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });
});

describe("isSystemDue — interval recurrence", () => {
  const every = (n: number, last: string | null) =>
    system({ frequency: "interval", interval_days: n, last_done: last });

  it("is due when never done", () => {
    expect(isSystemDue(every(7, null), FRI)).toBe(true);
  });

  it("is not due before the interval elapses", () => {
    expect(isSystemDue(every(7, "2026-08-15"), FRI)).toBe(false); // 6 days
  });

  it("is due once the interval elapses", () => {
    expect(isSystemDue(every(7, "2026-08-14"), FRI)).toBe(true);  // 7 days
  });

  it("is never due again the day it was completed", () => {
    expect(isSystemDue(every(7, FRI), FRI)).toBe(false);
  });

  it("floats with behaviour rather than the calendar", () => {
    // This is the whole reason `interval` exists: do it Friday instead of
    // Tuesday and the next one moves with you.
    expect(isSystemDue(every(3, "2026-08-18"), FRI)).toBe(true);
    expect(isSystemDue(every(3, "2026-08-19"), FRI)).toBe(false);
  });

  it("is not due forever when interval_days is missing or nonsense", () => {
    // The DB CHECK prevents this shape; a bad row must not nag daily anyway.
    expect(isSystemDue(system({ frequency: "interval" }), FRI)).toBe(false);
    expect(isSystemDue(system({ frequency: "interval", interval_days: 0 }), FRI)).toBe(false);
    expect(isSystemDue(system({ frequency: "interval", interval_days: -3 }), FRI)).toBe(false);
  });
});

describe("isSystemDue — calendar recurrence", () => {
  it("daily is due unless already done today", () => {
    expect(isSystemDue(system({ frequency: "daily" }), FRI)).toBe(true);
    expect(isSystemDue(system({ frequency: "daily", last_done: FRI }), FRI)).toBe(false);
  });

  it("weekly respects the chosen weekdays", () => {
    expect(isSystemDue(system({ frequency: "weekly", days_of_week: "5" }), FRI)).toBe(true);
    expect(isSystemDue(system({ frequency: "weekly", days_of_week: "1" }), FRI)).toBe(false);
    expect(isSystemDue(system({ frequency: "weekly", days_of_week: "1,5" }), FRI)).toBe(true);
  });

  it("weekly with no days chosen errs toward visible", () => {
    // Hiding it forever is the failure a user cannot diagnose.
    expect(isSystemDue(system({ frequency: "weekly" }), FRI)).toBe(true);
    expect(isSystemDue(system({ frequency: "weekly", days_of_week: "" }), FRI)).toBe(true);
  });

  it("monthly and unknown frequencies err toward visible", () => {
    expect(isSystemDue(system({ frequency: "monthly" }), FRI)).toBe(true);
    expect(isSystemDue(system({ frequency: "quarterly" as any }), FRI)).toBe(true);
  });
});

describe("isSystemDue — call signature", () => {
  it("survives being passed straight to Array.filter", () => {
    // `systems.filter(isSystemDue)` hands the ARRAY INDEX in as `date`, which
    // made every date invalid. tsc caught it once; this keeps it caught.
    const list = [
      system({ id: 1, frequency: "daily" }),
      system({ id: 2, frequency: "weekly", days_of_week: "1" }),
    ];
    const viaLambda = list.filter((s) => isSystemDue(s, FRI));
    expect(viaLambda.map((s) => s.id)).toEqual([1]);
  });
});

describe("isSystemScheduledOn", () => {
  it("places calendar frequencies on the grid", () => {
    expect(isSystemScheduledOn(system({ frequency: "daily" }), FRI)).toBe(true);
    expect(isSystemScheduledOn(system({ frequency: "weekly", days_of_week: "5" }), FRI)).toBe(true);
    expect(isSystemScheduledOn(system({ frequency: "weekly", days_of_week: "1" }), FRI)).toBe(false);
  });

  it("keeps interval and monthly off the grid — they have no fixed slot", () => {
    expect(isSystemScheduledOn(system({ frequency: "interval", interval_days: 7 }), FRI)).toBe(false);
    expect(isSystemScheduledOn(system({ frequency: "monthly" }), FRI)).toBe(false);
  });

  it("is independent of completion, unlike isSystemDue", () => {
    const s = system({ frequency: "daily", last_done: FRI });
    expect(isSystemDue(s, FRI)).toBe(false);
    expect(isSystemScheduledOn(s, FRI)).toBe(true);
  });
});

describe("frequencyLabel", () => {
  it("describes an interval cadence", () => {
    expect(frequencyLabel(system({ frequency: "interval", interval_days: 7 }))).toBe("Every 7 days");
    expect(frequencyLabel(system({ frequency: "interval", interval_days: 1 }))).toBe("Every day");
  });

  it("lists weekly days, and falls back to the frequency name", () => {
    expect(frequencyLabel(system({ frequency: "weekly", days_of_week: "1,3,5" }))).toBe("Mon Wed Fri");
    expect(frequencyLabel(system({ frequency: "weekly" }))).toBe("Weekly");
    expect(frequencyLabel(system({ frequency: "daily" }))).toBe("Daily");
  });
});
