// Quick drags on the dashboard (849): what dropping a task row on something
// OTHER than the day calendar does. React-free so every "is this drop
// meaningful?" decision is tested rather than discovered.
//
// The zones:
//  - another plan card  → move the task to that plan
//  - the drop tray      → due Today / Tomorrow / Next week / No date, or Done
//
// Every rule below returns null for a drop that would change nothing or would
// do something the row itself refuses — and null means the zone does not even
// light up, so a drop that does nothing never LOOKS like it did something.

export interface DashDropTask {
  taskId: number;
  planId: number | null;
  /** A step's plan follows its parent; only a root task can change plans. */
  isRoot: boolean;
  done: boolean;
  dueDate: string | null;
  /** Has steps — the row's own checkbox is disabled until they're finished,
   *  so a drag must not be a way around that. */
  hasKids: boolean;
}

export type DashZone =
  | { kind: "plan"; planId: number | null; label: string }
  | { kind: "due"; date: string | null; label: string }
  | { kind: "done"; label: string };

export type DashZoneAction =
  | { kind: "move"; planId: number | null; label: string }
  | { kind: "due"; date: string | null; label: string }
  | { kind: "done"; label: string };

export function zoneAction(task: DashDropTask, zone: DashZone): DashZoneAction | null {
  switch (zone.kind) {
    case "plan":
      if (!task.isRoot || zone.planId === task.planId) return null;
      return { kind: "move", planId: zone.planId, label: `Move to ${zone.label}` };
    case "due":
      if (zone.date === task.dueDate) return null;
      return { kind: "due", date: zone.date, label: zone.date == null ? "Clear due date" : `Due ${zone.label.toLowerCase()}` };
    case "done":
      if (task.done || task.hasKids) return null;
      return { kind: "done", label: "Mark done" };
  }
}

/** YYYY-MM-DD plus `n` calendar days. UTC arithmetic on the date alone, so a
 *  DST change can't turn "+1 day" into the same day or two days. */
export function addDaysStr(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** The drop tray's chips, in display order. */
export function dropTrayZones(today: string): { key: string; zone: DashZone }[] {
  return [
    { key: "due:today", zone: { kind: "due", date: today, label: "Today" } },
    { key: "due:tomorrow", zone: { kind: "due", date: addDaysStr(today, 1), label: "Tomorrow" } },
    { key: "due:next-week", zone: { kind: "due", date: addDaysStr(today, 7), label: "Next week" } },
    { key: "due:none", zone: { kind: "due", date: null, label: "No date" } },
    { key: "done", zone: { kind: "done", label: "Done" } },
  ];
}
