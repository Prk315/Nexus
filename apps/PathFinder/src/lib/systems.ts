// The one place that decides whether a system is due.
//
// This rule used to be written out three times — QuickPanels' `isSystemDue`,
// Week's `systemScheduledFor`, and an inline filter in api.ts's `getTodayFocus` —
// and the three already disagreed before this file existed: two of them treated
// an unrecognised frequency as due, the third as not; Week returned false for
// monthly while the others returned true. Adding a fourth frequency kind to
// three separate copies is how that becomes a real bug, so the rule moved here
// first.
//
// React-free and pure, like taskTree.ts and coverage.ts.

import type { SystemEntry } from "../types";

/** Local calendar date as YYYY-MM-DD. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. Negative if `to` precedes `from`. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T12:00:00").getTime();
  const b = new Date(to + "T12:00:00").getTime();
  // Noon anchors sidestep DST: a 23- or 25-hour day would otherwise round wrong.
  return Math.round((b - a) / 86_400_000);
}

/**
 * Is this system due on `date`?
 *
 * Two families of recurrence, and the difference is the whole reason `interval`
 * exists:
 *
 *   daily / weekly / monthly — CALENDAR. Due-ness follows the date. "Every
 *                              Monday" stays on Mondays no matter when you last
 *                              did it.
 *   interval                 — SINCE COMPLETION. Due-ness follows `last_done`,
 *                              so the schedule floats with your actual
 *                              behaviour. Wash the clothes on Friday instead of
 *                              Tuesday and the next one moves to Friday.
 *
 * Something already completed on `date` is never due again that day, whichever
 * family it belongs to.
 */
export function isSystemDue(system: SystemEntry, date: string = todayISO()): boolean {
  if (system.last_done === date) return false;

  if (system.frequency === "interval") {
    // No interval configured would otherwise read as "due forever". The DB
    // constraint prevents it; this keeps a bad row from nagging daily anyway.
    const every = system.interval_days;
    if (every == null || every <= 0) return false;
    if (!system.last_done) return true; // never done — due now
    return daysBetween(system.last_done, date) >= every;
  }

  if (system.frequency === "daily") return true;

  if (system.frequency === "weekly") {
    const days = system.days_of_week
      ? system.days_of_week.split(",").map(Number).filter(Number.isFinite)
      : [];
    // No days chosen means "weekly, unspecified" — treat as due rather than
    // hiding it forever, which is the failure a user cannot diagnose.
    if (days.length === 0) return true;
    return days.includes(new Date(date + "T12:00:00").getDay());
  }

  // monthly, and anything unrecognised: due unless already done today. Erring
  // toward visible is right for a checklist — a system you can see and ignore is
  // recoverable, one that silently never appears is not.
  return true;
}

/**
 * Does this system occupy a slot in the week's time grid on `date`?
 *
 * Distinct from `isSystemDue`: the grid draws a system at its start/end time on
 * the days it is *scheduled*, regardless of whether it has been completed. An
 * interval system has no fixed day, so it is never drawn on the grid — it
 * belongs in the checklist, not at a time.
 */
export function isSystemScheduledOn(system: SystemEntry, date: string): boolean {
  if (system.frequency === "daily") return true;
  if (system.frequency === "weekly") {
    const days = system.days_of_week
      ? system.days_of_week.split(",").map(Number).filter(Number.isFinite)
      : [];
    if (days.length === 0) return true;
    return days.includes(new Date(date + "T12:00:00").getDay());
  }
  return false; // monthly and interval: no fixed slot in the grid
}

/** Human label for a system's cadence, e.g. "Every 7 days". */
export function frequencyLabel(system: SystemEntry): string {
  if (system.frequency === "interval") {
    const n = system.interval_days ?? 0;
    return n === 1 ? "Every day" : `Every ${n} days`;
  }
  if (system.frequency === "weekly" && system.days_of_week) {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const picked = system.days_of_week.split(",").map(Number).filter(Number.isFinite);
    if (picked.length > 0) return picked.map((d) => names[d] ?? "?").join(" ");
  }
  return system.frequency.charAt(0).toUpperCase() + system.frequency.slice(1);
}
