import { describe, it, expect } from "vitest";
import {
  DAY_WINDOW_END_MIN, DAY_WINDOW_START_MIN,
  findFreeSlot, minToTime, nextQuarterHour, timeToMin,
  todayDateStr, tomorrowDateStr, defaultScheduleWindow,
} from "./quickSchedule";

describe("findFreeSlot — empty day", () => {
  it("proposes notBefore itself when nothing is scheduled", () => {
    expect(findFreeSlot([], 30, { notBefore: "09:00" }))
      .toEqual({ startTime: "09:00", endTime: "09:30" });
  });

  it("clamps notBefore up to the window start (05:00) when it's earlier", () => {
    expect(findFreeSlot([], 30, { notBefore: "02:00" }))
      .toEqual({ startTime: "05:00", endTime: "05:30" });
  });
});

describe("findFreeSlot — gap between blocks", () => {
  const dayBlocks = [
    { start_time: "09:00", end_time: "10:00" },
    { start_time: "11:00", end_time: "12:00" },
  ];

  it("skips past a block that starts before notBefore and lands in the next real gap", () => {
    // notBefore (09:30) falls inside the first block, so the search must
    // resume after it ends (10:00), not inside it — the 60-minute gap
    // between the two blocks is what should come back.
    expect(findFreeSlot(dayBlocks, 30, { notBefore: "09:30" }))
      .toEqual({ startTime: "10:00", endTime: "10:30" });
  });

  it("returns the gap before the first block when notBefore precedes it", () => {
    expect(findFreeSlot(dayBlocks, 30, { notBefore: "08:00" }))
      .toEqual({ startTime: "08:00", endTime: "08:30" });
  });

  it("returns the trailing gap after the last block when nothing earlier fits", () => {
    expect(findFreeSlot(dayBlocks, 30, { notBefore: "11:30" }))
      .toEqual({ startTime: "12:00", endTime: "12:30" });
  });
});

describe("findFreeSlot — overflow-append (no gap fits, but some room remains)", () => {
  it("appends after the last block and clamps the end to the window", () => {
    // Window ends at 23:00. A block runs right up to 22:50, leaving only 10
    // free minutes — not enough for the requested 30, but the function still
    // offers what's left rather than giving up.
    const dayBlocks = [{ start_time: "05:00", end_time: "22:50" }];
    expect(findFreeSlot(dayBlocks, 30, { notBefore: "05:00" }))
      .toEqual({ startTime: "22:50", endTime: "23:00" });
  });

  it("clamps to a caller-supplied notAfter the same way", () => {
    const dayBlocks = [{ start_time: "09:00", end_time: "17:50" }];
    expect(findFreeSlot(dayBlocks, 30, { notBefore: "09:00", notAfter: "18:00" }))
      .toEqual({ startTime: "17:50", endTime: "18:00" });
  });
});

describe("findFreeSlot — full day", () => {
  it("returns null when the window is completely booked", () => {
    const dayBlocks = [{ start_time: "05:00", end_time: "23:00" }];
    expect(findFreeSlot(dayBlocks, 30, { notBefore: "05:00" })).toBeNull();
  });

  it("returns null when notBefore is already at/after the window end", () => {
    expect(findFreeSlot([], 30, { notBefore: "23:00" })).toBeNull();
    expect(findFreeSlot([], 30, { notBefore: "23:30" })).toBeNull();
  });

  it("accepts a gap exactly equal to the requested duration (>=, not >)", () => {
    const dayBlocks = [
      { start_time: "09:00", end_time: "09:30" }, // 30-minute gap before this, from notBefore
      { start_time: "10:00", end_time: "11:00" },
    ];
    expect(findFreeSlot(dayBlocks, 30, { notBefore: "08:30" }))
      .toEqual({ startTime: "08:30", endTime: "09:00" });
  });

  it("rejects a gap one minute short of the requested duration", () => {
    const dayBlocks = [{ start_time: "09:29", end_time: "23:00" }];
    // Only a 29-minute gap between notBefore and the block — not enough for
    // 30, and there's no room left afterward either (block runs to the
    // window's end), so this must fall through to null, not a short slot.
    expect(findFreeSlot(dayBlocks, 30, { notBefore: "09:00" })).toBeNull();
  });
});

describe("findFreeSlot — 5-minute granularity", () => {
  it("snaps a block's end that lands off-grid up to the next 5-minute mark", () => {
    // A 9-minute block ending at 09:09 must not offer 09:09 as a start —
    // the next slot should land on a 5-minute boundary.
    const dayBlocks = [{ start_time: "09:00", end_time: "09:09" }];
    const slot = findFreeSlot(dayBlocks, 15, { notBefore: "09:00" });
    expect(slot).toEqual({ startTime: "09:10", endTime: "09:25" });
  });

  it("snaps notBefore itself up to the next 5-minute mark", () => {
    expect(findFreeSlot([], 15, { notBefore: "09:03" }))
      .toEqual({ startTime: "09:05", endTime: "09:20" });
  });
});

describe("timeToMin / minToTime", () => {
  it("round-trip for on-the-hour and mid-hour times", () => {
    expect(timeToMin("00:00")).toBe(0);
    expect(timeToMin("09:30")).toBe(570);
    expect(minToTime(0)).toBe("00:00");
    expect(minToTime(570)).toBe("09:30");
  });

  it("minToTime clamps out-of-range minutes into a valid HH:MM", () => {
    expect(minToTime(-10)).toBe("00:00");
    expect(minToTime(24 * 60 + 30)).toBe("23:59");
  });
});

describe("nextQuarterHour", () => {
  it("rounds up to the next quarter-hour mark", () => {
    expect(nextQuarterHour(new Date(2026, 0, 1, 10, 1))).toBe("10:15");
    expect(nextQuarterHour(new Date(2026, 0, 1, 10, 16))).toBe("10:30");
    expect(nextQuarterHour(new Date(2026, 0, 1, 10, 44))).toBe("10:45");
  });

  it("leaves a time already on a quarter-hour boundary unchanged", () => {
    expect(nextQuarterHour(new Date(2026, 0, 1, 10, 30))).toBe("10:30");
    expect(nextQuarterHour(new Date(2026, 0, 1, 0, 0))).toBe("00:00");
  });

  it("rolls over past the last quarter-hour of the day (clamped by minToTime)", () => {
    expect(nextQuarterHour(new Date(2026, 0, 1, 23, 50))).toBe("23:59");
  });
});

describe("defaultScheduleWindow", () => {
  it("wraps nextQuarterHour as notBefore", () => {
    expect(defaultScheduleWindow(new Date(2026, 0, 1, 14, 5))).toEqual({ notBefore: "14:15" });
  });
});

describe("todayDateStr / tomorrowDateStr", () => {
  it("formats in local time, not UTC", () => {
    const d = new Date(2026, 7, 26, 23, 30); // Aug 26, 2026, 23:30 local
    expect(todayDateStr(d)).toBe("2026-08-26");
    expect(tomorrowDateStr(d)).toBe("2026-08-27");
  });

  it("rolls over the month/year boundary correctly", () => {
    const d = new Date(2026, 11, 31, 12, 0); // Dec 31, 2026
    expect(todayDateStr(d)).toBe("2026-12-31");
    expect(tomorrowDateStr(d)).toBe("2027-01-01");
  });
});

// Sanity check the two window constants line up with the documented 05:00–23:00 range.
describe("window constants", () => {
  it("DAY_WINDOW_START_MIN / DAY_WINDOW_END_MIN match 05:00 / 23:00", () => {
    expect(DAY_WINDOW_START_MIN).toBe(5 * 60);
    expect(DAY_WINDOW_END_MIN).toBe(23 * 60);
  });
});
