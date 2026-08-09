import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HourlyChart, SharePie, formatDuration } from "./UsageCharts";

/**
 * Today's foreground time: which apps, which sites.
 *
 * # Where the numbers come from
 *
 * Not from this process. On macOS the **daemon** runs the tracker and the
 * browser extension's ingest endpoint (see `src-tauri/src/usage.rs`); the
 * desktop app spawns no grid at all. `tt_usage_today` reads the day's JSONL
 * file from disk, which is the channel between the two processes — the same
 * shape as the enforcement toggle crossing the boundary through
 * `~/.nexuslocalrc`.
 *
 * That is why `tracking` can be false while there are still numbers to show:
 * the day happened, nothing is recording it right now. The panel says so rather
 * than pretending the totals are live.
 *
 * # Privacy
 *
 * None of this is ever written to Supabase — not app names, not hosts, not
 * aggregates. The repo is public, the anon key is in `config.rs`, and these
 * tables carry `USING (true)` RLS, so anything written there is world-readable.
 * Local files only. There is deliberately no Supabase import in this file.
 *
 * Renders `null` when nothing is tracking *and* there is no data, so it does not
 * leave an empty box on iOS (which has no daemon, no `lsappinfo` and no
 * listener).
 */

type AppUsage = { name: string; seconds: number };
type SiteUsage = { host: string; seconds: number };
type DayTotal = { date: string; seconds: number };
type Usage = {
  apps: AppUsage[];
  sites: SiteUsage[];
  total_seconds: number;
  tracking: boolean;
  hours: number[];
  days: DayTotal[];
};

type Range = "today" | "week";

/**
 * `Mon`, `Tue`, … from a `YYYY-MM-DD` local date.
 *
 * Parsed as a **local** date deliberately: `new Date("2026-08-07")` is
 * interpreted as UTC midnight, which renders as the *previous* day for anyone
 * west of Greenwich and would label every bar wrong. Splitting the parts and
 * using the local constructor avoids the shift entirely.
 */
function weekdayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short" });
}

function isToday(isoDate: string): boolean {
  const now = new Date();
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  return local === isoDate;
}

/** Where the extension is loaded from — the one-time setup the token is for. */
const EXTENSION_PATH = "apps/NexusLocal/extensions/chrome-usage";

export function UsagePanel() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [range, setRange] = useState<Range>("today");
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const mounted = useRef(true);
  const alive = useCallback(() => mounted.current, []);

  const load = useCallback(async (which: Range) => {
    try {
      // `invoke()` keys are camelCase — snake_case works on macOS and
      // hard-fails on iOS with `invalid args`. `range` is one word, but the
      // rule still governs anything added here.
      const next = await invoke<Usage>("tt_usage_range", { range: which });
      if (alive()) setUsage(next);
    } catch {
      // The command is infallible by design (a missing day file is an empty
      // day). If it throws at all, the panel is better off staying as it was
      // than flashing an error over numbers that were correct a moment ago.
    }
  }, [alive]);

  useEffect(() => {
    mounted.current = true;
    // Re-runs when `range` changes, so switching tab refetches immediately
    // rather than showing the old range until the next poll.
    load(range);
    invoke<string>("tt_usage_token")
      .then((t) => alive() && setToken(t))
      .catch(() => undefined);
    // Slow poll: intervals only close when the frontmost app changes, so
    // anything faster mostly re-renders the same numbers.
    const t = setInterval(() => load(range), 15000);
    return () => {
      mounted.current = false;
      clearInterval(t);
    };
  }, [load, alive, range]);

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => alive() && setCopied(false), 1500);
    } catch {
      // Clipboard denied in the WebView — reveal it so it can be selected by
      // hand rather than leaving a button that silently does nothing.
      setShowToken(true);
    }
  }

  if (!usage) return null;
  const hasData = usage.apps.length > 0 || usage.sites.length > 0;
  // Nothing recording and nothing recorded: on iOS this is every launch.
  if (!usage.tracking && !hasData) return null;

  // Bars are scaled to the busiest row rather than to the day, so a day with one
  // dominant app still shows a readable difference between the rest.
  const topApp = usage.apps[0]?.seconds ?? 0;
  const topSite = usage.sites[0]?.seconds ?? 0;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs uppercase tracking-wide text-white/40">Usage</h2>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-white/45">
            {formatDuration(usage.total_seconds)}
          </span>
          <div className="flex gap-0.5 rounded-lg bg-white/[0.04] p-0.5">
            {(["today", "week"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`rounded-md px-2 py-1 text-[10px] font-medium capitalize transition-colors ${
                  range === r ? "bg-white/10 text-white/90" : "text-white/40 hover:text-white/70"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {range === "week" && usage.days.length > 1 && <WeekStrip days={usage.days} />}

      {hasData && (
        <>
          <HourlyChart hours={usage.hours ?? []} multiDay={range === "week"} />
          <SharePie
            slices={usage.apps.map((a) => ({ label: a.name, seconds: a.seconds }))}
            total={usage.total_seconds}
            label={range === "week" ? "this week" : "today"}
          />
        </>
      )}

      {!usage.tracking && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-3 text-[10px] text-amber-200/80">
          Nothing is recording right now — the background service isn't running, so
          these are the totals up to the point it stopped. Turn on{" "}
          <span className="text-amber-100/90">Background service</span> under
          Enforcement.
        </div>
      )}

      {!hasData ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[10px] text-white/40">
          Nothing recorded yet today. App time appears after a couple of minutes;
          site time needs the browser extension below.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Rows
            title="Apps"
            empty="No app time recorded yet today."
            rows={usage.apps.map((a) => ({ label: a.name, seconds: a.seconds }))}
            max={topApp}
          />
          <Rows
            title="Sites"
            empty="No site time yet — the browser extension reports these."
            rows={usage.sites.map((s) => ({ label: s.host, seconds: s.seconds }))}
            max={topSite}
          />
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="text-[10px] text-white/45">Browser extension · one-time setup</div>
        <p className="mt-1 text-[10px] leading-relaxed text-white/30">
          Load <span className="font-mono text-white/45">{EXTENSION_PATH}</span> at
          chrome://extensions (Developer mode → Load unpacked), then paste this token
          into its settings page. It authenticates the extension to this Mac —
          without it, any web page could write to your usage history.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-black/30 px-2 py-1 font-mono text-[10px] text-white/50">
            {token ? (showToken ? token : `${token.slice(0, 8)}${"•".repeat(12)}`) : "—"}
          </code>
          <button
            onClick={() => setShowToken((v) => !v)}
            disabled={!token}
            className="shrink-0 rounded bg-white/[0.06] px-2 py-1 text-[10px] font-medium text-white/40 disabled:opacity-40"
          >
            {showToken ? "hide" : "show"}
          </button>
          <button
            onClick={copyToken}
            disabled={!token}
            className={`shrink-0 rounded px-2 py-1 text-[10px] font-medium disabled:opacity-40 ${
              copied ? "bg-emerald-500/15 text-emerald-300" : "bg-white/[0.06] text-white/40"
            }`}
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
      </div>

      <p className="text-[10px] text-white/30">
        Stored on this Mac only, in ~/.nexuslocal/usage — never synced anywhere.
      </p>
    </section>
  );
}

/**
 * Seven days of app time as a bar strip.
 *
 * Bars are scaled to the busiest day in the range, not to a fixed ceiling, so
 * the shape of a quiet week is still readable. Today is highlighted because it
 * is the one bar that is still growing — comparing a part-day against six whole
 * ones is the easiest way to misread this chart.
 */
function WeekStrip({ days }: { days: DayTotal[] }) {
  const max = Math.max(...days.map((d) => d.seconds), 1);
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      {/* `items-stretch`, not `items-end` — see the note in UsageCharts.tsx.
          `flex-end` collapses each column to its content height and every bar
          below resolves to 0%. */}
      <div className="flex items-stretch justify-between gap-1.5" style={{ height: 64 }}>
        {days.map((d) => {
          const today = isToday(d.date);
          // A day with a little time still gets a visible sliver; a genuinely
          // empty day stays flat, so "nothing" and "barely anything" look
          // different.
          const pct = d.seconds > 0 ? Math.max(6, Math.round((d.seconds / max) * 100)) : 0;
          return (
            <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="flex w-full flex-1 items-end">
                <div
                  className={`w-full rounded-sm ${today ? "bg-indigo-400/70" : "bg-white/25"}`}
                  style={{ height: `${pct}%` }}
                  title={`${d.date} · ${formatDuration(d.seconds)}`}
                />
              </div>
              <span
                className={`text-[9px] ${today ? "text-indigo-300/80" : "text-white/30"}`}
              >
                {weekdayLabel(d.date)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-baseline justify-between text-[10px]">
        <span className="text-white/30">
          Daily average{" "}
          <span className="font-mono text-white/45">
            {formatDuration(Math.round(days.reduce((a, d) => a + d.seconds, 0) / days.length))}
          </span>
        </span>
        <span className="text-white/25">today is partial</span>
      </div>
    </div>
  );
}

function Rows({
  title,
  empty,
  rows,
  max,
}: {
  title: string;
  empty: string;
  rows: Array<{ label: string; seconds: number }>;
  max: number;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="text-[10px] uppercase tracking-wide text-white/35">{title}</div>
      {rows.length === 0 ? (
        <div className="mt-1 text-[10px] text-white/25">{empty}</div>
      ) : (
        <div className="mt-1.5 flex flex-col gap-1">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[11px] text-white/75">{row.label}</span>
                  <span className="shrink-0 font-mono text-[10px] text-white/40">
                    {formatDuration(row.seconds)}
                  </span>
                </div>
                <div className="mt-0.5 h-0.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-white/25"
                    style={{ width: `${max > 0 ? Math.round((row.seconds / max) * 100) : 0}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
