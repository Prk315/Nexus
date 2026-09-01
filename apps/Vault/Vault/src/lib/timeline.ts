// Placing dated work on a horizontal axis, at three zoom levels.
//
// Pure and React-free on purpose, like taskTree/systems/coverage: every trap
// here is arithmetic, and arithmetic is the part worth testing.
//
// ── ⚠️ A task with no date has NO POSITION ─────────────────────────────────
//
// 384 of Bastian's 554 tasks have no due date. The tempting thing is to park
// them at today, or at the left edge, so the timeline "shows everything" — and
// that is a lie the user cannot see through: a bar at today asserts a deadline
// nobody set. Undated work is PARTITIONED OUT and counted, so the view can say
// "170 shown · 384 undated" rather than inventing 384 deadlines.
//
// Same house rule as `aggregate` skipping nulls, `coerceField` returning null
// for an empty value and `meterFraction` drawing a dash: absent is not zero.
//
// ── Extent comes from data, never from a default ───────────────────────────
//
// A task's bar spans its scheduled calendar time when it has any, and is a
// single-day marker when all it has is a due date. It is NOT given an invented
// duration from `time_estimate` — an estimate says how long the work takes, not
// which days it occupies, and drawing it as a span would put work on days
// nothing was ever scheduled for.

/** An ISO date, `YYYY-MM-DD`. Dates here are calendar days, never instants:
 *  a due date is a day, and turning it into a UTC timestamp shifts it across
 *  midnight for anyone east or west of Greenwich. */
export type IsoDate = string;

export const ZOOMS = ["month", "quarter", "year"] as const;
export type Zoom = (typeof ZOOMS)[number];

export const ZOOM_LABELS: Record<Zoom, string> = {
  month: "Month",
  quarter: "3 months",
  year: "Year",
};

/** How many days the viewport spans at each zoom. Approximate by design —
 *  the axis is drawn from real month boundaries, this only sets the scale. */
export const ZOOM_DAYS: Record<Zoom, number> = {
  month: 31,
  quarter: 92,
  year: 366,
};

/** Pixels per day, chosen so a month fills a typical note column and a year
 *  still leaves a month wide enough to read a label in. */
export const ZOOM_PX_PER_DAY: Record<Zoom, number> = {
  month: 26,
  quarter: 9,
  year: 2.6,
};

export const DAY_MS = 86_400_000;

/** Parse `YYYY-MM-DD` to a UTC day index. UTC throughout: the axis is made of
 *  calendar days and must not shift with the viewer's timezone. */
export function dayIndex(iso: IsoDate): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return NaN;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
}

export function isoFromDay(day: number): IsoDate {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * ⚠️ Validated by ROUND TRIP, not by a range check.
 *
 * `Date.UTC(2026, 12, 1)` does not fail — it rolls over into January 2027. So
 * "2026-13-01" parsed to a perfectly finite day index twelve months from where
 * it claims to be, and a task carrying it would have been drawn a year late
 * with nothing to suggest anything was wrong. Same for "2026-02-30", which
 * rolls into March.
 *
 * Building the date and checking it renders back to the same string catches
 * every rollover at once, which a month<=12 && day<=31 check does not.
 */
export function isIsoDate(v: unknown): v is IsoDate {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const day = dayIndex(v);
  return Number.isFinite(day) && isoFromDay(day) === v;
}

/** One row on the timeline. `from`/`to` are inclusive day indices. */
export interface Span {
  id: number;
  title: string;
  from: number;
  to: number;
  done: boolean;
  /** True when the extent is real scheduled time rather than a due-date mark.
   *  The view draws the two differently — a point is not a duration. */
  scheduled: boolean;
  /** Lane the row is packed into, filled by `packLanes`. */
  lane: number;
}

export interface TimelineInput {
  id: number;
  title: string;
  done: boolean;
  dueDate: string | null | undefined;
  /** Days this task has calendar blocks on, in any order. */
  scheduledDays?: readonly IsoDate[];
}

export interface TimelineModel {
  spans: Span[];
  /** Tasks with no date of any kind. Counted, never placed. */
  undated: number;
  /** Inclusive day range actually covered, or null when nothing is dated. */
  range: { from: number; to: number } | null;
  lanes: number;
}

/**
 * Turn tasks into positioned spans.
 *
 * ⚠️ Order matters for what a bar MEANS. Scheduled time wins over the due date:
 * if a task is scheduled Mon–Wed and due Friday, the bar is Mon–Wed and Friday
 * is a separate marker the view can draw. Using the due date as the end of the
 * bar would silently claim work happens on days it was never scheduled for.
 */
export function buildTimeline(tasks: readonly TimelineInput[]): TimelineModel {
  const spans: Span[] = [];
  let undated = 0;

  for (const t of tasks) {
    const days = (t.scheduledDays ?? []).filter(isIsoDate).map(dayIndex).sort((a, b) => a - b);
    const due = isIsoDate(t.dueDate) ? dayIndex(t.dueDate) : null;

    if (days.length > 0) {
      spans.push({
        id: t.id, title: t.title, done: t.done,
        from: days[0], to: days[days.length - 1],
        scheduled: true, lane: 0,
      });
    } else if (due !== null) {
      // A due date is a POINT, not a duration — from === to.
      spans.push({ id: t.id, title: t.title, done: t.done, from: due, to: due, scheduled: false, lane: 0 });
    } else {
      undated++;
    }
  }

  spans.sort((a, b) => a.from - b.from || a.to - b.to || a.id - b.id);
  const lanes = packLanes(spans);

  return {
    spans,
    undated,
    lanes,
    range: spans.length
      ? { from: spans[0].from, to: spans.reduce((m, s) => Math.max(m, s.to), spans[0].to) }
      : null,
  };
}

/**
 * Pack spans into as few rows as possible without overlap. Mutates `lane`.
 *
 * ⚠️ Two spans that merely TOUCH must not share a lane. A task ending on the
 * 5th and another starting on the 5th would be drawn edge to edge and read as
 * one continuous bar, so the test is `from <= lastEnd`, not `<`.
 *
 * Expects `spans` sorted by `from`; that is what makes one pass correct.
 */
export function packLanes(spans: Span[]): number {
  const lastEnd: number[] = [];
  for (const s of spans) {
    let lane = lastEnd.findIndex((end) => s.from > end);
    if (lane === -1) { lane = lastEnd.length; lastEnd.push(s.to); }
    else lastEnd[lane] = s.to;
    s.lane = lane;
  }
  return lastEnd.length;
}

/** A labelled tick on the axis. */
export interface Tick {
  day: number;
  label: string;
  /** Month starts are major; weeks and quarters are minor. The view draws a
   *  stronger rule for major ones so a year does not become 52 identical lines. */
  major: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Axis ticks for a day range, at a density the zoom can actually render.
 *
 * Built from real month boundaries rather than by stepping a fixed number of
 * days: months are 28–31 days, so a fixed step drifts and the labels stop
 * lining up with the month they name. At year zoom only quarters are labelled,
 * because twelve labels in the width of a note overlap into mush.
 */
export function axisTicks(from: number, to: number, zoom: Zoom): Tick[] {
  if (!(from <= to)) return [];
  const out: Tick[] = [];
  const start = new Date(from * DAY_MS);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));

  // Bounded: a range longer than a decade is not something a note renders, and
  // an unbounded loop here would be a frozen tab rather than a wrong picture.
  for (let guard = 0; guard < 400; guard++) {
    const day = Math.floor(cursor.getTime() / DAY_MS);
    if (day > to) break;
    const month = cursor.getUTCMonth();
    const showLabel = zoom === "year" ? month % 3 === 0 : true;
    if (day >= from && showLabel) {
      out.push({
        day,
        label: month === 0 || zoom === "year"
          ? `${MONTHS[month]} ${String(cursor.getUTCFullYear()).slice(2)}`
          : MONTHS[month],
        major: true,
      });
    }
    cursor.setUTCMonth(month + 1);
  }

  // Week rules, month zoom only — at 9 px/day a weekly rule every 63 px is
  // noise, and at 2.6 px/day it is a solid grey block.
  if (zoom === "month") {
    for (let d = from; d <= to; d++) {
      // Monday. Epoch day 0 was a THURSDAY, and getUTCDay() numbers Sunday 0,
      // so the weekday of day d is (d + 4) % 7 — Monday is 1, not 0. Writing
      // 0 here put every week rule on Sunday, which looks almost right and is
      // off by one column all the way across.
      if ((d + 4) % 7 === 1) out.push({ day: d, label: "", major: false });
    }
  }

  return out.sort((a, b) => a.day - b.day || Number(b.major) - Number(a.major));
}

/**
 * The window the viewport shows, clamped to the content.
 *
 * Scrolling is expressed as a start day rather than a pixel offset so that
 * changing zoom keeps the same DATE under the viewport's left edge. Converting
 * a pixel offset between scales instead is how a zoom control ends up jumping
 * you to a different month.
 */
export function clampWindow(
  startDay: number,
  zoom: Zoom,
  range: { from: number; to: number } | null,
): { from: number; to: number } {
  const span = ZOOM_DAYS[zoom];
  if (!range) return { from: startDay, to: startDay + span - 1 };
  // A little air either side so the first and last bar are not flush against
  // the edge, and so an empty-looking timeline still shows where content is.
  const lo = range.from - 7;
  const hi = Math.max(range.to + 7, lo + span - 1);
  const from = Math.min(Math.max(startDay, lo), hi - span + 1);
  return { from, to: from + span - 1 };
}

/** x offset in px for a day, within a window. */
export function dayToX(day: number, windowFrom: number, zoom: Zoom): number {
  return (day - windowFrom) * ZOOM_PX_PER_DAY[zoom];
}

/** Width in px for an inclusive day span — always at least a visible sliver,
 *  or a single-day marker at year zoom would be 2.6 px and vanish under a
 *  border. */
export function spanWidth(from: number, to: number, zoom: Zoom): number {
  return Math.max((to - from + 1) * ZOOM_PX_PER_DAY[zoom], 3);
}
