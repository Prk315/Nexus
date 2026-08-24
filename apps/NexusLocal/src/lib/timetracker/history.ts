/**
 * Coverage history and recurring-gap suggestions.
 *
 * `DayCoveragePanel` judges one day at a time. This module looks backward:
 * `loadHistory` reconstructs the same four-source coverage picture for the
 * last N days in a handful of range queries (not N × the panel's per-day
 * fan-out), and `detectRecurringGaps` looks for a gap that keeps showing up
 * at the same time on multiple of the last 7 days — the pattern a human
 * would call "I always forget to log lunch" — and turns it into a one-tap
 * recurring block suggestion.
 *
 * Two layers in this file: pure functions first (types, the detector, the
 * dismissal store — all plain data, no React/Supabase/Tauri, so they can be
 * sanity-run under node), then `loadHistory` at the bottom, the only part
 * allowed to import supabase/invoke/nodeUser.
 */

import {
  type Span,
  clip,
  dayStartMs,
  gapsIn,
  hmOn,
  shiftYmd,
  totalSeconds,
  union,
  ymd,
} from "./coverage";

export type DayCoverage = {
  date: string; // YYYY-MM-DD local
  pct: number; // 0..100, accounted / elapsed
  gaps: Span[]; // uncovered spans >= 30 min, within the judged window
  // Phase E: the same per-day spans the pct/gaps above were computed from,
  // carried through so CategoryBreakdown can run categoryTotals over a week
  // of days without a second batch of queries. screen spans keep their app
  // name as `label` (one entry per app per interval, not merged); planned
  // spans carry `category` from pf_cal_blocks/pf_recurring_cal_blocks.
  screen: Span[];
  training: Span[];
  // `id`/`parentBlockId` (Phase U1) — see the matching comment on
  // useDayCoverage.ts's `PlannedSpan`. Same optional-and-omitted-for-
  // recurring-occurrences contract, same reason (id-namespace collision risk).
  planned: (Span & { category: string | null; id?: string; parentBlockId?: string | null })[];
};

export type GapSuggestion = {
  key: string; // stable dismissal key, see below
  startHm: string; // "HH:MM"
  endHm: string; // "HH:MM"
  weekdays: number[]; // sorted distinct getUTCDay() values, 0=Sun
  dates: string[]; // contributing dates, ascending
};

const GAP_MIN_MS = 30 * 60_000;
/** Gaps are bucketed to the half hour their midpoint falls in. */
const BUCKET_MINUTES = 30;
/** A pattern needs to show up on at least this many distinct days to count. */
const MIN_DISTINCT_DATES = 3;
/** History considered for pattern detection — the last full week. */
const LOOKBACK_DAYS = 7;

/** Minute-of-day (0..1439) for an epoch ms, in local wall-clock time. */
export function minuteOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/** Round a minute-of-day value to the nearest 15 minutes. */
function roundTo15(minutes: number): number {
  return Math.round(minutes / 15) * 15;
}

function hmFromMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, minutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Median of a sorted-ascending number array; even count takes the lower middle. */
function median(sortedValues: number[]): number {
  const mid = Math.floor((sortedValues.length - 1) / 2);
  return sortedValues[mid];
}

type BucketedGap = { date: string; startMin: number; endMin: number };

/**
 * Find gaps that recur at roughly the same time across multiple of the last
 * 7 (non-today) days, and turn each into a suggested recurring block.
 *
 * Deterministic by construction: same input history + same `todayYmd` always
 * yields the same suggestions in the same order.
 */
export function detectRecurringGaps(history: DayCoverage[], todayYmd: string): GapSuggestion[] {
  // 1. Only fully-elapsed days, most recent 7 of them.
  const pastDays = history
    .filter((d) => d.date < todayYmd)
    .sort((a, b) => (a.date < b.date ? 1 : -1)) // most recent first
    .slice(0, LOOKBACK_DAYS);

  // 2. Bucket every gap by its midpoint minute-of-day.
  const buckets = new Map<number, BucketedGap[]>();
  for (const day of pastDays) {
    for (const gap of day.gaps) {
      const midMs = (gap.start + gap.end) / 2;
      const bucket = Math.round(minuteOfDay(midMs) / BUCKET_MINUTES);
      const entry: BucketedGap = {
        date: day.date,
        startMin: minuteOfDay(gap.start),
        endMin: minuteOfDay(gap.end),
      };
      const list = buckets.get(bucket);
      if (list) list.push(entry);
      else buckets.set(bucket, [entry]);
    }
  }

  // 3-5. Distinct-date threshold, median window, weekday summary.
  const suggestions: GapSuggestion[] = [];
  for (const [bucket, gaps] of buckets) {
    const distinctDates = Array.from(new Set(gaps.map((g) => g.date))).sort();
    if (distinctDates.length < MIN_DISTINCT_DATES) continue;

    const starts = [...gaps.map((g) => g.startMin)].sort((a, b) => a - b);
    const ends = [...gaps.map((g) => g.endMin)].sort((a, b) => a - b);
    const startMin = roundTo15(median(starts));
    const endMin = roundTo15(median(ends));
    if (endMin <= startMin) continue; // degenerate window — discard

    const weekdays = Array.from(
      new Set(distinctDates.map((date) => new Date(`${date}T00:00:00Z`).getUTCDay())),
    ).sort((a, b) => a - b);

    suggestions.push({
      key: `${bucket}|${weekdays.join("")}`,
      startHm: hmFromMinutes(startMin),
      endHm: hmFromMinutes(endMin),
      weekdays,
      dates: distinctDates,
    });
  }

  // 6. Sorted by startHm.
  suggestions.sort((a, b) => (a.startHm < b.startHm ? -1 : a.startHm > b.startHm ? 1 : 0));
  return suggestions;
}

const DISMISSED_KEY = "nl-coverage-dismissed-suggestions";

/** Dismissed suggestion keys, read from localStorage. Corrupted/absent → empty. */
export function dismissedSuggestions(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

/** Append a key to the dismissed set and persist it. */
export function dismissSuggestion(key: string): void {
  const next = dismissedSuggestions();
  next.add(key);
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(next)));
  } catch {
    // Storage full or unavailable — the dismissal just won't stick this time.
  }
}

// ── Data loading — the only part of this file touching Supabase/Tauri ──────

import { invoke } from "@tauri-apps/api/core";
import { supabasePublic } from "../supabase";
import { calendarOwnerUid } from "./calendarOwner";
import { parseSleepTs } from "./coverage";

type UsageSpanRow = { name: string; start: string; end: string; seconds: number };
type UsageDayRow = { date: string; spans: UsageSpanRow[] };

type CalRow = {
  id: number | string;
  date: string;
  title: string;
  start_time: string;
  end_time: string;
  color: string | null;
  category: string | null;
  parent_block_id: number | string | null;
};

type RecurringRow = {
  title: string;
  start_time: string;
  end_time: string;
  color: string | null;
  category: string | null;
  recurrence: string;
  days_of_week: string | null;
  start_date: string;
  end_date: string | null;
};

function sessionSpanEnd(startMs: number, durationSec: number): number {
  return startMs + Math.max(0, durationSec) * 1000;
}

/**
 * Reconstruct the last `days` days of coverage in a handful of range queries.
 *
 * Mirrors `DayCoveragePanel.load` source-by-source, but batched: one screen
 * invoke, one sleep query, two training queries, two planned queries — then
 * every source is clipped and unioned per day rather than re-queried per day.
 */
export async function loadHistory(days = 30): Promise<DayCoverage[]> {
  const today = ymd(new Date());
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) dates.push(shiftYmd(today, -i));

  const rangeStart = dates[0];
  const rangeEnd = dates[dates.length - 1];
  const rangeStartMs = dayStartMs(rangeStart);
  const rangeEndMs = dayStartMs(shiftYmd(rangeEnd, 1));
  const rangeStartIso = new Date(rangeStartMs).toISOString();
  const rangeEndIso = new Date(rangeEndMs).toISOString();

  // Screen — one call for the whole range. Falls back to empty on iOS/browser
  // dev (no bridge) or on any error, same as the single-day path.
  const screenByDate = new Map<string, Span[]>();
  try {
    const rows = await invoke<UsageDayRow[]>("tt_usage_spans_range", { days });
    for (const row of rows ?? []) {
      const spans: Span[] = [];
      for (const iv of row.spans ?? []) {
        const s = Date.parse(iv.start);
        const e = Date.parse(iv.end);
        if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
        spans.push({ start: s, end: e, label: iv.name });
      }
      screenByDate.set(row.date, spans);
    }
  } catch {
    // No bridge or no command — screen contributes nothing to any day.
  }

  // Sleep — one query over the range plus one trailing day, since a night's
  // span can spill from `date` into the next calendar day.
  const allSleepSpans: Span[] = [];
  const { data: sleepRows } = await supabasePublic
    .from("protocol_sleep")
    .select("date, bedtime_start, bedtime_end")
    .gte("date", rangeStart)
    .lte("date", shiftYmd(rangeEnd, 1));
  for (const row of sleepRows ?? []) {
    const s = parseSleepTs(row.bedtime_start);
    const e = parseSleepTs(row.bedtime_end);
    if (s === null || e === null || e <= s) continue;
    allSleepSpans.push({ start: s, end: e, label: "Sleep" });
  }

  // Training — two queries over the whole range, same reconstruction as
  // DayCoveragePanel (workouts from duration_min, runs from pace × distance).
  const allTrainingSpans: Span[] = [];
  const [{ data: workouts }, { data: runs }] = await Promise.all([
    supabasePublic
      .from("protocol_workout_sessions")
      .select("name, started_at, duration_min")
      .not("started_at", "is", null)
      .gte("started_at", rangeStartIso)
      .lt("started_at", rangeEndIso),
    supabasePublic
      .from("protocol_running_sessions")
      .select("notes, started_at, avg_pace_s_per_km, actual_km")
      .not("started_at", "is", null)
      .gte("started_at", rangeStartIso)
      .lt("started_at", rangeEndIso),
  ]);
  for (const w of workouts ?? []) {
    const s = Date.parse(w.started_at);
    if (!Number.isFinite(s) || typeof w.duration_min !== "number") continue;
    allTrainingSpans.push({
      start: s,
      end: sessionSpanEnd(s, w.duration_min * 60),
      label: w.name ?? "Workout",
    });
  }
  for (const r of runs ?? []) {
    const s = Date.parse(r.started_at);
    if (
      !Number.isFinite(s) ||
      typeof r.avg_pace_s_per_km !== "number" ||
      typeof r.actual_km !== "number"
    ) {
      continue;
    }
    allTrainingSpans.push({
      start: s,
      end: sessionSpanEnd(s, r.avg_pace_s_per_km * r.actual_km),
      label: r.notes ?? "Run",
    });
  }

  // Planned — one-off blocks over the range, plus recurring rules expanded
  // per day exactly as DayCoveragePanel does.
  const user = await calendarOwnerUid();
  const [{ data: blocks }, { data: recurring }] = await Promise.all([
    supabasePublic
      .from("pf_cal_blocks")
      .select("id, date, title, start_time, end_time, color, category, parent_block_id")
      .eq("user_id", user)
      .gte("date", rangeStart)
      .lte("date", rangeEnd),
    supabasePublic
      .from("pf_recurring_cal_blocks")
      .select(
        "title, start_time, end_time, color, category, recurrence, days_of_week, start_date, end_date",
      )
      .eq("user_id", user)
      .lte("start_date", rangeEnd)
      .or(`end_date.is.null,end_date.gte.${rangeStart}`),
  ]);
  const blocksByDate = new Map<string, CalRow[]>();
  for (const b of (blocks ?? []) as CalRow[]) {
    const list = blocksByDate.get(b.date);
    if (list) list.push(b);
    else blocksByDate.set(b.date, [b]);
  }

  const now = Date.now();

  const out: DayCoverage[] = [];
  for (const date of dates) {
    const winStart = dayStartMs(date);
    const winEnd = dayStartMs(shiftYmd(date, 1));
    const isToday = date === today;
    const judgeEnd = isToday ? Math.min(now, winEnd) : winEnd;

    const screenSpans: Span[] = [];
    for (const s of screenByDate.get(date) ?? []) {
      const clipped = clip(s, winStart, winEnd);
      if (clipped) screenSpans.push(clipped);
    }

    const sleepSpans: Span[] = [];
    for (const s of allSleepSpans) {
      const clipped = clip(s, winStart, winEnd);
      if (clipped) sleepSpans.push(clipped);
    }

    const trainingSpans: Span[] = [];
    for (const s of allTrainingSpans) {
      const clipped = clip(s, winStart, winEnd);
      if (clipped) trainingSpans.push(clipped);
    }

    const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=Sun
    const todaysRecurring = (recurring ?? []).filter(
      (r: RecurringRow) =>
        r.start_date <= date &&
        (r.end_date === null || r.end_date >= date) &&
        (r.recurrence === "daily" ||
          (r.recurrence === "weekly" &&
            String(r.days_of_week ?? "").split(",").map(Number).includes(dow))),
    );
    const plannedSpans: DayCoverage["planned"] = [];
    // One-off blocks: real ids, nesting-eligible on either side.
    for (const b of (blocksByDate.get(date) ?? []) as CalRow[]) {
      const s = hmOn(date, b.start_time);
      let e = hmOn(date, b.end_time);
      if (s === null || e === null) continue;
      if (e <= s) e = winEnd; // crosses midnight — count the part on this day
      const clipped = clip({ start: s, end: e, label: b.title }, winStart, winEnd);
      if (clipped) {
        plannedSpans.push({
          ...clipped, category: b.category ?? null,
          id: String(b.id), parentBlockId: b.parent_block_id != null ? String(b.parent_block_id) : null,
        });
      }
    }
    // Recurring occurrences: never carry an id — see the `planned` field
    // comment on `DayCoverage` and `useDayCoverage.ts`'s matching note.
    for (const r of todaysRecurring as RecurringRow[]) {
      const s = hmOn(date, r.start_time);
      let e = hmOn(date, r.end_time);
      if (s === null || e === null) continue;
      if (e <= s) e = winEnd;
      const clipped = clip({ start: s, end: e, label: r.title }, winStart, winEnd);
      if (clipped) plannedSpans.push({ ...clipped, category: r.category ?? null });
    }

    const covered = union([...sleepSpans, ...screenSpans, ...trainingSpans, ...plannedSpans]);
    const uncovered = gapsIn(covered, winStart, judgeEnd);
    const elapsed = Math.round((judgeEnd - winStart) / 1000);
    const accounted = elapsed - totalSeconds(uncovered);
    const gaps = uncovered.filter((g) => g.end - g.start >= GAP_MIN_MS);
    const pct = elapsed > 0 ? Math.round((accounted / elapsed) * 100) : 0;

    out.push({ date, pct, gaps, screen: screenSpans, training: trainingSpans, planned: plannedSpans });
  }

  return out;
}
