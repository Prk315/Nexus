/**
 * Compact value donut used for the weight and total-body-water read-outs in a
 * body-composition report. The ring is a single-value gauge: `pct` of the
 * circumference is filled with `color`, the rest is the track. Big value +
 * unit + optional range caption sit stacked in the middle. Presentational.
 */

export default function DonutRing({
  value, unit, caption, pct, color, size = 116,
}: {
  value: string;
  unit?: string;
  caption?: string;
  /** 0-100 fill fraction. */
  pct: number;
  color: string;
  size?: number;
}) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, pct)) / 100;

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--progress-bg)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * filled} ${c}`}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1 }}>
        <span style={{ fontSize: 19, fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>{value}</span>
        {unit && <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)" }}>{unit}</span>}
        {caption && <span style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>{caption}</span>}
      </div>
    </div>
  );
}
