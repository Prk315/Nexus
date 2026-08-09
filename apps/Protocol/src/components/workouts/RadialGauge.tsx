const GREEN = "#22c55e";

/**
 * Radial gauge where 100% is a full ring (the baseline). Progress below 100 fills
 * the ring in `color`; progress above 100 draws a green overflow arc on an outer
 * ring and turns the centre % green — the "overflowing with improvement" look.
 */
export default function RadialGauge({
  pct,
  size = 64,
  thickness = 6,
  color = "var(--accent)",
  label,
}: {
  pct: number;
  size?: number;
  thickness?: number;
  color?: string;
  label?: string;
}) {
  const overflowPad = 4;
  const r = (size - thickness) / 2 - overflowPad;
  const cx = size / 2;
  const c = 2 * Math.PI * r;
  const main = Math.max(0, Math.min(pct, 100));
  const over = Math.max(0, Math.min(pct - 100, 100));
  const rOuter = r + overflowPad;
  const cOuter = 2 * Math.PI * rOuter;
  const improved = pct > 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: size }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size}>
          {/* base track */}
          <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--progress-bg)" strokeWidth={thickness} />
          {/* main arc (up to 100%) */}
          <circle
            cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round"
            strokeDasharray={`${(main / 100) * c} ${c}`}
            transform={`rotate(-90 ${cx} ${cx})`}
          />
          {/* green overflow ring (above 100%) */}
          {over > 0 && (
            <circle
              cx={cx} cy={cx} r={rOuter} fill="none" stroke={GREEN} strokeWidth={2.5} strokeLinecap="round"
              strokeDasharray={`${(over / 100) * cOuter} ${cOuter}`}
              transform={`rotate(-90 ${cx} ${cx})`}
            />
          )}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: size < 72 ? 12 : 18, fontWeight: 700, color: improved ? GREEN : "var(--text)" }}>
            {Math.round(pct)}%
          </span>
        </div>
      </div>
      {label && (
        <span style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.2, maxWidth: size + 16 }}>
          {label}
        </span>
      )}
    </div>
  );
}
