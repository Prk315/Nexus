// Pure half of the Learn tab: position/pace arithmetic over progress events.
// React-free and network-free (the taskTree.ts convention) — the same rules
// the learn-plan edge function applies server-side, mirrored here so the tab
// and tomorrow's generated plan never disagree about where a book stands.

export interface LearnEventLike {
  material_id: string;
  event_date: string; // YYYY-MM-DD
  kind: string;
  units_from: number | null;
  units_to: number | null;
  units_delta: number | null;
  minutes: number | null;
}

export interface MaterialLike {
  id: string;
  start_unit: number;
  total_units: number | null;
  pace_units_per_min: number;
}

/** Current position = the furthest units_to any event reached, never less
 *  than the material's start offset. Events without units_to contribute
 *  nothing — absent is not zero. */
export function materialPosition(m: MaterialLike, events: LearnEventLike[]): number {
  let pos = m.start_unit;
  for (const e of events) {
    if (e.material_id !== m.id) continue;
    if (e.units_to != null && e.units_to > pos) pos = e.units_to;
  }
  return pos;
}

/** Fraction done of the SPAN THAT EXISTS TO READ (start→total), not of the
 *  raw page count — front matter the plan skips must not read as progress
 *  owed. Null when the length is unknown: an unknown-length book has no
 *  honest percentage, and rendering one would be the empty-meter lie. */
export function materialFraction(m: MaterialLike, position: number): number | null {
  if (m.total_units == null) return null;
  const span = m.total_units - m.start_unit;
  if (span <= 0) return null;
  return Math.min(1, Math.max(0, (position - m.start_unit) / span));
}

/** Median measured pace (units/min) over reading events carrying both delta
 *  and minutes; the material's configured pace until 3 measurements exist. */
export function materialPace(m: MaterialLike, events: LearnEventLike[]): number {
  const rates: number[] = [];
  for (const e of events) {
    if (e.material_id !== m.id || e.kind !== "reading") continue;
    if (e.units_delta == null || e.minutes == null || e.minutes <= 0) continue;
    if (e.units_delta <= 0) continue;
    rates.push(e.units_delta / e.minutes);
  }
  if (rates.length < 3) return m.pace_units_per_min;
  rates.sort((a, b) => a - b);
  return rates[Math.floor(rates.length / 2)];
}

/** The delta a "read to page N" quick-log should store. Null (not 0) when the
 *  claimed position does not advance — logging a re-read of earlier pages is
 *  minutes without delta, never negative progress. */
export function deltaForLogTo(position: number, to: number): number | null {
  const d = to - position;
  return d > 0 ? d : null;
}

export function lastActivityDate(m: MaterialLike, events: LearnEventLike[]): string | null {
  let last: string | null = null;
  for (const e of events) {
    if (e.material_id !== m.id || e.kind === "baseline") continue;
    if (!last || e.event_date > last) last = e.event_date;
  }
  return last;
}
