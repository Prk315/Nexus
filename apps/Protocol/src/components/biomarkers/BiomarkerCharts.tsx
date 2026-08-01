import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export { StatTile } from "../shared/StatTile";

const TOOLTIP_STYLE = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  boxShadow: "var(--shadow-md)",
  fontSize: 12,
  color: "var(--text)",
};

// ── Single-series trend chart ───────────────────────────────────────────────

export interface TrendPoint {
  date: string;
  value: number | null;
}

export function TrendChart({
  data, color, gradientId, height = 140, domain, valueSuffix = "",
}: {
  data: TrendPoint[];
  color: string;
  gradientId: string;
  height?: number;
  domain?: [number | "auto", number | "auto"];
  valueSuffix?: string;
}) {
  const hasData = data.some((d) => d.value != null);
  if (!hasData) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>
        No data yet
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border-subtle)" strokeWidth={1} vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
        <YAxis
          domain={domain ?? ["auto", "auto"]}
          tick={{ fontSize: 10, fill: "var(--text-muted)" }}
          axisLine={false}
          tickLine={false}
          width={30}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value: number) => [`${value}${valueSuffix}`, ""]}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          connectNulls
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Stacked macro bar chart (protein/carbs/fat are true parts of a gram total) ─

export interface MacroPoint {
  date: string;
  protein: number;
  carbs: number;
  fat: number;
}

const MACRO_COLORS = {
  protein: "var(--macro-protein)",
  carbs: "var(--macro-carbs)",
  fat: "var(--macro-fat)",
};

export function MacroBarChart({ data, height = 140 }: { data: MacroPoint[]; height?: number }) {
  const hasData = data.some((d) => d.protein + d.carbs + d.fat > 0);
  if (!hasData) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>
        No data yet
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -28 }} barCategoryGap="30%">
        <CartesianGrid stroke="var(--border-subtle)" strokeWidth={1} vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={30} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value: number, name: string) => [`${value}g`, name.charAt(0).toUpperCase() + name.slice(1)]}
        />
        <Bar dataKey="protein" stackId="macro" name="protein" fill={MACRO_COLORS.protein} />
        <Bar dataKey="carbs"   stackId="macro" name="carbs"   fill={MACRO_COLORS.carbs} />
        <Bar dataKey="fat"     stackId="macro" name="fat"     fill={MACRO_COLORS.fat} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Legend swatch row ────────────────────────────────────────────────────────

export function LegendRow({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
      {items.map(({ label, color }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
          {label}
        </div>
      ))}
    </div>
  );
}
