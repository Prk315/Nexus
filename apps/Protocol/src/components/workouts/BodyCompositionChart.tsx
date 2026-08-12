import { useEffect, useState } from "react";
import { Scale } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { CARD_STYLE } from "../../lib/uiHelpers";
import { fetchBodyCompositionSeriesFromCloud, type BodyCompPoint } from "../../lib/api";

const TOOLTIP_STYLE = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  fontSize: 12,
  color: "var(--text)",
};

// Yellow = weight, red = fat, green = muscle. Percentages ride the same hue,
// dashed, on a second (right) axis since %-scale differs from kg.
const LINES: { key: keyof BodyCompPoint; name: string; axis: "kg" | "pct"; color: string; dashed?: boolean }[] = [
  { key: "weight_kg", name: "Weight (kg)", axis: "kg", color: "var(--warning)" },
  { key: "fat_mass_kg", name: "Fat mass (kg)", axis: "kg", color: "var(--danger)" },
  { key: "muscle_mass_kg", name: "Muscle mass (kg)", axis: "kg", color: "var(--success)" },
  { key: "fat_pct", name: "Fat %", axis: "pct", color: "var(--danger)", dashed: true },
  { key: "muscle_pct", name: "Muscle %", axis: "pct", color: "var(--success)", dashed: true },
];

/**
 * Body-composition progress over time — weight, fat mass/%, muscle mass/% from
 * the Vellafit scale. kg metrics on the left axis, % on the right. Estimated
 * scans (BIA gap-fills) are included; real scans are the norm.
 */
export default function BodyCompositionChart() {
  const [series, setSeries] = useState<BodyCompPoint[] | null>(null);

  useEffect(() => {
    fetchBodyCompositionSeriesFromCloud().then(setSeries).catch(() => setSeries([]));
  }, []);

  const data = (series ?? []).map((p) => ({ ...p, label: p.date.slice(5) }));

  return (
    <div style={{ ...CARD_STYLE, padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Scale size={16} color="var(--accent)" />
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>Body Composition</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· weight, fat &amp; muscle over time</span>
      </div>

      {series == null ? (
        <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
          Loading…
        </div>
      ) : data.length === 0 ? (
        <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
          No body scans yet — step on the Vellafit scale to start tracking.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="var(--border-subtle)" strokeWidth={1} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="kg" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={40}
              label={{ value: "kg", angle: -90, position: "insideLeft", fontSize: 10, fill: "var(--text-muted)" }} />
            <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={36}
              label={{ value: "%", angle: 90, position: "insideRight", fontSize: 10, fill: "var(--text-muted)" }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
            {LINES.map((l) => (
              <Line
                key={l.key}
                yAxisId={l.axis}
                type="monotone"
                dataKey={l.key}
                name={l.name}
                stroke={l.color}
                strokeWidth={2}
                strokeDasharray={l.dashed ? "5 4" : undefined}
                dot={{ r: 2 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
