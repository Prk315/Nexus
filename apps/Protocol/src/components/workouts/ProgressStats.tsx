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

const sectionLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 };

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
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {hero && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--text)" }}>
          <span style={{ width: 14, height: 5, borderRadius: 2, background: hero.color, boxShadow: `0 0 6px ${hero.color}` }} />{hero.name}
        </span>
      )}
      {items.map((s) => (
        <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
          <span style={{ width: 12, height: 3, borderRadius: 2, background: s.color }} />{s.name}
        </span>
      ))}
    </div>
  );
}

/**
 * Reusable activity progress card, two columns:
 * - Left: the lead-vs-lag pair, stacked — a glowing "progress score" hero (LAG,
 *   the outcome) on top, "progress toward goal" (LEAD, the input) underneath.
 * - Right: biomarkers & proxies — the gauges (big overall + baseline circles) on
 *   top, with the multi-line biomarker chart underneath.
 * A gear opens CRUD over what's tracked; a W/M/3M/Y/All toggle drives it all.
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
    <div style={{ ...CARD_STYLE, padding: "22px 26px", flex: "1 1 520px", minWidth: 0, minHeight: 520, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
          <span style={{ fontWeight: 700, fontSize: 18, color: "var(--text)" }}>{title}</span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 3 }}>
            {TIME_RANGES.map((r) => (
              <button key={r.id} onClick={() => onRange(r.id)} style={{ padding: "5px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer", borderRadius: "var(--radius-sm)", border: "none", background: range === r.id ? color : "transparent", color: range === r.id ? "#fff" : "var(--text-muted)" }}>
                {r.label}
              </button>
            ))}
          </div>
          <button onClick={() => setEditing((v) => !v)} title="Configure tracking" style={{ display: "flex", padding: 6, cursor: "pointer", borderRadius: "var(--radius-sm)", border: `1px solid ${editing ? color : "var(--border)"}`, background: editing ? `${color}22` : "transparent", color: editing ? "var(--text)" : "var(--text-muted)" }}>
            <SlidersHorizontal size={15} />
          </button>
        </div>
      </div>

      {editing && <ProgressConfigEditor activity={activity} config={config} onChange={onConfigChange} />}

      {data.empty ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "var(--text-muted)" }}>
          No {title.toLowerCase()} in this range yet.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
          {/* LEFT — lead vs lag, stacked */}
          <div style={{ flex: "2 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
            {/* LAG — progress score */}
            <div>
              <div style={sectionLabel}>Lag · are you improving?</div>
              <Legend items={data.trend.series} hero={{ name: "Progress score", color }} />
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={data.trend.data} margin={{ top: 12, right: 10, bottom: 0, left: -22 }}>
                  <defs>
                    <linearGradient id={`hero-${gid}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                      <stop offset="60%" stopColor={color} stopOpacity={0.05} />
                      <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                    <filter id={`glow-${gid}`} x="-20%" y="-30%" width="140%" height="160%">
                      <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor={color} floodOpacity="0.55" />
                    </filter>
                  </defs>
                  <CartesianGrid strokeDasharray="2 7" stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={26} />
                  <YAxis domain={[0, 105]} tick={false} axisLine={false} tickLine={false} width={0} />
                  <ReferenceLine y={100} stroke="var(--text-muted)" strokeDasharray="4 4" strokeOpacity={0.4} />
                  <Tooltip content={<HeroTip />} />
                  {data.trend.series.map((s) => (
                    <Line key={s.key} type="monotone" dataKey={`${s.key}_pos`} name={s.name} stroke={s.color} strokeWidth={1.75} strokeOpacity={0.85} dot={false} activeDot={{ r: 3, fill: s.color }} connectNulls isAnimationActive={false} />
                  ))}
                  <Area type="monotone" dataKey="score" name="Progress score" stroke={color} strokeWidth={4.5} fill={`url(#hero-${gid})`} filter={`url(#glow-${gid})`} dot={false} activeDot={{ r: 4, fill: color }} connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* LEAD — progress toward goal */}
            <div>
              <div style={sectionLabel}>Lead · {data.goal.label}</div>
              <ResponsiveContainer width="100%" height={190}>
                <ComposedChart data={data.goal.data} margin={{ top: 8, right: 10, bottom: 0, left: -22 }}>
                  <defs>
                    <linearGradient id={`goal-${gid}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 7" stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={26} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} width={30} />
                  <Tooltip contentStyle={TOOLTIP} />
                  <Line type="monotone" dataKey="goal" name="Goal" stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                  <Area type="monotone" dataKey="value" name={data.goal.unit} stroke={color} strokeWidth={2.5} fill={`url(#goal-${gid})`} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* RIGHT — biomarkers & proxies: gauges on top, biomarker chart underneath */}
          <div style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <RadialGauge pct={data.overallPct} size={140} thickness={12} color={color} />
              <span style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginTop: -4 }}>{data.overallLabel}</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(62px, 1fr))", gap: 12, width: "100%" }}>
                {data.metrics.map((m) => (
                  <RadialGauge key={m.name} pct={m.pct} size={60} thickness={5} color={color} label={m.name} />
                ))}
              </div>
            </div>

            {data.biomarkers.data.length > 0 && (
              <div>
                <div style={sectionLabel}>Biomarkers &amp; proxies</div>
                <Legend items={data.biomarkers.series} />
                <ResponsiveContainer width="100%" height={180}>
                  <ComposedChart data={data.biomarkers.data} margin={{ top: 8, right: 8, bottom: 0, left: -30 }}>
                    <CartesianGrid strokeDasharray="2 7" stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
                    <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={26} />
                    <YAxis domain={[0, 100]} tick={false} axisLine={false} tickLine={false} width={0} />
                    <Tooltip content={<BioTip />} />
                    {data.biomarkers.series.map((s) => (
                      <Line key={s.key} type="monotone" dataKey={`${s.key}_pos`} name={s.name} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 3, fill: s.color }} connectNulls isAnimationActive={false} />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
