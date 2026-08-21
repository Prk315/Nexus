import { describe, it, expect } from "vitest";
import { summariseWeek } from "./WeekTimeStrip";
import type { CalBlock, TaskSession } from "../../types";

const WEEK = ["2026-08-16","2026-08-17","2026-08-18","2026-08-19","2026-08-20","2026-08-21","2026-08-22"];

const block = (over: Partial<CalBlock> = {}): CalBlock => ({
  id: 1, date: "2026-08-17", title: "b", start_time: "09:00", end_time: "10:00",
  color: "blue", description: null, location: null, created_at: "",
  is_recurring: false, recurring_id: null, recurrence: null, days_of_week: null,
  series_start_date: null, series_end_date: null, task_id: null, category: null, ...over,
});

const session = (over: Partial<TaskSession> = {}): TaskSession => ({
  id: 1, task_id: 1, date: "2026-08-17", minutes: 30,
  cal_block_id: null, note: null, created_at: "", ...over,
});

describe("summariseWeek", () => {
  it("returns one entry per day, in order, even with no data", () => {
    const out = summariseWeek(WEEK, [], []);
    expect(out.map((d) => d.iso)).toEqual(WEEK);
    expect(out.every((d) => d.committed === 0 && d.onTasks === 0 && d.logged === 0)).toBe(true);
  });

  it("sums committed minutes onto the right day", () => {
    const out = summariseWeek(WEEK, [
      block({ id: 1, date: "2026-08-17", start_time: "09:00", end_time: "10:30" }),
      block({ id: 2, date: "2026-08-17", start_time: "14:00", end_time: "14:30" }),
      block({ id: 3, date: "2026-08-19", start_time: "08:00", end_time: "09:00" }),
    ], []);
    expect(out.find((d) => d.iso === "2026-08-17")!.committed).toBe(120);
    expect(out.find((d) => d.iso === "2026-08-19")!.committed).toBe(60);
    expect(out.find((d) => d.iso === "2026-08-16")!.committed).toBe(0);
  });

  it("counts task-linked minutes separately from bare events", () => {
    // The distinction is the point: a week full of meetings is committed but
    // not task work, and the strip should be able to say so.
    const out = summariseWeek(WEEK, [
      block({ id: 1, date: "2026-08-18", task_id: 7, start_time: "09:00", end_time: "10:00" }),
      block({ id: 2, date: "2026-08-18", task_id: null, start_time: "11:00", end_time: "13:00" }),
    ], []);
    const d = out.find((x) => x.iso === "2026-08-18")!;
    expect(d.committed).toBe(180);
    expect(d.onTasks).toBe(60);
  });

  it("counts logged sessions, including freehand ones with no block", () => {
    // sessionsByBlock drops these; the strip must not, or logged time recorded
    // away from a scheduled block silently vanishes.
    const out = summariseWeek(WEEK, [], [
      session({ id: 1, date: "2026-08-20", minutes: 25, cal_block_id: 99 }),
      session({ id: 2, date: "2026-08-20", minutes: 35, cal_block_id: null }),
    ]);
    expect(out.find((d) => d.iso === "2026-08-20")!.logged).toBe(60);
  });

  it("ignores blocks and sessions outside the visible week", () => {
    const out = summariseWeek(WEEK, [
      block({ id: 1, date: "2026-09-01", start_time: "09:00", end_time: "17:00" }),
    ], [
      session({ id: 1, date: "2026-07-04", minutes: 500 }),
    ]);
    expect(out.reduce((s, d) => s + d.committed + d.logged, 0)).toBe(0);
  });

  it("handles a block that runs past midnight without going negative", () => {
    const out = summariseWeek(WEEK, [
      block({ id: 1, date: "2026-08-21", start_time: "23:00", end_time: "00:30" }),
    ], []);
    expect(out.find((d) => d.iso === "2026-08-21")!.committed).toBe(90);
  });

  it("allows logged to exceed committed rather than clamping the data", () => {
    // Working longer than you booked is real; the bar clamps its FILL at 100%
    // but the underlying numbers stay honest.
    const out = summariseWeek(WEEK,
      [block({ id: 1, date: "2026-08-19", start_time: "09:00", end_time: "10:00" })],
      [session({ id: 1, date: "2026-08-19", minutes: 180 })]);
    const d = out.find((x) => x.iso === "2026-08-19")!;
    expect(d.committed).toBe(60);
    expect(d.logged).toBe(180);
  });
});
