import { isoDate } from "./uiHelpers";
import type { RunningSession, BodyMetric, ExerciseHistory } from "../store/types";
import { RUN_METRIC_OPTIONS, type TrackingConfig } from "./trackingConfig";

export type TimeRange = "week" | "month" | "3months" | "year" | "all";

export const TIME_RANGES: { id: TimeRange; label: string; days: number }[] = [
  { id: "week", label: "W", days: 7 },
  { id: "month", label: "M", days: 30 },
  { id: "3months", label: "3M", days: 90 },
  { id: "year", label: "Y", days: 365 },
  { id: "all", label: "All", days: Infinity },
];

/** One small named circle — 100 = baseline, >100 = improved (green overflow). */
export interface GaugeMetric { name: string; pct: number; }

type Row = Record<string, number | string | null>;

export interface ProgressData {
  empty: boolean;
  overallPct: number;
  overallLabel: string;
  metrics: GaugeMetric[];
  /** Lead indicator — cumulative input toward the period goal vs a pro-rated goal
   *  line ("are you doing the work?"). */
  goal: { label: string; unit: string; data: Row[] };
  /** Hero chart — a glowing "progress score" (mean of the tracked component lines,
   *  each normalised 0–100) plus the component lines themselves. */
  trend: {
    data: Row[]; // { label, full, score, <key>_pos, <key>_raw }
    series: { key: string; name: string; color: string; unit: string }[];
  };
  /** Biomarkers over time — normalised onto a shared 0–100 axis (`<key>_pos`) with
   *  the raw value kept for the tooltip (`<key>_raw`). Filtered by config. */
  biomarkers: {
    label: string;
    series: { key: string; name: string; color: string; unit: string }[];
    data: Row[];
  };
}

interface BioSpec { key: string; name: string; color: string; field: keyof BodyMetric; higherBetter: boolean; unit: string; }

const BIO_SPECS: BioSpec[] = [
  { key: "readiness", name: "Readiness", color: "#d946ef", field: "readiness_score", higherBetter: true, unit: "" },
  { key: "hrv", name: "HRV", color: "#f59e0b", field: "hrv_ms", higherBetter: true, unit: "ms" },
  { key: "rhr", name: "Resting HR", color: "#ef4444", field: "resting_hr_bpm", higherBetter: false, unit: "bpm" },
  { key: "recovery", name: "Recovery", color: "#22c55e", field: "recovery_index", higherBetter: true, unit: "" },
  { key: "spo2", name: "SpO2", color: "#38bdf8", field: "spo2_pct", higherBetter: true, unit: "%" },
  { key: "avghr", name: "Avg HR", color: "#fb923c", field: "avg_heart_rate_bpm", higherBetter: false, unit: "bpm" },
];

export const BIOMARKER_OPTIONS = BIO_SPECS.map((s) => ({ key: s.key, name: s.name, color: s.color }));

const EX_PALETTE = ["#38bdf8", "#f59e0b", "#a78bfa", "#22c55e", "#ec4899", "#14b8a6", "#eab308", "#f472b6"];

function cutoffISO(days: number): string {
  if (!isFinite(days)) return "0000-01-01";
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  return isoDate(d);
}

function weekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return isoDate(d);
}

function shortDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function improvement(first: number | null, second: number | null, higherBetter: boolean): number {
  if (first == null || second == null || first === 0 || second === 0) return 100;
  return Math.round((higherBetter ? second / first : first / second) * 100);
}

function mean(xs: number[]): number | null {
  const v = xs.filter((x) => x != null && isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function halves<T extends { date: string }>(rows: T[]): [T[], T[]] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const mid = Math.floor(sorted.length / 2);
  return [sorted.slice(0, mid || 1), sorted.slice(mid)];
}

function weeksInRange(days: number, rows: { date: string }[]): number {
  if (isFinite(days)) return Math.max(1, days / 7);
  if (rows.length === 0) return 1;
  const dates = rows.map((r) => r.date).sort();
  const span = (new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / 86400000;
  return Math.max(1, span / 7);
}

interface Comp { key: string; name: string; color: string; unit: string; higherBetter: boolean; byWeek: Map<string, number>; }

/** Normalise each component's per-week values onto a shared 0–100 axis (direction-
 *  aware) and derive the glowing hero "score" as the mean of the present positions. */
function assembleTrend(weekKeys: string[], comps: Comp[]): ProgressData["trend"] {
  const bounds = comps.map((c) => {
    const vals = weekKeys.map((w) => c.byWeek.get(w)).filter((v): v is number => typeof v === "number");
    return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
  });
  const data: Row[] = weekKeys.map((w) => {
    const row: Row = { label: shortDate(w), full: w };
    let sum = 0, n = 0;
    comps.forEach((c, i) => {
      const v = c.byWeek.get(w);
      const b = bounds[i];
      if (typeof v !== "number" || !b) { row[`${c.key}_pos`] = null; row[`${c.key}_raw`] = null; return; }
      const frac = b.max === b.min ? 0.5 : (v - b.min) / (b.max - b.min);
      const pos = Math.round((c.higherBetter ? frac : 1 - frac) * 100);
      row[`${c.key}_pos`] = pos;
      row[`${c.key}_raw`] = Math.round(v * 10) / 10;
      sum += pos; n++;
    });
    row.score = n > 0 ? Math.round(sum / n) : null;
    return row;
  });
  return { data, series: comps.map((c) => ({ key: c.key, name: c.name, color: c.color, unit: c.unit })) };
}

const RUN_WEEKLY_KM = 30;
const STRENGTH_WEEKLY_SESSIONS = 4;

export function buildRunningStats(runs: RunningSession[], body: BodyMetric[], range: TimeRange, config: TrackingConfig): ProgressData {
  const days = TIME_RANGES.find((r) => r.id === range)!.days;
  const since = cutoffISO(days);
  const inRange = runs.filter((r) => r.date >= since).sort((a, b) => a.date.localeCompare(b.date));
  const empty = inRange.length === 0;
  const weeks = weeksInRange(days, inRange);

  const weekKeys = [...new Set(inRange.map((r) => weekKey(r.date)))].sort();

  // Per-week aggregates for each run metric.
  const agg = (fn: (rs: RunningSession[]) => number | null) => {
    const m = new Map<string, number>();
    for (const w of weekKeys) {
      const rs = inRange.filter((r) => weekKey(r.date) === w);
      const v = fn(rs);
      if (v != null) m.set(w, v);
    }
    return m;
  };
  const perMetric: Record<string, Map<string, number>> = {
    speed: agg((rs) => { const p = mean(rs.map((r) => r.avg_pace_s_per_km).filter((x): x is number => x != null && x > 0)); return p ? 3600 / p : null; }),
    distance: agg((rs) => rs.reduce((s, r) => s + (r.actual_km ?? 0), 0) || null),
    hr: agg((rs) => mean(rs.map((r) => r.heart_rate_avg).filter((x): x is number => x != null))),
    cadence: agg((rs) => mean(rs.map((r) => r.cadence_avg).filter((x): x is number => x != null))),
  };
  const comps: Comp[] = RUN_METRIC_OPTIONS
    .filter((o) => config.runMetrics.includes(o.key))
    .map((o) => ({ ...o, byWeek: perMetric[o.key] ?? new Map() }));

  const totalKm = inRange.reduce((s, r) => s + (r.actual_km ?? 0), 0);
  const avgWeeklyKm = totalKm / weeks;

  const [a, b] = halves(inRange);
  const metrics: GaugeMetric[] = [
    { name: "Weekly km", pct: improvement(mean(a.map((r) => r.actual_km ?? 0)), mean(b.map((r) => r.actual_km ?? 0)), true) },
    { name: "Pace", pct: improvement(mean(a.map((r) => r.avg_pace_s_per_km).filter((x): x is number => x != null)), mean(b.map((r) => r.avg_pace_s_per_km).filter((x): x is number => x != null)), false) },
    { name: "Avg HR", pct: improvement(mean(a.map((r) => r.heart_rate_avg).filter((x): x is number => x != null)), mean(b.map((r) => r.heart_rate_avg).filter((x): x is number => x != null)), false) },
    { name: "Longest", pct: improvement(Math.max(0, ...a.map((r) => r.actual_km ?? 0)), Math.max(0, ...b.map((r) => r.actual_km ?? 0)), true) },
  ];

  // Lead: cumulative distance vs a linear goal line (30 km/wk pro-rated).
  const first = inRange[0]?.date;
  let cum = 0;
  const goalData: Row[] = inRange.map((r) => {
    cum += r.actual_km ?? 0;
    const days = first ? Math.max(0, (new Date(r.date).getTime() - new Date(first).getTime()) / 86400000) : 0;
    return { label: shortDate(r.date), full: r.date, value: Math.round(cum * 10) / 10, goal: Math.round((RUN_WEEKLY_KM / 7) * (days + 1) * 10) / 10 };
  });

  return {
    empty,
    overallPct: Math.round((avgWeeklyKm / RUN_WEEKLY_KM) * 100),
    overallLabel: `${avgWeeklyKm.toFixed(1)} / ${RUN_WEEKLY_KM} km·wk`,
    metrics,
    goal: { label: "Progress toward goal · km", unit: "km", data: goalData },
    trend: assembleTrend(weekKeys, comps),
    biomarkers: buildBiomarkers(body, since, config.biomarkers),
  };
}

export function buildStrengthStats(history: ExerciseHistory[], body: BodyMetric[], range: TimeRange, config: TrackingConfig): ProgressData {
  const days = TIME_RANGES.find((r) => r.id === range)!.days;
  const since = cutoffISO(days);
  const inRange = history.filter((h) => h.date >= since).sort((a, b) => a.date.localeCompare(b.date));
  const empty = inRange.length === 0;
  const weeks = weeksInRange(days, inRange);

  const e1rm = (h: ExerciseHistory) => (h.weight_kg != null && h.reps != null ? h.weight_kg * (1 + h.reps / 30) : 0);
  const weekKeys = [...new Set(inRange.map((h) => weekKey(h.date)))].sort();

  // Which exercises to track: explicit config, else the top 3 most-logged.
  let tracked = config.exercises;
  if (tracked.length === 0) {
    const count = new Map<string, number>();
    for (const h of inRange) count.set(h.name, (count.get(h.name) ?? 0) + 1);
    tracked = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
  }

  // Per-week top est-1RM for each tracked exercise.
  const comps: Comp[] = tracked.map((name, i) => {
    const byWeek = new Map<string, number>();
    for (const w of weekKeys) {
      const best = Math.max(0, ...inRange.filter((h) => h.name === name && weekKey(h.date) === w).map(e1rm));
      if (best > 0) byWeek.set(w, Math.round(best * 10) / 10);
    }
    return { key: `ex${i}`, name, color: EX_PALETTE[i % EX_PALETTE.length], unit: "kg", higherBetter: true, byWeek };
  });

  const totalSessions = new Set(inRange.map((h) => h.date)).size;
  const avgWeeklySessions = totalSessions / weeks;

  const [a, b] = halves(inRange);
  const vol = (h: ExerciseHistory) => (h.sets ?? 1) * (h.reps ?? 0) * (h.weight_kg ?? 0);
  const metrics: GaugeMetric[] = [
    { name: "Top 1RM", pct: improvement(Math.max(0, ...a.map(e1rm)), Math.max(0, ...b.map(e1rm)), true) },
    { name: "Volume", pct: improvement(mean(a.map(vol)), mean(b.map(vol)), true) },
    { name: "Sessions/wk", pct: improvement(new Set(a.map((h) => h.date)).size, new Set(b.map((h) => h.date)).size, true) },
    { name: "Top weight", pct: improvement(Math.max(0, ...a.map((h) => h.weight_kg ?? 0)), Math.max(0, ...b.map((h) => h.weight_kg ?? 0)), true) },
  ];

  // Lead: cumulative sessions vs a linear target line (4/wk pro-rated).
  const sessionDates = [...new Set(inRange.map((h) => h.date))].sort();
  const first = sessionDates[0];
  const goalData: Row[] = sessionDates.map((d, i) => {
    const days = first ? Math.max(0, (new Date(d).getTime() - new Date(first).getTime()) / 86400000) : 0;
    return { label: shortDate(d), full: d, value: i + 1, goal: Math.round((STRENGTH_WEEKLY_SESSIONS / 7) * (days + 1) * 10) / 10 };
  });

  return {
    empty,
    overallPct: Math.round((avgWeeklySessions / STRENGTH_WEEKLY_SESSIONS) * 100),
    overallLabel: `${avgWeeklySessions.toFixed(1)} / ${STRENGTH_WEEKLY_SESSIONS} sessions·wk`,
    metrics,
    goal: { label: "Progress toward goal · sessions", unit: "sessions", data: goalData },
    trend: assembleTrend(weekKeys, comps),
    biomarkers: buildBiomarkers(body, since, config.biomarkers),
  };
}

function buildBiomarkers(body: BodyMetric[], since: string, selected: string[]): ProgressData["biomarkers"] {
  const rows = body.filter((m) => m.date >= since).sort((a, b) => a.date.localeCompare(b.date));
  const active = BIO_SPECS.filter((s) => selected.includes(s.key) && rows.some((m) => typeof m[s.field] === "number"));

  const bounds = new Map<string, { min: number; max: number }>();
  for (const s of active) {
    const vals = rows.map((m) => m[s.field]).filter((v): v is number => typeof v === "number");
    bounds.set(s.key, { min: Math.min(...vals), max: Math.max(...vals) });
  }

  const data: Row[] = rows
    .filter((m) => active.some((s) => typeof m[s.field] === "number"))
    .map((m) => {
      const row: Row = { label: shortDate(m.date), full: m.date };
      for (const s of active) {
        const v = m[s.field];
        if (typeof v !== "number") { row[`${s.key}_pos`] = null; row[`${s.key}_raw`] = null; continue; }
        const { min, max } = bounds.get(s.key)!;
        const frac = max === min ? 0.5 : (v - min) / (max - min);
        row[`${s.key}_pos`] = Math.round((s.higherBetter ? frac : 1 - frac) * 100);
        row[`${s.key}_raw`] = v;
      }
      return row;
    });

  return {
    label: "Biomarkers & proxies over time",
    series: active.map((s) => ({ key: s.key, name: s.name, color: s.color, unit: s.unit })),
    data,
  };
}
