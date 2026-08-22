/**
 * Meal sessions — breakfast, lunch and dinner buttons that open a 30-minute
 * window in the blocking wall for a per-meal list of sites and apps.
 *
 * The panel never derives blocking policy. Activating a meal inserts one
 * `meal_sessions` row; `focus-evaluate` folds it into `blocking_state` and
 * every enforcer reads that. Because the cron pass is 5 minutes apart and a
 * meal is only 30 minutes long, activation also *pokes* the evaluator directly
 * (an anon-key POST — the function recomputes from data we could already read,
 * it accepts no input that changes the outcome), so the unblock lands on the
 * Mac's next 30 s tick instead of up to 5½ minutes later. A second best-effort
 * poke fires when the session expires so re-blocking is prompt while the app
 * is open; with the app closed the cron pass re-blocks within ~5 minutes.
 *
 * One activation per meal per local day, enforced by a unique index server-side
 * — the disabled button here is a courtesy, not the guard.
 *
 * Each activation is also logged to PathFinder's calendar (`pf_cal_blocks`) so
 * the meal shows up in the Week view. That insert is best-effort: a failed log
 * must not roll back an already-running session.
 *
 * Protocol tie-in (added 2026-08-21): each card also shows what Protocol's
 * meal planner says was planned for today — a read-only reminder, not a new
 * write surface. `protocol_meal_plan_entries` / `protocol_foods` carry a
 * `widget_anon_read` SELECT policy pinned to the owner uid (same one the iOS
 * meal widget reads with), so the anon client can fetch today's plan. The
 * `logged` flag is written exclusively through the `meal-log` edge function
 * (see `supabase/functions/meal-log` and the 2026-08-13 migration comment on
 * `widget_anon_read`) using a scoped `WIDGET_MEAL_KEY` secret — today that key
 * is wired only into the iOS widget's CI-generated `Secrets.swift`, never
 * into this web bundle. Until it is, there is no tap-to-log here: this reads
 * the plan and shows it, nothing more.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { supabasePublic } from "../supabase";
import { nodeUserId } from "../nodeUser";
import { calendarOwnerUid } from "./calendarOwner";

type MealKey = "breakfast" | "lunch" | "dinner";

/** A resolved (name already joined) line from today's Protocol meal plan. */
type PlannedMealEntry = {
  id: string;
  slot: MealKey;
  name: string;
  logged: boolean;
};

// Same owner uid as `meal-log`'s OWNER_UID and the `widget_anon_read` RLS
// policies on protocol_meal_plan_entries/protocol_foods — this is a
// single-user app, so the plan we show is always this uid's, independent of
// `nodeUserId()` (which scopes the *local grid node's* own tables).
const PROTOCOL_OWNER_UID = "a33625c2-4dd2-44fa-b2e5-4d455eeac59d";

type MealTarget = {
  id: string;
  meal: MealKey;
  domain: string | null;
  process_name: string | null;
};

type MealSession = {
  id: string;
  meal: MealKey;
  started_at: string;
  ends_at: string;
  local_date: string;
};

type BlockedApp = { process_name: string; display_name: string };
type BlockedSite = { domain: string };

const SESSION_MINUTES = 30;

// Keep in sync with TIMEZONE in supabase/functions/focus-evaluate/logic.ts and
// the local_date default in the meal_sessions migration.
const TZ = "Europe/Copenhagen";

// Literal Tailwind classes per meal — template-built class names never survive
// the compiler's scan. `calColor` is a PathFinder BLOCK_COLORS key.
const MEALS: Array<{
  key: MealKey;
  label: string;
  emoji: string;
  calColor: string;
  activeCls: string;
  buttonCls: string;
}> = [
  {
    key: "breakfast",
    label: "Breakfast",
    emoji: "🍳",
    calColor: "amber",
    activeCls: "border-amber-500/25 bg-amber-500/[0.06]",
    buttonCls: "bg-amber-500/20 text-amber-300",
  },
  {
    key: "lunch",
    label: "Lunch",
    emoji: "🥗",
    calColor: "emerald",
    activeCls: "border-emerald-500/25 bg-emerald-500/[0.06]",
    buttonCls: "bg-emerald-500/20 text-emerald-300",
  },
  {
    key: "dinner",
    label: "Dinner",
    emoji: "🍽️",
    calColor: "violet",
    activeCls: "border-violet-500/25 bg-violet-500/[0.06]",
    buttonCls: "bg-violet-500/20 text-violet-300",
  },
];

/** "YYYY-MM-DD" and "HH:MM" for an instant, in the blocker's timezone. */
function localParts(d: Date): { date: string; hm: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hm: `${get("hour")}:${get("minute")}`,
  };
}

function sessionActive(s: MealSession, nowMs: number): boolean {
  const start = Date.parse(s.started_at);
  const end = Date.parse(s.ends_at);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return nowMs >= start && nowMs < end;
}

/**
 * Ask the server to recompute `blocking_state` now rather than on the next
 * cron pass. Best-effort by design: if it fails, the cron pass picks the
 * session up within 5 minutes — later than ideal, never wrong.
 */
async function pokeEvaluator(): Promise<void> {
  try {
    await supabasePublic.functions.invoke("focus-evaluate", { body: {} });
  } catch {
    // The cron pass is the fallback; nothing useful to surface here.
  }
}

export function MealsPanel() {
  const [targets, setTargets] = useState<MealTarget[]>([]);
  const [sessions, setSessions] = useState<MealSession[]>([]);
  const [apps, setApps] = useState<BlockedApp[]>([]);
  const [sites, setSites] = useState<BlockedSite[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Which meal's "add target" form is open, and its state.
  const [addingFor, setAddingFor] = useState<MealKey | null>(null);
  const [addType, setAddType] = useState<"app" | "site">("site");
  const [addTarget, setAddTarget] = useState("");
  // Re-render clock for the countdown; only ticks while a session is active.
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Today's Protocol meal plan, read-only — see file header for why there's
  // no write path yet. Empty on fetch failure or no plan; never blocks the
  // rest of the panel.
  const [mealPlan, setMealPlan] = useState<PlannedMealEntry[]>([]);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const user = await nodeUserId();
    const nowIso = new Date().toISOString();
    const today = localParts(new Date()).date;
    const [t, s, a, w] = await Promise.all([
      supabasePublic
        .from("meal_unlock_targets")
        .select("id, meal, domain, process_name")
        .eq("user_id", user)
        .order("created_at"),
      // Today's rows (for the once-per-day state) plus anything still running,
      // which near midnight is not the same set.
      supabasePublic
        .from("meal_sessions")
        .select("id, meal, started_at, ends_at, local_date")
        .eq("user_id", user)
        .or(`local_date.eq.${today},ends_at.gt.${nowIso}`),
      supabasePublic
        .from("blocked_apps")
        .select("process_name, display_name")
        .eq("user_id", user)
        .order("display_name"),
      supabasePublic
        .from("blocked_sites")
        .select("domain")
        .eq("user_id", user)
        .order("domain"),
    ]);
    if (!alive.current) return;
    if (t.error || s.error) {
      setError(
        "Meal tables unreachable — has the meal_sessions migration been applied?",
      );
      return;
    }
    setTargets((t.data ?? []) as MealTarget[]);
    setSessions((s.data ?? []) as MealSession[]);
    if (!a.error) setApps((a.data ?? []) as BlockedApp[]);
    if (!w.error) setSites((w.data ?? []) as BlockedSite[]);
    setError("");
  }, []);

  // Today's Protocol meal plan — a reminder line only, so a failure here
  // degrades silently (empty plan) instead of touching `error`, which is
  // reserved for the meal-session machinery above.
  const loadMealPlan = useCallback(async () => {
    try {
      const today = localParts(new Date()).date;
      const { data: rows, error: rowsErr } = await supabasePublic
        .from("protocol_meal_plan_entries")
        .select("id,slot,logged,meal_id,food_id")
        .eq("user_id", PROTOCOL_OWNER_UID)
        .eq("date", today)
        .order("sort_order", { ascending: true });
      if (rowsErr || !rows || rows.length === 0) {
        if (alive.current) setMealPlan([]);
        return;
      }

      const mealIds = Array.from(
        new Set(rows.map((r) => r.meal_id).filter((v): v is string => !!v)),
      );
      const foodIds = Array.from(
        new Set(rows.map((r) => r.food_id).filter((v): v is string => !!v)),
      );

      const [mealsRes, foodsRes] = await Promise.all([
        mealIds.length
          ? supabasePublic.from("protocol_meals").select("id,name").in("id", mealIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        foodIds.length
          ? supabasePublic.from("protocol_foods").select("id,name").in("id", foodIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);

      const nameById = new Map<string, string>();
      for (const m of mealsRes.data ?? []) nameById.set(m.id, m.name);
      for (const f of foodsRes.data ?? []) nameById.set(f.id, f.name);

      // Only breakfast/lunch/dinner have a card; Protocol's `snack` slot (and
      // any future slot) has nowhere to render here, so it's dropped.
      const resolved: PlannedMealEntry[] = rows
        .filter((r) => r.slot === "breakfast" || r.slot === "lunch" || r.slot === "dinner")
        .map((r) => {
          const refId = r.meal_id ?? r.food_id ?? null;
          // A food row the owner didn't contribute stays hidden to anon
          // (widget_anon_read is owner-scoped on protocol_foods too) — same
          // generic fallback the iOS widget uses for the same case.
          const name = (refId && nameById.get(refId)) || "Meal";
          return { id: r.id as string, slot: r.slot as MealKey, name, logged: Boolean(r.logged) };
        });

      if (alive.current) setMealPlan(resolved);
    } catch {
      if (alive.current) setMealPlan([]);
    }
  }, []);

  useEffect(() => {
    loadMealPlan().catch(() => {});
  }, [loadMealPlan]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const active = sessions.filter((s) => sessionActive(s, nowMs));

  // Tick the countdown while anything runs; on expiry, poke the evaluator so
  // re-blocking doesn't wait for the cron pass, then refresh.
  useEffect(() => {
    if (active.length === 0) return;
    const t = setInterval(() => setNowMs(Date.now()), 1_000);
    const soonest = Math.min(...active.map((s) => Date.parse(s.ends_at)));
    const untilEnd = Math.max(0, soonest - Date.now()) + 5_000;
    const endT = setTimeout(() => {
      pokeEvaluator();
      load().catch(() => {});
    }, untilEnd);
    return () => {
      clearInterval(t);
      clearTimeout(endT);
    };
  }, [active.length, sessions, load]);

  async function activate(meal: (typeof MEALS)[number]) {
    setBusy(true);
    try {
      const user = await nodeUserId();
      const start = new Date();
      const end = new Date(start.getTime() + SESSION_MINUTES * 60_000);
      const { error: insErr } = await supabasePublic.from("meal_sessions").insert({
        user_id: user,
        meal: meal.key,
        started_at: start.toISOString(),
        ends_at: end.toISOString(),
        // local_date is defaulted server-side to the Copenhagen day.
      });
      if (insErr) {
        setError(
          insErr.code === "23505"
            ? `${meal.label} has already been used today — one session per meal per day.`
            : insErr.message,
        );
        return;
      }

      // Log to PathFinder's calendar. Best-effort: the session is already live.
      const { date, hm } = localParts(start);
      const endParts = localParts(end);
      const names = targets
        .filter((t) => t.meal === meal.key)
        .map(
          (t) =>
            t.domain ??
            (apps.find((a) => a.process_name === t.process_name)?.display_name ??
              t.process_name),
        );
      // PathFinder's calendar is keyed by the authed account, not the node id —
      // see calendarOwner.ts. The RLS insert policy is pinned to that uid.
      const { error: calErr } = await supabasePublic.from("pf_cal_blocks").insert({
        user_id: await calendarOwnerUid(),
        date,
        title: `${meal.emoji} ${meal.label}`,
        start_time: hm,
        // A block crossing midnight would end "earlier" than it starts on the
        // same date row — clamp so the calendar entry stays renderable.
        end_time: endParts.date === date ? endParts.hm : "23:59",
        color: meal.calColor,
        // Phase E: every meal session is unambiguously the Meals category.
        category: "Meals",
        description: `Nexus Local meal session — unblocked for ${SESSION_MINUTES} min: ${
          names.join(", ") || "no targets"
        }`,
        location: null,
        task_id: null,
      });
      if (calErr) setError(`Session started, but the calendar log failed: ${calErr.message}`);
      else setError("");

      await pokeEvaluator();
      setNowMs(Date.now());
      await load();
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function addTargetRow(meal: MealKey) {
    const value = addTarget.trim();
    if (!value) return;
    setBusy(true);
    try {
      const user = await nodeUserId();
      const { error: e } = await supabasePublic.from("meal_unlock_targets").insert({
        user_id: user,
        meal,
        domain: addType === "site" ? value : null,
        process_name: addType === "app" ? value : null,
      });
      if (e) setError(e.message);
      else {
        setError("");
        setAddTarget("");
      }
      await load();
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  // Removing a target only ever makes things MORE blocked, so unlike the block
  // lists a delete is allowed here.
  async function removeTarget(id: string) {
    setBusy(true);
    try {
      const { error: e } = await supabasePublic
        .from("meal_unlock_targets")
        .delete()
        .eq("id", id);
      if (e) setError(e.message);
      await load();
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const today = localParts(new Date()).date;

  function targetLabel(t: MealTarget): string {
    if (t.domain) return t.domain;
    const app = apps.find((a) => a.process_name === t.process_name);
    return app?.display_name ?? t.process_name ?? "?";
  }

  const options =
    addType === "app"
      ? apps.map((a) => ({ value: a.process_name, label: a.display_name || a.process_name }))
      : sites.map((s) => ({ value: s.domain, label: s.domain }));

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs uppercase tracking-wide text-white/40">
        Meal sessions · 30 min unblock
      </h2>

      {error && (
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 text-[10px] text-rose-300 break-all">
          {error}
        </div>
      )}

      {MEALS.map((meal) => {
        const mealTargets = targets.filter((t) => t.meal === meal.key);
        const running = active.find((s) => s.meal === meal.key);
        const usedToday = sessions.some((s) => s.meal === meal.key && s.local_date === today);
        const remaining = running
          ? Math.max(0, Math.ceil((Date.parse(running.ends_at) - nowMs) / 1000))
          : 0;
        const adding = addingFor === meal.key;
        const planned = mealPlan.filter((p) => p.slot === meal.key);

        return (
          <div
            key={meal.key}
            className={`rounded-xl border p-3 ${
              running ? meal.activeCls : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-[13px]">{meal.emoji}</span>
              <span className="flex-1 text-xs font-medium text-white/90">{meal.label}</span>
              {running ? (
                <span className={`rounded px-2 py-0.5 text-[10px] font-semibold tabular-nums ${meal.buttonCls}`}>
                  {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")} left
                </span>
              ) : usedToday ? (
                <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-white/45">
                  Used today
                </span>
              ) : (
                <button
                  onClick={() => activate(meal)}
                  disabled={busy || mealTargets.length === 0}
                  className={`rounded-lg px-3 py-1 text-[11px] font-medium ${
                    busy || mealTargets.length === 0
                      ? "bg-white/[0.06] text-white/25"
                      : meal.buttonCls
                  }`}
                >
                  Start {SESSION_MINUTES} min
                </button>
              )}
            </div>

            {/* What Protocol planned for this meal today — read-only reminder,
                reserves no space when there's nothing planned. */}
            {planned.length > 0 && (
              <p className="mt-1 truncate text-[10px] text-white/35">
                🍽 planned:{" "}
                {planned.map((p, i) => (
                  <span key={p.id} className={p.logged ? "text-white/25 line-through" : undefined}>
                    {i > 0 ? ", " : ""}
                    {p.name}
                  </span>
                ))}
              </p>
            )}

            {/* Targets this meal opens. */}
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {mealTargets.length === 0 && (
                <span className="text-[10px] text-white/30">
                  No targets yet — add a site or app to unblock.
                </span>
              )}
              {mealTargets.map((t) => (
                <span
                  key={t.id}
                  className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/70"
                >
                  <span>{t.domain ? "🌐" : "🖥️"}</span>
                  {targetLabel(t)}
                  <button
                    onClick={() => removeTarget(t.id)}
                    disabled={busy}
                    className="text-white/30 hover:text-white/70"
                    aria-label="Remove target"
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                onClick={() => {
                  setAddingFor(adding ? null : meal.key);
                  setAddTarget("");
                }}
                className="rounded-full border border-dashed border-white/15 px-2 py-0.5 text-[10px] text-white/40 hover:text-white/70"
              >
                {adding ? "close" : "+ add"}
              </button>
            </div>

            {adding && (
              <div className="mt-2 flex gap-2">
                <div className="flex overflow-hidden rounded-lg border border-white/10">
                  {(["site", "app"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setAddType(t);
                        setAddTarget("");
                      }}
                      className={`px-2.5 py-1 text-[10px] ${
                        addType === t ? "bg-indigo-500/20 text-indigo-300" : "text-white/40"
                      }`}
                    >
                      {t === "app" ? "App" : "Site"}
                    </button>
                  ))}
                </div>
                <select
                  value={addTarget}
                  onChange={(e) => setAddTarget(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-white/80"
                >
                  <option value="">— pick one —</option>
                  {options
                    .filter(
                      (o) =>
                        !mealTargets.some(
                          (t) => (t.domain ?? t.process_name) === o.value,
                        ),
                    )
                    .map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                </select>
                <button
                  onClick={() => addTargetRow(meal.key)}
                  disabled={busy || !addTarget}
                  className={`rounded-lg px-3 py-1 text-[11px] font-medium ${
                    busy || !addTarget
                      ? "bg-white/[0.06] text-white/25"
                      : "bg-emerald-500/20 text-emerald-300"
                  }`}
                >
                  Add
                </button>
              </div>
            )}
          </div>
        );
      })}

      <p className="text-[9px] leading-relaxed text-white/25">
        Takes ~30 s to lift on the Mac after starting. Re-blocks on expiry —
        within seconds while this app is open, otherwise on the next 5-minute
        server pass. Logged to the PathFinder calendar.
      </p>
    </section>
  );
}
