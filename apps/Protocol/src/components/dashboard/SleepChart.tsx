import { useMemo, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Moon } from "lucide-react";
import { CARD_STYLE, isoDate } from "../../lib/uiHelpers";
import type { SleepEntry, BodyMetric } from "../../store/types";

/**
 * Sleep trend chart — one line per metric (total, REM, deep, light, HRV, resting
 * HR), each NORMALISED to its own max over the visible window so their shapes sit
 * on one 0-100% axis and can be compared at a glance. The tooltip shows the real
 * numbers. Range switches between a week (default), 3 months and a year.
 *
 * Total is the hero: a thick light-blue line with a downward blue glow. The sleep
 * stages are mid-weight and colour-coded (REM green, deep purple, light indigo);
 * the vitals are thin and run warm (HRV orange → resting HR red).
 */

type Range = "week" | "3m" | "year";
const RANGES: { id: Range; label: string; days: number; bucketDays: number }[] = [
  { id: "week", label: "Week", days: 7, bucketDays: 1 },
  { id: "3m", label: "3 Months", days: 92, bucketDays: 1 },
  { id: "year", label: "Year", days: 365, bucketDays: 7 },
];

const minToH = (m: number) => `${(m / 60).toFixed(1)} h`;

interface Series {
  key: string;
  label: string;
  color: string;
  width: number;
  hero?: boolean;
  source: "sleep" | "body";
  field: keyof SleepEntry | keyof BodyMetric;
  fmt: (v: number) => string;
}

const SERIES: Series[] = [
  { key: "total", label: "Total sleep", color: "#38bdf8", width: 4, hero: true, source: "sleep", field: "duration_min", fmt: minToH },
  { key: "rem", label: "REM", color: "#22c55e", width: 2.5, source: "sleep", field: "rem_sleep_min", fmt: minToH },
  { key: "deep", label: "Deep", color: "#8b5cf6", width: 2.5, source: "sleep", field: "deep_sleep_min", fmt: minToH },
  { key: "light", label: "Light", color: "#6366f1", width: 1.75, source: "sleep", field: "light_sleep_min", fmt: minToH },
  { key: "hrv", label: "HRV", color: "#f59e0b", width: 1.25, source: "body", field: "hrv_ms", fmt: (v) => `${Math.round(v)} ms` },
  { key: "hr", label: "Resting HR", color: "#ef4444", width: 1.25, source: "body", field: "resting_hr_bpm", fmt: (v) => `${Math.round(v)} bpm` },
];

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

  const { data, activeSeries } = useMemo(() => {
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
    // Raw value per series per date.
    const rawRows: RawRow[] = dates.map((date) => {
      const rec = byDate.get(date)!;
      const row: RawRow = { date };
      for (const s of SERIES) {
        const src = s.source === "sleep" ? rec.sleep : rec.body;
        const v = src ? (src as unknown as Record<string, unknown>)[s.field as string] : null;
        row[s.key] = typeof v === "number" ? v : null;
      }
      return row;
    });

    // Bucket (year → weekly averages) to keep long ranges legible.
    const buckets = cfg.bucketDays > 1 ? bucketRows(rawRows, cfg.bucketDays) : rawRows;

    // Which series actually have data in this window.
    const activeSeries = SERIES.filter((s) => buckets.some((r) => r[s.key] != null));

    // Normalise each series to its own max → percentage. Keep raw for the tooltip.
    const maxes: Record<string, number> = {};
    for (const s of SERIES) {
      maxes[s.key] = Math.max(1, ...buckets.map((r) => (r[s.key] as number | null) ?? 0));
    }

    const data: Datum[] = buckets.map((r) => {
      const d: Datum = { date: r.date as string, full: fullLabel(r.date as string), label: shortLabel(r.date as string, range) };
      for (const s of SERIES) {
        const raw = r[s.key] as number | null;
        d[`${s.key}_pct`] = raw == null ? null : Math.round((raw / maxes[s.key]) * 1000) / 10;
        d[`${s.key}_raw`] = raw;
      }
      return d;
    });

    return { data, activeSeries };
  }, [sleep, bodyMetrics, cfg, range]);

  const tickInterval = range === "week" ? 0 : range === "3m" ? Math.max(0, Math.floor(data.length / 8)) : Math.max(0, Math.floor(data.length / 10));

  return (
    <div style={{ ...CARD_STYLE, padding: "20px 20px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Moon size={15} color="var(--accent)" />
          <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Sleep</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· normalised — hover for real values</span>
        </div>
        {/* Legend */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {activeSeries.map((s) => (
            <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
              <span style={{ width: 14, height: s.hero ? 4 : 2, borderRadius: 2, background: s.color, boxShadow: s.hero ? `0 0 6px ${s.color}` : "none" }} />
              {s.label}
            </span>
          ))}
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
              <linearGradient id="sleepTotalFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
              </linearGradient>
              <filter id="sleepGlow" x="-20%" y="-30%" width="140%" height="160%">
                <feDropShadow dx="0" dy="5" stdDeviation="6" floodColor="#38bdf8" floodOpacity="0.55" />
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
            <Tooltip content={<SleepTooltip />} />

            {/* Hero: total sleep as a glowing light-blue area. */}
            <Area
              type="monotone"
              dataKey="total_pct"
              stroke="#38bdf8"
              strokeWidth={4}
              fill="url(#sleepTotalFill)"
              filter="url(#sleepGlow)"
              connectNulls
              dot={false}
              activeDot={{ r: 4, fill: "#38bdf8" }}
              isAnimationActive={false}
            />

            {SERIES.filter((s) => !s.hero).map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={`${s.key}_pct`}
                stroke={s.color}
                strokeWidth={s.width}
                dot={false}
                activeDot={{ r: 3, fill: s.color }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
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
    for (const s of SERIES) {
      const vals = slice.map((r) => r[s.key]).filter((v): v is number => typeof v === "number");
      agg[s.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
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
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 10px", fontSize: 12, color: "var(--text)" }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{d.full}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {SERIES.map((s) => {
          const raw = d[`${s.key}_raw`];
          if (raw == null || typeof raw !== "number") return null;
          const pct = d[`${s.key}_pct`];
          return (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color }} />
                {s.label}
              </span>
              <span style={{ fontWeight: 600 }}>
                {s.fmt(raw)}
                {typeof pct === "number" && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {pct}%</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
