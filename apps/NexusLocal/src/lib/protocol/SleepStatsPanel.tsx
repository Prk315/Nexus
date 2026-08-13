import type { SleepNight } from "./api";

/**
 * Last 14 nights as stacked stage bars (deep / REM / light) with the quality
 * score as a line over them. Raw SVG like `UsageCharts` — the app has no chart
 * library and two scales on one plot is exactly the case where hand-rolled
 * stays simpler than adopting one.
 */

const W = 320;
const H = 130;
const PAD_TOP = 12;
const PAD_BOTTOM = 18;

const DEEP = "#818cf8"; // indigo-400
const REM = "#60a5fa"; // blue-400
const LIGHT = "#475569"; // slate-600
const SCORE = "#f6c453";

export function SleepStatsPanel({ sleep }: { sleep: SleepNight[] }) {
  const nights = sleep.filter((n) => (n.duration_min ?? 0) > 0);

  const last = nights.length > 0 ? nights[nights.length - 1] : null;
  const avgDur =
    nights.length > 0 ? nights.reduce((a, n) => a + (n.duration_min ?? 0), 0) / nights.length : 0;

  const maxDur = Math.max(...nights.map((n) => n.duration_min ?? 0), 1);
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const slot = W / Math.max(nights.length, 1);
  const barW = Math.min(16, slot * 0.6);

  const scorePoints = nights
    .map((n, i) => {
      if (n.quality_score == null) return null;
      const x = i * slot + slot / 2;
      const y = PAD_TOP + plotH - (Math.max(0, Math.min(10, n.quality_score)) / 10) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter((p): p is string => p != null);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wide text-white/40">Sleep · last {nights.length} nights</h3>
        {last && (
          <span className="text-[11px] text-white/45">
            last{" "}
            <span className="font-semibold text-indigo-300">
              {last.quality_score != null ? last.quality_score.toFixed(1) : "—"}
            </span>{" "}
            · {formatMin(last.duration_min ?? 0)} · avg {formatMin(Math.round(avgDur))}
          </span>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        {nights.length === 0 ? (
          <p className="py-4 text-center text-xs text-white/30">No sleep data yet.</p>
        ) : (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
              {nights.map((n, i) => {
                const total = n.duration_min ?? 0;
                const deep = n.deep_sleep_min ?? 0;
                const rem = n.rem_sleep_min ?? 0;
                // Whatever the stages don't account for renders as "light" so
                // the bar height always equals the actual duration.
                const light = Math.max(0, total - deep - rem);
                const x = i * slot + (slot - barW) / 2;
                const hOf = (min: number) => (min / maxDur) * plotH;
                const yBase = PAD_TOP + plotH;
                let y = yBase;
                const segs: Array<[number, string]> = [
                  [light, LIGHT],
                  [rem, REM],
                  [deep, DEEP],
                ];
                return (
                  <g key={n.date}>
                    {segs.map(([min, color], j) => {
                      const h = hOf(min);
                      y -= h;
                      return (
                        <rect key={j} x={x} y={y} width={barW} height={h} fill={color} rx={j === 2 ? 2 : 0} />
                      );
                    })}
                    <text
                      x={i * slot + slot / 2}
                      y={H - 5}
                      fontSize="7"
                      fill="rgba(255,255,255,0.3)"
                      textAnchor="middle"
                    >
                      {n.date.slice(8)}
                    </text>
                  </g>
                );
              })}
              {scorePoints.length > 1 && (
                <polyline
                  points={scorePoints.join(" ")}
                  fill="none"
                  stroke={SCORE}
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity="0.9"
                />
              )}
              {scorePoints.map((p) => {
                const [x, y] = p.split(",").map(Number);
                return <circle key={p} cx={x} cy={y} r="1.8" fill={SCORE} />;
              })}
            </svg>
            <div className="mt-2 flex items-center gap-3 text-[10px] text-white/40">
              <Legend color={DEEP} label="Deep" />
              <Legend color={REM} label="REM" />
              <Legend color={LIGHT} label="Light" />
              <Legend color={SCORE} label="Score /10" line />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <span
        style={{ background: color }}
        className={line ? "h-0.5 w-3 rounded-full" : "h-2 w-2 rounded-sm"}
      />
      {label}
    </span>
  );
}

function formatMin(min: number): string {
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}
