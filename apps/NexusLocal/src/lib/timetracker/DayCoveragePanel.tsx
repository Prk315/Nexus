/**
 * Day coverage — where the whole day went, not just the screen part.
 *
 * The usage tracker only sees this Mac's foreground time, so a day full of
 * training, reading and cooking looks like a day of nothing. This panel
 * stitches four sources into one 24-hour timeline and turns what's left into
 * a to-log list:
 *
 *  - **Sleep** — Protocol's `protocol_sleep` bed/rise times, read with the
 *    anon client via the table's `widget_anon_read` policy (RLS pins the anon
 *    role to the owner's rows; empty result means "not synced", not an error).
 *  - **Screen** — the tracker's raw intervals via `tt_usage_intervals`, local
 *    JSONL only. Usage data never touches Supabase; this panel only *reads*
 *    remote rows next to it.
 *  - **Training** — Garmin activities from `protocol_workout_sessions` /
 *    `protocol_running_sessions`, placed by `started_at` (added 2026-08-16;
 *    rows imported before then have NULL and simply don't render). Runs have
 *    no stored duration — it is reconstructed as pace × distance, and a run
 *    missing either is skipped rather than guessed.
 *  - **Planned** — PathFinder calendar blocks (`pf_cal_blocks` + recurring).
 *
 * Unaccounted gaps ≥ 30 min carry one-tap category chips (the shared
 * CATEGORIES list): tapping inserts a `pf_cal_blocks` row over the gap —
 * rounded outward to 5-minute edges — so logging costs one tap and the gap
 * disappears on the refresh that follows.
 *
 * Honesty checks render as amber footnotes and never change the coverage
 * number: screen time inside the sleep window, and offline-category planned
 * blocks whose interior is mostly screen time. The point is that the number
 * stays trustworthy — a check that silently "fixed" the data would be worse
 * than the overlap it found.
 *
 * NOTE on recurring expansion: `pf_recurring_cal_blocks.days_of_week` uses JS
 * `getUTCDay()` numbering (0=Sun), matching PathFinder's `expandRecurring` —
 * NOT the ISO 1–7 numbering `focus_blocks` uses. Mixing those up shifts every
 * weekly block by a day.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabasePublic } from "../supabase";
import { nodeUserId } from "../nodeUser";
import { formatDuration } from "./UsageCharts";
import { CATEGORIES } from "./categories";
import {
  type Span,
  clip,
  dayStartMs,
  gapsIn,
  hm,
  hmOn,
  intersect,
  parseSleepTs,
  roundForLog,
  shiftYmd,
  totalSeconds,
  union,
  ymd,
} from "./coverage";
import {
  type DayCoverage,
  type GapSuggestion,
  detectRecurringGaps,
  dismissedSuggestions,
  dismissSuggestion,
  loadHistory,
} from "./history";

type UsageInterval = { name: string; start: string; end: string; seconds: number };

type CalRow = {
  title: string;
  start_time: string;
  end_time: string;
  color: string | null;
};

const GAP_MIN_SECONDS = 30 * 60;
/** Screen-during-sleep overlaps shorter than this are clock skew, not news. */
const HONESTY_MIN_MS = 5 * 60_000;
/** Titles that imply screen work even without a category match. */
const ONSCREEN_TITLE = /work|deep|study|code|research|writ|admin|meeting/i;

function sessionSpanEnd(startMs: number, durationSec: number): number {
  return startMs + Math.max(0, durationSec) * 1000;
}

const WEEKDAY_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** "Mo We Fr" for a sorted, distinct list of getUTCDay() values; "daily" for all 7. */
function weekdaySummary(weekdays: number[]): string {
  if (weekdays.length === 7) return "daily";
  return weekdays.map((d) => WEEKDAY_SHORT[d]).join(" ");
}

/** Is a planned block expected to be mostly on-screen? */
function onscreenBlock(title: string): boolean {
  const cat = CATEGORIES.find((c) => title.includes(c.name));
  if (cat) return cat.onscreen;
  return ONSCREEN_TITLE.test(title);
}

/** One track of the timeline: absolutely positioned segments over 24 h. */
function Track({
  label,
  spans,
  winStart,
  winEnd,
  colorCls,
}: {
  label: string;
  spans: Span[];
  winStart: number;
  winEnd: number;
  colorCls: string;
}) {
  const width = winEnd - winStart;
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-right text-[9px] text-white/35">{label}</span>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
        {spans.map((s, i) => (
          <div
            key={i}
            className={`absolute top-0 h-full ${colorCls}`}
            style={{
              left: `${((s.start - winStart) / width) * 100}%`,
              width: `${Math.max(0.4, ((s.end - s.start) / width) * 100)}%`,
            }}
            title={`${s.label ? `${s.label} · ` : ""}${hm(s.start)}–${hm(s.end)}`}
          />
        ))}
      </div>
    </div>
  );
}

export function DayCoveragePanel() {
  const [date, setDate] = useState(() => ymd(new Date()));
  const [screen, setScreen] = useState<Span[]>([]);
  const [sleep, setSleep] = useState<Span[]>([]);
  const [training, setTraining] = useState<Span[]>([]);
  const [planned, setPlanned] = useState<Span[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Ticks once a minute so "so far today" and the gap list stay current.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [history, setHistory] = useState<DayCoverage[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => dismissedSuggestions());

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const winStart = dayStartMs(date);
  const winEnd = dayStartMs(shiftYmd(date, 1));
  const isToday = date === ymd(new Date());

  const load = useCallback(async (day: string) => {
    const start = dayStartMs(day);
    const end = dayStartMs(shiftYmd(day, 1));
    const startIso = new Date(start).toISOString();
    const endIso = new Date(end).toISOString();

    // Screen — local only. Fails to empty on iOS (no daemon) and on any error.
    const screenSpans: Span[] = [];
    try {
      const intervals = await invoke<UsageInterval[]>("tt_usage_intervals", { date: day });
      for (const iv of intervals ?? []) {
        const s = Date.parse(iv.start);
        const e = Date.parse(iv.end);
        if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
        const clipped = clip({ start: s, end: e, label: iv.name }, start, end);
        if (clipped) screenSpans.push(clipped);
      }
    } catch {
      // No bridge (browser dev) or no command — screen band stays empty.
    }

    // Sleep — the night ending this morning is filed under `date = day`, and
    // tonight's bedtime under the next day; both can put minutes inside this
    // window. No user filter: widget_anon_read already scopes anon to the owner.
    const sleepSpans: Span[] = [];
    const { data: sleepRows } = await supabasePublic
      .from("protocol_sleep")
      .select("date, bedtime_start, bedtime_end")
      .in("date", [day, shiftYmd(day, 1)]);
    for (const row of sleepRows ?? []) {
      const s = parseSleepTs(row.bedtime_start);
      const e = parseSleepTs(row.bedtime_end);
      if (s === null || e === null || e <= s) continue;
      const clipped = clip({ start: s, end: e, label: "Sleep" }, start, end);
      if (clipped) sleepSpans.push(clipped);
    }

    // Training — Garmin activities with a start instant. Same anon-read
    // policies as sleep (added 2026-08-16). Pre-migration rows have NULL
    // started_at and are correctly absent.
    const trainingSpans: Span[] = [];
    const [{ data: workouts }, { data: runs }] = await Promise.all([
      supabasePublic
        .from("protocol_workout_sessions")
        .select("name, started_at, duration_min")
        .not("started_at", "is", null)
        .gte("started_at", startIso)
        .lt("started_at", endIso),
      supabasePublic
        .from("protocol_running_sessions")
        .select("notes, started_at, avg_pace_s_per_km, actual_km")
        .not("started_at", "is", null)
        .gte("started_at", startIso)
        .lt("started_at", endIso),
    ]);
    for (const w of workouts ?? []) {
      const s = Date.parse(w.started_at);
      if (!Number.isFinite(s) || typeof w.duration_min !== "number") continue;
      const span = clip(
        { start: s, end: sessionSpanEnd(s, w.duration_min * 60), label: w.name ?? "Workout" },
        start,
        end,
      );
      if (span) trainingSpans.push(span);
    }
    for (const r of runs ?? []) {
      const s = Date.parse(r.started_at);
      // Runs store no duration; pace × distance reconstructs it. Missing
      // either means the span length would be a guess — skip instead.
      if (
        !Number.isFinite(s) ||
        typeof r.avg_pace_s_per_km !== "number" ||
        typeof r.actual_km !== "number"
      ) {
        continue;
      }
      const span = clip(
        {
          start: s,
          end: sessionSpanEnd(s, r.avg_pace_s_per_km * r.actual_km),
          label: r.notes ?? "Run",
        },
        start,
        end,
      );
      if (span) trainingSpans.push(span);
    }

    // Planned — PathFinder's day, one-off blocks plus recurring expanded for
    // exactly this date (mirrors expandRecurring in PathFinder's api.ts).
    const plannedSpans: Span[] = [];
    const user = await nodeUserId();
    const [{ data: blocks }, { data: recurring }] = await Promise.all([
      supabasePublic
        .from("pf_cal_blocks")
        .select("title, start_time, end_time, color")
        .eq("user_id", user)
        .eq("date", day),
      supabasePublic
        .from("pf_recurring_cal_blocks")
        .select("title, start_time, end_time, color, recurrence, days_of_week, start_date, end_date")
        .eq("user_id", user)
        .lte("start_date", day)
        .or(`end_date.is.null,end_date.gte.${day}`),
    ]);

    const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0=Sun, PathFinder's numbering
    const todaysRecurring = (recurring ?? []).filter(
      (r) =>
        r.recurrence === "daily" ||
        (r.recurrence === "weekly" &&
          String(r.days_of_week ?? "").split(",").map(Number).includes(dow)),
    );

    for (const b of [...(blocks ?? []), ...todaysRecurring] as CalRow[]) {
      const s = hmOn(day, b.start_time);
      let e = hmOn(day, b.end_time);
      if (s === null || e === null) continue;
      if (e <= s) e = end; // crosses midnight — count the part on this day
      const clipped = clip({ start: s, end: e, label: b.title }, start, end);
      if (clipped) plannedSpans.push(clipped);
    }

    if (!alive.current) return;
    setScreen(screenSpans);
    setSleep(sleepSpans);
    setTraining(trainingSpans);
    setPlanned(plannedSpans);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load(date).catch(() => {});
    const t = setInterval(() => {
      setNowMs(Date.now());
      load(date).catch(() => {});
    }, 60_000);
    return () => clearInterval(t);
  }, [load, date]);

  const refreshHistory = useCallback(async () => {
    const next = await loadHistory(30);
    if (alive.current) setHistory(next);
  }, []);

  // History covers 30 immutable past days — load once on mount (and again
  // after an insert changes one of them), never on the 60-second tick. That
  // tick exists to keep "today" current; re-querying 30 days of Supabase
  // rows every minute for data that cannot have changed would be pure waste.
  useEffect(() => {
    refreshHistory().catch(() => {});
  }, [refreshHistory]);

  /** One-tap gap logging: insert a PathFinder block over the (rounded) gap. */
  async function logGap(gap: Span, category: (typeof CATEGORIES)[number]) {
    setBusy(true);
    try {
      const user = await nodeUserId();
      const rounded = roundForLog(gap, winStart, winEnd);
      const { error: e } = await supabasePublic.from("pf_cal_blocks").insert({
        user_id: user,
        date,
        title: `${category.emoji} ${category.name}`,
        start_time: hm(rounded.start),
        end_time: rounded.end >= winEnd ? "23:59" : hm(rounded.end),
        color: category.color,
        description: "Logged from Nexus Local day coverage",
        location: null,
        task_id: null,
      });
      if (e) {
        setError(e.message);
      } else {
        setError("");
        await refreshHistory();
      }
      await load(date);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  /** Accept a recurring-gap suggestion: file it as a weekly PathFinder block. */
  async function acceptSuggestion(suggestion: GapSuggestion, category: (typeof CATEGORIES)[number]) {
    setBusy(true);
    try {
      const user = await nodeUserId();
      const { error: e } = await supabasePublic.from("pf_recurring_cal_blocks").insert({
        user_id: user,
        title: `${category.emoji} ${category.name}`,
        start_time: suggestion.startHm,
        end_time: suggestion.endHm,
        color: category.color,
        recurrence: "weekly",
        days_of_week: suggestion.weekdays.join(","),
        start_date: ymd(new Date()),
        end_date: null,
        description: "Suggested by Nexus Local day coverage",
        location: null,
      });
      if (e) {
        setError(e.message);
      } else {
        setError("");
        // The suggestion disappears on recompute once history reflects the
        // new block — but dismiss it too, so a window that's only partially
        // covered by the new recurring block can't re-suggest itself.
        dismissSuggestion(suggestion.key);
        setDismissed(dismissedSuggestions());
        await refreshHistory();
        await load(date);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  function dismiss(key: string) {
    dismissSuggestion(key);
    setDismissed(dismissedSuggestions());
  }

  if (!loaded) return null;

  // Coverage is judged against the day so far, not the whole day — 9 a.m.
  // should not read as 62% missing.
  const judgeEnd = isToday ? Math.min(nowMs, winEnd) : winEnd;
  const covered = union([...sleep, ...screen, ...training, ...planned]);
  const uncovered = gapsIn(covered, winStart, judgeEnd);
  const elapsed = Math.round((judgeEnd - winStart) / 1000);
  const accounted = elapsed - totalSeconds(uncovered);
  const gaps = uncovered.filter((g) => g.end - g.start >= GAP_MIN_SECONDS * 1000);
  const pct = elapsed > 0 ? Math.round((accounted / elapsed) * 100) : 0;

  // ── Honesty checks — reported, never subtracted ──────────────────────────
  const screenDuringSleep = intersect(screen, sleep).filter(
    (s) => s.end - s.start >= HONESTY_MIN_MS,
  );
  const screenHeavyBlocks = planned.filter((b) => {
    if (b.end - b.start < GAP_MIN_SECONDS * 1000) return false;
    if (!b.label || onscreenBlock(b.label)) return false;
    const overlap = totalSeconds(intersect(screen, [b]));
    return overlap / ((b.end - b.start) / 1000) > 0.5;
  });

  const suggestions = detectRecurringGaps(history, ymd(new Date())).filter(
    (s) => !dismissed.has(s.key),
  );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs uppercase tracking-wide text-white/40">Day coverage</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setDate(shiftYmd(date, -1))}
            className="rounded px-1.5 py-0.5 text-[11px] text-white/40 hover:text-white/80"
            aria-label="Previous day"
          >
            ◀
          </button>
          <span className="font-mono text-[10px] text-white/60">{isToday ? "today" : date}</span>
          <button
            onClick={() => !isToday && setDate(shiftYmd(date, 1))}
            disabled={isToday}
            className="rounded px-1.5 py-0.5 text-[11px] text-white/40 hover:text-white/80 disabled:opacity-25"
            aria-label="Next day"
          >
            ▶
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 text-[10px] text-rose-300 break-all">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex flex-col gap-1.5">
          <Track label="Sleep" spans={sleep} winStart={winStart} winEnd={winEnd} colorCls="bg-indigo-400/60" />
          <Track label="Screen" spans={screen} winStart={winStart} winEnd={winEnd} colorCls="bg-sky-400/60" />
          <Track label="Training" spans={training} winStart={winStart} winEnd={winEnd} colorCls="bg-emerald-400/60" />
          <Track label="Planned" spans={planned} winStart={winStart} winEnd={winEnd} colorCls="bg-amber-400/55" />
        </div>
        {/* Hour ruler */}
        <div className="mt-1 flex justify-between pl-14 text-[8px] text-white/25">
          {[0, 6, 12, 18, 24].map((h) => (
            <span key={h}>{String(h).padStart(2, "0")}</span>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[10px]">
          <span className="text-white/70">
            {pct}% accounted{isToday ? " so far" : ""}
          </span>
          <span className="text-indigo-300/70">sleep {formatDuration(totalSeconds(sleep))}</span>
          <span className="text-sky-300/70">screen {formatDuration(totalSeconds(union(screen)))}</span>
          <span className="text-emerald-300/70">
            training {formatDuration(totalSeconds(union(training)))}
          </span>
          <span className="text-amber-300/70">planned {formatDuration(totalSeconds(union(planned)))}</span>
        </div>
      </div>

      {history.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex gap-0.5" style={{ height: 24 }}>
            {history.map((d) => {
              const alpha = d.pct > 0 ? 0.12 + 0.55 * (d.pct / 100) : 0;
              const selected = d.date === date;
              return (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => setDate(d.date)}
                  title={`${d.date} · ${d.pct}%`}
                  className={`h-full flex-1 rounded-sm ${
                    d.pct > 0 ? "" : "bg-white/[0.04]"
                  } ${selected ? "ring-1 ring-white/40" : ""}`}
                  style={d.pct > 0 ? { backgroundColor: `rgba(129,140,248,${alpha})` } : undefined}
                />
              );
            })}
          </div>
          <div className="mt-2 flex items-baseline justify-between text-[10px]">
            <span className="text-white/30">30-day coverage</span>
            <span className="text-white/25">today is partial</span>
          </div>
        </div>
      )}

      {gaps.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[10px] uppercase tracking-wide text-white/35">
            Unaccounted · tap to log
          </div>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {gaps.map((g, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between text-[11px]">
                  <span className="font-mono text-white/70">
                    {hm(g.start)}–{hm(g.end)}
                  </span>
                  <span className="font-mono text-[10px] text-rose-300/70">
                    {formatDuration(Math.round((g.end - g.start) / 1000))}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.name}
                      onClick={() => logGap(g, c)}
                      disabled={busy}
                      title={`Log as ${c.name}`}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/60 hover:border-white/25 hover:text-white/90 disabled:opacity-40"
                    >
                      {c.emoji} {c.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[9px] leading-relaxed text-white/25">
            A tap files a PathFinder calendar block over the gap (rounded to 5 min).
            Edit or retitle it later in the Week view.
          </p>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[10px] uppercase tracking-wide text-white/35">
            Recurring gaps · make it a plan
          </div>
          <div className="mt-1.5 flex flex-col gap-2">
            {suggestions.map((s) => (
              <div key={s.key} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between text-[11px]">
                  <span className="font-mono text-white/70">
                    {s.startHm}–{s.endHm}
                    <span className="ml-2 font-sans text-white/40">
                      {weekdaySummary(s.weekdays)}
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white/30">
                      seen {s.dates.length} of last 7 days
                    </span>
                    <button
                      onClick={() => dismiss(s.key)}
                      title="Dismiss suggestion"
                      className="rounded px-1 text-[11px] text-white/30 hover:text-white/70"
                    >
                      dismiss ×
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.name}
                      onClick={() => acceptSuggestion(s, c)}
                      disabled={busy}
                      title={`Make a weekly ${c.name} block ${s.startHm}–${s.endHm}`}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/60 hover:border-white/25 hover:text-white/90 disabled:opacity-40"
                    >
                      {c.emoji} {c.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(screenDuringSleep.length > 0 || screenHeavyBlocks.length > 0) && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-3 text-[10px] text-amber-200/70">
          {screenDuringSleep.map((s, i) => (
            <div key={`sl-${i}`}>
              Screen time during sleep {hm(s.start)}–{hm(s.end)} — bedtime and this Mac
              disagree about one of them.
            </div>
          ))}
          {screenHeavyBlocks.map((b, i) => (
            <div key={`bl-${i}`}>
              “{b.label}” ({hm(b.start)}–{hm(b.end)}) was mostly screen time — the plan
              and the day drifted apart.
            </div>
          ))}
        </div>
      )}

      {sleep.length === 0 && (
        <p className="text-[9px] text-white/25">
          No sleep for this day yet — Protocol's Oura sync writes bed/rise times daily.
        </p>
      )}
    </section>
  );
}
