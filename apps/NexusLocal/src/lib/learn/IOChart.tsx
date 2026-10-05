/**
 * Input/output-grafen øverst i Overblik. To små linjediagrammer over samme
 * tidsakse (sporingens start → i dag):
 *   INPUT  — tid:      akkumuleret studiebudget (rød, "burde") vs. loggede
 *            minutter (grøn, "faktisk").
 *   OUTPUT — fremdrift: forventet kumulativ læsning på tværs af alle aktive
 *            bøger (rød) vs. faktisk læste sider (grøn).
 * Samme farvesprog som PaceBar: rød er planen, grøn er virkeligheden, og
 * gabet mellem dem ER budskabet. Rent SVG, alt beregnet fra serierne.
 */
import type { SeriesPoint } from "./roadmapData";

const RED = "#E05252";
const GREEN = "#10B981";

function Chart({ title, unit, pts }: { title: string; unit: string; pts: SeriesPoint[] }) {
  const W = 320, H = 130, pad = { l: 38, r: 10, t: 10, b: 18 };
  const n = pts.length;
  const ymax = Math.max(1, ...pts.map((p) => Math.max(p.exp, p.act))) * 1.08;
  const sx = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const sy = (v: number) => H - pad.b - (v / ymax) * (H - pad.t - pad.b);
  const path = (f: (p: SeriesPoint) => number) =>
    pts.map((p, i) => `${i ? "L" : "M"} ${sx(i).toFixed(1)} ${sy(f(p)).toFixed(1)}`).join(" ");
  const last = pts[n - 1];
  const behind = last && last.act < last.exp;

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-semibold uppercase tracking-wide text-[#6E6E78]">{title}</span>
        {last && (
          <span className={`tabular-nums ${behind ? "text-[#E05252]" : "text-emerald-600"}`}>
            {Math.round(last.act)} / {Math.round(last.exp)} {unit}
          </span>
        )}
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMinYMin meet">
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} y1={sy(ymax * f / 1.08)} x2={W - pad.r} y2={sy(ymax * f / 1.08)}
              stroke="#EBEAE5" strokeWidth={1} />
            <text x={pad.l - 4} y={sy(ymax * f / 1.08) + 3} fontSize={9} textAnchor="end"
              fill="#9A9AA8" fontFamily="Archivo, sans-serif">
              {Math.round(ymax * f / 1.08)}
            </text>
          </g>
        ))}
        <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="#C6C6D2" strokeWidth={1} />
        <path d={path((p) => p.exp)} fill="none" stroke={RED} strokeWidth={1.8} strokeDasharray="4 3" />
        <path d={path((p) => p.act)} fill="none" stroke={GREEN} strokeWidth={2.2} />
        {last && (
          <>
            <circle cx={sx(n - 1)} cy={sy(last.exp)} r={3} fill={RED} />
            <circle cx={sx(n - 1)} cy={sy(last.act)} r={3} fill={GREEN} />
          </>
        )}
        {pts.length > 0 && (
          <>
            <text x={pad.l} y={H - 5} fontSize={9} fill="#9A9AA8" fontFamily="Archivo, sans-serif">{pts[0].d.slice(5)}</text>
            <text x={W - pad.r} y={H - 5} fontSize={9} textAnchor="end" fill="#9A9AA8" fontFamily="Archivo, sans-serif">i dag</text>
          </>
        )}
      </svg>
    </div>
  );
}

export function IOChart({ input, output }: { input: SeriesPoint[]; output: SeriesPoint[] }) {
  if (!input.length && !output.length) return null;
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-5 sm:flex-row">
        <Chart title="Input · tid" unit="min" pts={input} />
        <Chart title="Output · fremdrift" unit="sider" pts={output} />
      </div>
      <div className="mt-2 flex gap-4 text-[11px] text-[#6E6E78]">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4" style={{ background: RED }} />burde (planen)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4" style={{ background: GREEN }} />faktisk
        </span>
      </div>
    </section>
  );
}
