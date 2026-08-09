import { isoDate } from "./uiHelpers";
import type { RunningSession, BodyMetric, ExerciseHistory } from "../store/types";

export type TimeRange = "week" | "month" | "3months" | "year" | "all";

export const TIME_RANGES: { id: TimeRange; label: string; days: number }[] = [
  { id: "week", label: "W", days: 7 },
  { id: "month", label: "M", days: 30 },
  { id: "3months", label: "3M", days: 90 },
  { id: "year", label: "Y", days: 365 },
  { id: "all", label: "All", days: Infinity },
];

/** One small named circle — 100 = baseline, >100 = improved (green overflow). */
export interface GaugeMetric {
  name: string;
  pct: number;
}

export interface ProgressData {
  empty: boolean;
  /** Big pie: overall % toward the headline goal. */
  overallPct: number;
  overallLabel: string;
  metrics: GaugeMetric[];
  /** Graph 1 — cumulative progress toward the period goal. */
  goal: { label: string; unit: string; data: { label: string; value: number; goal: number }[] };
  /** Graph 2 — recurring output vs a per-week target. */
  output: { label: string; unit: string; target: number; data: { label: string; value: number }[] };
  /** Biomarkers / proxies connected to the activity, over time. */
  biomarkers: { label: string; series: { key: string; name: string; color: string }[]; data: Record<string, number | string | null>[] };
}

function cutoffISO(days: number): string {
  if (!isFinite(days)) return "0000-01-01";
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  return isoDate(d);
}

/** Monday-of-week key for a date string. */
function weekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return isoDate(d);
}

function shortDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Improvement of `second` over `first`, as a % where 100 = no change. Neutral
 *  (100) when there isn't enough data — matching "initially 100%". */
function improvement(first: number | null, second: number | null, higherBetter: boolean): number {
  if (first == null || second == null || first === 0 || second === 0) return 100;
  const ratio = higherBetter ? second / first : first / second;
  return Math.round(ratio * 100);
}

function mean(xs: number[]): number | null {
  const v = xs.filter((x) => x != null && isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Split rows (sorted by date) into earlier / later halves for baseline vs current. */
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

const RUN_WEEKLY_KM = 30; // default output goal — user-configurable later
const STRENGTH_WEEKLY_SESSIONS = 4;

export function buildRunningStats(runs: RunningSession[], body: BodyMetric[], range: TimeRange): ProgressData {
  const days = TIME_RANGES.find((r) => r.id === range)!.days;
  const since = cutoffISO(days);
  const inRange = runs.filter((r) => r.date >= since).sort((a, b) => a.date.localeCompare(b.date));

  const empty = inRange.length === 0;
  const weeks = weeksInRange(days, inRange);

  // Output — distance per week vs target.
  const byWeek = new Map<string, number>();
  for (const r of inRange) byWeek.set(weekKey(r.date), (byWeek.get(weekKey(r.date)) ?? 0) + (r.actual_km ?? 0));
  const outputData = [...byWeek.entries()].sort().map(([k, v]) => ({ label: shortDate(k), value: Math.round(v * 10) / 10 }));
  const totalKm = inRange.reduce((s, r) => s + (r.actual_km ?? 0), 0);
  const avgWeeklyKm = totalKm / weeks;
  const overallPct = Math.round((avgWeeklyKm / RUN_WEEKLY_KM) * 100);

  // Goal — cumulative distance vs pro-rated target line.
  const goalTotal = RUN_WEEKLY_KM * weeks;
  let cum = 0;
  const first = inRange[0]?.date;
  const goalData = inRange.map((r) => {
    cum += r.actual_km ?? 0;
    const elapsedWeeks = first ? Math.max(0, (new Date(r.date).getTime() - new Date(first).getTime()) / 604800000) : 0;
    return { label: shortDate(r.date), value: Math.round(cum * 10) / 10, goal: Math.round(Math.min(goalTotal, RUN_WEEKLY_KM * elapsedWeeks + RUN_WEEKLY_KM) * 10) / 10 };
  });

  // Metrics — baseline (earlier half) vs current (later half).
  const [a, b] = halves(inRange);
  const metrics: GaugeMetric[] = [
    { name: "Weekly km", pct: improvement(mean(a.map((r) => r.actual_km ?? 0)), mean(b.map((r) => r.actual_km ?? 0)), true) },
    { name: "Pace", pct: improvement(mean(a.map((r) => r.avg_pace_s_per_km).filter((x): x is number => x != null)), mean(b.map((r) => r.avg_pace_s_per_km).filter((x): x is number => x != null)), false) },
    { name: "Avg HR", pct: improvement(mean(a.map((r) => r.heart_rate_avg).filter((x): x is number => x != null)), mean(b.map((r) => r.heart_rate_avg).filter((x): x is number => x != null)), false) },
    { name: "Longest", pct: improvement(Math.max(0, ...a.map((r) => r.actual_km ?? 0)), Math.max(0, ...b.map((r) => r.actual_km ?? 0)), true) },
  ];

  return {
    empty,
    overallPct,
    overallLabel: `${avgWeeklyKm.toFixed(1)} / ${RUN_WEEKLY_KM} km·wk`,
    metrics,
    goal: { label: "Cumulative distance vs goal", unit: "km", data: goalData },
    output: { label: `Weekly distance · target ${RUN_WEEKLY_KM} km`, unit: "km", target: RUN_WEEKLY_KM, data: outputData },
    biomarkers: buildBiomarkers(body, since),
  };
}

export function buildStrengthStats(history: ExerciseHistory[], body: BodyMetric[], range: TimeRange): ProgressData {
  const days = TIME_RANGES.find((r) => r.id === range)!.days;
  const since = cutoffISO(days);
  const inRange = history.filter((h) => h.date >= since).sort((a, b) => a.date.localeCompare(b.date));

  const empty = inRange.length === 0;
  const weeks = weeksInRange(days, inRange);

  const vol = (h: ExerciseHistory) => (h.sets ?? 1) * (h.reps ?? 0) * (h.weight_kg ?? 0);
  const e1rm = (h: ExerciseHistory) => (h.weight_kg != null && h.reps != null ? h.weight_kg * (1 + h.reps / 30) : 0);

  // Output — sessions (distinct dates) per week vs target.
  const sessionDatesByWeek = new Map<string, Set<string>>();
  for (const h of inRange) {
    const k = weekKey(h.date);
    if (!sessionDatesByWeek.has(k)) sessionDatesByWeek.set(k, new Set());
    sessionDatesByWeek.get(k)!.add(h.date);
  }
  const outputData = [...sessionDatesByWeek.entries()].sort().map(([k, set]) => ({ label: shortDate(k), value: set.size }));
  const totalSessions = new Set(inRange.map((h) => h.date)).size;
  const avgWeeklySessions = totalSessions / weeks;
  const overallPct = Math.round((avgWeeklySessions / STRENGTH_WEEKLY_SESSIONS) * 100);

  // Goal — cumulative volume vs pro-rated target (target derived from period pace).
  const totalVol = inRange.reduce((s, h) => s + vol(h), 0);
  const goalTotal = totalVol > 0 ? totalVol * 1.1 : 1; // 10% stretch on current pace
  let cum = 0;
  const goalData = inRange.map((h) => {
    cum += vol(h);
    return { label: shortDate(h.date), value: Math.round(cum), goal: Math.round(goalTotal) };
  });

  const [a, b] = halves(inRange);
  const metrics: GaugeMetric[] = [
    { name: "Top 1RM", pct: improvement(Math.max(0, ...a.map(e1rm)), Math.max(0, ...b.map(e1rm)), true) },
    { name: "Volume", pct: improvement(mean(a.map(vol)), mean(b.map(vol)), true) },
    { name: "Sessions/wk", pct: improvement(new Set(a.map((h) => h.date)).size, new Set(b.map((h) => h.date)).size, true) },
    { name: "Top weight", pct: improvement(Math.max(0, ...a.map((h) => h.weight_kg ?? 0)), Math.max(0, ...b.map((h) => h.weight_kg ?? 0)), true) },
  ];

  return {
    empty,
    overallPct,
    overallLabel: `${avgWeeklySessions.toFixed(1)} / ${STRENGTH_WEEKLY_SESSIONS} sessions·wk`,
    metrics,
    goal: { label: "Cumulative volume vs goal", unit: "kg", data: goalData },
    output: { label: `Weekly sessions · target ${STRENGTH_WEEKLY_SESSIONS}`, unit: "", target: STRENGTH_WEEKLY_SESSIONS, data: outputData },
    biomarkers: buildBiomarkers(body, since),
  };
}

/** Recovery/fitness proxies shared by both activities: resting HR (lower better)
 *  and HRV (higher better), over the selected window. */
function buildBiomarkers(body: BodyMetric[], since: string): ProgressData["biomarkers"] {
  const rows = body
    .filter((m) => m.date >= since && (m.resting_hr_bpm != null || m.hrv_ms != null))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) => ({ label: shortDate(m.date), rhr: m.resting_hr_bpm, hrv: m.hrv_ms }));
  return {
    label: "Recovery proxies over time",
    series: [
      { key: "rhr", name: "Resting HR", color: "var(--series-running)" },
      { key: "hrv", name: "HRV", color: "var(--series-workout)" },
    ],
    data: rows,
  };
}
