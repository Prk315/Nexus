import { useMemo, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Moon } from "lucide-react";
import { CARD_STYLE, isoDate } from "../../lib/uiHelpers";
import type { SleepEntry, BodyMetric } from "../../store/types";

/**
 * Sleep trend chart. Every metric is scored 0–100% by EXPONENTIAL DECAY from its
 * own ideal: 100% at target, halving each time you stray a fixed step further
 * (for total sleep, 8 h = 100% and every 2 h away halves it, so 6 h = 50%). That
 * makes the percentages a real quality read, not a ratio.
 *
 * The hero is a separate aggregate — "Sleep score" — a weighted blend of the
 * component scores (duration heaviest, then deep & REM, then light + vitals): the
 * one-glance "how good was this sleep". Total sleep stays as its own light-blue
 * component line. Range switches between a week (default), 3 months and a year.
 */

type Range = "week" | "3m" | "year";
const RANGES: { id: Range; label: string; days: number; bucketDays: number }[] = [
  { id: "week", label: "Week", days: 7, bucketDays: 1 },
  { id: "3m", label: "3 Months", days: 92, bucketDays: 1 },
  { id: "year", label: "Year", days: 365, bucketDays: 7 },
];

const minToH = (m: number) => `${(m / 60).toFixed(1)} h`;

/** Which side of the target is penalised: below only, above only, or both. */
type Dir = "both" | "under" | "over";

interface Metric {
  key: string;
  label: string;
  color: string;
  width: number;
  source: "sleep" | "body";
  field: keyof SleepEntry | keyof BodyMetric;
  fmt: (v: number) => string;
  /** Value (same unit as the metric) that scores 100%. */
  target: number;
  /** Distance from target that halves the score — the exponential's half-life. */
  halfLife: number;
  dir: Dir;
  /** Contribution to the aggregate "Sleep score" (weights renormalise over the
   *  metrics present each day). */
  weight: number;
}

// Component metrics. Scores exp-decay from each ideal; weights feed the aggregate.
// Duration is symmetric (over- and under-sleeping both cost); the stages only
// penalise a deficit (more deep/REM is not worse); HRV higher-is-better, resting
// HR lower-is-better.
const METRICS: Metric[] = [
  { key: "total", label: "Total sleep", color: "#38bdf8", width: 3,    source: "sleep", field: "duration_min",    fmt: minToH,                         target: 480, halfLife: 120, dir: "both",  weight: 0.35 },
  { key: "deep",  label: "Deep",        color: "#8b5cf6", width: 2.75, source: "sleep", field: "deep_sleep_min",  fmt: minToH,                         target: 120, halfLife: 40,  dir: "under", weight: 0.20 },
  { key: "rem",   label: "REM",         color: "#22c55e", width: 2.75, source: "sleep", field: "rem_sleep_min",   fmt: minToH,                         target: 120, halfLife: 40,  dir: "under", weight: 0.20 },
  { key: "light", label: "Light",       color: "#6366f1", width: 1.75, source: "sleep", field: "light_sleep_min", fmt: minToH,                         target: 240, halfLife: 120, dir: "under", weight: 0.10 },
  { key: "hrv",   label: "HRV",         color: "#f59e0b", width: 1.25, source: "body",  field: "hrv_ms",          fmt: (v) => `${Math.round(v)} ms`,   target: 55,  halfLife: 20,  dir: "under", weight: 0.10 },
  { key: "hr",    label: "Resting HR",  color: "#ef4444", width: 1.25, source: "body",  field: "resting_hr_bpm",  fmt: (v) => `${Math.round(v)} bpm`,  target: 55,  halfLife: 12,  dir: "over",  weight: 0.05 },
];

// The aggregate hero — a distinct fuchsia so it reads apart from every component.
const SCORE = { key: "score", label: "Sleep score", color: "#d946ef", width: 6 };

/** Exponential-decay score: 100% at target, halving every `halfLife` further away
 *  on the penalised side(s). Always in [0, 100]. */
function scoreOf(value: number, m: Metric): number {
  let dev: number;
  if (m.dir === "under") dev = Math.max(0, m.target - value);
  else if (m.dir === "over") dev = Math.max(0, value - m.target);
  else dev = Math.abs(value - m.target);
  return Math.round(100 * Math.pow(2, -dev / m.halfLife) * 10) / 10;
}

function subDaysISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

type Datum = Record<string, number | string | null>;
interface RawRow { [key: string]: number | string | null; date: string; }

export default function SleepChart({
  sleep, bodyMetrics,
}: {
  sleep: SleepEntry[];
  bodyMetrics: BodyMetric[];
}) {
  const [range, setRange] = useState<Range>("week");
  const cfg = RANGES.find((r) => r.id === range)!;

  const { data, activeMetrics, hasScore } = useMemo(() => {
    const cutoff = subDaysISO(cfg.days - 1);

    // Merge sleep + body metrics by date.
    const byDate = new Map<string, { sleep?: SleepEntry; body?: BodyMetric }>();
    for (const s of sleep) {
      if (s.date < cutoff) continue;
      (byDate.get(s.date) ?? setGet(byDate, s.date)).sleep = s;
    }
    for (const b of bodyMetrics) {
      if (b.date < cutoff) continue;
      (byDate.get(b.date) ?? setGet(byDate, b.date)).body = b;
    }

    const dates = [...byDate.keys()].sort();
    const rawRows: RawRow[] = dates.map((date) => {
      const rec = byDate.get(date)!;
      const row: RawRow = { date };
      for (const m of METRICS) {
        const src = m.source === "sleep" ? rec.sleep : rec.body;
        const v = src ? (src as unknown as Record<string, unknown>)[m.field as string] : null;
        row[m.key] = typeof v === "number" ? v : null;
      }
      return row;
    });

    // Bucket (year → weekly averages) to keep long ranges legible.
    const buckets = cfg.bucketDays > 1 ? bucketRows(rawRows, cfg.bucketDays) : rawRows;

    const activeMetrics = METRICS.filter((m) => buckets.some((r) => r[m.key] != null));

    let hasScore = false;
    const data: Datum[] = buckets.map((r) => {
      const d: Datum = { date: r.date as string, full: fullLabel(r.date as string), label: shortLabel(r.date as string, range) };
      let wSum = 0, sSum = 0;
      for (const m of METRICS) {
        const raw = r[m.key] as number | null;
        if (raw == null) { d[`${m.key}_pct`] = null; d[`${m.key}_raw`] = null; continue; }
        const sc = scoreOf(raw, m);
        d[`${m.key}_pct`] = sc;
        d[`${m.key}_raw`] = raw;
        wSum += m.weight;
        sSum += m.weight * sc;
      }
      // Aggregate: weighted mean of the component scores present that day.
      d.score_pct = wSum > 0 ? Math.round((sSum / wSum) * 10) / 10 : null;
      if (d.score_pct != null) hasScore = true;
      return d;
    });

    return { data, activeMetrics, hasScore };
  }, [sleep, bodyMetrics, cfg, range]);

  const tickInterval = range === "week" ? 0 : range === "3m" ? Math.max(0, Math.floor(data.length / 8)) : Math.max(0, Math.floor(data.length / 10));

  return (
    <div style={{ ...CARD_STYLE, padding: "20px 20px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Moon size={15} color="var(--accent)" />
          <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Sleep</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· quality score vs ideal (8 h = 100%, 6 h = 50%) — hover for values</span>
        </div>
        {/* Legend — aggregate first, then components. */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {[...(hasScore ? [SCORE] : []), ...activeMetrics].map((s) => {
            const hero = s.key === "score";
            return (
              <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: hero ? "var(--text)" : "var(--text-muted)", fontWeight: hero ? 600 : 400 }}>
                <span style={{ width: 14, height: hero ? 5 : Math.max(2, Math.round(s.width)), borderRadius: 2, background: s.color, boxShadow: hero ? `0 0 6px ${s.color}` : "none" }} />
                {s.label}
              </span>
            );
          })}
        </div>
      </div>

      {data.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)", fontSize: 13 }}>
          No sleep data in this range yet.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data} margin={{ top: 12, right: 10, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="sleepScoreFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SCORE.color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={SCORE.color} stopOpacity={0} />
              </linearGradient>
              <filter id="sleepGlow" x="-20%" y="-30%" width="140%" height="160%">
                <feDropShadow dx="0" dy="5" stdDeviation="6" floodColor={SCORE.color} floodOpacity="0.55" />
              </filter>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              axisLine={false}
              tickLine={false}
              interval={tickInterval}
              minTickGap={16}
            />
            <YAxis
              domain={[0, 105]}
              ticks={[0, 50, 100]}
              tickFormatter={(v) => `${v}%`}
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            {/* 100% = a perfect score against every ideal. */}
            <ReferenceLine y={100} stroke="var(--text-muted)" strokeDasharray="4 4" strokeOpacity={0.5} />
            <Tooltip content={<SleepTooltip />} />

            {/* Component lines (including total sleep). */}
            {METRICS.map((m) => (
              <Line
                key={m.key}
                type="monotone"
                dataKey={`${m.key}_pct`}
                stroke={m.color}
                strokeWidth={m.width}
                dot={false}
                activeDot={{ r: 3, fill: m.color }}
                connectNulls
                isAnimationActive={false}
              />
            ))}

            {/* Hero: the aggregate sleep score, a glowing fuchsia area on top. */}
            <Area
              type="monotone"
              dataKey="score_pct"
              stroke={SCORE.color}
              strokeWidth={SCORE.width}
              fill="url(#sleepScoreFill)"
              filter="url(#sleepGlow)"
              connectNulls
              dot={false}
              activeDot={{ r: 4, fill: SCORE.color }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {/* Range toggle */}
      <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 10 }}>
        {RANGES.map((r) => {
          const on = r.id === range;
          return (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              style={{
                padding: "5px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                borderRadius: "var(--radius-sm)",
                border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                background: on ? "var(--accent-tint)" : "transparent",
                color: on ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function setGet(map: Map<string, { sleep?: SleepEntry; body?: BodyMetric }>, key: string) {
  const v: { sleep?: SleepEntry; body?: BodyMetric } = {};
  map.set(key, v);
  return v;
}

/** Average consecutive rows into fixed-size day buckets (for the year view). */
function bucketRows(rows: RawRow[], bucketDays: number): RawRow[] {
  if (rows.length === 0) return rows;
  const out: RawRow[] = [];
  for (let i = 0; i < rows.length; i += bucketDays) {
    const slice = rows.slice(i, i + bucketDays);
    const agg: RawRow = { date: slice[slice.length - 1].date };
    for (const m of METRICS) {
      const vals = slice.map((r) => r[m.key]).filter((v): v is number => typeof v === "number");
      agg[m.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    out.push(agg);
  }
  return out;
}

function shortLabel(dateISO: string, range: Range): string {
  const d = new Date(`${dateISO}T00:00:00`);
  if (range === "week") return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fullLabel(dateISO: string): string {
  return new Date(`${dateISO}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function SleepTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Datum }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  const score = d.score_pct;
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 10px", fontSize: 12, color: "var(--text)" }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{d.full}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {typeof score === "number" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", marginBottom: 3, paddingBottom: 5, borderBottom: "1px solid var(--border)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: SCORE.color, boxShadow: `0 0 5px ${SCORE.color}` }} />
              {SCORE.label}
            </span>
            <span style={{ fontWeight: 700 }}>{score}%</span>
          </div>
        )}
        {METRICS.map((m) => {
          const raw = d[`${m.key}_raw`];
          if (raw == null || typeof raw !== "number") return null;
          const pct = d[`${m.key}_pct`];
          return (
            <div key={m.key} style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: m.color }} />
                {m.label}
              </span>
              <span style={{ fontWeight: 600 }}>
                {m.fmt(raw)}
                {typeof pct === "number" && (
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {pct}%</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
