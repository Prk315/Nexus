import { describe, it, expect } from "vitest";
import {
  buildTimeline, packLanes, axisTicks, clampWindow, dayIndex, isoFromDay,
  isIsoDate, dayToX, spanWidth, ZOOMS, ZOOM_DAYS, ZOOM_PX_PER_DAY,
  type Span,
} from "./timeline";

const task = (id: number, over: Partial<Parameters<typeof buildTimeline>[0][number]> = {}) => ({
  id, title: `t${id}`, done: false, dueDate: null, ...over,
});

const span = (id: number, from: string, to: string): Span => ({
  id, title: `s${id}`, from: dayIndex(from), to: dayIndex(to),
  done: false, scheduled: true, lane: 0,
});

describe("dates are calendar days, not instants", () => {
  // A due date is a DAY. Parsing it as a local instant shifts it across
  // midnight for anyone not on UTC, and the bar lands on the wrong column.
  it("round-trips every date through the day index", () => {
    for (const iso of ["2026-01-01", "2026-02-28", "2026-12-31", "2027-08-31"]) {
      expect(isoFromDay(dayIndex(iso)), iso).toBe(iso);
    }
  });

  it("counts consecutive days as consecutive indices, across a month end", () => {
    expect(dayIndex("2026-03-01") - dayIndex("2026-02-28")).toBe(1);
    // 2028 is a leap year: Feb 29 exists, so Mar 1 is two days after Feb 28.
    expect(dayIndex("2028-03-01") - dayIndex("2028-02-28")).toBe(2);
  });

  it("refuses what is not a date", () => {
    for (const bad of ["", "2026-13-01", "yesterday", "2026/01/01", null, undefined, 42]) {
      expect(isIsoDate(bad), String(bad)).toBe(false);
    }
    expect(isIsoDate("2026-01-01")).toBe(true);
  });
});

describe("⚠️ undated work is counted, never placed", () => {
  // The rule the whole module turns on. Parking undated tasks at today would
  // assert 384 deadlines nobody set, and the user cannot see through it.
  it("partitions tasks with no date at all", () => {
    const m = buildTimeline([
      task(1, { dueDate: "2026-05-01" }),
      task(2),
      task(3, { dueDate: null }),
      task(4, { dueDate: "not a date" }),
    ]);
    expect(m.spans.map((s) => s.id)).toEqual([1]);
    expect(m.undated).toBe(3);
  });

  it("has no range when nothing is dated, rather than a range around today", () => {
    const m = buildTimeline([task(1), task(2)]);
    expect(m.range).toBeNull();
    expect(m.spans).toEqual([]);
    expect(m.undated).toBe(2);
  });

  it("counts nothing when there are no tasks", () => {
    expect(buildTimeline([])).toEqual({ spans: [], undated: 0, range: null, lanes: 0 });
  });
});

describe("extent comes from data", () => {
  // A due date is a point. Giving it width would claim work happens on days
  // nothing was scheduled for.
  it("draws a due date as a single day", () => {
    const [s] = buildTimeline([task(1, { dueDate: "2026-05-04" })]).spans;
    expect(s.from).toBe(s.to);
    expect(s.scheduled).toBe(false);
  });

  it("spans scheduled days, first to last", () => {
    const [s] = buildTimeline([
      task(1, { scheduledDays: ["2026-05-06", "2026-05-04", "2026-05-05"] }),
    ]).spans;
    expect(isoFromDay(s.from)).toBe("2026-05-04");
    expect(isoFromDay(s.to)).toBe("2026-05-06");
    expect(s.scheduled).toBe(true);
  });

  // ⚠️ Scheduled time WINS over the due date. Using the due date as the end of
  // the bar would stretch it across days the work was never scheduled for.
  it("prefers scheduled days over a later due date", () => {
    const [s] = buildTimeline([
      task(1, { dueDate: "2026-05-30", scheduledDays: ["2026-05-04", "2026-05-05"] }),
    ]).spans;
    expect(isoFromDay(s.to)).toBe("2026-05-05");
  });

  it("ignores junk in the scheduled list rather than throwing", () => {
    const [s] = buildTimeline([
      task(1, { scheduledDays: ["nope", "2026-05-04", ""] as never }),
    ]).spans;
    expect(isoFromDay(s.from)).toBe("2026-05-04");
  });

  it("reports the full covered range, not just the last span's end", () => {
    // A long early span can end after a later-starting short one; the range
    // must be the max of every end, which a naive "last span" would miss.
    const m = buildTimeline([
      task(1, { scheduledDays: ["2026-01-01", "2026-12-01"] }),
      task(2, { dueDate: "2026-02-01" }),
    ]);
    expect(isoFromDay(m.range!.from)).toBe("2026-01-01");
    expect(isoFromDay(m.range!.to)).toBe("2026-12-01");
  });
});

describe("packLanes", () => {
  it("puts non-overlapping spans on one lane", () => {
    const spans = [span(1, "2026-01-01", "2026-01-05"), span(2, "2026-01-10", "2026-01-12")];
    expect(packLanes(spans)).toBe(1);
    expect(spans.map((s) => s.lane)).toEqual([0, 0]);
  });

  it("splits overlapping spans across lanes", () => {
    const spans = [span(1, "2026-01-01", "2026-01-10"), span(2, "2026-01-05", "2026-01-15")];
    expect(packLanes(spans)).toBe(2);
    expect(spans.map((s) => s.lane)).toEqual([0, 1]);
  });

  // ⚠️ Touching is not free. Edge-to-edge bars read as one continuous bar, so
  // a span starting the day another ends needs its own lane.
  it("does not share a lane with a span that ends on the same day", () => {
    const spans = [span(1, "2026-01-01", "2026-01-05"), span(2, "2026-01-05", "2026-01-09")];
    expect(packLanes(spans)).toBe(2);
  });

  it("reuses a lane as soon as it is genuinely free", () => {
    const spans = [
      span(1, "2026-01-01", "2026-01-05"),
      span(2, "2026-01-03", "2026-01-04"),
      span(3, "2026-01-07", "2026-01-08"),
    ];
    expect(packLanes(spans)).toBe(2);
    expect(spans[2].lane).toBe(0);
  });

  it("handles single-day spans without stacking them all", () => {
    const spans = [span(1, "2026-01-01", "2026-01-01"), span(2, "2026-01-02", "2026-01-02")];
    expect(packLanes(spans)).toBe(1);
  });
});

describe("axisTicks", () => {
  const at = (from: string, to: string, zoom: Parameters<typeof axisTicks>[2]) =>
    axisTicks(dayIndex(from), dayIndex(to), zoom);

  // Built from real month boundaries: months are 28–31 days, so a fixed step
  // drifts and labels stop naming the month they sit above.
  it("puts a major tick on the first of each month, on the right day", () => {
    const ticks = at("2026-01-15", "2026-04-10", "quarter").filter((t) => t.major);
    expect(ticks.map((t) => isoFromDay(t.day))).toEqual(["2026-02-01", "2026-03-01", "2026-04-01"]);
  });

  it("survives February in a leap year", () => {
    const ticks = at("2028-01-01", "2028-04-01", "quarter").filter((t) => t.major);
    expect(ticks.map((t) => isoFromDay(t.day))).toContain("2028-03-01");
  });

  it("labels only quarters at year zoom, so twelve labels do not overlap", () => {
    const labels = at("2026-01-01", "2026-12-31", "year").filter((t) => t.major);
    expect(labels).toHaveLength(4);
    expect(labels.map((t) => t.label)).toEqual(["Jan 26", "Apr 26", "Jul 26", "Oct 26"]);
  });

  it("adds week rules only at month zoom", () => {
    expect(at("2026-01-01", "2026-01-31", "month").some((t) => !t.major)).toBe(true);
    expect(at("2026-01-01", "2026-06-30", "quarter").some((t) => !t.major)).toBe(false);
    expect(at("2026-01-01", "2026-12-31", "year").some((t) => !t.major)).toBe(false);
  });

  it("puts week rules on Mondays", () => {
    for (const t of at("2026-01-01", "2026-02-28", "month").filter((x) => !x.major)) {
      expect(new Date(t.day * 86_400_000).getUTCDay(), isoFromDay(t.day)).toBe(1);
    }
  });

  it("returns nothing for an inverted or empty range instead of looping", () => {
    expect(at("2026-05-01", "2026-04-01", "month")).toEqual([]);
  });

  it("terminates on an absurd range", () => {
    // The guard exists so a bad range is a wrong picture, not a frozen tab.
    expect(() => at("1990-01-01", "2400-01-01", "year")).not.toThrow();
  });
});

describe("clampWindow", () => {
  const range = { from: dayIndex("2026-01-01"), to: dayIndex("2026-06-30") };

  it("spans the zoom's width", () => {
    for (const z of ZOOMS) {
      const w = clampWindow(range.from, z, range);
      expect(w.to - w.from + 1, z).toBe(ZOOM_DAYS[z]);
    }
  });

  it("will not scroll past the content", () => {
    const far = clampWindow(dayIndex("2030-01-01"), "month", range);
    expect(far.to).toBeLessThanOrEqual(range.to + 7);
    const back = clampWindow(dayIndex("2000-01-01"), "month", range);
    expect(back.from).toBeGreaterThanOrEqual(range.from - 7);
  });

  // A window wider than the content must still be the zoom's width, not a
  // collapsed sliver — otherwise a year zoom over one week of data draws
  // nothing.
  it("keeps full width when the content is shorter than the window", () => {
    const tiny = { from: dayIndex("2026-01-01"), to: dayIndex("2026-01-03") };
    const w = clampWindow(tiny.from, "year", tiny);
    expect(w.to - w.from + 1).toBe(ZOOM_DAYS.year);
  });

  it("works with no content at all", () => {
    const w = clampWindow(dayIndex("2026-01-01"), "month", null);
    expect(w.to - w.from + 1).toBe(ZOOM_DAYS.month);
  });
});

describe("pixel mapping", () => {
  it("puts the window's first day at x=0 and scales by the zoom", () => {
    const from = dayIndex("2026-01-01");
    expect(dayToX(from, from, "month")).toBe(0);
    expect(dayToX(from + 1, from, "month")).toBe(ZOOM_PX_PER_DAY.month);
    expect(dayToX(from + 1, from, "year")).toBe(ZOOM_PX_PER_DAY.year);
  });

  // ⚠️ At year zoom a single day is 2.6 px and would disappear under a border.
  // A due-date marker that cannot be seen is a task that looks unscheduled.
  it("never renders a span narrower than a visible sliver", () => {
    const d = dayIndex("2026-01-01");
    for (const z of ZOOMS) expect(spanWidth(d, d, z), z).toBeGreaterThanOrEqual(3);
  });

  it("scales a multi-day span by its length", () => {
    const d = dayIndex("2026-01-01");
    expect(spanWidth(d, d + 9, "month")).toBe(10 * ZOOM_PX_PER_DAY.month);
  });
});
