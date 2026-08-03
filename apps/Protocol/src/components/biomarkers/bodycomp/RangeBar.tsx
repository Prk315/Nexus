/**
 * Signature "range meter" from a bio-impedance body-composition report:
 * a horizontal track split into below-standard / standard / above-standard
 * zones with a marker dot at the measured value. The standard band's low/high
 * boundaries are printed above the track and the measured value to the right.
 *
 * Purely presentational — the caller supplies the numbers. Zones are laid out
 * over an [absMin, absMax] extent; when the caller omits those, the extent is
 * derived from the standard band with padding so the marker always sits inside.
 */

export interface RangeStat {
  label: string;
  /** Measured value. */
  value: number;
  /** Standard band, inclusive. */
  low: number;
  high: number;
  /** Bar extent. Defaults to a padded span around [low, high, value]. */
  absMin?: number;
  absMax?: number;
  unit?: string;
}

type Status = "low" | "standard" | "high";

function statusOf(s: RangeStat): Status {
  if (s.value < s.low) return "low";
  if (s.value > s.high) return "high";
  return "standard";
}

const STATUS_COLOR: Record<Status, string> = {
  low: "var(--warning)",
  standard: "var(--series-workout)",
  high: "var(--danger)",
};

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export default function RangeBar({ stat }: { stat: RangeStat }) {
  const span = stat.high - stat.low || 1;
  const absMin = stat.absMin ?? Math.min(stat.low - span * 0.6, stat.value - span * 0.3);
  const absMax = stat.absMax ?? Math.max(stat.high + span * 0.6, stat.value + span * 0.3);
  const extent = absMax - absMin || 1;

  const pct = (n: number) => clampPct(((n - absMin) / extent) * 100);
  const lowPct = pct(stat.low);
  const highPct = pct(stat.high);
  const valuePct = pct(stat.value);
  const status = statusOf(stat);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 56px", alignItems: "center", gap: 14 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>{stat.label}</span>

      <div style={{ position: "relative", paddingTop: 16, paddingBottom: 4 }}>
        {/* boundary labels */}
        <span style={{ position: "absolute", top: 0, left: `${lowPct}%`, transform: "translateX(-50%)", fontSize: 10, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
          {stat.low}
        </span>
        <span style={{ position: "absolute", top: 0, left: `${highPct}%`, transform: "translateX(-50%)", fontSize: 10, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
          {stat.high}
        </span>

        {/* track: below-standard | standard | above-standard */}
        <div style={{ position: "relative", height: 6, borderRadius: 3, overflow: "hidden", background: "var(--progress-bg)", display: "flex" }}>
          <div style={{ width: `${lowPct}%`, background: "var(--warning)", opacity: 0.55 }} />
          <div style={{ width: `${highPct - lowPct}%`, background: "var(--series-workout)" }} />
          <div style={{ width: `${100 - highPct}%`, background: "var(--danger)", opacity: 0.55 }} />
        </div>

        {/* marker dot */}
        <div
          style={{
            position: "absolute",
            top: 13,
            left: `${valuePct}%`,
            transform: "translateX(-50%)",
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: STATUS_COLOR[status],
            border: "2px solid var(--surface)",
            boxShadow: "var(--shadow)",
          }}
        />
      </div>

      <span style={{ fontSize: 13, fontWeight: 700, color: STATUS_COLOR[status], textAlign: "right" }}>
        {stat.value}
        {stat.unit ? <span style={{ fontSize: 10, fontWeight: 500, color: "var(--text-muted)" }}> {stat.unit}</span> : null}
      </span>
    </div>
  );
}
