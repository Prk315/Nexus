import { describe, it, expect } from "vitest";
import { addDaysStr, dropTrayZones, zoneAction, type DashDropTask } from "./dashDrop";

const task = (over: Partial<DashDropTask> = {}): DashDropTask => ({
  taskId: 1, planId: 10, isRoot: true, done: false, dueDate: "2026-11-23", hasKids: false, ...over,
});

describe("zoneAction — plan cards", () => {
  it("moves a root task to another plan, including to No plan", () => {
    expect(zoneAction(task(), { kind: "plan", planId: 20, label: "Thesis" }))
      .toEqual({ kind: "move", planId: 20, label: "Move to Thesis" });
    expect(zoneAction(task(), { kind: "plan", planId: null, label: "No plan" })?.kind).toBe("move");
  });

  it("its own card is not a target", () => {
    expect(zoneAction(task(), { kind: "plan", planId: 10, label: "Same" })).toBeNull();
    expect(zoneAction(task({ planId: null }), { kind: "plan", planId: null, label: "No plan" })).toBeNull();
  });

  it("a step cannot change plans — its plan follows its parent", () => {
    expect(zoneAction(task({ isRoot: false }), { kind: "plan", planId: 20, label: "X" })).toBeNull();
  });
});

describe("zoneAction — the drop tray", () => {
  const zones = Object.fromEntries(dropTrayZones("2026-11-23").map((z) => [z.key, z.zone]));

  it("sets a due date, and dropping on the date it already has is a no-op", () => {
    expect(zoneAction(task(), zones["due:tomorrow"])).toEqual({ kind: "due", date: "2026-11-24", label: "Due tomorrow" });
    expect(zoneAction(task(), zones["due:today"])).toBeNull();
  });

  it("No date clears it — absent, not a sentinel date", () => {
    expect(zoneAction(task(), zones["due:none"])).toEqual({ kind: "due", date: null, label: "Clear due date" });
    expect(zoneAction(task({ dueDate: null }), zones["due:none"])).toBeNull();
  });

  it("Done completes a leaf, but not a task with steps (its checkbox refuses too) or one already done", () => {
    expect(zoneAction(task(), zones.done)?.kind).toBe("done");
    expect(zoneAction(task({ hasKids: true }), zones.done)).toBeNull();
    expect(zoneAction(task({ done: true }), zones.done)).toBeNull();
  });
});

describe("addDaysStr", () => {
  it("crosses month and year boundaries and a leap day", () => {
    expect(addDaysStr("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDaysStr("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDaysStr("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("is immune to DST: the last Sunday of October is still one day long", () => {
    expect(addDaysStr("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDaysStr("2026-10-25", 1)).toBe("2026-10-26");
  });
});
