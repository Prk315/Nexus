/**
 * Chart primitives for `StatsPanel.tsx` ("Statistik" board). Hand-built inline
 * SVG/HTML per the dataviz skill's mark specs — no charting dependency.
 *
 * Color: every mark below is the ONE validated sequential indigo hue
 * (`SEQ_MARK` = #4f46e5, the ramp's darkest step) — every one of the design
 * contract's 8 forms is single-series or a faceted grid of single-series
 * mini-charts, so no categorical pair is ever needed here. `SEQ_RAMP` (light→
 * dark) is reserved for the ONE true magnitude-via-color mark, the activity
 * heatmap; `seqStep` maps a value to a ramp step and renders true zero as an
 * explicit neutral (`rgba(0,0,0,0.04)`), never the ramp's lightest step — a
 * day with zero attempts must not read as "a little bit of indigo".
 *
 * Marks follow `references/marks-and-anatomy.md`: bars are ≤24px, 4px rounded
 * data-end, square at the baseline; lines are 2px with ≥8px (r≥4 visually,
 * scaled down slightly here because these are dense multi-point series —
 * markers grow on hover/focus to signal the exact hit); a 2px white ring
 * separates overlapping marks. Every chart carries its own hover layer
 * (`references/interaction.md`): a snapping crosshair + tooltip on line
 * charts, a per-mark hover/focus tooltip on bars/cells — and every value a
 * tooltip shows is also in the "Vis tal" table (`StatsPanel.tsx` wires that
 * toggle via `ChartCard`), so nothing is hover-gated.
 *
 * Chart cards are `@container`-scoped (Tailwind v4 native container queries,
 * no plugin) so axis tick density responds to the CARD's rendered width, not
 * the viewport — a chart in the 2-col desktop grid (~380px) shows fewer
 * labels than the same chart full-width on phone, without a JS resize
 * listener. `@[420px]:opacity-100` on tick `<text>` is the one place that
 * matters; SVG text supports `opacity` cleanly across engines where toggling
 * `display` on SVG elements is less predictable.
 */

import { useState, type ReactNode } from "react";

export const INK = "#1A1A24";
export const MUTED = "#6E6E78";

/** The one validated sequential hue, light→dark — magnitude marks only. */
export const SEQ_RAMP = ["#eef2ff", "#c7d2fe", "#a5b4fc", "#818cf8", "#6366f1", "#4f46e5"];
/** Default mark color for every single-series bar/line in this file. */
export const SEQ_MARK = "#4f46e5";
export const SEQ_MARK_HOVER = "#6366f1";

/** Value → ramp step for the activity heatmap. True zero is an explicit
 * neutral, never the ramp's lightest indigo step (see file header). */
export function seqStep(value: number, max: number): string {
  if (value <= 0 || max <= 0) return "rgba(0,0,0,0.05)";
  const idx = Math.min(SEQ_RAMP.length - 1, Math.max(0, Math.ceil((value / max) * SEQ_RAMP.length) - 1));
  return SEQ_RAMP[idx];
}

// ── Shared chrome ─────────────────────────────────────────────────────────

/** Card shell + heading + optional "Vis tal" toggle revealing `table` below
 * the chart. Every chart section on the board is wrapped in one of these —
 * the toggle is the board's one accessibility escape hatch (identity/values
 * never gated behind hover or color alone). `@container` so children can key
 * tick density off the card's own rendered width. */
export function ChartCard({
  title,
  sub,
  badge,
  table,
  children,
}: {
  title: string;
  sub?: string;
  badge?: ReactNode;
  table?: ReactNode;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="@container rounded-xl border border-black/[0.06] bg-white p-3 shadow-[0_1px_8px_rgba(0,0,0,0.05)] md:rounded-2xl md:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[13px] font-semibold text-[#1A1A24]/85">{title}</h3>
            {badge}
          </div>
          {sub && <p className="mt-0.5 text-[11px] text-[#6E6E78]">{sub}</p>}
        </div>
        {table && (
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-medium text-[#6E6E78] ring-1 ring-black/10 transition-colors active:bg-black/[0.05]"
          >
            {showTable ? "Skjul tal" : "Vis tal"}
          </button>
        )}
      </div>
      <div className="mt-3">{children}</div>
      {showTable && table && <div className="mt-3 border-t border-black/[0.06] pt-3">{table}</div>}
    </div>
  );
}

/** Explicit empty state — never a zero-height chart or a fake zero line.
 * `height` lets small-multiples facets (Form 5) use a shorter placeholder
 * than a full-width chart card. */
export function EmptyState({ label = "Ingen data endnu", height = 110 }: { label?: string; height?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg bg-black/[0.02] text-[12px] text-[#6E6E78]/70"
      style={{ height }}
    >
      {label}
    </div>
  );
}

/** Generic scrollable data table for a "Vis tal" reveal — never `innerHTML`;
 * React text children are already safe against untrusted labels. */
export function DataTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) return <p className="text-[11px] text-[#6E6E78]/70">Ingen data endnu.</p>;
  return (
    <div className="max-h-56 overflow-y-auto overflow-x-auto">
      <table className="w-full min-w-[260px] border-collapse text-left text-[11px]">
        <thead className="sticky top-0 bg-white">
          <tr>
            {columns.map((c) => (
              <th key={c} className="border-b border-black/[0.08] py-1 pr-3 font-medium text-[#6E6E78]">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((v, ci) => (
                <td key={ci} className="border-b border-black/[0.04] py-1 pr-3 tabular-nums text-[#1A1A24]/80">
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Headline stat tile — big numeral (gradient-clip when `accent`, matching
 * the app's existing "earned" convention on streaks/scores) + label. */
export function StatTile({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-black/[0.06] bg-white p-3 shadow-[0_1px_8px_rgba(0,0,0,0.05)] md:rounded-2xl md:p-4">
      <div
        className={
          accent
            ? "bg-gradient-to-br from-indigo-600 to-fuchsia-600 bg-clip-text font-mono text-2xl font-semibold tabular-nums text-transparent md:text-3xl"
            : "font-mono text-2xl font-semibold tabular-nums text-[#1A1A24]/90 md:text-3xl"
        }
      >
        {value}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-[#6E6E78]/80">{label}</div>
      {sub && <div className="mt-0.5 text-[9px] text-[#6E6E78]/60">{sub}</div>}
    </div>
  );
}

// ── Time-series charts (Form 2 volume, Form 3 accuracy, Form 4 growth) ─────

export interface SeriesPoint {
  key: string;
  /** `null` = no evidence that bucket (Form 3's no-attempt days) — renders as
   * a gap, never a dip to zero. */
  value: number | null;
  tickLabel?: string;
  tooltipLabel: string;
}

/** Form 2 (volume) and any other single-series magnitude bar. 4px rounded
 * data-end, 2px inter-bar gap (via the fixed slot/bar-width difference), a
 * transparent oversized hit rect per bar so the target is bigger than the
 * mark, per-mark tooltip on hover/focus. */
export function BarChart({
  data,
  height = 120,
  formatValue = (v: number) => `${v}`,
}: {
  data: SeriesPoint[];
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return <EmptyState />;

  const n = data.length;
  const values = data.map((d) => d.value ?? 0);
  const max = Math.max(1, ...values);
  const padTop = 10;
  const padBottom = 16;
  const chartH = height - padTop - padBottom;
  const slot = 12;
  const barW = 9;
  const W = n * slot + 6;
  const tickEvery = Math.max(1, Math.ceil(n / 7));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} className="h-[120px] w-full" preserveAspectRatio="none" role="img" aria-label="Bar chart">
        <line x1={0} y1={padTop + chartH} x2={W} y2={padTop + chartH} stroke="rgba(0,0,0,0.07)" strokeWidth={1} />
        {data.map((d, i) => {
          const v = d.value ?? 0;
          const h = max > 0 ? (v / max) * chartH : 0;
          const x = 3 + i * slot;
          const y = padTop + chartH - h;
          const showTick = d.tickLabel && (i % tickEvery === 0 || i === n - 1);
          return (
            <g key={d.key}>
              <rect
                x={x - 1.5}
                y={padTop}
                width={barW + 3}
                height={chartH}
                fill="transparent"
                tabIndex={0}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h2) => (h2 === i ? null : h2))}
                onFocus={() => setHover(i)}
                onBlur={() => setHover((h2) => (h2 === i ? null : h2))}
              />
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, 0)}
                rx={2}
                fill={hover === i ? SEQ_MARK_HOVER : SEQ_MARK}
                className="pointer-events-none transition-colors"
              />
              {showTick && (
                <text
                  x={x + barW / 2}
                  y={height - 4}
                  fontSize={7}
                  textAnchor="middle"
                  fill={MUTED}
                  className="pointer-events-none select-none opacity-0 @[420px]:opacity-100"
                >
                  {d.tickLabel}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-[#1A1A24] px-2 py-1 text-[10px] text-white shadow-lg"
          style={{ left: `${((3 + hover * slot + barW / 2) / W) * 100}%`, top: `${(padTop / height) * 100}%` }}
        >
          <span className="font-semibold tabular-nums">{formatValue(data[hover].value ?? 0)}</span>
          <span className="ml-1.5 text-white/60">{data[hover].tooltipLabel}</span>
        </div>
      )}
    </div>
  );
}

/** Form 3 (accuracy, `stepped=false`) and Form 4 (mastery growth,
 * `stepped=true`) — a crosshair that snaps to the nearest data position on
 * pointer move (and Arrow keys once focused), one tooltip listing that
 * point's value. Null-valued points break the line (a gap) rather than
 * dipping to zero, and grow no marker of their own. */
export function LineChart({
  data,
  height = 120,
  stepped = false,
  formatValue = (v: number) => `${Math.round(v)}`,
  unit = "",
}: {
  data: SeriesPoint[];
  height?: number;
  stepped?: boolean;
  formatValue?: (v: number) => string;
  unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return <EmptyState />;

  const n = data.length;
  const padTop = 10;
  const padBottom = 16;
  const padX = 4;
  const chartH = height - padTop - padBottom;
  const W = Math.max(240, (n - 1) * 12 + padX * 2);
  const stepXpx = n > 1 ? (W - padX * 2) / (n - 1) : 0;

  const known = data.filter((d): d is SeriesPoint & { value: number } => d.value !== null).map((d) => d.value);
  const maxV = Math.max(1, ...known);

  const xAt = (i: number) => padX + i * stepXpx;
  const yAt = (v: number) => padTop + chartH - (v / maxV) * chartH;

  const segments: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  data.forEach((d, i) => {
    if (d.value === null) {
      if (cur.length) segments.push(cur);
      cur = [];
      return;
    }
    cur.push({ x: xAt(i), y: yAt(d.value) });
  });
  if (cur.length) segments.push(cur);

  function pathFor(pts: { x: number; y: number }[]): string {
    if (pts.length === 0) return "";
    if (!stepped) return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) d += ` H${pts[i].x} V${pts[i].y}`;
    return d;
  }

  function snapFromClientX(clientX: number, rect: DOMRect) {
    const ratio = n > 1 ? (clientX - rect.left) / rect.width : 0;
    const i = Math.round(ratio * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  }

  const tickEvery = Math.max(1, Math.ceil(n / 7));
  const hoveredPoint = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="h-[120px] w-full touch-none"
        preserveAspectRatio="none"
        role="img"
        aria-label="Line chart"
      >
        <line x1={0} y1={padTop + chartH} x2={W} y2={padTop + chartH} stroke="rgba(0,0,0,0.07)" strokeWidth={1} />
        {segments.map((seg, si) => (
          <path
            key={si}
            d={pathFor(seg)}
            fill="none"
            stroke={SEQ_MARK}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none"
          />
        ))}
        {data.map((d, i) =>
          d.value === null ? null : (
            <circle
              key={d.key}
              cx={xAt(i)}
              cy={yAt(d.value)}
              r={hover === i ? 3.2 : 2.2}
              fill={SEQ_MARK}
              stroke="#fff"
              strokeWidth={1.6}
              className="pointer-events-none transition-[r]"
            />
          )
        )}
        {hover !== null && (
          <line
            x1={xAt(hover)}
            x2={xAt(hover)}
            y1={padTop}
            y2={padTop + chartH}
            stroke={SEQ_MARK}
            strokeOpacity={0.22}
            strokeWidth={1}
            className="pointer-events-none"
          />
        )}
        {data.map((d, i) =>
          d.tickLabel && (i % tickEvery === 0 || i === n - 1) ? (
            <text
              key={`t-${d.key}`}
              x={xAt(i)}
              y={height - 4}
              fontSize={7}
              textAnchor="middle"
              fill={MUTED}
              className="pointer-events-none select-none opacity-0 @[420px]:opacity-100"
            >
              {d.tickLabel}
            </text>
          ) : null
        )}
        <rect
          x={0}
          y={0}
          width={W}
          height={height}
          fill="transparent"
          tabIndex={0}
          onPointerMove={(e) => snapFromClientX(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerDown={(e) => snapFromClientX(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover((h) => h ?? 0)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (hover === null) return;
            if (e.key === "ArrowRight") setHover(Math.min(n - 1, hover + 1));
            if (e.key === "ArrowLeft") setHover(Math.max(0, hover - 1));
          }}
        />
      </svg>
      {hoveredPoint && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-[#1A1A24] px-2 py-1 text-[10px] text-white shadow-lg"
          style={{
            left: `${(xAt(hover as number) / W) * 100}%`,
            top: `${((hoveredPoint.value !== null ? yAt(hoveredPoint.value) : padTop) / height) * 100}%`,
          }}
        >
          <span className="font-semibold tabular-nums">
            {hoveredPoint.value === null ? "–" : `${formatValue(hoveredPoint.value)}${unit}`}
          </span>
          <span className="ml-1.5 text-white/60">{hoveredPoint.tooltipLabel}</span>
        </div>
      )}
    </div>
  );
}

// ── Horizontal bars (Form 6 sprint buckets, Form 7 weakest concepts) ───────

export interface HBarRow {
  key: string;
  label: string;
  /** 0..1 — bar length as a fraction of the row's own scale. */
  value: number;
  /** Direct label, always visible ("n/m · NN%") — never hover-gated. */
  display: string;
  sublabel?: string;
}

/** Weakest-first horizontal bars. Data-end (right edge) is the 4px-rounded
 * end; the baseline (left, zero) is square. Direct label always rendered —
 * the hover tooltip is a redundant, richer readout, not the only source. */
export function HBarChart({ data }: { data: HBarRow[] }) {
  if (data.length === 0) return <EmptyState />;
  return (
    <div className="flex flex-col gap-1.5">
      {data.map((d) => (
        <div key={d.key} className="group relative flex items-center gap-2">
          <div className="w-24 shrink-0 truncate text-[11px] text-[#1A1A24]/75 md:w-32" title={d.label}>
            {d.label}
          </div>
          <div className="relative h-4 min-w-0 flex-1 rounded bg-black/[0.05]">
            <div
              className="h-4 rounded-r-[4px] bg-[#4f46e5] outline-none transition-[width,background-color] duration-300 group-hover:bg-[#6366f1] group-focus-within:bg-[#6366f1]"
              style={{ width: `${Math.max(3, Math.min(100, d.value * 100))}%` }}
              tabIndex={0}
            />
            <div className="pointer-events-none absolute -top-7 left-0 z-10 hidden whitespace-nowrap rounded-md bg-[#1A1A24] px-2 py-1 text-[10px] text-white shadow-lg group-hover:block group-focus-within:block">
              <span className="font-semibold tabular-nums">{d.display}</span>
              {d.sublabel && <span className="ml-1.5 text-white/60">{d.sublabel}</span>}
            </div>
          </div>
          <div className="w-16 shrink-0 text-right text-[10px] tabular-nums text-[#6E6E78]">{d.display}</div>
        </div>
      ))}
    </div>
  );
}

// ── Activity heatmap (Form 8) ───────────────────────────────────────────────

export interface HeatCell {
  count: number;
  tooltipLabel: string;
  /** 0=Monday…6=Sunday. */
  dow: number;
}

const DOW_LABELS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];

function buildWeeks(data: HeatCell[]): (HeatCell | null)[][] {
  if (data.length === 0) return [];
  const cols: (HeatCell | null)[][] = [];
  let col: (HeatCell | null)[] = new Array(7).fill(null);
  let row = data[0].dow;
  for (const d of data) {
    col[row] = d;
    row++;
    if (row === 7) {
      cols.push(col);
      col = new Array(7).fill(null);
      row = 0;
    }
  }
  if (col.some((c) => c !== null)) cols.push(col);
  return cols;
}

/** 6-week calendar heatmap, sequential indigo ramp. Leading/trailing padding
 * cells (outside the data window) render as fully transparent — distinct
 * from a real zero-attempt day, which gets `seqStep`'s explicit neutral. */
export function Heatmap({ data }: { data: HeatCell[] }) {
  if (data.length === 0) return <EmptyState />;
  const max = Math.max(1, ...data.map((d) => d.count));
  const weeks = buildWeeks(data);
  return (
    <div className="flex gap-[3px] overflow-x-auto pb-1">
      <div className="flex flex-col gap-[3px] pt-[1px] text-[8px] leading-none text-[#6E6E78]/55">
        {DOW_LABELS.map((l, i) => (
          <div key={l} className="flex h-[13px] w-6 items-center">
            {i % 2 === 0 ? l.slice(0, 1) : ""}
          </div>
        ))}
      </div>
      <div className="grid grid-flow-col gap-[3px]">
        {weeks.map((col, ci) => (
          <div key={ci} className="grid grid-rows-7 gap-[3px]">
            {col.map((cell, ri) => (
              <div key={ri} className="group relative">
                <div
                  className="h-[13px] w-[13px] rounded-[3px] transition-transform group-hover:scale-110"
                  style={{ backgroundColor: cell ? seqStep(cell.count, max) : "transparent" }}
                  tabIndex={cell ? 0 : -1}
                />
                {cell && (
                  <div className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-[#1A1A24] px-2 py-1 text-[10px] text-white shadow-lg group-hover:block group-focus-within:block">
                    <span className="font-semibold tabular-nums">{cell.count}</span>
                    <span className="ml-1.5 text-white/60">{cell.tooltipLabel}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
