/**
 * The day-coverage date picker, shared between `DayCoveragePanel` and
 * `CategoryBreakdown` (Phase E) so the latter's "daily totals" section shows
 * the same day the former is displaying rather than always defaulting to
 * today. Module-scoped external store rather than React context: the two
 * panels mount as siblings in an array (`timetracker/index.tsx`) with no
 * shared parent to hang a provider off without touching that wiring.
 */

import { useSyncExternalStore } from "react";
import { ymd } from "./coverage";

let current = ymd(new Date());
const listeners = new Set<() => void>();

export function getSelectedDate(): string {
  return current;
}

export function setSelectedDate(date: string): void {
  if (date === current) return;
  current = date;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Same shape as `useState<string>()` so it drops into existing call sites. */
export function useSelectedDate(): [string, (date: string) => void] {
  const date = useSyncExternalStore(subscribe, getSelectedDate, getSelectedDate);
  return [date, setSelectedDate];
}
