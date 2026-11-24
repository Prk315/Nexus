import { describe, it, expect } from "vitest";
import {
  localDayBounds,
  toCalReminder,
  REMINDER_MARKER_MIN,
  compareReminders, fromLocalInputValue, isReminderActionable,
  reminderPresets, reminderStatus, toLocalInputValue,
} from "./reminders";

// Every instant is built from LOCAL parts so the suite passes in any TZ.
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi);
const iso = (dt: Date) => dt.toISOString();

describe("reminderStatus", () => {
  const now = at(2026, 11, 23, 12).getTime();

  it("no time is unscheduled — and still actionable", () => {
    expect(reminderStatus({ remind_at: null, lead_minutes: null }, now)).toBe("unscheduled");
    expect(isReminderActionable({ remind_at: null, lead_minutes: null }, now)).toBe(true);
  });

  it("treats an unparseable timestamp as unscheduled, never as due", () => {
    expect(reminderStatus({ remind_at: "not a date", lead_minutes: 15 }, now)).toBe("unscheduled");
  });

  it("a passed time is due", () => {
    expect(reminderStatus({ remind_at: iso(at(2026, 11, 23, 11)), lead_minutes: null }, now)).toBe("due");
  });

  it("exactly now is due, not soon", () => {
    expect(reminderStatus({ remind_at: iso(at(2026, 11, 23, 12)), lead_minutes: 30 }, now)).toBe("due");
  });

  it("inside the lead window is soon — lead_minutes now means something", () => {
    expect(reminderStatus({ remind_at: iso(at(2026, 11, 23, 12, 20)), lead_minutes: 30 }, now)).toBe("soon");
    expect(isReminderActionable({ remind_at: iso(at(2026, 11, 23, 12, 20)), lead_minutes: 30 }, now)).toBe(true);
  });

  it("outside the lead window is scheduled and off the badge", () => {
    const m = { remind_at: iso(at(2026, 11, 23, 13)), lead_minutes: 30 };
    expect(reminderStatus(m, now)).toBe("scheduled");
    expect(isReminderActionable(m, now)).toBe(false);
  });

  it("a zero or negative lead is no lead", () => {
    expect(reminderStatus({ remind_at: iso(at(2026, 11, 23, 12, 1)), lead_minutes: 0 }, now)).toBe("scheduled");
    expect(reminderStatus({ remind_at: iso(at(2026, 11, 23, 12, 1)), lead_minutes: -10 }, now)).toBe("scheduled");
  });
});

describe("compareReminders", () => {
  it("orders by instant, not by string — Z and +00:00 spellings of one instant tie", () => {
    expect(compareReminders(
      { remind_at: "2026-11-23T10:00:00.000Z", lead_minutes: null },
      { remind_at: "2026-11-23T10:00:00+00:00", lead_minutes: null },
    )).toBe(0);
  });

  it("puts undated reminders last", () => {
    const dated = { remind_at: "2026-11-23T10:00:00Z", lead_minutes: null };
    const none = { remind_at: null, lead_minutes: null };
    expect(compareReminders(dated, none)).toBeLessThan(0);
    expect(compareReminders(none, dated)).toBeGreaterThan(0);
    expect(compareReminders(undefined, none)).toBe(0);
  });
});

describe("local datetime input round trip", () => {
  it("toLocalInputValue → fromLocalInputValue returns the same instant", () => {
    const d = at(2026, 3, 29, 2, 30); // around a DST change in many zones
    const back = fromLocalInputValue(toLocalInputValue(d.toISOString()));
    expect(back).not.toBeNull();
    expect(toLocalInputValue(back)).toBe(toLocalInputValue(d.toISOString()));
  });

  it("renders local wall-clock parts", () => {
    expect(toLocalInputValue(iso(at(2026, 11, 3, 8, 5)))).toBe("2026-11-03T08:05");
  });

  it("empty and invalid inputs are null / empty, never epoch", () => {
    expect(fromLocalInputValue("")).toBeNull();
    expect(fromLocalInputValue("garbage")).toBeNull();
    expect(toLocalInputValue(null)).toBe("");
    expect(toLocalInputValue("garbage")).toBe("");
  });
});

describe("reminderPresets", () => {
  it("offers tonight only while 19:00 is still ahead", () => {
    expect(reminderPresets(at(2026, 11, 23, 12)).map((p) => p.label))
      .toEqual(["In 1 h", "Tonight 19:00", "Tomorrow 09:00"]);
    expect(reminderPresets(at(2026, 11, 23, 20)).map((p) => p.label))
      .toEqual(["In 1 h", "Tomorrow 09:00"]);
  });

  it("every preset is in the future", () => {
    const now = at(2026, 11, 23, 18, 59);
    for (const p of reminderPresets(now)) expect(Date.parse(p.iso)).toBeGreaterThan(now.getTime());
  });

  it("tomorrow rolls over the month", () => {
    const p = reminderPresets(at(2026, 11, 30, 12)).find((x) => x.label.startsWith("Tomorrow"))!;
    expect(toLocalInputValue(p.iso)).toBe("2026-12-01T09:00");
  });
});

describe("reminders on the calendar", () => {
  it("places a reminder on its LOCAL day and minute", () => {
    const at = new Date(2026, 10, 24, 0, 30).toISOString(); // 00:30 local
    const r = toCalReminder({ task_id: 1, title: "Call", done: false, remind_at: at, lead_minutes: 15 })!;
    expect(r.date).toBe("2026-11-24");
    expect(r.time).toBe("00:30");
  });

  it("has no position without a parseable time", () => {
    expect(toCalReminder({ task_id: 1, title: "x", done: false, remind_at: null, lead_minutes: null })).toBeNull();
    expect(toCalReminder({ task_id: 1, title: "x", done: false, remind_at: "soon", lead_minutes: null })).toBeNull();
  });

  it("bounds a range by local midnights, end-exclusive the day after", () => {
    const { from, to } = localDayBounds("2026-11-23", "2026-11-29");
    expect(from).toBe(new Date(2026, 10, 23).toISOString());
    expect(to).toBe(new Date(2026, 10, 30).toISOString());
    // A reminder at 23:59 on the last day is inside; 00:00 the next day is not.
    const last = new Date(2026, 10, 29, 23, 59).toISOString();
    const next = new Date(2026, 10, 30, 0, 0).toISOString();
    expect(last >= from && last < to).toBe(true);
    expect(next < to).toBe(false);
  });

  it("draws a point in time with a visible height", () => {
    expect(REMINDER_MARKER_MIN).toBeGreaterThanOrEqual(15);
  });
});
