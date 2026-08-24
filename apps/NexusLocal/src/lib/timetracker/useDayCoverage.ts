/**
 * The single-day four-source loader (screen, sleep, training, planned),
 * extracted from `DayCoveragePanel` in Phase E so `CategoryBreakdown` can
 * reuse the exact same fetch instead of re-querying Supabase for data the
 * panel already has. Behavior is unchanged from the panel's original inline
 * `load` — see its comments for the source-by-source reasoning (sleep spill
 * across midnight, Garmin duration reconstruction, PathFinder's 0=Sun
 * recurring-block weekday numbering).
 *
 * The one addition here is `category` on planned spans, carried through from
 * `pf_cal_blocks.category` / `pf_recurring_cal_blocks.category` (Phase E) so
 * `categoryTotals` in `@nexus/core/categories` has something to attribute
 * against without re-deriving it from the title.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabasePublic } from "../supabase";
import { calendarOwnerUid } from "./calendarOwner";
import { type Span, clip, dayStartMs, hmOn, parseSleepTs, shiftYmd } from "./coverage";

type UsageInterval = { name: string; start: string; end: string; seconds: number };

/**
 * `id`/`parentBlockId` (Phase U1) carry `pf_cal_blocks.id`/`parent_block_id`
 * through to `PlannedBlock` (`@nexus/core/categories`) so `categoryTotals`
 * can apply its children-win rule — otherwise a Deep-work segment nested
 * inside an Errands "transport" block would count under both categories.
 * Stringified: `PlannedBlock.id`/`parentId` are `string` (id-representation-
 * agnostic in the shared package), while `pf_cal_blocks.id` is `bigint`.
 * Recurring occurrences never carry a `parent_block_id` at all (recurring
 * blocks never nest — see `expandRecurring` in PathFinder's api/_shared.ts).
 * `id`/`parentBlockId` are optional and OMITTED entirely for recurring
 * occurrences below, not defaulted to a sentinel — a recurring series row's
 * `id` lives in a separate sequence from `pf_cal_blocks.id` and could
 * numerically collide with an unrelated real block's id once stringified.
 */
export type PlannedSpan = Span & { category: string | null; id?: string; parentBlockId?: string | null };

type CalRow = {
  id: number | string;
  title: string;
  start_time: string;
  end_time: string;
  color: string | null;
  category: string | null;
  parent_block_id: number | string | null;
};

function sessionSpanEnd(startMs: number, durationSec: number): number {
  return startMs + Math.max(0, durationSec) * 1000;
}

export type DayCoverageData = {
  screen: Span[];
  sleep: Span[];
  training: Span[];
  planned: PlannedSpan[];
  loaded: boolean;
  /** Re-fetch this same date on demand (e.g. right after an insert). */
  reload: () => Promise<void>;
};

/** Loads, and keeps current on a 60s tick, the four coverage sources for `date`. */
export function useDayCoverage(date: string): DayCoverageData {
  const [screen, setScreen] = useState<Span[]>([]);
  const [sleep, setSleep] = useState<Span[]>([]);
  const [training, setTraining] = useState<Span[]>([]);
  const [planned, setPlanned] = useState<PlannedSpan[]>([]);
  const [loaded, setLoaded] = useState(false);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async (day: string) => {
    const start = dayStartMs(day);
    const end = dayStartMs(shiftYmd(day, 1));
    const startIso = new Date(start).toISOString();
    const endIso = new Date(end).toISOString();

    // Screen — local only. Fails to empty on iOS (no daemon) and on any error.
    const screenSpans: Span[] = [];
    try {
      const intervals = await invoke<UsageInterval[]>("tt_usage_intervals", { date: day });
      for (const iv of intervals ?? []) {
        const s = Date.parse(iv.start);
        const e = Date.parse(iv.end);
        if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
        const clipped = clip({ start: s, end: e, label: iv.name }, start, end);
        if (clipped) screenSpans.push(clipped);
      }
    } catch {
      // No bridge (browser dev) or no command — screen band stays empty.
    }

    // Sleep — same night-spill handling as the panel: no user filter, since
    // widget_anon_read already scopes anon to the owner.
    const sleepSpans: Span[] = [];
    const { data: sleepRows } = await supabasePublic
      .from("protocol_sleep")
      .select("date, bedtime_start, bedtime_end")
      .in("date", [day, shiftYmd(day, 1)]);
    for (const row of sleepRows ?? []) {
      const s = parseSleepTs(row.bedtime_start);
      const e = parseSleepTs(row.bedtime_end);
      if (s === null || e === null || e <= s) continue;
      const clipped = clip({ start: s, end: e, label: "Sleep" }, start, end);
      if (clipped) sleepSpans.push(clipped);
    }

    // Training — Garmin activities with a start instant.
    const trainingSpans: Span[] = [];
    const [{ data: workouts }, { data: runs }] = await Promise.all([
      supabasePublic
        .from("protocol_workout_sessions")
        .select("name, started_at, duration_min")
        .not("started_at", "is", null)
        .gte("started_at", startIso)
        .lt("started_at", endIso),
      supabasePublic
        .from("protocol_running_sessions")
        .select("notes, started_at, avg_pace_s_per_km, actual_km")
        .not("started_at", "is", null)
        .gte("started_at", startIso)
        .lt("started_at", endIso),
    ]);
    for (const w of workouts ?? []) {
      const s = Date.parse(w.started_at);
      if (!Number.isFinite(s) || typeof w.duration_min !== "number") continue;
      const span = clip(
        { start: s, end: sessionSpanEnd(s, w.duration_min * 60), label: w.name ?? "Workout" },
        start,
        end,
      );
      if (span) trainingSpans.push(span);
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
      const span = clip(
        {
          start: s,
          end: sessionSpanEnd(s, r.avg_pace_s_per_km * r.actual_km),
          label: r.notes ?? "Run",
        },
        start,
        end,
      );
      if (span) trainingSpans.push(span);
    }

    // Planned — PathFinder's day, one-off blocks plus recurring expanded for
    // exactly this date, now carrying `category` alongside the span.
    const plannedSpans: PlannedSpan[] = [];
    const user = await calendarOwnerUid();
    const [{ data: blocks }, { data: recurring }] = await Promise.all([
      supabasePublic
        .from("pf_cal_blocks")
        .select("id, title, start_time, end_time, color, category, parent_block_id")
        .eq("user_id", user)
        .eq("date", day),
      supabasePublic
        .from("pf_recurring_cal_blocks")
        .select(
          "title, start_time, end_time, color, category, recurrence, days_of_week, start_date, end_date",
        )
        .eq("user_id", user)
        .lte("start_date", day)
        .or(`end_date.is.null,end_date.gte.${day}`),
    ]);

    const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0=Sun, PathFinder's numbering
    const todaysRecurring = (recurring ?? []).filter(
      (r) =>
        r.recurrence === "daily" ||
        (r.recurrence === "weekly" &&
          String(r.days_of_week ?? "").split(",").map(Number).includes(dow)),
    );

    // One-off blocks: real ids, eligible to participate in nesting either
    // side (as a parent OR as a child pointing at one).
    for (const b of (blocks ?? []) as CalRow[]) {
      const s = hmOn(day, b.start_time);
      let e = hmOn(day, b.end_time);
      if (s === null || e === null) continue;
      if (e <= s) e = end; // crosses midnight — count the part on this day
      const clipped = clip({ start: s, end: e, label: b.title }, start, end);
      if (clipped) {
        plannedSpans.push({
          ...clipped, category: b.category ?? null,
          id: String(b.id), parentBlockId: b.parent_block_id != null ? String(b.parent_block_id) : null,
        });
      }
    }
    // Recurring occurrences: NEVER carry an id here — see the type comment
    // above. Recurring blocks never nest (can't be a parent, can't be a
    // child — the DB column doesn't exist on this table), so omitting `id`
    // entirely (never even attempting a match) is the only safe choice.
    for (const r of todaysRecurring) {
      const s = hmOn(day, r.start_time);
      let e = hmOn(day, r.end_time);
      if (s === null || e === null) continue;
      if (e <= s) e = end;
      const clipped = clip({ start: s, end: e, label: r.title }, start, end);
      if (clipped) plannedSpans.push({ ...clipped, category: r.category ?? null });
    }

    if (!alive.current) return;
    setScreen(screenSpans);
    setSleep(sleepSpans);
    setTraining(trainingSpans);
    setPlanned(plannedSpans);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load(date).catch(() => {});
    const t = setInterval(() => {
      load(date).catch(() => {});
    }, 60_000);
    return () => clearInterval(t);
  }, [load, date]);

  const reload = useCallback(() => load(date), [load, date]);

  return { screen, sleep, training, planned, loaded, reload };
}
