/**
 * Rewards — track N minutes today and a blocked app or site opens up.
 *
 * Despite the name there are no points, coins or streaks: the "currency" is
 * minutes of *completed* time entries today, and a rule is satisfied while
 * `today_minutes >= required_minutes`. It resets at local midnight because the
 * evaluation is date-scoped.
 *
 * The verdict is **not** computed here. `focus-evaluate` runs on pg_cron every
 * five minutes and publishes `blocking_state`; a rule's target is unlocked iff
 * it is *absent* from `effective_processes` / `effective_domains`. Comparing
 * `today_minutes >= required_minutes` in this file would make the phone and the
 * Mac disagree about what is blocked the moment the two drift, so this panel
 * only ever displays the server's answer — and says "unknown" when it has none.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabasePublic } from "../supabase";

type UnlockRule = {
  id?: string | null;
  process_name?: string | null;
  domain?: string | null;
  required_minutes: number;
  enabled: boolean;
};

type BlockingState = {
  effective_domains?: string[];
  effective_processes?: string[];
  reasons?: Record<string, unknown> | null;
  today_minutes?: number;
  computed_at?: string | null;
};

type BlockedApp = { process_name: string; display_name: string };
type BlockedSite = { domain: string };

/** locked / unlocked per the server; unknown while `blocking_state` is absent. */
type Verdict = "locked" | "unlocked" | "unknown";

const POLL_MS = 45_000; // the server recomputes every 5 min; faster gains nothing

/**
 * `unlock_rules.enabled` is added by a parallel work unit. Until it lands, a
 * *toggle* fails on the server (an insert silently retries without the column,
 * an update deliberately does not) and PostgREST's raw schema-cache complaint is
 * unreadable on a 400px column. Say what actually happened instead.
 */
function humanizeError(raw: string): string {
  if (raw.includes("PGRST204") && raw.includes("enabled")) {
    return "Enabling/disabling needs the `enabled` column, which isn't on unlock_rules yet.";
  }
  return raw;
}

function ruleTarget(rule: UnlockRule): string {
  return (rule.domain ?? rule.process_name ?? "").trim();
}

/**
 * A *missing* `blocking_state` row means "no verdict computed yet", which is not
 * the same as "computed, and nothing is blocked" — the second is an unlock, the
 * first is silence. `computed_at` is the only field that tells them apart: with
 * no row the effective lists deserialize to `[]` and would otherwise read as a
 * blanket unlock.
 */
function hasVerdict(state: BlockingState | null): state is BlockingState {
  return !!state && !!state.computed_at;
}

function verdictFor(rule: UnlockRule, state: BlockingState | null): Verdict {
  if (!hasVerdict(state)) return "unknown";
  const list = rule.domain ? state.effective_domains : state.effective_processes;
  if (!Array.isArray(list)) return "unknown";
  const target = ruleTarget(rule).toLowerCase();
  if (!target) return "unknown";
  return list.some((x) => String(x).toLowerCase() === target) ? "locked" : "unlocked";
}

function formatMinutes(total: number): string {
  const safe = Math.max(0, Math.round(total));
  return `${Math.floor(safe / 60)}h ${safe % 60}m`;
}

/**
 * Reads only `today_minutes` off the materialized `blocking_state` row. Returns
 * `{}` on any failure so a missing table or column simply leaves the header at
 * "—" instead of breaking the verdict poll around it.
 */
async function fetchTodayMinutes(): Promise<{ today_minutes?: number }> {
  try {
    const { data, error } = await supabasePublic
      .from("blocking_state")
      .select("today_minutes")
      .eq("user_id", "default")
      .limit(1);
    const value = data?.[0]?.today_minutes;
    if (error || typeof value !== "number") return {};
    return { today_minutes: value };
  } catch {
    return {};
  }
}

export function RewardsPanel() {
  const [rules, setRules] = useState<UnlockRule[]>([]);
  const [state, setState] = useState<BlockingState | null>(null);
  const [apps, setApps] = useState<BlockedApp[]>([]);
  const [sites, setSites] = useState<BlockedSite[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [addType, setAddType] = useState<"app" | "site">("app");
  const [addTarget, setAddTarget] = useState("");
  const [addMinutes, setAddMinutes] = useState(60);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A read issued *before* a mutation can resolve *after* it and resurrect the
  // pre-mutation list — the mount read is slow, the post-save read is warm, and
  // the new rule vanishes a beat after appearing. A monotonic request id means
  // only the newest read is ever allowed to land.
  const rulesSeq = useRef(0);

  const loadRules = useCallback(async () => {
    const seq = ++rulesSeq.current;
    try {
      const list = await invoke<UnlockRule[]>("tt_unlock_rules");
      if (!alive.current || seq !== rulesSeq.current) return;
      setRules(Array.isArray(list) ? list : []);
      setError("");
    } catch (e) {
      if (!alive.current || seq !== rulesSeq.current) return;
      setError(humanizeError(String(e)));
    }
  }, []);

  // Only already-blocked targets are offered: a reward for something that isn't
  // blocked unlocks nothing.
  const loadTargets = useCallback(async () => {
    const [a, s] = await Promise.all([
      supabasePublic
        .from("blocked_apps")
        .select("process_name,display_name")
        .eq("user_id", "default")
        .order("display_name"),
      supabasePublic
        .from("blocked_sites")
        .select("domain")
        .eq("user_id", "default")
        .order("domain"),
    ]);
    if (!alive.current) return;
    if (!a.error) setApps((a.data ?? []) as BlockedApp[]);
    if (!s.error) setSites((s.data ?? []) as BlockedSite[]);
  }, []);

  useEffect(() => {
    loadRules();
    loadTargets().catch(() => {});
  }, [loadRules, loadTargets]);

  // `tt_blocking_state` errors until work unit 8 lands its producer — degrade to
  // "unknown" rather than showing a scary error for a table that isn't there.
  useEffect(() => {
    let seq = 0;
    let inFlight = false;
    async function tick() {
      // A slow tick must not be overtaken by the next interval, and a late
      // response must not overwrite a newer one.
      if (inFlight) return;
      inFlight = true;
      const mine = ++seq;
      try {
        const s = await invoke<BlockingState>("tt_blocking_state");
        // The verdict always comes from the command. `today_minutes` is a
        // column on `blocking_state` that unit 8's `BlockingState` struct does
        // not carry, so the command silently drops it; read that one field off
        // the same materialized row rather than summing time_entries here,
        // which would reintroduce the client-side arithmetic this panel exists
        // to avoid. Drop the backfill once the struct grows the field.
        const withMinutes =
          s && typeof s.today_minutes !== "number" ? { ...s, ...(await fetchTodayMinutes()) } : s;
        if (alive.current && mine === seq) setState(withMinutes ?? null);
      } catch {
        if (alive.current && mine === seq) setState(null);
      } finally {
        inFlight = false;
      }
    }
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => clearInterval(t);
  }, []);

  async function save(rule: UnlockRule): Promise<boolean> {
    setBusy(true);
    try {
      await invoke("tt_unlock_rule_save", { rule });
      if (alive.current) setError("");
      await loadRules();
      return true;
    } catch (e) {
      if (alive.current) setError(humanizeError(String(e)));
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await invoke("tt_unlock_rule_delete", { id });
      if (alive.current) setError("");
      await loadRules();
    } catch (e) {
      if (alive.current) setError(humanizeError(String(e)));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function add() {
    const target = addTarget.trim();
    if (!target) return;
    const ok = await save({
      id: null,
      process_name: addType === "app" ? target : null,
      domain: addType === "site" ? target : null,
      required_minutes: Math.max(1, Math.round(addMinutes) || 1),
      enabled: true,
    });
    // Keep the form populated on failure so the input isn't lost to a retry.
    if (ok && alive.current) {
      setAddTarget("");
      setAddMinutes(60);
    }
  }

  // Same reasoning as `hasVerdict`: an uncomputed row's `0` is not "zero minutes".
  const todayMinutes =
    hasVerdict(state) && typeof state.today_minutes === "number" ? state.today_minutes : null;

  const taken = new Set(rules.map((r) => ruleTarget(r).toLowerCase()));
  const appOptions = apps.filter((a) => !taken.has(a.process_name.toLowerCase()));
  const siteOptions = sites.filter((s) => !taken.has(s.domain.toLowerCase()));
  const options =
    addType === "app"
      ? appOptions.map((a) => ({ value: a.process_name, label: a.display_name || a.process_name }))
      : siteOptions.map((s) => ({ value: s.domain, label: s.domain }));

  function labelFor(rule: UnlockRule): string {
    if (rule.process_name) {
      return apps.find((a) => a.process_name === rule.process_name)?.display_name ?? rule.process_name;
    }
    return rule.domain ?? "?";
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs uppercase tracking-wide text-white/40">Rewards · time unlocks</h2>

      {/* Today's tracked time — the server's number, never summed here. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="text-[9px] uppercase tracking-wide text-white/35">Tracked today</div>
        <div className="mt-0.5 text-lg font-semibold text-white/90">
          {todayMinutes === null ? "—" : formatMinutes(todayMinutes)}
        </div>
        <div className="mt-0.5 text-[10px] text-white/35">
          {todayMinutes === null
            ? "waiting on blocking_state — unlock status unknown"
            : "apps and sites open up once you hit their threshold"}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 text-[10px] text-rose-300 break-all">
          {error}
        </div>
      )}

      {rules.length === 0 ? (
        <p className="text-[10px] text-white/30">No time rewards yet. Add one below.</p>
      ) : (
        rules.map((rule) => {
          const verdict = verdictFor(rule, state);
          const pct =
            todayMinutes === null || rule.required_minutes < 1
              ? 0
              : Math.min(100, Math.round((todayMinutes / rule.required_minutes) * 100));
          const unlocked = verdict === "unlocked";
          return (
            <div
              key={rule.id ?? ruleTarget(rule)}
              className={`rounded-xl border p-3 ${
                unlocked ? "border-emerald-500/25 bg-emerald-500/[0.06]" : "border-white/10 bg-white/[0.03]"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px]">{rule.domain ? "🌐" : "🖥️"}</span>
                <span
                  className={`flex-1 truncate text-xs font-medium ${
                    rule.enabled ? "text-white/90" : "text-white/40 line-through"
                  }`}
                >
                  {labelFor(rule)}
                </span>
                {verdict === "unlocked" && (
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">
                    Unlocked
                  </span>
                )}
                {verdict === "unknown" && (
                  <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-white/35">
                    Unknown
                  </span>
                )}
                <button
                  onClick={() => save({ ...rule, enabled: !rule.enabled })}
                  disabled={busy}
                  className={`rounded px-1.5 py-0.5 text-[9px] ${
                    rule.enabled ? "bg-indigo-500/15 text-indigo-300" : "bg-white/[0.06] text-white/40"
                  }`}
                >
                  {rule.enabled ? "On" : "Off"}
                </button>
                <button
                  onClick={() => rule.id && remove(rule.id)}
                  disabled={busy || !rule.id}
                  className="px-1 text-xs text-white/30 hover:text-white/70"
                  aria-label="Delete rule"
                >
                  ×
                </button>
              </div>

              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
                <div
                  className={`h-full rounded-full transition-all ${
                    unlocked ? "bg-emerald-400/70" : "bg-indigo-400/70"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1 text-[9px] text-white/35">
                {todayMinutes === null ? "—" : todayMinutes}/{rule.required_minutes} min
                {todayMinutes !== null && ` · ${pct}%`}
              </div>
            </div>
          );
        })
      )}

      {/* Add form */}
      <div className="rounded-xl border border-dashed border-white/10 p-3">
        <div className="flex gap-2">
          <div className="flex overflow-hidden rounded-lg border border-white/10">
            {(["app", "site"] as const).map((t) => (
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
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={addMinutes}
            onChange={(e) => setAddMinutes(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-16 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-white/80"
          />
          <span className="text-[10px] text-white/35">min to unlock</span>
          <button
            onClick={add}
            disabled={busy || !addTarget}
            className={`ml-auto rounded-lg px-3 py-1 text-[11px] font-medium ${
              busy || !addTarget ? "bg-white/[0.06] text-white/25" : "bg-emerald-500/20 text-emerald-300"
            }`}
          >
            Add
          </button>
        </div>
        {options.length === 0 && (
          <p className="mt-2 text-[10px] text-white/30">
            No {addType === "app" ? "apps" : "sites"} left to reward — block one first.
          </p>
        )}
      </div>
    </section>
  );
}
