import { useRef, useState } from "react";
import { Clock } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { createClient } from "@supabase/supabase-js";
import {
  type Span,
  clip,
  dayStartMs,
  hmOn,
  parseSleepTs,
  shiftYmd,
  ymd,
} from "../coverage";
import {
  CATEGORIES,
  UNCATEGORIZED,
  categoryTotals,
  type PlannedBlock,
  type ScreenAppSpans,
} from "../categories";
import { cn } from "../utils";

/**
 * The Clock dropdown: "where did today go" at a glance, in every app that
 * mounts NexusHeader. Three sections — day stats by category, PathFinder's
 * daily progress donut recreated read-only, and a non-interactive mini
 * timetrack strip — all fed straight from Supabase rather than IPC, so it
 * works the same in a browser dev run as inside Tauri.
 *
 * nexus-core has no Supabase client of its own — NexusAuth takes each app's
 * client as a prop instead, and that client is frequently an *authed*
 * session (PathFinder's, NexusLocal's…). The productivity tables here are
 * gated by `widget_anon_read`-style policies scoped to the *anon* role; a
 * mismatched authed JWT reads back an empty set, not an error, so reusing an
 * app's client would silently show a blank dropdown in exactly the apps most
 * likely to have a session. A second, session-less client is created here
 * instead, from the same `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` env
 * vars every app's own client already reads (uncommitted `.env` files — the
 * key is deliberately not in the repo; see the anon-key-out effort). Apps
 * that don't declare them (Stonks has no Supabase use of its own yet) get
 * `anon = null` and the dropdown renders its not-configured state instead of
 * data — the same silent-degradation contract as every fetch failure here.
 */
// `(import.meta as any)` — not every consuming app's tsconfig loads
// `vite/client` types (TimeTrackerApp doesn't), and this file compiles in all
// of them. Vite still statically injects the env object at build time.
const viteEnv = ((import.meta as { env?: Record<string, string> }).env ?? {}) as Record<string, string>;
const SUPABASE_URL = viteEnv.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = viteEnv.VITE_SUPABASE_ANON_KEY ?? "";

const anon =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

/**
 * The one real account behind every `widget_anon_read` policy on `pf_tasks`,
 * `pf_daily_primary_goal`, `pf_daily_secondary_goals`, `protocol_sleep`,
 * `protocol_workout_sessions` and `protocol_running_sessions` (verified
 * directly against the project's `pg_policies`, 2026-08-21). `coverage_categories`
 * and `app_category_map` are on a different, older convention — fully open to
 * `anon` and keyed `user_id = 'default'` — so they are filtered separately.
 */
const OWNER_UID = "a33625c2-4dd2-44fa-b2e5-4d455eeac59d";

const REFETCH_AFTER_MS = 5 * 60 * 1000;

// ── Small local helpers (deliberately not imported from NexusLocal/PathFinder —
// nexus-core cannot depend on any app) ──────────────────────────────────────

/** "1h 23m" / "45m" for a minute count. */
function fmtMin(min: number): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h > 0 && rem > 0) return `${h}h ${rem}m`;
  if (h > 0) return `${h}h`;
  return `${rem}m`;
}

/** Same, from a second count (day-stats rows work in seconds like categoryTotals). */
function fmtSec(sec: number): string {
  return fmtMin(sec / 60);
}

/** Group spans that carry an app name in `label` by that name (categoryTotals' input shape). */
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

// Category-name-color -> hex. Hand-rolled so bars/bands don't depend on
// Tailwind JIT resolving a dynamically-built class name (`bg-${color}-500`
// is invisible to the purge scanner across a package boundary).
const COLOR_HEX: Record<string, string> = {
  blue: "#3b82f6", indigo: "#6366f1", violet: "#8b5cf6", purple: "#a855f7",
  pink: "#ec4899", rose: "#f43f5e", red: "#ef4444", orange: "#f97316",
  amber: "#f59e0b", yellow: "#eab308", green: "#22c55e", emerald: "#10b981",
  teal: "#14b8a6", cyan: "#06b6d4", sky: "#0ea5e9", slate: "#64748b",
};
const FALLBACK_PLANNED_HEX = "#f59e0b"; // amber-ish, per spec, for an unmatched block color
function colorHex(name: string | null | undefined, fallback = "#64748b"): string {
  if (!name) return fallback;
  return COLOR_HEX[name] ?? fallback;
}

type ScreenSpan = { name: string; start: number; end: number };
export type ClockDropdownProps = {
  /** Optional: today's per-app screen spans. Only apps with a usage bridge pass this (PathFinder). */
  loadScreenSpans?: () => Promise<ScreenSpan[]>;
};

type DbCategory = { name: string; color: string; emoji: string };
const FALLBACK_CATEGORIES: DbCategory[] = CATEGORIES.map((c) => ({
  name: c.name, color: c.color, emoji: c.emoji,
}));

type DayStatsRow = { name: string; color: string; emoji: string; seconds: number };

type PieState = { doneMin: number; pendingMin: number; freeMin: number; capTotal: number } | null;

type StripBand = { start: number; end: number; color: string };
type StripState = { sleep: StripBand[]; planned: StripBand[]; training: StripBand[]; screen: StripBand[] } | null;

type LoadedData = {
  dayStats: { rows: DayStatsRow[]; uncategorizedSeconds: number; screenTracked: boolean } | null;
  pie: PieState;
  strip: StripState;
};

async function fetchAll(loadScreenSpans?: () => Promise<ScreenSpan[]>): Promise<LoadedData> {
  // No env-configured client (app has no .env with VITE_SUPABASE_*) → the
  // caller's catch renders the same empty state as any total fetch failure.
  if (!anon) throw new Error("supabase not configured");
  const today = ymd(new Date());
  const tomorrow = shiftYmd(today, 1);
  const winStart = dayStartMs(today);
  const winEnd = dayStartMs(tomorrow);
  const window: Span = { start: winStart, end: winEnd };
  const startIso = new Date(winStart).toISOString();
  const endIso = new Date(winEnd).toISOString();

  const [
    catRes, mapRes, blocksRes, workoutsRes, runsRes, sleepRes,
    tasksRes, primaryGoalRes, secondaryGoalsRes, screenRes,
  ] = await Promise.allSettled([
    anon.from("coverage_categories").select("name,color,emoji,sort").eq("user_id", "default").order("sort", { ascending: true }),
    anon.from("app_category_map").select("process_name,category").eq("user_id", "default"),
    // `pf_cal_blocks` gained a `widget_anon_read` policy (pinned to OWNER_UID)
    // on 2026-08-21 — added precisely because building this dropdown exposed
    // that no anon read path existed, which had also silently broken Nexus
    // Local's calendar logging since Phase A. See migration
    // 20260821220000_pf_cal_blocks_anon_access.sql.
    anon.from("pf_cal_blocks").select("id,title,start_time,end_time,category,color,parent_block_id").eq("user_id", OWNER_UID).eq("date", today),
    anon.from("protocol_workout_sessions").select("name,started_at,duration_min").eq("user_id", OWNER_UID).not("started_at", "is", null).gte("started_at", startIso).lt("started_at", endIso),
    anon.from("protocol_running_sessions").select("notes,started_at,avg_pace_s_per_km,actual_km").eq("user_id", OWNER_UID).not("started_at", "is", null).gte("started_at", startIso).lt("started_at", endIso),
    anon.from("protocol_sleep").select("date,bedtime_start,bedtime_end").gte("date", today).lte("date", tomorrow).eq("user_id", OWNER_UID),
    anon.from("pf_tasks").select("id,title,done,aggregate_estimate,time_estimate").eq("user_id", OWNER_UID).is("parent_id", null).eq("due_date", today),
    anon.from("pf_daily_primary_goal").select("text,time_estimate_min").eq("user_id", OWNER_UID).eq("date", today).maybeSingle(),
    anon.from("pf_daily_secondary_goals").select("id,text,time_estimate_min").eq("user_id", OWNER_UID).eq("date", today),
    loadScreenSpans ? loadScreenSpans().catch(() => [] as ScreenSpan[]) : Promise.resolve(null),
  ]);

  // ── Shared building blocks ────────────────────────────────────────────
  const trainingSpans: Span[] = [];
  if (workoutsRes.status === "fulfilled") {
    for (const w of workoutsRes.value.data ?? []) {
      const s = Date.parse(w.started_at as string);
      if (!Number.isFinite(s) || typeof w.duration_min !== "number") continue;
      trainingSpans.push({ start: s, end: s + Math.max(0, w.duration_min) * 60_000, label: (w.name as string) ?? "Workout" });
    }
  }
  if (runsRes.status === "fulfilled") {
    for (const r of runsRes.value.data ?? []) {
      const s = Date.parse(r.started_at as string);
      if (!Number.isFinite(s) || typeof r.avg_pace_s_per_km !== "number" || typeof r.actual_km !== "number") continue;
      trainingSpans.push({ start: s, end: s + r.avg_pace_s_per_km * r.actual_km * 1000, label: (r.notes as string) ?? "Run" });
    }
  }
  const trainingClipped = trainingSpans.map((t) => clip(t, winStart, winEnd)).filter((t): t is Span => t !== null);

  const sleepSpans: Span[] = [];
  if (sleepRes.status === "fulfilled") {
    for (const row of sleepRes.value.data ?? []) {
      const s = parseSleepTs(row.bedtime_start as string | null);
      const e = parseSleepTs(row.bedtime_end as string | null);
      if (s === null || e === null || e <= s) continue;
      const c = clip({ start: s, end: e }, winStart, winEnd);
      if (c) sleepSpans.push(c);
    }
  }

  const plannedBlocks: PlannedBlock[] = [];
  const plannedBands: StripBand[] = [];
  if (blocksRes.status === "fulfilled") {
    type PlannedRow = {
      id: number | string; title: string; start_time: string; end_time: string;
      category: string | null; color: string | null; parent_block_id: number | string | null;
    };
    const rows = (blocksRes.value.data ?? []) as PlannedRow[];
    // Phase U1 (nested blocks): the mini strip has no inset container like
    // Week's TimeColumn — it draws every band flat, at the same width. The
    // ONLY way a nested child stays visible at all is paint order, so rows
    // are sorted parent-before-child (by depth, walking `parent_block_id`
    // within today's own fetched set) before the loop below pushes bands in
    // that order — later pushes paint on top.
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    function depthOf(r: PlannedRow, seen: Set<string> = new Set()): number {
      if (r.parent_block_id == null) return 0;
      const pid = String(r.parent_block_id);
      if (seen.has(pid)) return 0; // defensive: never hang on a stale cycle
      const parent = byId.get(pid);
      if (!parent) return 0; // parent not in today's set — orphan, treat as top-level
      return 1 + depthOf(parent, new Set(seen).add(pid));
    }
    const ordered = [...rows].sort((a, b) => depthOf(a) - depthOf(b));
    for (const b of ordered) {
      const s = hmOn(today, b.start_time);
      let e = hmOn(today, b.end_time);
      if (s === null || e === null) continue;
      if (e <= s) e = winEnd; // crosses midnight — count the part on today
      plannedBlocks.push({
        category: b.category, title: b.title, span: { start: s, end: e },
        id: String(b.id), parentId: b.parent_block_id != null ? String(b.parent_block_id) : null,
      });
      plannedBands.push({ start: s, end: e, color: colorHex(b.color, FALLBACK_PLANNED_HEX) });
    }
  }

  const screenSpansRaw: ScreenSpan[] = screenRes.status === "fulfilled" && screenRes.value ? screenRes.value : [];
  const screenTracked = !!loadScreenSpans;
  const screenSpans: Span[] = screenSpansRaw
    .map((s) => clip({ start: s.start, end: s.end, label: s.name }, winStart, winEnd))
    .filter((s): s is Span => s !== null);

  // ── Section A: category totals ────────────────────────────────────────
  const categories: DbCategory[] =
    catRes.status === "fulfilled" && (catRes.value.data?.length ?? 0) > 0
      ? (catRes.value.data as DbCategory[])
      : FALLBACK_CATEGORIES;
  const appMap = new Map<string, string>();
  if (mapRes.status === "fulfilled") {
    for (const row of mapRes.value.data ?? []) appMap.set(row.process_name as string, row.category as string);
  }
  const totals = categoryTotals({
    screen: screenTracked ? groupByApp(screenSpans) : [],
    planned: plannedBlocks,
    training: trainingClipped,
    appMap,
    window,
  });
  const rows: DayStatsRow[] = categories.map((c) => ({
    name: c.name, color: c.color, emoji: c.emoji, seconds: totals.get(c.name) ?? 0,
  }));
  const uncategorizedSeconds = totals.get(UNCATEGORIZED) ?? 0;
  const dayStats = { rows, uncategorizedSeconds, screenTracked };

  // ── Section B: pie ───────────────────────────────────────────────────
  let pie: PieState = null;
  if (tasksRes.status === "fulfilled" && !tasksRes.value.error) {
    const TASK_MIN = 10;
    let doneMin = 0, pendingMin = 0;
    for (const t of tasksRes.value.data ?? []) {
      const min = (t.aggregate_estimate as number) || (t.time_estimate as number) || TASK_MIN;
      t.done ? (doneMin += min) : (pendingMin += min);
    }
    // Goal done-state lives in PathFinder's own localStorage (Dashboard.tsx),
    // not in Supabase — it is per-browser-origin and simply won't be found
    // outside PathFinder. That's an accepted drift for this read-only
    // recreation: the goal still counts toward the ring, just as "pending"
    // in every app but PathFinder itself.
    let doneState: { primary: boolean; secondary: number[] } = { primary: false, secondary: [] };
    try {
      const raw = localStorage.getItem(`daily_goals_done_${today}`);
      if (raw) doneState = { primary: false, secondary: [], ...JSON.parse(raw) };
    } catch { /* no localStorage (SSR-ish) or bad JSON — treat as nothing done */ }
    const secDoneSet = new Set(doneState.secondary ?? []);

    if (primaryGoalRes.status === "fulfilled" && primaryGoalRes.value.data?.time_estimate_min) {
      const min = primaryGoalRes.value.data.time_estimate_min as number;
      doneState.primary ? (doneMin += min) : (pendingMin += min);
    }
    if (secondaryGoalsRes.status === "fulfilled") {
      for (const g of secondaryGoalsRes.value.data ?? []) {
        if (!g.time_estimate_min) continue;
        secDoneSet.has(g.id) ? (doneMin += g.time_estimate_min as number) : (pendingMin += g.time_estimate_min as number);
      }
    }

    const TOTAL_MIN = 16 * 60;
    const workMin = doneMin + pendingMin;
    const capTotal = Math.max(TOTAL_MIN, workMin);
    const freeMin = capTotal - workMin;
    pie = { doneMin, pendingMin, freeMin, capTotal };
  }
  // pf_tasks itself failing (RLS or network) drops Section B entirely, per spec.
  // pf_course_assignments and pf_training_sessions are excluded from this math
  // outright — both carry only an `owner_all` policy, no anon read path.

  // ── Section C: mini timetrack strip ─────────────────────────────────
  const strip: StripState = {
    sleep: sleepSpans.map((s) => ({ start: s.start, end: s.end, color: colorHex("indigo") })),
    planned: plannedBands,
    training: trainingClipped.map((s) => ({ start: s.start, end: s.end, color: colorHex("emerald") })),
    screen: screenTracked ? screenSpans.map((s) => ({ start: s.start, end: s.end, color: colorHex("sky") })) : [],
  };

  return { dayStats, pie, strip };
}

// ── Section A — day stats ────────────────────────────────────────────────

function DayStatsSection({ data }: { data: LoadedData["dayStats"] }) {
  if (!data) return null;
  const maxSeconds = Math.max(1, ...data.rows.map((r) => r.seconds), data.uncategorizedSeconds);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-semibold text-foreground">I dag</p>
      <div className="flex flex-col gap-1">
        {data.rows.map((r) => (
          <div key={r.name} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-center text-xs">{r.emoji}</span>
            <span className="w-20 shrink-0 truncate text-[11px] text-muted-foreground">{r.name}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${(r.seconds / maxSeconds) * 100}%`, backgroundColor: colorHex(r.color) }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
              {r.seconds > 0 ? fmtSec(r.seconds) : "—"}
            </span>
          </div>
        ))}
        {data.uncategorizedSeconds > 0 && (
          <div className="flex items-center gap-2 opacity-50">
            <span className="w-5 shrink-0" />
            <span className="w-20 shrink-0 truncate text-[11px] text-muted-foreground">{UNCATEGORIZED}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-muted-foreground/40"
                style={{ width: `${(data.uncategorizedSeconds / maxSeconds) * 100}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
              {fmtSec(data.uncategorizedSeconds)}
            </span>
          </div>
        )}
      </div>
      {!data.screenTracked && (
        <p className="text-[10px] italic text-muted-foreground/60">screen time only where tracked</p>
      )}
    </div>
  );
}

// ── Section B — daily progress donut (TodayPie, recreated) ─────────────────

function MiniTodayPie({ pie }: { pie: PieState }) {
  if (!pie) return null;
  const { doneMin, pendingMin, freeMin, capTotal } = pie;

  const SIZE = 56;
  const STROKE = 8;
  const r = (SIZE - STROKE) / 2;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const circ = 2 * Math.PI * r;

  const doneFrac = capTotal > 0 ? doneMin / capTotal : 0;
  const pendingFrac = capTotal > 0 ? pendingMin / capTotal : 0;
  const freeFrac = capTotal > 0 ? freeMin / capTotal : 1;

  const segments: { frac: number; color: string; cumOffset: number }[] = [];
  let cum = 0;
  for (const [frac, color] of [
    [doneFrac, "#10b981"] as const,
    [pendingFrac, "#6366f1"] as const,
    [freeFrac, "hsl(var(--muted))"] as const,
  ]) {
    if (frac > 0.0005) segments.push({ frac, color, cumOffset: cum });
    cum += frac;
  }
  const doneWorkPct = doneMin + pendingMin > 0 ? Math.round((doneMin / (doneMin + pendingMin)) * 100) : 0;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-semibold text-foreground">Today's progress</p>
      <div className="flex items-center gap-3">
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE}>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={STROKE} />
            {segments.map((seg, i) => (
              <circle
                key={i} cx={cx} cy={cy} r={r} fill="none"
                stroke={seg.color} strokeWidth={STROKE}
                strokeDasharray={`${seg.frac * circ} ${circ}`}
                strokeDashoffset={-(seg.cumOffset * circ)}
                style={{ transform: "rotate(-90deg)", transformOrigin: `${cx}px ${cy}px` }}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[10px] font-bold tabular-nums leading-none">{doneWorkPct}%</span>
          </div>
        </div>
        <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" /><span>{fmtMin(doneMin)} done</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-500" /><span>{fmtMin(pendingMin)} planned</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/25" /><span>{fmtMin(Math.max(0, freeMin))} free</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Section C — mini timetrack strip ────────────────────────────────────

function TimetrackStrip({ strip }: { strip: StripState }) {
  if (!strip) return null;
  const today = ymd(new Date());
  const winStart = dayStartMs(today);
  const winEnd = dayStartMs(shiftYmd(today, 1));
  const span = winEnd - winStart;
  const pct = (ms: number) => Math.max(0, Math.min(100, ((ms - winStart) / span) * 100));

  const bands: { start: number; end: number; color: string; opacity: number }[] = [
    ...strip.sleep.map((b) => ({ ...b, opacity: 0.85 })),
    ...strip.planned.map((b) => ({ ...b, opacity: 0.55 })),
    ...strip.training.map((b) => ({ ...b, opacity: 0.85 })),
    ...strip.screen.map((b) => ({ ...b, opacity: 0.65 })),
  ];

  const now = Date.now();
  const nowPct = now >= winStart && now <= winEnd ? pct(now) : null;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-semibold text-foreground">Day timeline</p>
      <div className="relative h-10 w-full overflow-hidden rounded-md bg-muted">
        {bands.map((b, i) => (
          <div
            key={i}
            className="pointer-events-none absolute inset-y-0 rounded-sm"
            style={{
              left: `${pct(b.start)}%`,
              width: `${Math.max(0.5, pct(b.end) - pct(b.start))}%`,
              backgroundColor: b.color,
              opacity: b.opacity,
            }}
          />
        ))}
        {nowPct !== null && (
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-foreground/70"
            style={{ left: `${nowPct}%` }}
          />
        )}
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground/70 tabular-nums">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
      </div>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────

export function ClockDropdown({ loadScreenSpans }: ClockDropdownProps) {
  const [data, setData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(false);
  const lastFetchRef = useRef(0);

  function handleOpenChange(open: boolean) {
    if (!open) return;
    // Without this, a quick open→close→open before the first fetch resolves
    // (data still null) skips the "already have data" guard below and fires
    // a second concurrent fetchAll — wasted Supabase reads, and whichever
    // response lands last silently wins.
    if (loading) return;
    const now = Date.now();
    if (data && now - lastFetchRef.current < REFETCH_AFTER_MS) return;
    lastFetchRef.current = now;
    setLoading(true);
    fetchAll(loadScreenSpans)
      .then((result) => setData(result))
      // A total failure (e.g. the anon client can't reach Supabase at all)
      // degrades to "no data" rather than a crash or a spinner stuck forever.
      .catch(() => setData({ dayStats: null, pie: null, strip: null }))
      .finally(() => setLoading(false));
  }

  const hasAnything = !!(data?.dayStats || data?.pie || data?.strip);

  return (
    <DropdownMenu.Root onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          title="Clock"
          className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Clock className="h-4 w-4" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className={cn(
            "z-50 w-[360px] max-h-[75vh] overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-3",
            "flex flex-col gap-3",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          {loading && !data && (
            <p className="px-1 py-2 text-xs text-muted-foreground italic">Loading…</p>
          )}
          {!loading && data && !hasAnything && (
            <p className="px-1 py-2 text-xs text-muted-foreground italic">Nothing to show yet.</p>
          )}
          {data?.dayStats && <DayStatsSection data={data.dayStats} />}
          {data?.pie && <MiniTodayPie pie={data.pie} />}
          {data?.strip && <TimetrackStrip strip={data.strip} />}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
