import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabasePublic } from "./supabase";

/**
 * Manual Garmin pull — the fallback for when the normal sync doesn't happen.
 *
 * # Two transports, chosen by platform
 *
 * The bridge is a Python script driven by `std::process::Command`, using tokens
 * in `~/.garminconnect`. That can only ever run on the Mac.
 *
 *  - **macOS** — `tt_garmin_run` executes it directly. No Supabase, no queue,
 *    no daemon required. That matters: this is what you reach for when the
 *    normal path is broken, and the normal path includes all three of those.
 *  - **iOS** — the phone cannot spawn a subprocess (the sandbox forbids it, and
 *    the module is compiled out entirely). So it enqueues into
 *    `nexus_local_commands` and waits for the Mac daemon to claim it, exactly as
 *    Protocol does from the browser. That works only while the Mac is awake,
 *    which the panel says rather than hanging.
 *
 * # Where the mapping lives
 *
 * Not here. "Sync to Protocol" pulls the raw JSON and POSTs it to the
 * `garmin-import` edge function, which does the mapping server-side with a
 * service-role client. That is deliberate: re-implementing the mapping in this
 * file would fork Protocol's, and two drifting copies of health-data mapping
 * produce *wrong* numbers, which is worse than none.
 *
 * The function also owns the rules this UI must not second-guess — the
 * per-metric data-source settings (Garmin vs Oura), and the idempotency that
 * keeps a re-sync from duplicating activities.
 */

const NODE_FRESH_MS = 30_000;
const QUEUE_TIMEOUT_MS = 120_000;

type Action = "status" | "sleep" | "body_stats" | "activities" | "exercise_sets" | "sync";

const PULLS: Array<{ action: Action; label: string }> = [
  { action: "sleep", label: "Sleep" },
  { action: "body_stats", label: "Body" },
  { action: "activities", label: "Activities" },
  { action: "exercise_sets", label: "Sets" },
];

/** Describe a bridge result without pretending to understand its shape. */
function describe(result: unknown): string {
  if (Array.isArray(result)) return `${result.length} record${result.length === 1 ? "" : "s"}`;
  if (result && typeof result === "object") {
    const o = result as Record<string, unknown>;
    if (typeof o.connected === "boolean") return o.connected ? "connected" : "not connected";
    return `${Object.keys(o).length} field(s)`;
  }
  return String(result);
}

export function GarminPanel({ platform }: { platform: string | null }) {
  const isMac = platform === "macos";
  const [busy, setBusy] = useState<Action | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  const mounted = useRef(true);
  const alive = useCallback(() => mounted.current, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** iOS path: enqueue and poll, the same contract Protocol's gridClient uses. */
  const runViaQueue = useCallback(async (action: Action, payload: Record<string, unknown>) => {
    // Check for a live node first so a stopped Mac fails in a second with a
    // clear reason, rather than after a two-minute timeout.
    const { data: nodes } = await supabasePublic
      .from("nexus_local_nodes")
      .select("device_id,last_seen,modules")
      .order("last_seen", { ascending: false })
      .limit(10);
    const fresh = (nodes ?? []).some((n: { last_seen: string; modules: Array<{ id: string }> | null }) => {
      if (Date.now() - new Date(n.last_seen).getTime() >= NODE_FRESH_MS) return false;
      return (n.modules ?? []).some((m) => m.id === "garmin");
    });
    if (!fresh) throw new Error("No Mac node online — the bridge only runs there.");

    const { data: row, error } = await supabasePublic
      .from("nexus_local_commands")
      .insert({ module: "garmin", action, payload })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "could not queue the command");

    const started = Date.now();
    for (;;) {
      if (Date.now() - started > QUEUE_TIMEOUT_MS) throw new Error("Timed out waiting for the Mac.");
      await new Promise((r) => setTimeout(r, 1500));
      const { data: cur } = await supabasePublic
        .from("nexus_local_commands")
        .select("status,result,error")
        .eq("id", row.id)
        .single();
      if (!cur) continue;
      if (cur.status === "done") return cur.result;
      if (cur.status === "error") throw new Error(cur.error ?? "the bridge failed");
    }
  }, []);

  /**
   * Pull everything, then hand it to `garmin-import` in one call.
   *
   * The four pulls run sequentially rather than in parallel: each spawns a
   * Python process that logs in to Garmin Connect, and firing four at once is a
   * good way to get rate-limited by them.
   *
   * The date range is sent explicitly because the import REPLACES exercise sets
   * within it — the function refuses to delete without a bounded range, so a
   * missing one would skip sets rather than wipe history.
   */
  async function syncToProtocol() {
    setBusy("sync");
    setMsg(null);
    setErr(null);
    try {
      const [key, userId, url] = await invoke<[string, string, string]>(
        "tt_garmin_import_config",
      );
      if (!key) throw new Error("No garmin_import_key in ~/.nexuslocalrc — import is off.");
      if (!userId) throw new Error("No export profile set. Pick one in the account menu first.");

      const end = new Date().toISOString().slice(0, 10);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - (days - 1));
      const start = startDate.toISOString().slice(0, 10);

      const payload: Record<string, unknown> = { user_id: userId, range: { start, end } };
      for (const a of ["sleep", "body_stats", "activities", "exercise_sets"] as const) {
        payload[a] = await invoke("tt_garmin_run", { action: a, date: end, days });
      }

      const res = await fetch(`${url.replace(/\/$/, "")}/functions/v1/garmin-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Garmin-Key": key },
        body: JSON.stringify(payload),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out?.error ?? `import failed (${res.status})`);

      const c = out.counts ?? {};
      const lines = [
        `Imported · ${c.runs ?? 0} run(s), ${c.workouts ?? 0} workout(s), ${c.exercise_sets ?? 0} set(s)`,
      ];
      // Skips are shown, not swallowed: "0 imported" because Oura owns that
      // metric is a very different thing from "0 imported" because it broke.
      if (Array.isArray(out.skipped) && out.skipped.length) lines.push(...out.skipped);
      if (Array.isArray(out.errors) && out.errors.length) lines.push(...out.errors);
      if (alive()) setMsg(lines.join("\n"));
    } catch (e) {
      if (alive()) setErr(String(e instanceof Error ? e.message : e));
    }
    if (alive()) setBusy(null);
  }

  async function run(action: Action) {
    setBusy(action);
    setMsg(null);
    setErr(null);
    const started = Date.now();
    try {
      const payload =
        action === "status" ? {} : { date: new Date().toISOString().slice(0, 10), days };
      const result = isMac
        ? // camelCase over IPC — snake_case hard-fails on iOS.
          await invoke("tt_garmin_run", {
            action,
            date: action === "status" ? null : (payload as { date: string }).date,
            days: action === "status" ? null : days,
          })
        : await runViaQueue(action, payload);
      if (alive()) {
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        setMsg(`${action}: ${describe(result)} · ${secs}s${isMac ? "" : " (via Mac)"}`);
      }
    } catch (e) {
      if (alive()) setErr(String(e instanceof Error ? e.message : e));
    }
    if (alive()) setBusy(null);
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs uppercase tracking-wide text-white/40">Garmin</h3>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <p className="text-[10px] leading-relaxed text-white/35">
          {isMac
            ? "Runs the bridge on this Mac directly — no queue, no daemon, works with Supabase down."
            : "Queues a pull for your Mac to run. It only works while the Mac is awake."}
        </p>

        <div className="mt-2 flex items-center gap-2">
          <label className="text-[10px] text-white/35">Days back</label>
          <input
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
            className="w-16 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-white/80"
          />
          <button
            onClick={() => run("status")}
            disabled={busy !== null}
            className="ml-auto shrink-0 rounded-lg bg-white/[0.06] px-2.5 py-1 text-[10px] font-medium text-white/60 disabled:opacity-40"
          >
            {busy === "status" ? "checking…" : "Check connection"}
          </button>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          {PULLS.map((p) => (
            <button
              key={p.action}
              onClick={() => run(p.action)}
              disabled={busy !== null}
              className="rounded-lg bg-indigo-500/15 px-2 py-1.5 text-[10px] font-medium text-indigo-300 disabled:opacity-40"
            >
              {busy === p.action ? "pulling…" : `Pull ${p.label}`}
            </button>
          ))}
        </div>

        <button
          onClick={syncToProtocol}
          disabled={busy !== null || !isMac}
          className="mt-2 w-full rounded-lg bg-emerald-500/15 px-2 py-2 text-[11px] font-medium text-emerald-300 disabled:opacity-40"
        >
          {busy === "sync" ? "syncing…" : "Sync to Protocol"}
        </button>

        {msg && <div className="mt-2 whitespace-pre-line text-[10px] text-emerald-300/80">{msg}</div>}
        {err && <div className="mt-2 text-[10px] text-red-300/90">{err}</div>}

        <p className="mt-2 text-[10px] leading-relaxed text-white/25">
          Sync pulls all four datasets and posts them to the <code>garmin-import</code>{" "}
          function, which maps them into Protocol. Your data-source settings decide
          what actually lands — with Oura selected for sleep and body, only training
          data is imported. Re-syncing never duplicates.
        </p>
      </div>
    </section>
  );
}
