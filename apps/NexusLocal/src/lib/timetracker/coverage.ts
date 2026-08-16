/**
 * Pure span math for the day-coverage feature. No React, no Supabase, no
 * Tauri — everything here is a plain function over `{start, end}` epoch-ms
 * spans so it can be tested and reused (the Phase B history strip and
 * suggestion detector fold over these same helpers).
 */

export type Span = { start: number; end: number; label?: string };

/** "YYYY-MM-DD" for a Date, in the machine's local time (this Mac = Copenhagen). */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function shiftYmd(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + days));
}

/** Local midnight starting `date`, as epoch ms. */
export function dayStartMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/**
 * Parse `protocol_sleep` bedtime text. Two formats are live in the same column
 * (Oura-era ISO with offset, and a space-separated variant with a bare `+00`):
 * normalise the separator and short offset, then let Date.parse resolve the
 * instant. Null on anything else — a junk row must drop out, not become 1970.
 */
export function parseSleepTs(value: string | null | undefined): number | null {
  if (!value) return null;
  let v = value.trim().replace(" ", "T");
  if (/[+-]\d{2}$/.test(v)) v = `${v}:00`;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** "HH:MM" on `date` (local) as epoch ms; null when unparseable. */
export function hmOn(date: string, hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((hm ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(y, mo - 1, d, Number(m[1]), Number(m[2])).getTime();
}

/** Clip a span to a window; null when nothing remains. */
export function clip(span: Span, winStart: number, winEnd: number): Span | null {
  const start = Math.max(span.start, winStart);
  const end = Math.min(span.end, winEnd);
  return end > start ? { ...span, start, end } : null;
}

/** Merge overlapping/touching spans into a sorted disjoint union. */
export function union(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

export function totalSeconds(spans: Span[]): number {
  return Math.round(spans.reduce((a, s) => a + (s.end - s.start), 0) / 1000);
}

/** The complement of `covered` within [winStart, winEnd]. */
export function gapsIn(covered: Span[], winStart: number, winEnd: number): Span[] {
  const merged = union(covered);
  const out: Span[] = [];
  let cursor = winStart;
  for (const s of merged) {
    if (s.start > cursor) out.push({ start: cursor, end: Math.min(s.start, winEnd) });
    cursor = Math.max(cursor, s.end);
    if (cursor >= winEnd) break;
  }
  if (cursor < winEnd) out.push({ start: cursor, end: winEnd });
  return out.filter((g) => g.end > g.start);
}

/**
 * The overlap of two span sets, as spans. Used by the honesty checks
 * (screen-during-sleep, screen-heavy offline blocks). Both sides are unioned
 * first so duplicate input spans cannot double-count an overlap.
 */
export function intersect(a: Span[], b: Span[]): Span[] {
  const ua = union(a);
  const ub = union(b);
  const out: Span[] = [];
  let i = 0;
  let j = 0;
  while (i < ua.length && j < ub.length) {
    const start = Math.max(ua[i].start, ub[j].start);
    const end = Math.min(ua[i].end, ub[j].end);
    if (end > start) out.push({ start, end });
    if (ua[i].end < ub[j].end) i++;
    else j++;
  }
  return out;
}

/** "HH:MM" local wall-clock for an epoch ms. */
export function hm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * A gap rounded outward to 5-minute edges for logging as a calendar block —
 * "13:07–14:53" is measurement noise pretending to be precision. The panel's
 * own coverage math stays on raw edges; only the logged block is rounded.
 */
export function roundForLog(gap: Span, winStart: number, winEnd: number): Span {
  const FIVE = 5 * 60_000;
  return {
    start: Math.max(winStart, Math.floor(gap.start / FIVE) * FIVE),
    end: Math.min(winEnd, Math.ceil(gap.end / FIVE) * FIVE),
    label: gap.label,
  };
}
