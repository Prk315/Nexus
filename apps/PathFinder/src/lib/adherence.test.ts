import { describe, it, expect } from "vitest";
import { hasEnded, summariseAdherence } from "./adherence";
import type { CalBlock } from "../types";

const block = (over: Partial<CalBlock> = {}): CalBlock => ({
  id: 1, date: "2026-11-02", title: "b", start_time: "09:00", end_time: "10:00",
  color: "blue", description: null, location: null, created_at: "",
  is_recurring: false, recurring_id: null, recurrence: null, days_of_week: null,
  series_start_date: null, series_end_date: null, task_id: 7, category: null,
  parent_block_id: null, ...over,
});

const NOW = { date: "2026-11-03", minutes: 12 * 60 };
const DAYS = ["2026-11-02", "2026-11-03"];

describe("hasEnded", () => {
  it("compares against the clock on the same day", () => {
    expect(hasEnded(block({ date: "2026-11-03", start_time: "09:00", end_time: "12:00" }), NOW)).toBe(true);
    expect(hasEnded(block({ date: "2026-11-03", start_time: "11:00", end_time: "12:01" }), NOW)).toBe(false);
  });

  it("treats past days as over and future days as not", () => {
    expect(hasEnded(block({ date: "2026-11-02", end_time: "23:59" }), NOW)).toBe(true);
    expect(hasEnded(block({ date: "2026-11-04", start_time: "00:00", end_time: "00:15" }), NOW)).toBe(false);
  });

  it("lets a block that wraps past midnight end the next morning", () => {
    const wrap = block({ date: "2026-11-02", start_time: "23:00", end_time: "01:00" });
    expect(hasEnded(wrap, { date: "2026-11-03", minutes: 30 })).toBe(false);
    expect(hasEnded(wrap, { date: "2026-11-03", minutes: 60 })).toBe(true);
  });
});

describe("summariseAdherence", () => {
  it("returns every day in order, with null rates when nothing is graded", () => {
    const s = summariseAdherence(DAYS, [], new Set(), new Set(), NOW);
    expect(s.days.map((d) => d.iso)).toEqual(DAYS);
    expect(s.days.every((d) => d.rate === null)).toBe(true);
    expect(s.rate).toBeNull();
    expect(s.activeDays).toBe(0);
  });

  it("grades task blocks by minutes into done / missed / unmarked / upcoming", () => {
    const blocks = [
      block({ id: 1, start_time: "08:00", end_time: "10:00" }),                      // done, 120
      block({ id: 2, start_time: "10:00", end_time: "11:00" }),                      // missed, 60
      block({ id: 3, start_time: "13:00", end_time: "14:00" }),                      // unmarked, 60
      block({ id: 4, date: "2026-11-03", start_time: "15:00", end_time: "16:30" }), // upcoming, 90
    ];
    const s = summariseAdherence(DAYS, blocks, new Set([1]), new Set([2]), NOW);
    const [mon, tue] = s.days;
    expect(mon).toMatchObject({ scheduled: 240, done: 120, missed: 60, unmarked: 60, upcoming: 0, blocks: 3 });
    expect(mon.rate).toBeCloseTo(0.5);
    expect(tue).toMatchObject({ scheduled: 90, upcoming: 90, rate: null });
    expect(s.rate).toBeCloseTo(0.5);
    expect(s.activeDays).toBe(2);
    expect(s.avgScheduledPerActiveDay).toBe(165);
  });

  it("counts bare blocks as booked time but never grades them", () => {
    const s = summariseAdherence(DAYS, [
      block({ id: 1, task_id: null, start_time: "12:00", end_time: "12:30" }),
      block({ id: 2, start_time: "09:00", end_time: "10:00" }),
    ], new Set([2]), new Set(), NOW);
    expect(s.days[0]).toMatchObject({ booked: 90, scheduled: 60, done: 60, blocks: 1, rate: 1 });
  });

  it("a worked tick wins over a stale miss on the same occurrence", () => {
    const s = summariseAdherence(DAYS, [block({ id: -5 })], new Set([-5]), new Set([-5]), NOW);
    expect(s.days[0]).toMatchObject({ done: 60, missed: 0 });
  });

  it("ignores blocks outside the requested days", () => {
    const s = summariseAdherence(DAYS, [block({ date: "2026-10-01" })], new Set(), new Set(), NOW);
    expect(s.scheduled).toBe(0);
  });
});
