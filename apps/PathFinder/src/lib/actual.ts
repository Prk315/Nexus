/**
 * The "actual" day — sleep, screen and training spans — loaded next to
 * PathFinder's planned calendar blocks so Week.tsx can render plan vs.
 * reality in one place. Mirrors the query + span-reconstruction rules in
 * NexusLocal's `DayCoveragePanel` (`timetracker/DayCoveragePanel.tsx`); the
 * pure span math itself lives once, in `@nexus/core/coverage`.
 */
import { invoke } from "@tauri-apps/api/core";
import { type Span, clip, dayStartMs, parseSleepTs, shiftYmd } from "@nexus/core/coverage";
import { supabase } from "./supabase";

export type ActualDay = { sleep: Span[]; screen: Span[]; training: Span[] };

type UsageSpanRow = { name: string; start: string; end: string; seconds: number };

function sessionSpanEnd(startMs: number, durationSec: number): number {
  return startMs + Math.max(0, durationSec) * 1000;
}

export async function loadActualWeek(dates: string[]): Promise<Map<string, ActualDay>> {
  const result = new Map<string, ActualDay>();
  for (const d of dates) result.set(d, { sleep: [], screen: [], training: [] });
  if (dates.length === 0) return result;

  const sorted = [...dates].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  // Sleep — one query across the whole visible range. A night ending on day
  // N is filed under `date = N`, tonight's bedtime under `date = N+1`; both
  // can put minutes inside day N's window, so the range spills one day past
  // `last`. No user_id filter: widget_anon_read already scopes anon to the
  // owner's rows.
  const { data: sleepRows } = await supabase
    .from("protocol_sleep")
    .select("date, bedtime_start, bedtime_end")
    .gte("date", first)
    .lte("date", shiftYmd(last, 1));

  const sleepSpans: Span[] = [];
  for (const row of sleepRows ?? []) {
    const s = parseSleepTs(row.bedtime_start);
    const e = parseSleepTs(row.bedtime_end);
    if (s === null || e === null || e <= s) continue;
    sleepSpans.push({ start: s, end: e, label: "Sleep" });
  }

  // Training — Garmin activities with a start instant, reconstructed exactly
  // as DayCoveragePanel does: workout end = started_at + duration_min·60s
  // (skipped when duration_min isn't a number); run end = started_at +
  // avg_pace_s_per_km · actual_km seconds (skipped when either is missing —
  // a run stores no duration, and a guessed span is worse than none).
  const startIso = new Date(dayStartMs(first)).toISOString();
  const endIso = new Date(dayStartMs(shiftYmd(last, 1))).toISOString();
  const [{ data: workouts }, { data: runs }] = await Promise.all([
    supabase
      .from("protocol_workout_sessions")
      .select("name, started_at, duration_min")
      .not("started_at", "is", null)
      .gte("started_at", startIso)
      .lt("started_at", endIso),
    supabase
      .from("protocol_running_sessions")
      .select("notes, started_at, avg_pace_s_per_km, actual_km")
      .not("started_at", "is", null)
      .gte("started_at", startIso)
      .lt("started_at", endIso),
  ]);

  const trainingSpans: Span[] = [];
  for (const w of workouts ?? []) {
    const s = Date.parse(w.started_at);
    if (!Number.isFinite(s) || typeof w.duration_min !== "number") continue;
    trainingSpans.push({ start: s, end: sessionSpanEnd(s, w.duration_min * 60), label: w.name ?? "Workout" });
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
    trainingSpans.push({
      start: s,
      end: sessionSpanEnd(s, r.avg_pace_s_per_km * r.actual_km),
      label: r.notes ?? "Run",
    });
  }

  // Screen — a plain `npm run dev:pathfinder` browser run has no Tauri
  // bridge at all, so every `invoke` in the batch fails the same way; one
  // wrapping try/catch yields empty screen spans for every day rather than
  // rejecting the whole load.
  let screenRows: UsageSpanRow[][] = dates.map(() => []);
  try {
    screenRows = await Promise.all(
      dates.map((d) => invoke<UsageSpanRow[]>("pf_usage_spans", { date: d })),
    );
  } catch {
    // No bridge (browser dev) or command missing — screen band stays empty.
  }

  dates.forEach((date, i) => {
    for (const row of screenRows[i] ?? []) {
      const s = Date.parse(row.start);
      const e = Date.parse(row.end);
      if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
      const winStart = dayStartMs(date);
      const winEnd = dayStartMs(shiftYmd(date, 1));
      const clipped = clip({ start: s, end: e, label: row.name }, winStart, winEnd);
      if (clipped) result.get(date)!.screen.push(clipped);
    }
  });

  // Clip the whole-range sleep/training spans per day window.
  for (const date of dates) {
    const winStart = dayStartMs(date);
    const winEnd = dayStartMs(shiftYmd(date, 1));
    const day = result.get(date)!;
    for (const span of sleepSpans) {
      const clipped = clip(span, winStart, winEnd);
      if (clipped) day.sleep.push(clipped);
    }
    for (const span of trainingSpans) {
      const clipped = clip(span, winStart, winEnd);
      if (clipped) day.training.push(clipped);
    }
  }

  return result;
}
