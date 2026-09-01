import { describe, it, expect } from "vitest";
import {
  monthGrid, shiftMonth, weekdayOfDay, columnOfDay, entriesByDay, unscheduled,
  dayIndex, isoFromDay, WEEKDAY_LABELS,
} from "./calendarGrid";

const D = (iso: string) => dayIndex(iso);
const task = (id: number, over: Partial<Parameters<typeof entriesByDay>[0][number]> = {}) =>
  ({ id, title: `t${id}`, done: false, dueDate: null, ...over });

describe("the two weekday conventions", () => {
  // ⚠️ pf_recurring_cal_blocks numbers weekdays 0=Sunday and is explicitly NOT
  // ISO. The grid draws Monday-first. Conflating them shifts everything one
  // column, which reads as correct until you look at a date.
  it("weekdayOfDay is 0=Sunday, the number the database stores", () => {
    expect(weekdayOfDay(D("2026-01-04"))).toBe(0); // a Sunday
    expect(weekdayOfDay(D("2026-01-05"))).toBe(1); // Monday
    expect(weekdayOfDay(D("2026-01-10"))).toBe(6); // Saturday
  });

  it("columnOfDay is 0=Monday, the column it is drawn in", () => {
    expect(columnOfDay(D("2026-01-05"))).toBe(0); // Monday → first column
    expect(columnOfDay(D("2026-01-04"))).toBe(6); // Sunday → last column
  });

  it("agrees with the header labels", () => {
    for (let i = 0; i < 7; i++) {
      const day = D("2026-01-05") + i; // starts on a Monday
      expect(WEEKDAY_LABELS[columnOfDay(day)].slice(0, 3),
        isoFromDay(day)).toBe(
          ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]);
    }
  });
});

describe("monthGrid", () => {
  const today = D("2026-01-15");

  // ⚠️ Whole weeks always. Starting on the 1st in whichever column it falls
  // would put the first row under the wrong weekday headers.
  it("always renders whole weeks starting on a Monday", () => {
    for (const anchor of ["2026-01-15", "2026-02-01", "2026-02-28", "2028-02-15", "2026-11-30"]) {
      const g = monthGrid(D(anchor), today);
      expect(g.days.length % 7, anchor).toBe(0);
      expect(columnOfDay(g.days[0].day), anchor).toBe(0);
      expect(columnOfDay(g.days[g.days.length - 1].day), anchor).toBe(6);
    }
  });

  it("borrows leading and trailing days and marks them out of month", () => {
    // 1 Feb 2026 is a Sunday, so the grid starts the Monday before (26 Jan).
    const g = monthGrid(D("2026-02-10"), today);
    expect(g.days[0].iso).toBe("2026-01-26");
    expect(g.days[0].inMonth).toBe(false);
    expect(g.days.find((d) => d.iso === "2026-02-01")!.inMonth).toBe(true);
    expect(g.days.find((d) => d.iso === "2026-03-01")?.inMonth).toBe(false);
  });

  it("covers every day of the month exactly once", () => {
    const g = monthGrid(D("2026-05-09"), today);
    const inMonth = g.days.filter((d) => d.inMonth).map((d) => d.iso);
    expect(inMonth).toHaveLength(31);
    expect(new Set(inMonth).size).toBe(31);
    expect(inMonth[0]).toBe("2026-05-01");
    expect(inMonth[30]).toBe("2026-05-31");
  });

  it("handles February, including a leap year", () => {
    expect(monthGrid(D("2026-02-10"), today).days.filter((d) => d.inMonth)).toHaveLength(28);
    expect(monthGrid(D("2028-02-10"), today).days.filter((d) => d.inMonth)).toHaveLength(29);
  });

  it("grows to six rows when a month needs them", () => {
    // Aug 2026 starts on a Saturday and has 31 days — the case that overflows.
    const g = monthGrid(D("2026-08-10"), today);
    expect(g.weeks).toBe(6);
    expect(monthGrid(D("2026-02-10"), today).weeks).toBe(5);
  });

  it("marks today, and only when today is in the grid", () => {
    const g = monthGrid(D("2026-01-15"), today);
    expect(g.days.filter((d) => d.isToday).map((d) => d.iso)).toEqual(["2026-01-15"]);
    expect(monthGrid(D("2026-06-15"), today).days.some((d) => d.isToday)).toBe(false);
  });

  it("labels the month it is showing", () => {
    expect(monthGrid(D("2026-01-31"), today).label).toBe("January 2026");
    expect(monthGrid(D("2026-12-01"), today).label).toBe("December 2026");
  });
});

describe("shiftMonth", () => {
  // ⚠️ Whole months, never 30 days: a fixed step drifts and eventually skips
  // February.
  it("steps month by month without drifting", () => {
    let cur = D("2026-01-15");
    const seen: string[] = [];
    for (let i = 0; i < 14; i++) { seen.push(monthGrid(cur, 0).label); cur = shiftMonth(cur, 1); }
    expect(seen[1]).toBe("February 2026");
    expect(seen[2]).toBe("March 2026");
    expect(seen[12]).toBe("January 2027");
  });

  it("steps backwards across a year boundary", () => {
    expect(monthGrid(shiftMonth(D("2026-01-15"), -1), 0).label).toBe("December 2025");
  });

  it("lands on the 1st, so repeated stepping cannot drift off a 31st", () => {
    let cur = D("2026-01-31");
    for (let i = 0; i < 6; i++) cur = shiftMonth(cur, 1);
    expect(isoFromDay(cur)).toBe("2026-07-01");
  });
});

describe("entriesByDay", () => {
  it("places a due date and a scheduled block on their days", () => {
    const m = entriesByDay([
      task(1, { dueDate: "2026-05-04" }),
      task(2, { scheduled: [{ iso: "2026-05-06", blockId: 99 }] }),
    ]);
    expect(m.get("2026-05-04")!.map((e) => [e.taskId, e.kind])).toEqual([[1, "due"]]);
    expect(m.get("2026-05-06")!.map((e) => [e.taskId, e.kind, e.blockId])).toEqual([[2, "scheduled", 99]]);
  });

  // ⚠️ Two chips for one task on one day reads as two pieces of work.
  it("shows a task once when it is scheduled on the day it is due", () => {
    const m = entriesByDay([
      task(1, { dueDate: "2026-05-04", scheduled: [{ iso: "2026-05-04", blockId: 7 }] }),
    ]);
    expect(m.get("2026-05-04")).toHaveLength(1);
    expect(m.get("2026-05-04")![0].kind).toBe("scheduled");
  });

  it("keeps a due date that falls on a different day from the scheduled one", () => {
    const m = entriesByDay([
      task(1, { dueDate: "2026-05-08", scheduled: [{ iso: "2026-05-04", blockId: 7 }] }),
    ]);
    expect(m.get("2026-05-04")![0].kind).toBe("scheduled");
    expect(m.get("2026-05-08")![0].kind).toBe("due");
  });

  it("collapses two blocks on the same day to one chip", () => {
    const m = entriesByDay([
      task(1, { scheduled: [{ iso: "2026-05-04", blockId: 7 }, { iso: "2026-05-04", blockId: 8 }] }),
    ]);
    expect(m.get("2026-05-04")).toHaveLength(1);
  });

  it("ignores junk dates rather than throwing", () => {
    const m = entriesByDay([
      task(1, { dueDate: "nope" }),
      task(2, { scheduled: [{ iso: "2026-13-01", blockId: 1 }] }),
    ]);
    expect(m.size).toBe(0);
  });

  // A cell whose order shuffles between renders looks like it is changing.
  it("orders a cell deterministically: scheduled first, then by title", () => {
    const m = entriesByDay([
      task(3, { title: "zebra", dueDate: "2026-05-04" } as never),
      task(1, { title: "apple", dueDate: "2026-05-04" } as never),
      task(2, { title: "mango", scheduled: [{ iso: "2026-05-04", blockId: 1 }] } as never),
    ]);
    expect(m.get("2026-05-04")!.map((e) => e.title)).toEqual(["mango", "apple", "zebra"]);
  });
});

describe("unscheduled", () => {
  // The timeline must leave these out — they have no position on an axis. Here
  // they get a tray, which turns an honest omission into something actionable.
  it("is exactly the tasks with no date of any kind", () => {
    const out = unscheduled([
      task(1),
      task(2, { dueDate: "2026-05-04" }),
      task(3, { scheduled: [{ iso: "2026-05-04", blockId: 1 }] }),
      task(4, { dueDate: "rubbish" }),
    ]);
    expect(out.map((t) => t.id)).toEqual([1, 4]);
  });

  it("is empty when everything is dated", () => {
    expect(unscheduled([task(1, { dueDate: "2026-05-04" })])).toEqual([]);
  });
});
