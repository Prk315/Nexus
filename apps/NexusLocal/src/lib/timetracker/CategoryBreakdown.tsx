/**
 * Category breakdown — where the accounted day/week actually went, split by
 * the shared taxonomy instead of by source. `DayCoveragePanel` answers "is
 * the day covered"; this answers "covered by what" and "is that on budget".
 *
 * Three sections:
 *  - **Daily totals** for whichever date `DayCoveragePanel` currently has
 *    selected (shared via `./selectedDate`) — one row per category, plus
 *    Uncategorized last when it's non-zero.
 *  - **Weekly budgets** — Monday-start (Europe/Copenhagen) actual vs. the
 *    optional `weekly_target_min` on `coverage_categories`, editable inline.
 *  - **Categorize apps** (collapsed by default) — the last-7-days top apps by
 *    screen time, each mapped to a category via `app_category_map`.
 *
 * Data sources: `coverage_categories` / `app_category_map` (config, this
 * component's own reads/writes), and the same span sources DayCoveragePanel
 * already loads — `useDayCoverage` for the single selected day, `loadHistory`
 * (the batched multi-day loader from `history.ts`) for the week and the
 * 7-day app ranking, so neither section fires a per-day query fan-out.
 *
 * All attribution math is `categoryTotals` from `@nexus/core/categories`
 * (re-exported via the local `./categories` shim) — this component only
 * shapes spans into its input and renders the result.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabasePublic } from "../supabase";
import { nodeUserId } from "../nodeUser";
import { formatDuration } from "./UsageCharts";
import {
  CATEGORIES,
  UNCATEGORIZED,
  categoryTotals,
  type PlannedBlock,
  type ScreenAppSpans,
} from "./categories";
import { type Span, dayStartMs, shiftYmd, totalSeconds, union, ymd } from "./coverage";
import { type DayCoverage, loadHistory } from "./history";
import { useSelectedDate } from "./selectedDate";
import { useDayCoverage } from "./useDayCoverage";

type DbCategory = {
  id: string;
  name: string;
  color: string;
  emoji: string | null;
  sort: number;
  weekly_target_min: number | null;
};

/** Used when `coverage_categories` can't be reached — budgets unavailable. */
const FALLBACK_CATEGORIES: DbCategory[] = CATEGORIES.map((c, i) => ({
  id: c.name,
  name: c.name,
  color: c.color,
  emoji: c.emoji,
  sort: i,
  weekly_target_min: null,
}));

const TZ = "Europe/Copenhagen";

/** Days since Monday (0 = Monday) for "today" in Copenhagen wall-clock time. */
function daysSinceMondayCopenhagen(): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(
    new Date(),
  );
  const order: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return order[weekday] ?? 0;
}

/** Group spans that carry an app name in `label` by that name. */
function groupByApp(spans: Span[]): ScreenAppSpans[] {
  const byName = new Map<string, Span[]>();
  for (const s of spans) {
    if (!s.label) continue;
    const list = byName.get(s.label);
    if (list) list.push(s);
    else byName.set(s.label, [s]);
  }
  return Array.from(byName, ([name, spans]) => ({ name, spans }));
}

/** Same grouping across several days' worth of screen spans at once. */
function groupByAppAcrossDays(days: DayCoverage[]): ScreenAppSpans[] {
  return groupByApp(days.flatMap((d) => d.screen));
}

/**
 * `useDayCoverage`/`history.ts`'s planned spans -> categoryTotals' shape.
 * Carries `id`/`parentId` through (Phase U1) so `categoryTotals`'
 * children-win rule actually fires here — without this, threading those
 * fields onto `PlannedSpan` upstream would be dead weight, since this is the
 * one place they get converted into what `categoryTotals` reads.
 */
function toPlannedBlocks(spans: (Span & { category: string | null; id?: string; parentBlockId?: string | null })[]): PlannedBlock[] {
  return spans.map((p) => ({ category: p.category, title: p.label ?? "", span: p, id: p.id, parentId: p.parentBlockId }));
}

/** "1h 23m" for minutes rather than seconds — the budget inputs are minutes. */
function formatMinutes(minutes: number): string {
  return formatDuration(minutes * 60);
}

export function CategoryBreakdown() {
  const [date] = useSelectedDate(); // read-only here — DayCoveragePanel owns the picker.
  const { screen: daySpans, training: dayTraining, planned: dayPlanned } = useDayCoverage(date);

  const [categories, setCategories] = useState<DbCategory[]>(FALLBACK_CATEGORIES);
  const [budgetsAvailable, setBudgetsAvailable] = useState(true);
  const [appMap, setAppMap] = useState<Map<string, string>>(new Map());
  const [weekDays, setWeekDays] = useState<DayCoverage[]>([]);
  const [sevenDays, setSevenDays] = useState<DayCoverage[]>([]);
  const [appsOpen, setAppsOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [error, setError] = useState("");

  const loadCategories = useCallback(async () => {
    const user = await nodeUserId();
    const { data, error: e } = await supabasePublic
      .from("coverage_categories")
      .select("id, name, color, emoji, sort, weekly_target_min")
      .eq("user_id", user)
      .order("sort", { ascending: true });
    if (e || !data || data.length === 0) {
      // Fetch failed (or the migration hasn't been applied on this
      // machine yet) — fall back to the constant. No budgets without a
      // weekly_target_min column to read, but the rest of the panel works.
      setCategories(FALLBACK_CATEGORIES);
      setBudgetsAvailable(false);
      return;
    }
    setCategories(data as DbCategory[]);
    setBudgetsAvailable(true);
  }, []);

  const loadAppMap = useCallback(async () => {
    const user = await nodeUserId();
    const { data } = await supabasePublic
      .from("app_category_map")
      .select("process_name, category")
      .eq("user_id", user);
    const next = new Map<string, string>();
    for (const row of data ?? []) next.set(row.process_name, row.category);
    setAppMap(next);
  }, []);

  const loadWeek = useCallback(async () => {
    const [week, last7] = await Promise.all([
      loadHistory(daysSinceMondayCopenhagen() + 1),
      loadHistory(7),
    ]);
    setWeekDays(week);
    setSevenDays(last7);
  }, []);

  useEffect(() => {
    loadCategories().catch(() => {});
    loadAppMap().catch(() => {});
    loadWeek().catch(() => {});
  }, [loadCategories, loadAppMap, loadWeek]);

  // ── Daily totals ───────────────────────────────────────────────────────
  const dayWindow: Span = { start: dayStartMs(date), end: dayStartMs(shiftYmd(date, 1)) };
  const dailyTotals = useMemo(
    () =>
      categoryTotals({
        screen: groupByApp(daySpans),
        planned: toPlannedBlocks(dayPlanned),
        training: dayTraining,
        appMap,
        window: dayWindow,
      }),
    [daySpans, dayPlanned, dayTraining, appMap, dayWindow.start, dayWindow.end],
  );

  // ── Weekly budgets ─────────────────────────────────────────────────────
  const weekWindow: Span = {
    start: weekDays.length > 0 ? dayStartMs(weekDays[0].date) : Date.now(),
    end: Date.now(),
  };
  const weeklyTotals = useMemo(
    () =>
      categoryTotals({
        screen: groupByAppAcrossDays(weekDays),
        planned: toPlannedBlocks(weekDays.flatMap((d) => d.planned)),
        training: weekDays.flatMap((d) => d.training),
        appMap,
        window: weekWindow,
      }),
    [weekDays, appMap, weekWindow.start, weekWindow.end],
  );

  // ── Top apps, last 7 days ──────────────────────────────────────────────
  const topApps = useMemo(() => {
    return groupByAppAcrossDays(sevenDays)
      .map((a) => ({ name: a.name, seconds: totalSeconds(union(a.spans)) }))
      .filter((a) => a.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 15);
  }, [sevenDays]);

  async function saveBudget(cat: DbCategory, minutes: number | null) {
    const user = await nodeUserId();
    const { error: e } = await supabasePublic.from("coverage_categories").upsert(
      {
        user_id: user,
        name: cat.name,
        color: cat.color,
        emoji: cat.emoji,
        sort: cat.sort,
        weekly_target_min: minutes,
      },
      { onConflict: "user_id,name" },
    );
    if (e) setError(e.message);
    else {
      setError("");
      setEditingBudget(null);
      await loadCategories();
    }
  }

  async function setAppCategory(processName: string, category: string | null) {
    const user = await nodeUserId();
    const { error: e } = category
      ? await supabasePublic
          .from("app_category_map")
          .upsert(
            { user_id: user, process_name: processName, category },
            { onConflict: "user_id,process_name" },
          )
      : await supabasePublic
          .from("app_category_map")
          .delete()
          .eq("user_id", user)
          .eq("process_name", processName);
    if (e) setError(e.message);
    else {
      setError("");
      await loadAppMap();
    }
  }

  const uncategorizedSeconds = dailyTotals.get(UNCATEGORIZED) ?? 0;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs uppercase tracking-wide text-white/40">Category breakdown</h2>

      {error && (
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 text-[10px] text-rose-300 break-all">
          {error}
        </div>
      )}

      {/* Daily totals */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="text-[10px] uppercase tracking-wide text-white/35">
          {date === ymd(new Date()) ? "Today" : date} by category
        </div>
        <div className="mt-1.5 flex flex-col gap-1">
          {categories.map((c) => {
            const seconds = dailyTotals.get(c.name) ?? 0;
            return (
              <div key={c.id} className="flex items-center justify-between text-[11px]">
                <span className="text-white/70">
                  {c.emoji ?? ""} {c.name}
                </span>
                <span className="font-mono text-white/50">
                  {seconds > 0 ? formatDuration(seconds) : "—"}
                </span>
              </div>
            );
          })}
          {uncategorizedSeconds > 0 && (
            <div className="flex items-center justify-between text-[11px] text-white/30">
              <span>{UNCATEGORIZED}</span>
              <span className="font-mono">{formatDuration(uncategorizedSeconds)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Weekly budgets */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="text-[10px] uppercase tracking-wide text-white/35">
          This week vs. budget
        </div>
        {!budgetsAvailable && (
          <p className="mt-1 text-[9px] text-white/25">
            coverage_categories unreachable — showing the built-in list, budgets unavailable.
          </p>
        )}
        <div className="mt-1.5 flex flex-col gap-1.5">
          {categories.map((c) => {
            const actualSeconds = weeklyTotals.get(c.name) ?? 0;
            const targetMin = c.weekly_target_min;
            const editing = editingBudget === c.id;
            const pct =
              targetMin && targetMin > 0
                ? Math.min(100, Math.round((actualSeconds / 60 / targetMin) * 100))
                : null;
            return (
              <div key={c.id} className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-white/70">
                    {c.emoji ?? ""} {c.name}
                  </span>
                  {editing ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        autoFocus
                        value={budgetInput}
                        onChange={(e) => setBudgetInput(e.target.value)}
                        placeholder="min/week"
                        className="w-20 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/80"
                      />
                      <button
                        onClick={() => {
                          const n = Number(budgetInput);
                          saveBudget(c, budgetInput.trim() === "" || !Number.isFinite(n) ? null : n);
                        }}
                        className="rounded px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/10"
                      >
                        save
                      </button>
                      <button
                        onClick={() => setEditingBudget(null)}
                        className="rounded px-1.5 py-0.5 text-[10px] text-white/40 hover:text-white/70"
                      >
                        cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setEditingBudget(c.id);
                        setBudgetInput(targetMin ? String(targetMin) : "");
                      }}
                      className="font-mono text-white/50 hover:text-white/80"
                      title="Edit weekly budget"
                    >
                      {targetMin
                        ? `${formatDuration(actualSeconds)} / ${formatMinutes(targetMin)}`
                        : "set budget"}
                    </button>
                  )}
                </div>
                {pct !== null && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className={`h-full rounded-full ${pct >= 100 ? "bg-amber-400/70" : "bg-emerald-400/60"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Categorize apps */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <button
          onClick={() => setAppsOpen((v) => !v)}
          className="flex w-full items-center justify-between text-[10px] uppercase tracking-wide text-white/35"
        >
          <span>Categorize apps</span>
          <span>{appsOpen ? "▲" : "▼"}</span>
        </button>
        {appsOpen && (
          <div className="mt-1.5 flex flex-col gap-1">
            {topApps.length === 0 && (
              <p className="text-[10px] text-white/25">No screen time in the last 7 days yet.</p>
            )}
            {topApps.map((app) => (
              <div key={app.name} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-white/70">{app.name}</span>
                <span className="w-14 shrink-0 font-mono text-[10px] text-white/40">
                  {formatDuration(app.seconds)}
                </span>
                <select
                  value={appMap.get(app.name) ?? ""}
                  onChange={(e) => setAppCategory(app.name, e.target.value || null)}
                  className="shrink-0 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/70"
                >
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.emoji ?? ""} {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
