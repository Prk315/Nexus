import { useState } from "react";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { SlidersHorizontal } from "lucide-react";
import { CARD_STYLE } from "../../lib/uiHelpers";
import { TIME_RANGES, type TimeRange, type ProgressData } from "../../lib/progressStats";
import type { Activity, TrackingConfig } from "../../lib/trackingConfig";
import RadialGauge from "./RadialGauge";
import ProgressConfigEditor from "./ProgressConfigEditor";

const TOOLTIP = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 12 };
const AXIS = { fontSize: 10, fill: "var(--text-muted)" } as const;
const sectionLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 };

/** Tooltip showing each series' RAW value (lines are drawn on a 0–100 normalised axis). */
function rawTooltip(series: { key: string; name: string; color: string; unit: string }[], heroLabel?: string) {
  return function Tip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Record<string, number | string | null> }> }) {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0].payload;
    const score = row.score;
    return (
      <div style={{ ...TOOLTIP, padding: "8px 10px", color: "var(--text)" }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{String(row.full ?? row.label ?? "")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {heroLabel && typeof score === "number" && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontWeight: 700, paddingBottom: 4, marginBottom: 2, borderBottom: "1px solid var(--border)" }}>
              <span>{heroLabel}</span><span>{score}%</span>
            </div>
          )}
          {series.map((s) => {
            const raw = row[`${s.key}_raw`];
            if (raw == null || typeof raw !== "number") return null;
            return (
              <div key={s.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color }} />{s.name}
                </span>
                <span style={{ fontWeight: 600 }}>{Math.round(raw * 10) / 10}{s.unit ? ` ${s.unit}` : ""}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };
}

function Legend({ items, hero }: { items: { key: string; name: string; color: string }[]; hero?: { name: string; color: string } }) {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {hero && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 600, color: "var(--text)" }}>
          <span style={{ width: 12, height: 4, borderRadius: 2, background: hero.color, boxShadow: `0 0 6px ${hero.color}` }} />{hero.name}
        </span>
      )}
      {items.map((s) => (
        <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-muted)" }}>
          <span style={{ width: 10, height: 3, borderRadius: 2, background: s.color }} />{s.name}
        </span>
      ))}
    </div>
  );
}

/**
 * Compact activity progress card, two columns:
 * - Left: lead vs lag stacked — progress toward goal (LEAD) on top, the glowing
 *   progress-score hero (LAG) below. The per-metric detail lives in the gauges, so
 *   the hero draws only the score line (no duplicate component lines).
 * - Right: biomarkers & proxies — gauges (overall + baseline circles) overlaid
 *   across the top of the multi-line biomarker chart.
 */
export default function ProgressStats({
  title, color, activity, range, onRange, config, onConfigChange, data,
}: {
  title: string;
  color: string;
  activity: Activity;
  range: TimeRange;
  onRange: (r: TimeRange) => void;
  config: TrackingConfig;
  onConfigChange: (c: TrackingConfig) => void;
  data: ProgressData;
}) {
  const [editing, setEditing] = useState(false);
  const HeroTip = rawTooltip(data.trend.series, "Progress score");
  const BioTip = rawTooltip(data.biomarkers.series);
  const gid = title.replace(/\s/g, "");

  return (
    <div style={{ ...CARD_STYLE, padding: "14px 16px", flex: "1 1 460px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, boxShadow: `0 0 7px ${color}` }} />
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{title}</span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 3 }}>
            {TIME_RANGES.map((r) => (
              <button key={r.id} onClick={() => onRange(r.id)} style={{ padding: "4px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer", borderRadius: "var(--radius-sm)", border: "none", background: range === r.id ? color : "transparent", color: range === r.id ? "#fff" : "var(--text-muted)" }}>
                {r.label}
              </button>
            ))}
          </div>
          <button onClick={() => setEditing((v) => !v)} title="Configure tracking" style={{ display: "flex", padding: 5, cursor: "pointer", borderRadius: "var(--radius-sm)", border: `1px solid ${editing ? color : "var(--border)"}`, background: editing ? `${color}22` : "transparent", color: editing ? "var(--text)" : "var(--text-muted)" }}>
            <SlidersHorizontal size={14} />
          </button>
        </div>
      </div>

      {editing && <ProgressConfigEditor activity={activity} config={config} onChange={onConfigChange} />}

      {data.empty ? (
        <div style={{ minHeight: 220, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "var(--text-muted)" }}>
          No {title.toLowerCase()} in this range yet.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
          {/* LEFT — lead (top) + lag (bottom) */}
          <div style={{ flex: "1 1 250px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={sectionLabel}>Lead · toward goal ({data.goal.unit})</div>
              <ResponsiveContainer width="100%" height={140}>
                <ComposedChart data={data.goal.data} margin={{ top: 6, right: 8, bottom: 0, left: -24 }}>
                  <defs>
                    <linearGradient id={`goal-${gid}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 7" stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={28} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} width={28} />
                  <Tooltip contentStyle={TOOLTIP} />
                  <Line type="monotone" dataKey="goal" name="Goal" stroke="var(--text-muted)" strokeWidth={1.25} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                  <Area type="monotone" dataKey="value" name={data.goal.unit} stroke={color} strokeWidth={2} fill={`url(#goal-${gid})`} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 2, flexWrap: "wrap" }}>
                <span style={sectionLabel}>Lag · improving?</span>
                <Legend items={[]} hero={{ name: "Progress score", color }} />
              </div>
              <ResponsiveContainer width="100%" height={170}>
                <ComposedChart data={data.trend.data} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
                  <defs>
                    <linearGradient id={`hero-${gid}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                      <stop offset="60%" stopColor={color} stopOpacity={0.05} />
                      <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                    <filter id={`glow-${gid}`} x="-20%" y="-30%" width="140%" height="160%">
                      <feDropShadow dx="0" dy="2" stdDeviation="3.5" floodColor={color} floodOpacity="0.55" />
                    </filter>
                  </defs>
                  <CartesianGrid strokeDasharray="2 7" stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={28} />
                  <YAxis domain={[0, 105]} tick={false} axisLine={false} tickLine={false} width={0} />
                  <ReferenceLine y={100} stroke="var(--text-muted)" strokeDasharray="4 4" strokeOpacity={0.4} />
                  <Tooltip content={<HeroTip />} />
                  <Area type="monotone" dataKey="score" name="Progress score" stroke={color} strokeWidth={4} fill={`url(#hero-${gid})`} filter={`url(#glow-${gid})`} dot={false} activeDot={{ r: 4, fill: color }} connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* RIGHT — gauges in one row (circles · pie), biomarker chart below */}
          <div style={{ flex: "1 1 250px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {data.metrics.map((m) => (
                  <RadialGauge key={m.name} pct={m.pct} size={34} thickness={4} color={color} label={m.name} showText={false} />
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <RadialGauge pct={data.overallPct} size={54} thickness={5} color={color} showText={false} />
                <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: data.overallPct > 100 ? "#22c55e" : "var(--text)" }}>{Math.round(data.overallPct)}%</span>
                  <span style={{ fontSize: 9, color: "var(--text-muted)", maxWidth: 96 }}>{data.overallLabel}</span>
                </div>
              </div>
            </div>

            {data.biomarkers.data.length > 0 ? (
              <ResponsiveContainer width="100%" height={230}>
                <ComposedChart data={data.biomarkers.data} margin={{ top: 8, right: 8, bottom: 0, left: -30 }}>
                  <CartesianGrid strokeDasharray="2 7" stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={28} />
                  <YAxis domain={[0, 100]} tick={false} axisLine={false} tickLine={false} width={0} />
                  <Tooltip content={<BioTip />} />
                  {data.biomarkers.series.map((s) => (
                    <Line key={s.key} type="monotone" dataKey={`${s.key}_pos`} name={s.name} stroke={s.color} strokeWidth={1.75} dot={false} activeDot={{ r: 3, fill: s.color }} connectNulls isAnimationActive={false} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ minHeight: 180, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--text-muted)" }}>
                No biomarker data in this range.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
