import { describe, it, expect } from "vitest";
import {
  materialPosition, materialFraction, materialPace, deltaForLogTo, lastActivityDate,
  examRunway, recentDailyPace,
} from "./learnProgress";

const M = { id: "m1", start_unit: 37, total_units: 1171, pace_units_per_min: 0.15 };
const ev = (over: Partial<Parameters<typeof materialPosition>[1][number]>) => ({
  material_id: "m1", event_date: "2026-09-24", kind: "reading",
  units_from: null, units_to: null, units_delta: null, minutes: null, ...over,
});

describe("materialPosition", () => {
  it("starts at start_unit with no events — front matter is not unread progress", () => {
    expect(materialPosition(M, [])).toBe(37);
  });
  it("is the furthest units_to, and events without units_to contribute nothing", () => {
    expect(materialPosition(M, [
      ev({ units_to: 51 }), ev({ units_to: 44 }), ev({ minutes: 30 }),
    ])).toBe(51);
  });
  it("ignores other materials", () => {
    expect(materialPosition(M, [ev({ material_id: "m2", units_to: 400 })])).toBe(37);
  });
});

describe("materialFraction", () => {
  it("measures against the readable span, not the raw page count", () => {
    // position 604 of 37..1171 is exactly half the span — NOT 604/1171
    expect(materialFraction(M, 604)).toBeCloseTo(0.5, 5);
  });
  it("null for unknown length — an unknown book has no honest percentage", () => {
    expect(materialFraction({ ...M, total_units: null }, 100)).toBeNull();
  });
  it("clamps overshoot to 1", () => {
    expect(materialFraction(M, 2000)).toBe(1);
  });
});

describe("materialPace", () => {
  it("uses configured pace until three measurements exist", () => {
    expect(materialPace(M, [ev({ units_delta: 10, minutes: 10 })])).toBe(0.15);
  });
  it("median of measured rates once there are three", () => {
    const events = [
      ev({ units_delta: 10, minutes: 100 }), // 0.1
      ev({ units_delta: 20, minutes: 100 }), // 0.2
      ev({ units_delta: 90, minutes: 100 }), // 0.9 outlier — median shrugs
    ];
    expect(materialPace(M, events)).toBe(0.2);
  });
  it("skips events without minutes rather than treating them as infinite speed", () => {
    const events = [
      ev({ units_delta: 10, minutes: null }),
      ev({ units_delta: 10, minutes: 100 }),
      ev({ units_delta: 30, minutes: 100 }),
    ];
    expect(materialPace(M, events)).toBe(0.15); // only 2 measured → fallback
  });
});

describe("deltaForLogTo", () => {
  it("advancing stores the difference", () => {
    expect(deltaForLogTo(51, 65)).toBe(14);
  });
  it("re-reading earlier pages is null, never zero or negative", () => {
    expect(deltaForLogTo(51, 51)).toBeNull();
    expect(deltaForLogTo(51, 40)).toBeNull();
  });
});

describe("lastActivityDate", () => {
  it("baseline events are setup, not activity", () => {
    expect(lastActivityDate(M, [ev({ kind: "baseline", event_date: "2026-09-25" })])).toBeNull();
  });
  it("newest event date wins", () => {
    expect(lastActivityDate(M, [
      ev({ event_date: "2026-09-20", units_to: 40 }),
      ev({ event_date: "2026-09-24", minutes: 15 }),
    ])).toBe("2026-09-24");
  });
});

describe("examRunway", () => {
  const RM = { ...M, due_date: "2026-11-06" };
  it("needs both a due date and a length", () => {
    expect(examRunway({ ...M, due_date: null }, 100, "2026-09-28")).toBeNull();
    expect(examRunway({ ...RM, total_units: null }, 100, "2026-09-28")).toBeNull();
  });
  it("required per day = remaining / days left", () => {
    const r = examRunway(RM, 781, "2026-09-28")!; // 390 pages, 39 days
    expect(r.daysLeft).toBe(39);
    expect(r.requiredPerDay).toBeCloseTo(10, 5);
  });
  it("overdue floors days at 1 — full load, no divide-by-zero", () => {
    const r = examRunway(RM, 1000, "2026-11-20")!;
    expect(r.daysLeft).toBe(1);
    expect(r.remaining).toBe(171);
  });
});

describe("recentDailyPace", () => {
  it("null with no dated progress — a fresh tracker is not 0/day", () => {
    expect(recentDailyPace(M, [], "2026-09-28")).toBeNull();
  });
  it("averages deltas over the window", () => {
    const events = [
      ev({ event_date: "2026-09-27", units_delta: 21 }),
      ev({ event_date: "2026-09-25", units_delta: 14 }),
      ev({ event_date: "2026-09-01", units_delta: 99 }), // outside window
    ];
    expect(recentDailyPace(M, events, "2026-09-28", 7)).toBeCloseTo(5, 5);
  });
});
