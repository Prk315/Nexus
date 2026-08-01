import { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer } from "recharts";

/**
 * A single ring gauge for "value vs goal". Same visual language as the
 * dashboard's DomainRing, but parametrized (size, goal-relative fill,
 * fallback to a plain value display when no goal is set).
 */
export default function RingGauge({
  label, value, goal, unit, color, track, size = 56,
}: {
  label: string;
  value: number;
  goal: number | null;
  unit: string;
  color: string;
  track: string;
  size?: number;
}) {
  const pct = goal ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  const barSize = Math.max(3, Math.round(size / 11));

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: size + 16 }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={[{ value: goal ? pct : 0 }]}
            innerRadius="72%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            barSize={barSize}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
            <RadialBar dataKey="value" cornerRadius={barSize / 2} fill={color} background={{ fill: track }} isAnimationActive={false} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div
          style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 700, color: "var(--text)",
          }}
        >
          {Math.round(value)}
        </div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>{label}</div>
        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
          {goal ? `${Math.round(pct)}% of ${Math.round(goal)}${unit}` : `${unit}`}
        </div>
      </div>
    </div>
  );
}
