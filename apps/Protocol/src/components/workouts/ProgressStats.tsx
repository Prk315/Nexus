import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
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
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>{title}</div>
      <ResponsiveContainer width="100%" height={height}>{children}</ResponsiveContainer>
    </div>
  );
}

/**
 * Reusable activity progress card. Left: two stacked charts (cumulative goal
 * progress, recurring output vs target). Right: a grid of small baseline gauges +
 * a big overall gauge, then a biomarker trend. A time-range toggle up top drives
 * the whole card. Presentational — feed it data from buildRunningStats /
 * buildStrengthStats.
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
  return (
    <div style={{ ...CARD_STYLE, padding: "18px 20px", flex: "1 1 460px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header + range toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{title}</span>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {TIME_RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => onRange(r.id)}
              style={{
                padding: "3px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer",
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
        <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "40px 0" }}>
          No {title.toLowerCase()} in this range yet.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          {/* Left: two stacked charts */}
          <div style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
            <ChartFrame title={data.goal.label} height={120}>
              <AreaChart data={data.goal.data} margin={{ top: 4, right: 6, bottom: 0, left: -18 }}>
                <defs>
                  <linearGradient id={`grad-${title}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} width={34} />
                <Tooltip contentStyle={TOOLTIP} />
                <Line type="monotone" dataKey="goal" name="Goal" stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="value" name={data.goal.unit || "Progress"} stroke={color} strokeWidth={2} fill={`url(#grad-${title})`} isAnimationActive={false} />
              </AreaChart>
            </ChartFrame>

            <ChartFrame title={data.output.label} height={110}>
              <BarChart data={data.output.data} margin={{ top: 4, right: 6, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={16} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} width={34} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "var(--progress-bg)" }} />
                <ReferenceLine y={data.output.target} stroke={color} strokeDasharray="4 4" strokeWidth={1.5} />
                <Bar dataKey="value" name={data.output.unit || "Output"} fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ChartFrame>
          </div>

          {/* Right: gauges + biomarker trend */}
          <div style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))", gap: 10, flex: "1 1 160px" }}>
                {data.metrics.map((m) => (
                  <RadialGauge key={m.name} pct={m.pct} size={58} thickness={5} color={color} label={m.name} />
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <RadialGauge pct={data.overallPct} size={116} thickness={10} color={color} />
                <span style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center", maxWidth: 130 }}>{data.overallLabel}</span>
              </div>
            </div>

            {data.biomarkers.data.length > 0 && (
              <ChartFrame title={data.biomarkers.label} height={110}>
                <LineChart data={data.biomarkers.data} margin={{ top: 4, right: 6, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} width={34} />
                  <Tooltip contentStyle={TOOLTIP} />
                  {data.biomarkers.series.map((s) => (
                    <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  ))}
                </LineChart>
              </ChartFrame>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
