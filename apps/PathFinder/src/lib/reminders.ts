// Reminder timing — the pure half of the reminder panel and the calendar markers.
//
// `pf_task_reminders` carries two columns: `remind_at` (timestamptz) and
// `lead_minutes`. Nothing in the ecosystem can *deliver* a notification yet (see
// the NEXT STEPS note in components/QuickPanels.tsx), so these rules decide what
// a reminder looks like where it is surfaced: the sidebar badge and the panel's
// colour.
//
// React-free on purpose, like taskTree.ts and systems.ts: the badge and the
// row colour must agree about what "due" means, and two inline copies would not.

/**
 * Where a reminder stands right now.
 *
 *   unscheduled — no time set. Actionable: nothing will ever surface it later,
 *                 so it belongs on the badge now.
 *   scheduled   — set for later, outside its lead window.
 *   soon        — inside the lead window (`remind_at - lead_minutes <= now`).
 *                 This is what `lead_minutes` means while nothing can fire
 *                 early: the reminder starts asking for attention ahead of time.
 *   due         — `remind_at` has passed.
 */
export type ReminderStatus = "unscheduled" | "scheduled" | "soon" | "due";

export interface ReminderMeta {
  remind_at: string | null;
  lead_minutes: number | null;
}

export function reminderStatus(meta: ReminderMeta | undefined, now: number): ReminderStatus {
  const at = meta?.remind_at ? Date.parse(meta.remind_at) : NaN;
  // An unparseable timestamp is treated as "no time", not as "due": surfacing
  // it as unscheduled keeps it on the badge without claiming a time it lacks.
  if (!Number.isFinite(at)) return "unscheduled";
  if (at <= now) return "due";
  const lead = meta?.lead_minutes != null && meta.lead_minutes > 0 ? meta.lead_minutes : 0;
  if (lead > 0 && at - lead * 60_000 <= now) return "soon";
  return "scheduled";
}

/** Whether a reminder belongs on the sidebar badge. */
export function isReminderActionable(meta: ReminderMeta | undefined, now: number): boolean {
  return reminderStatus(meta, now) !== "scheduled";
}

/**
 * Soonest first, undated last — an unsorted reminder list buries the thing
 * that is actually due. Compares instants, not strings: `remind_at` comes back
 * from PostgREST as `…+00:00` while a just-written one may be `…Z`.
 */
export function compareReminders(a: ReminderMeta | undefined, b: ReminderMeta | undefined): number {
  const ta = a?.remind_at ? Date.parse(a.remind_at) : NaN;
  const tb = b?.remind_at ? Date.parse(b.remind_at) : NaN;
  const fa = Number.isFinite(ta), fb = Number.isFinite(tb);
  if (fa && fb) return ta - tb;
  if (fa) return -1;
  if (fb) return 1;
  return 0;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date (YYYY-MM-DD) of an instant — never the UTC date. */
export function localDateOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ISO instant → the value an `<input type="datetime-local">` expects, in local time. */
export function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `${localDateOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * `datetime-local` value → ISO instant, or null for empty/invalid input.
 * The input has no zone; `new Date("YYYY-MM-DDTHH:mm")` parses it as LOCAL,
 * which is what the user meant.
 */
export function fromLocalInputValue(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Lead-time choices offered in the panel; `null` is "no heads-up". */
export const LEAD_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "No heads-up" },
  { value: 5,    label: "5 min before" },
  { value: 15,   label: "15 min before" },
  { value: 30,   label: "30 min before" },
  { value: 60,   label: "1 h before" },
  { value: 1440, label: "1 day before" },
];

/**
 * One-tap times for a new or snoozed reminder.
 *
 * "Tonight" is skipped once it is already past 19:00 — offering a time in the
 * past as a *preset* would create a reminder that is due the moment it exists.
 */
export function reminderPresets(now: Date): { label: string; iso: string }[] {
  const out: { label: string; iso: string }[] = [];
  out.push({ label: "In 1 h", iso: new Date(now.getTime() + 60 * 60_000).toISOString() });
  const tonight = new Date(now);
  tonight.setHours(19, 0, 0, 0);
  if (tonight.getTime() > now.getTime()) out.push({ label: "Tonight 19:00", iso: tonight.toISOString() });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  out.push({ label: "Tomorrow 09:00", iso: tomorrow.toISOString() });
  return out;
}
