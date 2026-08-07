import { useEffect, useMemo, useRef, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Moon } from "lucide-react";
import { CARD_STYLE, isoDate, formatMinutes } from "../../lib/uiHelpers";
import type { SleepEntry, BodyMetric } from "../../store/types";

/**
 * Sleep trend chart + last-night ring column. Every metric is scored 0–100% by
 * EXPONENTIAL DECAY from its own ideal: 100% at target, halving each half-life
 * further away (total sleep 8 h = 100%, every 2 h away halves it → 6 h = 50%).
 *
 * The trend hero is an aggregate "Sleep score" (weighted blend of the component
 * scores). To the right, a column of ring gauges shows last night's score for
 * each metric with the % in the middle — Quality (the aggregate) and Duration
 * first, then Deep / REM / Light, then the vitals. When the card is too narrow to
 * seat the column, Deep / REM / Light hop up beside the title.
 */

type Range = "week" | "3m" | "year";
const RANGES: { id: Range; label: string; days: number; bucketDays: number }[] = [
  { id: "week", label: "Week", days: 7, bucketDays: 1 },
  { id: "3m", label: "3 Months", days: 92, bucketDays: 1 },
  { id: "year", label: "Year", days: 365, bucketDays: 7 },
];

const minToH = (m: number) => `${(m / 60).toFixed(1)} h`;

type Dir = "both" | "under" | "over";

interface Metric {
  key: string;
  label: string;
  color: string;
  width: number;
  source: "sleep" | "body";
  field: keyof SleepEntry | keyof BodyMetric;
  fmt: (v: number) => string;
  /** Scored metrics get an exp-decay quality %, a ring, and a share of the
   *  aggregate. Unscored ones (HRV, resting HR) only draw a trend line, mapped
   *  onto the 0–100 axis by `plot` — no percentage, no ring, no weight. */
  scored: boolean;
  target?: number;
  halfLife?: number;
  dir?: Dir;
  weight?: number;
  /** For unscored metrics: raw value → 0–100 axis position (not a score). */
  plot?: (v: number) => number;
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

const METRICS: Metric[] = [
  { key: "total", label: "Total sleep", color: "#38bdf8", width: 3,    source: "sleep", field: "duration_min",    fmt: minToH,                        scored: true,  target: 480, halfLife: 120, dir: "both",  weight: 0.40 },
  { key: "deep",  label: "Deep",        color: "#8b5cf6", width: 2.75, source: "sleep", field: "deep_sleep_min",  fmt: minToH,                        scored: true,  target: 120, halfLife: 40,  dir: "under", weight: 0.22 },
  { key: "rem",   label: "REM",         color: "#22c55e", width: 2.75, source: "sleep", field: "rem_sleep_min",   fmt: minToH,                        scored: true,  target: 120, halfLife: 40,  dir: "under", weight: 0.22 },
  { key: "light", label: "Light",       color: "#6366f1", width: 1.75, source: "sleep", field: "light_sleep_min", fmt: minToH,                        scored: true,  target: 240, halfLife: 120, dir: "under", weight: 0.16 },
  { key: "hrv",   label: "HRV",         color: "#f59e0b", width: 1.25, source: "body",  field: "hrv_ms",          fmt: (v) => `${Math.round(v)} ms`,  scored: false, plot: (v) => clamp((v / 250) * 100) },
  { key: "hr",    label: "Resting HR",  color: "#ef4444", width: 1.25, source: "body",  field: "resting_hr_bpm",  fmt: (v) => `${Math.round(v)} bpm`, scored: false, plot: (v) => clamp(v) },
];
const METRIC = Object.fromEntries(METRICS.map((m) => [m.key, m])) as Record<string, Metric>;

const SCORE = { key: "score", label: "Sleep score", color: "#d946ef", width: 6 };

/** Exponential-decay score for a scored metric: 100% at target, halving every
 *  `halfLife` further on the penalised side(s). Always in [0, 100]. */
function scoreOf(value: number, m: Metric): number {
  const target = m.target!, halfLife = m.halfLife!;
  let dev: number;
  if (m.dir === "under") dev = Math.max(0, target - value);
  else if (m.dir === "over") dev = Math.max(0, value - target);
  else dev = Math.abs(value - target);
  return Math.round(100 * Math.pow(2, -dev / halfLife) * 10) / 10;
}

/** Axis position 0–100 for a metric's line: its score if scored, else its raw
 *  value mapped through `plot`. */
function posOf(value: number, m: Metric): number {
  return m.scored ? scoreOf(value, m) : (m.plot ? m.plot(value) : 0);
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

  // Card width drives the ring layout: seat the column beside the chart when wide,
  // otherwise fold Deep/REM/Light up beside the title and lay the rest below.
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardW, setCardW] = useState(1000);
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setCardW(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const compact = cardW < 680;

  const { data, activeMetrics, hasScore } = useMemo(() => {
    const cutoff = subDaysISO(cfg.days - 1);

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

    const buckets = cfg.bucketDays > 1 ? bucketRows(rawRows, cfg.bucketDays) : rawRows;
    const activeMetrics = METRICS.filter((m) => buckets.some((r) => r[m.key] != null));

    let hasScore = false;
    const data: Datum[] = buckets.map((r) => {
      const d: Datum = { date: r.date as string, full: fullLabel(r.date as string), label: shortLabel(r.date as string, range) };
      let wSum = 0, sSum = 0;
      for (const m of METRICS) {
        const raw = r[m.key] as number | null;
        if (raw == null) { d[`${m.key}_pos`] = null; d[`${m.key}_raw`] = null; continue; }
        d[`${m.key}_pos`] = posOf(raw, m);
        d[`${m.key}_raw`] = raw;
        if (m.scored) { const sc = scoreOf(raw, m); wSum += m.weight!; sSum += m.weight! * sc; }
      }
      d.score_pct = wSum > 0 ? Math.round((sSum / wSum) * 10) / 10 : null;
      if (d.score_pct != null) hasScore = true;
      return d;
    });

    return { data, activeMetrics, hasScore };
  }, [sleep, bodyMetrics, cfg, range]);

  // Last night's per-metric score + value, and the aggregate, for the rings.
  const latest = useMemo(() => {
    const lastSleep = sleep.length ? [...sleep].sort((a, b) => b.date.localeCompare(a.date))[0] : null;
    const lastBody = bodyMetrics.length ? [...bodyMetrics].sort((a, b) => b.date.localeCompare(a.date))[0] : null;
    const byKey: Record<string, { pct: number | null; value: string }> = {};
    let wSum = 0, sSum = 0;
    for (const m of METRICS) {
      const src = m.source === "sleep" ? lastSleep : lastBody;
      const raw = src ? (src as unknown as Record<string, unknown>)[m.field as string] : null;
      if (typeof raw === "number") {
        const sc = m.scored ? scoreOf(raw, m) : null;
        byKey[m.key] = { pct: sc, value: m.fmt(raw) };
        if (m.scored && sc != null) { wSum += m.weight!; sSum += m.weight! * sc; }
      } else {
        byKey[m.key] = { pct: null, value: "—" };
      }
    }
    const quality = wSum > 0 ? Math.round((sSum / wSum) * 10) / 10 : null;
    return { byKey, quality, lastSleep };
  }, [sleep, bodyMetrics]);

  const tickInterval = range === "week" ? 0 : range === "3m" ? Math.max(0, Math.floor(data.length / 8)) : Math.max(0, Math.floor(data.length / 10));

  const ls = latest.lastSleep;
  const qualitySub = ls ? `${ls.quality_score.toFixed(1)}/10` : "—";
  // Non-scored extras from last night, folded in as a small footer.
  const extras = ls
    ? [
        ls.awake_time_min != null ? `Awake ${formatMinutes(ls.awake_time_min)}` : null,
        ls.respiratory_rate != null ? `Resp ${ls.respiratory_rate.toFixed(1)}/min` : null,
        ls.temperature_deviation != null ? `Temp ${ls.temperature_deviation > 0 ? "+" : ""}${ls.temperature_deviation.toFixed(2)}°` : null,
      ].filter(Boolean)
    : [];

  const stageRing = (key: "deep" | "rem" | "light") => (
    <RingStat key={key} label={METRIC[key].label} value={latest.byKey[key]?.value ?? "—"} pct={latest.byKey[key]?.pct ?? null} color={METRIC[key].color} />
  );

  // The ring column shown to the right of the chart (wide) or below it (compact).
  const columnRings = (
    <>
      <RingStat label="Quality" value={qualitySub} pct={latest.quality} color={SCORE.color} hero />
      <RingStat label="Duration" value={latest.byKey.total?.value ?? "—"} pct={latest.byKey.total?.pct ?? null} color={METRIC.total.color} />
      {!compact && stageRing("deep")}
      {!compact && stageRing("rem")}
      {!compact && stageRing("light")}
    </>
  );

  const chart = data.length === 0 ? (
    <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)", fontSize: 13 }}>
      No sleep data in this range yet.
    </div>
  ) : (
    <ResponsiveContainer width="100%" height={compact ? 300 : 360}>
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
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} interval={tickInterval} minTickGap={16} />
        <YAxis domain={[0, 105]} ticks={[0, 50, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={44} />
        <ReferenceLine y={100} stroke="var(--text-muted)" strokeDasharray="4 4" strokeOpacity={0.5} />
        <Tooltip content={<SleepTooltip />} />
        {METRICS.map((m) => (
          <Line key={m.key} type="monotone" dataKey={`${m.key}_pos`} stroke={m.color} strokeWidth={m.width} dot={false} activeDot={{ r: 3, fill: m.color }} connectNulls isAnimationActive={false} />
        ))}
        <Area type="monotone" dataKey="score_pct" stroke={SCORE.color} strokeWidth={SCORE.width} fill="url(#sleepScoreFill)" filter="url(#sleepGlow)" connectNulls dot={false} activeDot={{ r: 4, fill: SCORE.color }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );

  return (
    <div ref={cardRef} style={{ ...CARD_STYLE, padding: "20px 20px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Moon size={15} color="var(--accent)" />
            <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Sleep</span>
          </div>
          {/* When space is tight, Deep/REM/Light ride up here beside the title. */}
          {compact && (
            <div style={{ display: "flex", gap: 12 }}>
              {(["deep", "rem", "light"] as const).map((k) => (
                <RingMini key={k} label={METRIC[k].label} pct={latest.byKey[k]?.pct ?? null} color={METRIC[k].color} />
              ))}
            </div>
          )}
        </div>
        {/* Legend */}
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

      {compact ? (
        <>
          {chart}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 24px", justifyContent: "center", marginTop: 12 }}>
            {columnRings}
          </div>
          {extras.length > 0 && (
            <div style={{ textAlign: "center", fontSize: 11, color: "var(--text-muted)", marginTop: 10 }}>{extras.join(" · ")}</div>
          )}
        </>
      ) : (
        <div style={{ display: "flex", gap: 20, alignItems: "stretch" }}>
          <div style={{ flex: 1, minWidth: 0 }}>{chart}</div>
          <div style={{ width: 188, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12, maxHeight: 360, overflowY: "auto", paddingRight: 2 }}>
            {columnRings}
            {extras.length > 0 && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5, marginTop: 2 }}>{extras.join(" · ")}</div>
            )}
          </div>
        </div>
      )}

      {/* Range toggle */}
      <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 12 }}>
        {RANGES.map((r) => {
          const on = r.id === range;
          return (
            <button key={r.id} onClick={() => setRange(r.id)} style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", borderRadius: "var(--radius-sm)", border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "var(--accent-tint)" : "transparent", color: on ? "var(--accent)" : "var(--text-muted)" }}>
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── ring gauges ──────────────────────────────────────────────────────────────

function Ring({ pct, color, size, stroke = 5 }: { pct: number | null; color: string; size: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct ?? 0));
  const off = c * (1 - p / 100);
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={size * 0.3} fontWeight={700} fill="var(--text)">
        {pct != null ? `${Math.round(pct)}` : "—"}
      </text>
    </svg>
  );
}

/** Ring + label + value, laid out as a row (the right-column item). */
function RingStat({ label, value, pct, color, hero }: { label: string; value: string; pct: number | null; color: string; hero?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Ring pct={pct} color={color} size={hero ? 52 : 44} stroke={hero ? 6 : 5} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: hero ? 700 : 600, color: "var(--text)", whiteSpace: "nowrap" }}>{label}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{value}</div>
      </div>
    </div>
  );
}

/** Compact ring with the label underneath, for the header reflow. */
function RingMini({ label, pct, color }: { label: string; pct: number | null; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <Ring pct={pct} color={color} size={36} stroke={4} />
      <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}

// ── data helpers ─────────────────────────────────────────────────────────────

function setGet(map: Map<string, { sleep?: SleepEntry; body?: BodyMetric }>, key: string) {
  const v: { sleep?: SleepEntry; body?: BodyMetric } = {};
  map.set(key, v);
  return v;
}

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
          const pct = m.scored ? d[`${m.key}_pos`] : null;
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
