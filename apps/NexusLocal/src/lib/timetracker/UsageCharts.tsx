/**
 * The two charts in the usage panel: when the time went, and what it went on.
 *
 * Hand-rolled SVG rather than a charting library. Both shapes are trivial
 * (24 rects, and a set of arcs), the app already fights a dual-`three` problem
 * from pulling graphing deps into a Tauri WebView, and a library would ship more
 * bytes than the whole panel.
 */

/** `1h 23m` / `4m 12s` / `12s` — two units, never three. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Distinct hues for the pie. Fixed rather than hashed from the label: adjacent
 * slices must be *visibly* different, and a hash gives no such guarantee — two
 * neighbouring apps can easily land 5° apart and read as one slice.
 */
const SLICE_HUES = [222, 275, 330, 22, 45, 160, 195, 300];
const OTHER_COLOR = "hsl(220 8% 42%)";

function sliceColor(index: number): string {
  if (index >= SLICE_HUES.length) return OTHER_COLOR;
  return `hsl(${SLICE_HUES[index]} 62% 55%)`;
}

/**
 * Foreground time by hour of the local day.
 *
 * Fixed 24 columns with a fixed 0..3600s scale — **not** scaled to the busiest
 * hour. An hour is at most an hour, so a full bar means "all of it", and that
 * absolute reading is the whole point. Auto-scaling would make a quiet day look
 * identical to a busy one.
 */
export function HourlyChart({ hours, multiDay }: { hours: number[]; multiDay: boolean }) {
  // Over a week an hour bucket holds up to 7×3600, so the ceiling has to grow
  // or every bar clips at full height.
  const ceiling = multiDay ? Math.max(3600, ...hours) : 3600;
  const busiest = hours.reduce((best, s, i) => (s > hours[best] ? i : best), 0);
  const total = hours.reduce((a, b) => a + b, 0);

  if (total === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[10px] text-white/30">
        No hourly data yet.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wide text-white/35">Through the day</span>
        <span className="text-[10px] text-white/30">
          busiest {String(busiest).padStart(2, "0")}:00 ·{" "}
          <span className="font-mono text-white/45">{formatDuration(hours[busiest])}</span>
        </span>
      </div>

      {/* `items-stretch`, NOT `items-end`. With `align-items: flex-end` the
          columns size to their content, so the `flex-1` wrapper inside each one
          resolves to height 0 and every percentage-height bar collapses to
          nothing — the chart renders its axis labels and no bars at all. Each
          column bottom-aligns its own bar instead. */}
      <div className="flex items-stretch gap-[2px]" style={{ height: 72 }}>
        {hours.map((seconds, hour) => {
          const pct = ceiling > 0 ? (seconds / ceiling) * 100 : 0;
          // A tracked hour always shows something: 30 seconds out of 3600 is
          // 0.8% and would round to an invisible bar, which reads as "nothing
          // happened" rather than "barely anything did".
          const height = seconds > 0 ? Math.max(3, pct) : 0;
          return (
            <div key={hour} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="flex w-full flex-1 items-end">
                <div
                  className={`w-full rounded-[2px] ${
                    hour === busiest ? "bg-indigo-400/80" : "bg-white/25"
                  }`}
                  style={{ height: `${height}%` }}
                  title={`${String(hour).padStart(2, "0")}:00 · ${formatDuration(seconds)}`}
                />
              </div>
              {/* Every third hour only — 24 labels at 10px is unreadable soup. */}
              <span className="text-[8px] leading-none text-white/25">
                {hour % 3 === 0 ? String(hour).padStart(2, "0") : " "}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Slice = { label: string; seconds: number };

/**
 * Share of foreground time per app, as a donut.
 *
 * A donut rather than a full pie: the hole carries the total, which is the
 * number people actually want, and it removes the thin-wedge-at-the-centre
 * crowding that makes small slices unreadable.
 */
export function SharePie({
  slices,
  total,
  label = "total",
}: {
  slices: Slice[];
  total: number;
  label?: string;
}) {
  // `slices` is the truncated top-N, so the remainder is real time that would
  // otherwise silently vanish and make the percentages lie.
  const shown = slices.reduce((a, s) => a + s.seconds, 0);
  const other = Math.max(0, total - shown);
  const parts: Slice[] = other > 0 ? [...slices, { label: "Other", seconds: other }] : slices;
  const sum = parts.reduce((a, s) => a + s.seconds, 0);

  if (sum <= 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[10px] text-white/30">
        Nothing to chart yet.
      </div>
    );
  }

  const R = 52;
  const STROKE = 20;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="relative shrink-0" style={{ width: 132, height: 132 }}>
        {/* -90° so the first slice starts at 12 o'clock, which is where people
            expect a chart to begin reading. */}
        <svg width="132" height="132" viewBox="0 0 132 132" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="66" cy="66" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={STROKE} />
          {parts.map((s, i) => {
            const frac = s.seconds / sum;
            const dash = frac * C;
            const el = (
              <circle
                key={s.label}
                cx="66"
                cy="66"
                r={R}
                fill="none"
                stroke={s.label === "Other" ? OTHER_COLOR : sliceColor(i)}
                strokeWidth={STROKE}
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-offset}
              >
                <title>{`${s.label} · ${formatDuration(s.seconds)} · ${Math.round(frac * 100)}%`}</title>
              </circle>
            );
            offset += dash;
            return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="font-mono text-xs text-white/80">{formatDuration(total)}</div>
            <div className="text-[9px] text-white/30">{label}</div>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {parts.map((s, i) => (
          <div key={s.label} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: s.label === "Other" ? OTHER_COLOR : sliceColor(i) }}
            />
            <span className="min-w-0 flex-1 truncate text-[11px] text-white/70">{s.label}</span>
            <span className="shrink-0 font-mono text-[10px] text-white/35">
              {Math.round((s.seconds / sum) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
