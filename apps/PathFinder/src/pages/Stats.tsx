// How well the schedule is kept, over time.
//
// Every task-linked calendar block is graded done / missed / unmarked /
// upcoming (see lib/adherence.ts for why those four and why by minutes). This
// page shows today, the chosen period against the one before it, how much got
// scheduled each day, and a rolling kept-% line — the thing that should climb.
//
// It also lists the blocks still waiting for a verdict, with the same two
// buttons the calendar has, because an unmarked block counts against the rate
// and the calendar is a slow place to sweep a week of them.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, X, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { getCalBlocks, getTaskSessionsInRange, getBlockMissesInRange, logTaskSession, markBlockMissed } from "../lib/api";
import { summariseAdherence, blockOutcome, rateOf, type DayAdherence } from "../lib/adherence";
import { blockMinutes } from "../lib/taskTree";
import { addDays, toISO, todayISO } from "../components/week/_shared";
import { cn } from "../lib/utils";
import type { CalBlock } from "../types";

const RANGES = [7, 30, 90] as const;
type Range = typeof RANGES[number];
const RANGE_KEY = "pf-stats-range";
const ROLLING = 7;

// Status colors, validated together for colorblind separation (teal↔rose
// ΔE 10 deutan). Upcoming is a neutral — it is not a verdict yet.
const SEG = {
  done:     { label: "Done",     cls: "bg-teal-600" },
  missed:   { label: "Missed",   cls: "bg-rose-600" },
  unmarked: { label: "Unmarked", cls: "bg-amber-500" },
  upcoming: { label: "Upcoming", cls: "bg-muted-foreground/25" },
} as const;
type SegKey = keyof typeof SEG;
const SEG_ORDER: SegKey[] = ["done", "missed", "unmarked", "upcoming"]; // bottom → top

function hours(min: number): string {
  const n = Math.max(0, Math.round(min));
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60), m = n % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
const pct = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)}%`);

function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function nowStamp() {
  const d = new Date();
  return { date: toISO(d), minutes: d.getHours() * 60 + d.getMinutes() };
}

export function Stats() {
  const [range, setRange] = useState<Range>(() => {
    try {
      const v = Number(localStorage.getItem(RANGE_KEY));
      return (RANGES as readonly number[]).includes(v) ? (v as Range) : 30;
    } catch { return 30; }
  });
  useEffect(() => { try { localStorage.setItem(RANGE_KEY, String(range)); } catch { /* per-viewer nicety only */ } }, [range]);

  const [blocks, setBlocks] = useState<CalBlock[]>([]);
  const [worked, setWorked] = useState<Set<number>>(new Set());
  const [missed, setMissed] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = todayISO();
  // The period plus the one before it (for the trend), plus ROLLING-1 days
  // more so the first point of the rolling line has a full window.
  const allDays = useMemo(() => {
    const n = range * 2 + ROLLING - 1;
    const t = new Date(today + "T00:00:00");
    return Array.from({ length: n }, (_, i) => toISO(addDays(t, i - n + 1)));
  }, [range, today]);

  const load = useCallback(async () => {
    try {
      const [cb, ts, ms] = await Promise.all([
        getCalBlocks(allDays[0], today),
        getTaskSessionsInRange(allDays[0], today),
        getBlockMissesInRange(allDays[0], today),
      ]);
      setBlocks(cb);
      setWorked(new Set(ts.filter((s) => s.cal_block_id != null).map((s) => s.cal_block_id!)));
      setMissed(new Set(ms.map((m) => m.cal_block_id)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, [allDays, today]);

  useEffect(() => { load(); }, [load]);

  const now = nowStamp();
  const all = useMemo(
    () => summariseAdherence(allDays, blocks, worked, missed, now),
    // `now` is read fresh each render on purpose; recompute on data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allDays, blocks, worked, missed],
  );

  const period   = all.days.slice(-range);
  const previous = all.days.slice(-range * 2, -range);
  const sumRate = (ds: DayAdherence[]) => rateOf(ds.reduce(
    (a, d) => ({ done: a.done + d.done, missed: a.missed + d.missed, unmarked: a.unmarked + d.unmarked }),
    { done: 0, missed: 0, unmarked: 0 },
  ));
  const periodRate = sumRate(period);
  const prevRate   = sumRate(previous);
  const delta = periodRate != null && prevRate != null ? Math.round((periodRate - prevRate) * 100) : null;

  const activePeriod = period.filter((d) => d.scheduled > 0);
  const avgScheduled = activePeriod.length
    ? activePeriod.reduce((s, d) => s + d.scheduled, 0) / activePeriod.length : 0;
  const todayRow = all.days[all.days.length - 1];

  // Rolling kept-% for each day in the period, over the ROLLING days ending there.
  const rolling = period.map((d, i) => {
    const end = all.days.length - range + i;
    return { iso: d.iso, rate: sumRate(all.days.slice(end - ROLLING + 1, end + 1)) };
  });

  // Blocks still waiting for a verdict, newest first.
  const pending = useMemo(() => {
    const periodStart = all.days[all.days.length - range].iso;
    return blocks
      .filter((b) => b.task_id != null && b.date >= periodStart
        && blockOutcome(b, worked, missed, now) === "unmarked")
      .sort((a, b) => b.date.localeCompare(a.date) || b.start_time.localeCompare(a.start_time));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, worked, missed, range, all.days]);

  const resolve = async (b: CalBlock, verdict: "done" | "missed") => {
    if (b.task_id == null) return;
    // Optimistic, then re-sync — same shape as the calendar handlers.
    if (verdict === "done") setWorked((s) => new Set(s).add(b.id));
    else setMissed((s) => new Set(s).add(b.id));
    try {
      if (verdict === "done") {
        await logTaskSession({
          task_id: b.task_id, date: b.date,
          minutes: blockMinutes(b.start_time, b.end_time), cal_block_id: b.id,
        });
      } else {
        await markBlockMissed(b);
      }
    } finally {
      load();
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Sticking to the schedule</h1>
          <p className="text-sm text-muted-foreground">
            Scheduled task blocks you completed, by time. Tick blocks off as done or mark
            them not completed in Week or on the Dashboard.
          </p>
        </div>
        <div className="flex rounded-md border border-border overflow-hidden text-xs" role="group" aria-label="Period">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "px-3 py-1.5 transition-colors",
                r === range ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover:bg-secondary/50",
              )}
            >
              {r} days
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-foreground">
          Couldn't load the schedule: {error}
        </div>
      )}

      {/* ── Stat tiles ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Today" value={pct(todayRow.rate)}
          sub={todayRow.scheduled > 0
            ? `${hours(todayRow.scheduled)} scheduled · ${hours(todayRow.done)} done${todayRow.upcoming ? ` · ${hours(todayRow.upcoming)} to go` : ""}`
            : "Nothing scheduled"} />
        <Tile label={`Last ${range} days`} value={pct(periodRate)}
          sub={`${hours(period.reduce((s, d) => s + d.done, 0))} of ${hours(period.reduce((s, d) => s + d.done + d.missed + d.unmarked, 0))} kept`} />
        <Tile label="vs previous period"
          value={delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta} pts`}
          icon={delta == null ? null : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus}
          sub={prevRate == null ? "No earlier data yet" : `was ${pct(prevRate)}`} />
        <Tile label="Scheduled per day" value={hours(avgScheduled)}
          sub={`average over ${activePeriod.length} day${activePeriod.length === 1 ? "" : "s"} with plans`} />
      </div>

      {/* ── Daily bars ───────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Scheduled each day</h2>
          <Legend />
        </div>
        {loaded && period.every((d) => d.scheduled === 0)
          ? <Empty>No task blocks scheduled in this period.</Empty>
          : <DayBars days={period} today={today} />}
      </section>

      {/* ── Rolling kept-% ───────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          Kept, {ROLLING}-day rolling
        </h2>
        {rolling.every((p) => p.rate == null)
          ? <Empty>Nothing finished yet to grade.</Empty>
          : <RateLine points={rolling} />}
      </section>

      {/* ── Needs a verdict ──────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-foreground">Not marked yet</h2>
          <span className="text-xs text-muted-foreground tabular-nums">{pending.length}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          These are over but neither ticked nor marked, so they count as not kept until you decide.
        </p>
        {pending.length === 0
          ? <Empty>All caught up.</Empty>
          : (
            <ul className="divide-y divide-border/60">
              {pending.slice(0, 40).map((b) => (
                <li key={`${b.id}`} className="flex items-center gap-3 py-1.5 text-sm">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground tabular-nums">{shortDate(b.date)}</span>
                  <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">{b.start_time}–{b.end_time}</span>
                  <span className="flex-1 min-w-0 truncate text-foreground">{b.title}</span>
                  <button
                    onClick={() => resolve(b, "done")}
                    className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary"
                    title="Completed"
                  >
                    <Check className="h-3 w-3 text-teal-600" /> Done
                  </button>
                  <button
                    onClick={() => resolve(b, "missed")}
                    className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary"
                    title="Did not complete"
                  >
                    <X className="h-3 w-3 text-rose-600" /> Missed
                  </button>
                </li>
              ))}
            </ul>
          )}
        {pending.length > 40 && (
          <p className="text-xs text-muted-foreground">…and {pending.length - 40} older.</p>
        )}
      </section>

      {/* ── Table view ───────────────────────────────────────────────────── */}
      <details className="rounded-lg border border-border bg-card p-4 text-sm">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">Table</summary>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-3 font-medium">Day</th>
                <th className="py-1 pr-3 font-medium text-right">Booked</th>
                <th className="py-1 pr-3 font-medium text-right">On tasks</th>
                <th className="py-1 pr-3 font-medium text-right">Done</th>
                <th className="py-1 pr-3 font-medium text-right">Missed</th>
                <th className="py-1 pr-3 font-medium text-right">Unmarked</th>
                <th className="py-1 pr-3 font-medium text-right">Kept</th>
              </tr>
            </thead>
            <tbody className="text-foreground">
              {[...period].reverse().map((d) => (
                <tr key={d.iso} className="border-t border-border/50">
                  <td className="py-1 pr-3">{shortDate(d.iso)}</td>
                  <td className="py-1 pr-3 text-right">{hours(d.booked)}</td>
                  <td className="py-1 pr-3 text-right">{hours(d.scheduled)}</td>
                  <td className="py-1 pr-3 text-right">{hours(d.done)}</td>
                  <td className="py-1 pr-3 text-right">{hours(d.missed)}</td>
                  <td className="py-1 pr-3 text-right">{hours(d.unmarked)}</td>
                  <td className="py-1 pr-3 text-right">{pct(d.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Tile({ label, value, sub, icon: Icon }: {
  label: string; value: string; sub: string;
  icon?: React.ComponentType<{ className?: string }> | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 text-2xl font-semibold tabular-nums text-foreground leading-none">
        {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      {SEG_ORDER.map((k) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-sm", SEG[k].cls)} />
          {SEG[k].label}
        </span>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground italic py-4 text-center">{children}</p>;
}

const BAR_AREA_PX = 160;

/**
 * One stacked column per day; height is the day's scheduled task time, scaled
 * to the busiest day in view, segments stacked done → missed → unmarked →
 * upcoming from the baseline. Hover a column for the numbers.
 */
function DayBars({ days, today }: { days: DayAdherence[]; today: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const peak = Math.max(...days.map((d) => d.scheduled), 60);
  const dense = days.length > 31;
  const h = hover != null ? days[hover] : null;

  return (
    <div className="flex gap-2">
    <div className="flex flex-col justify-between text-[10px] text-muted-foreground tabular-nums text-right" style={{ height: BAR_AREA_PX }}>
      <span>{hours(peak)}</span><span>0</span>
    </div>
    <div className="relative flex-1 min-w-0">
      <div className="flex items-end gap-[2px]" style={{ height: BAR_AREA_PX }} onMouseLeave={() => setHover(null)}>
        {days.map((d, i) => {
          const colPx = (d.scheduled / peak) * BAR_AREA_PX;
          return (
            <div
              key={d.iso}
              className="flex-1 min-w-0 h-full flex flex-col justify-end cursor-default"
              onMouseEnter={() => setHover(i)}
            >
              <div
                className={cn(
                  "w-full max-w-6 mx-auto flex flex-col-reverse gap-[2px] rounded-t-[4px] overflow-hidden",
                  hover === i && "outline outline-1 outline-foreground/40",
                )}
                style={{ height: Math.max(d.scheduled > 0 ? 2 : 0, colPx) }}
              >
                {SEG_ORDER.map((k) => d[k] > 0 && (
                  <div key={k} className={cn("w-full shrink-0", SEG[k].cls)}
                    style={{ height: `${(d[k] / d.scheduled) * 100}%` }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-[2px] mt-1 border-t border-border/60 pt-1">
        {days.map((d, i) => {
          const show = !dense || i % 7 === (days.length - 1) % 7;
          return (
            <span key={d.iso} className={cn(
              "flex-1 min-w-0 text-center text-[10px] leading-none truncate",
              d.iso === today ? "text-foreground font-semibold" : "text-muted-foreground",
            )}>
              {show ? new Date(d.iso + "T00:00:00").toLocaleDateString(undefined, dense ? { day: "numeric", month: "numeric" } : { weekday: "narrow" }) : ""}
            </span>
          );
        })}
      </div>

      {h && hover != null && (
        // Beside the column, on whichever side has room, so it never covers the bar being read.
        <div
          className={cn(
            "pointer-events-none absolute top-0 z-10 w-52 rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-md",
            hover >= days.length / 2 && "-translate-x-full",
          )}
          style={{
            left: hover >= days.length / 2
              ? `calc(${(hover / days.length) * 100}% - 6px)`
              : `calc(${((hover + 1) / days.length) * 100}% + 6px)`,
          }}
        >
          <p className="font-medium text-foreground mb-1">{shortDate(h.iso)}</p>
          <Row label="Scheduled on tasks" value={hours(h.scheduled)} />
          {SEG_ORDER.map((k) => h[k] > 0 && (
            <Row key={k} swatch={SEG[k].cls} label={SEG[k].label} value={hours(h[k])} />
          ))}
          <Row label="Booked in total" value={hours(h.booked)} />
          <Row label="Kept" value={pct(h.rate)} strong />
        </div>
      )}
    </div>
    </div>
  );
}

function Row({ label, value, swatch, strong }: { label: string; value: string; swatch?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-muted-foreground whitespace-nowrap">
        {swatch && <span className={cn("h-2 w-2 rounded-sm", swatch)} />}
        {label}
      </span>
      <span className={cn("tabular-nums text-foreground", strong && "font-semibold")}>{value}</span>
    </div>
  );
}

const LINE_H = 140;

/** Rolling kept-% as a single 2px line on a fixed 0–100% axis; gaps where nothing was graded. */
function RateLine({ points }: { points: { iso: string; rate: number | null }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000; // viewBox width; scales to the container
  const x = (i: number) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * W);
  const y = (r: number) => LINE_H - r * LINE_H;

  // Break the path wherever a day has no graded time, rather than drawing
  // through it as if it were 0% or interpolating a value that never existed.
  let d = "";
  let pen = false;
  points.forEach((p, i) => {
    if (p.rate == null) { pen = false; return; }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.rate).toFixed(1)}`;
    pen = true;
  });

  const hp = hover != null ? points[hover] : null;

  return (
    <div className="flex gap-2">
      <div className="flex flex-col justify-between text-[10px] text-muted-foreground tabular-nums text-right" style={{ height: LINE_H }}>
        <span>100%</span><span>50%</span><span>0%</span>
      </div>
      <div className="relative flex-1 min-w-0" style={{ height: LINE_H }}>
        <svg
          viewBox={`0 0 ${W} ${LINE_H}`} preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const i = Math.round(((e.clientX - r.left) / r.width) * (points.length - 1));
            setHover(Math.max(0, Math.min(points.length - 1, i)));
          }}
          onMouseLeave={() => setHover(null)}
        >
          {[0, 0.5, 1].map((g) => (
            <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          {hover != null && (
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={LINE_H} className="stroke-muted-foreground/50" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          )}
          <path d={d} fill="none" className="stroke-teal-600" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        {/* Marker drawn in HTML so it stays round under the stretched viewBox. */}
        {hp && hp.rate != null && (
          <span
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal-600 ring-2 ring-card"
            style={{ left: `${(x(hover!) / W) * 100}%`, top: y(hp.rate) }}
          />
        )}
        {hp && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md whitespace-nowrap"
            style={{ left: `${(x(hover!) / W) * 100}%` }}
          >
            <span className="text-muted-foreground">{ROLLING} days to {shortDate(hp.iso)}: </span>
            <span className="font-semibold tabular-nums text-foreground">{pct(hp.rate)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
