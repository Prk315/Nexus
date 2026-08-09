import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { CARD_STYLE } from "../../lib/uiHelpers";
import { TIME_RANGES, type TimeRange, type ProgressData } from "../../lib/progressStats";
import RadialGauge from "./RadialGauge";

const TOOLTIP = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 12 };
const AXIS = { fontSize: 10, fill: "var(--text-muted)" } as const;

function ChartFrame({ title, height, children }: { title: string; height: number; children: React.ReactElement }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>{title}</div>
      <ResponsiveContainer width="100%" height={height}>{children}</ResponsiveContainer>
    </div>
  );
}

/** Tooltip for the biomarker chart — shows each series' RAW value (not the 0–100
 *  normalised axis position the lines are drawn on). */
function bioTooltip(series: ProgressData["biomarkers"]["series"]) {
  return function BioTip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Record<string, number | string | null> }> }) {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0].payload;
    return (
      <div style={{ ...TOOLTIP, padding: "8px 10px", color: "var(--text)" }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{String(row.full ?? row.label ?? "")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {series.map((s) => {
            const raw = row[`${s.key}_raw`];
            if (raw == null || typeof raw !== "number") return null;
            return (
              <div key={s.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color }} />
                  {s.name}
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

/**
 * Reusable activity progress card. Top: two goal charts (cumulative vs goal;
 * recurring output vs target) beside a grid of baseline gauges + a big overall
 * gauge. Bottom: a full-width multi-line biomarker chart (normalised onto a shared
 * axis, like the sleep chart). A W/M/3M/Y/All toggle drives the whole card.
 */
export default function ProgressStats({
  title, color, range, onRange, data,
}: {
  title: string;
  color: string;
  range: TimeRange;
  onRange: (r: TimeRange) => void;
  data: ProgressData;
}) {
  const BioTip = bioTooltip(data.biomarkers.series);

  return (
    <div style={{ ...CARD_STYLE, padding: "22px 26px", flex: "1 1 520px", minWidth: 0, minHeight: 560, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header + range toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
          <span style={{ fontWeight: 700, fontSize: 18, color: "var(--text)" }}>{title}</span>
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          {TIME_RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => onRange(r.id)}
              style={{
                padding: "5px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                borderRadius: "var(--radius-sm)", border: "none",
                background: range === r.id ? color : "transparent",
                color: range === r.id ? "#fff" : "var(--text-muted)",
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {data.empty ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "var(--text-muted)" }}>
          No {title.toLowerCase()} in this range yet.
        </div>
      ) : (
        <>
          {/* Top: goal + output charts (left) · gauges (right) */}
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
            <div style={{ flex: "2 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
              <ChartFrame title={data.goal.label} height={150}>
                <AreaChart data={data.goal.data} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
                  <defs>
                    <linearGradient id={`grad-${title}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 7" stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={28} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} width={34} />
                  <Tooltip contentStyle={TOOLTIP} />
                  <Line type="monotone" dataKey="goal" name="Goal" stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                  <Area type="monotone" dataKey="value" name={data.goal.unit || "Progress"} stroke={color} strokeWidth={2.5} fill={`url(#grad-${title})`} isAnimationActive={false} />
                </AreaChart>
              </ChartFrame>

              <ChartFrame title={data.output.label} height={130}>
                <BarChart data={data.output.data} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
                  <CartesianGrid strokeDasharray="2 7" stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={18} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} width={34} />
                  <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "var(--progress-bg)" }} />
                  <ReferenceLine y={data.output.target} stroke={color} strokeDasharray="4 4" strokeWidth={1.5} />
                  <Bar dataKey="value" name={data.output.unit || "Output"} fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ChartFrame>
            </div>

            {/* Gauges: big overall + small baseline circles */}
            <div style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
              <RadialGauge pct={data.overallPct} size={150} thickness={12} color={color} />
              <span style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginTop: -6 }}>{data.overallLabel}</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(66px, 1fr))", gap: 12, width: "100%", marginTop: 4 }}>
                {data.metrics.map((m) => (
                  <RadialGauge key={m.name} pct={m.pct} size={64} thickness={5} color={color} label={m.name} />
                ))}
              </div>
            </div>
          </div>

          {/* Bottom: full-width multi-line biomarker chart */}
          {data.biomarkers.data.length > 0 && (
            <div style={{ marginTop: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{data.biomarkers.label}</span>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {data.biomarkers.series.map((s) => (
                    <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
                      <span style={{ width: 12, height: 3, borderRadius: 2, background: s.color }} />
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={data.biomarkers.data} margin={{ top: 6, right: 10, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="2 7" stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={28} />
                  <YAxis domain={[0, 100]} tick={false} axisLine={false} tickLine={false} width={0} />
                  <Tooltip content={<BioTip />} />
                  {data.biomarkers.series.map((s) => (
                    <Line key={s.key} type="monotone" dataKey={`${s.key}_pos`} name={s.name} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 3, fill: s.color }} connectNulls isAnimationActive={false} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}
