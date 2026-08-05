import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabasePublic } from "../supabase";

/**
 * Unit 5 — blocking management UI.
 *
 * Edits the *inputs* of the blocking policy (`blocked_sites`, `blocked_apps`)
 * and displays the *verdict* (`tt_blocking_state`, materialized server-side by
 * the `focus-evaluate` edge function on pg_cron). It never computes "is this
 * blocked right now" itself — the phone and the Mac have to agree, and the only
 * way to guarantee that is for both to read the same precomputed row.
 *
 * In TimeTracker these two lists were read-only ("managed from Supabase"), so
 * the only way to add a blocked site was the Supabase dashboard. This makes the
 * phone the editor.
 */

const USER_ID = "default";

type Site = {
  id: string;
  domain: string;
  enabled: boolean;
};

type App = {
  id: string;
  display_name: string;
  process_name: string;
  block_mode: string;
  enabled: boolean;
};

type Verdict = {
  effective_domains: string[];
  effective_processes: string[];
  reasons: unknown;
  computed_at: string | null;
};

/**
 * Normalise a domain before it is written.
 *
 * Ported from `apps/TimeTrackerApp/src-tauri/src/db/site_blocker.rs::add`
 * (trim → strip scheme → strip trailing slash → lowercase) with one fix: the
 * original keeps paths and query strings, so `https://m.youtube.com/?ra=m` was
 * stored verbatim as `m.youtube.com/?ra=m`, which matches nothing. Everything
 * from the first `/`, `?` or `#` is dropped, as is any `:port`.
 *
 * `www.` is deliberately *not* stripped: the stored value has to stay
 * byte-identical to what the server puts in `effective_domains`.
 *
 * Returns "" for input that normalises to nothing; callers reject that.
 */
export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // https:// , http:// , anything://
  d = d.split(/[/?#]/)[0]; // drop path, query, fragment
  d = d.replace(/:\d+$/, ""); // drop :port
  d = d.replace(/^\.+|\.+$/g, ""); // stray leading/trailing dots
  return d.trim();
}

/**
 * The `reasons` blob is produced by work unit 8 and is for display only. Two
 * shapes are understood: `reasons[key]` as a string, or as an object carrying a
 * `reason`/`message` string. Anything else renders nothing — a speculative
 * parser for a schema that isn't written yet would only print noise into a
 * 400px column.
 */
function reasonFor(reasons: unknown, key: string): string | null {
  if (!reasons || typeof reasons !== "object") return null;
  const entry = (reasons as Record<string, unknown>)[key];
  if (typeof entry === "string") return entry.trim() || null;
  if (entry && typeof entry === "object") {
    const o = entry as Record<string, unknown>;
    const text =
      typeof o.reason === "string" ? o.reason : typeof o.message === "string" ? o.message : null;
    return text?.trim() || null;
  }
  return null;
}

export function BlockingPanel() {
  const [sites, setSites] = useState<Site[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const [newSite, setNewSite] = useState("");
  const [newAppName, setNewAppName] = useState("");
  const [newAppProc, setNewAppProc] = useState("");
  const [newAppMode, setNewAppMode] = useState("always");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // Lists and verdict load independently. `tt_blocking_state` is a stub until
  // work unit 8 lands, so its failure is the normal path — it must not blank
  // the lists.
  const loadLists = useCallback(async (alive: () => boolean) => {
    const [s, a] = await Promise.all([
      supabasePublic
        .from("blocked_sites")
        .select("id,domain,enabled")
        .eq("user_id", USER_ID)
        .order("domain"),
      supabasePublic
        .from("blocked_apps")
        .select("id,display_name,process_name,block_mode,enabled")
        .eq("user_id", USER_ID)
        .order("display_name"),
    ]);
    if (!alive()) return;
    const err = s.error ?? a.error;
    setListErr(err ? err.message : null);
    if (s.data) setSites(s.data as Site[]);
    if (a.data) setApps(a.data as App[]);
    setLoading(false);
  }, []);

  const loadVerdict = useCallback(async (alive: () => boolean) => {
    try {
      const v = await invoke<Verdict>("tt_blocking_state");
      if (alive()) setVerdict(v);
    } catch {
      if (alive()) setVerdict(null); // not computed yet — say so, never guess
    }
  }, []);

  // One mounted flag for the whole component, not just the effect: the mutation
  // handlers refetch too, and a delete that resolves after the panel unmounts
  // would otherwise set state on a dead component. Reset on entry because
  // StrictMode mounts → unmounts → remounts in dev.
  const mounted = useRef(true);
  const alive = useCallback(() => mounted.current, []);

  useEffect(() => {
    mounted.current = true;
    loadLists(alive).catch((e) => {
      if (mounted.current) {
        setListErr(String(e));
        setLoading(false);
      }
    });
    loadVerdict(alive);
    const t = setInterval(() => loadVerdict(alive), 60000);
    return () => {
      mounted.current = false;
      clearInterval(t);
    };
  }, [alive, loadLists, loadVerdict]);

  // Timestamps are RFC3339 UTC. TimeTracker's SQLite era wrote local time with
  // a space separator, which turned every last-write-wins comparison into a
  // lexical compare that remote always won.
  const stamp = () => new Date().toISOString();

  // Write, then refetch. Supabase returns no rows without `.select()`, and
  // reconciling optimistic state for a handful of rows in a 400px column buys
  // nothing.
  async function run(label: string, fn: () => Promise<{ error: { message: string } | null }>) {
    setBusy(true);
    setMsg("");
    try {
      const { error } = await fn();
      if (!alive()) return;
      if (error) {
        setMsg(`${label} failed: ${error.message}`);
      } else {
        setMsg(`${label} ✓`);
        await loadLists(alive);
      }
    } catch (e) {
      if (alive()) setMsg(`${label} failed: ${String(e)}`);
    }
    if (alive()) setBusy(false);
  }

  async function addSite() {
    const domain = normalizeDomain(newSite);
    if (!domain) {
      setMsg("enter a domain");
      return;
    }
    // Upsert on the natural key so re-adding an existing domain updates rather
    // than throwing an opaque 409 — PostgREST defaults `on_conflict` to the
    // primary key. `id` and `created_at` are omitted on purpose:
    // merge-duplicates compiles to ON CONFLICT DO UPDATE SET <columns sent>, so
    // sending an id would overwrite the existing row's primary key.
    await run("add", async () =>
      supabasePublic
        .from("blocked_sites")
        .upsert(
          { user_id: USER_ID, domain, enabled: true, updated_at: stamp() },
          { onConflict: "user_id,domain" },
        ),
    );
    setNewSite("");
  }

  async function addApp() {
    const display_name = newAppName.trim();
    const process_name = newAppProc.trim();
    if (!display_name || !process_name) {
      setMsg("name and process are both required");
      return;
    }
    await run("add", async () =>
      supabasePublic.from("blocked_apps").upsert(
        {
          user_id: USER_ID,
          display_name,
          process_name,
          block_mode: newAppMode,
          enabled: true,
          updated_at: stamp(),
        },
        { onConflict: "user_id,process_name" },
      ),
    );
    setNewAppName("");
    setNewAppProc("");
  }

  const toggleSite = (s: Site) =>
    run(s.enabled ? "disable" : "enable", async () =>
      supabasePublic
        .from("blocked_sites")
        .update({ enabled: !s.enabled, updated_at: stamp() })
        .eq("id", s.id),
    );

  const delSite = (s: Site) =>
    run("delete", async () => supabasePublic.from("blocked_sites").delete().eq("id", s.id));

  const toggleApp = (a: App) =>
    run(a.enabled ? "disable" : "enable", async () =>
      supabasePublic
        .from("blocked_apps")
        .update({ enabled: !a.enabled, updated_at: stamp() })
        .eq("id", a.id),
    );

  const toggleAppMode = (a: App) =>
    run("mode", async () =>
      supabasePublic
        .from("blocked_apps")
        .update({
          block_mode: a.block_mode === "always" ? "focus_only" : "always",
          updated_at: stamp(),
        })
        .eq("id", a.id),
    );

  const delApp = (a: App) =>
    run("delete", async () => supabasePublic.from("blocked_apps").delete().eq("id", a.id));

  // Exact string membership. Suffix/subdomain matching would be re-deriving
  // policy on the client, which is the one thing this panel must not do.
  const blockedDomains = new Set(verdict?.effective_domains ?? []);
  const blockedProcesses = new Set(verdict?.effective_processes ?? []);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs uppercase tracking-wide text-white/40">Blocking</h2>

      {/* The verdict, computed server-side by focus-evaluate. Never recomputed here. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[10px]">
        {verdict ? (
          <span className="text-white/45">
            verdict · {verdict.effective_domains.length} domain
            {verdict.effective_domains.length === 1 ? "" : "s"} ·{" "}
            {verdict.effective_processes.length} process
            {verdict.effective_processes.length === 1 ? "" : "es"} blocked right now
            {verdict.computed_at
              ? ` · computed ${new Date(verdict.computed_at).toLocaleTimeString()}`
              : ""}
          </span>
        ) : (
          <span className="text-amber-300/70">
            Live verdict unavailable — it is computed server-side by focus-evaluate. The lists below
            are still editable; they are the inputs it reads.
          </span>
        )}
      </div>

      {listErr && (
        <div className="rounded-lg bg-red-500/10 p-2 text-[10px] text-red-300">{listErr}</div>
      )}

      {/* ── Sites ─────────────────────────────────────────────────────────── */}
      <h3 className="mt-1 text-[10px] uppercase tracking-wide text-white/35">Sites</h3>
      <p className="text-[10px] text-white/35">
        Sites do apply on the iPhone: they are enforced through the Safari content blocker, and on
        your Mac through the hosts file. The on/off switch below is the input you control; the badge
        is the server's verdict, and the two can disagree until the enforcers are wired to it.
      </p>

      <div className="flex gap-2">
        <input
          value={newSite}
          onChange={(e) => setNewSite(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) addSite();
          }}
          placeholder="youtube.com"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/80 placeholder:text-white/25"
        />
        <button
          onClick={addSite}
          disabled={busy}
          className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium ${
            busy ? "bg-white/10 text-white/30" : "bg-indigo-500/20 text-indigo-300"
          }`}
        >
          Add
        </button>
      </div>

      {loading ? (
        <p className="text-[10px] text-white/30">Loading…</p>
      ) : sites.length === 0 ? (
        <p className="text-[10px] text-white/30">No sites blocked yet.</p>
      ) : (
        sites.map((s) => {
          const live = blockedDomains.has(s.domain);
          const why = reasonFor(verdict?.reasons, s.domain);
          return (
            <div key={s.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-white/85">{s.domain}</span>
                {verdict && (
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] ${
                      live ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"
                    }`}
                  >
                    {live ? "blocked now" : "open now"}
                  </span>
                )}
                <button
                  onClick={() => toggleSite(s)}
                  disabled={busy}
                  className={`shrink-0 rounded px-2 py-1 text-[10px] font-medium ${
                    s.enabled ? "bg-indigo-500/15 text-indigo-300" : "bg-white/[0.06] text-white/40"
                  }`}
                >
                  {s.enabled ? "on" : "off"}
                </button>
                <button
                  onClick={() => delSite(s)}
                  disabled={busy}
                  className="shrink-0 rounded px-1.5 py-1 text-[10px] text-white/30"
                >
                  ✕
                </button>
              </div>
              {why && <div className="mt-1 text-[10px] text-white/40">{why}</div>}
            </div>
          );
        })
      )}

      {/* ── Apps ──────────────────────────────────────────────────────────── */}
      <h3 className="mt-2 text-[10px] uppercase tracking-wide text-white/35">Apps</h3>
      <p className="text-[10px] text-amber-300/60">
        Enforced on your Mac only — iOS cannot enumerate or kill processes, and this app does not use
        the Screen Time (FamilyControls) API, which needs a paid entitlement. Editing from the phone
        still works; the Mac node acts on it.
      </p>

      <div className="flex gap-2">
        <input
          value={newAppName}
          onChange={(e) => setNewAppName(e.target.value)}
          placeholder="Discord"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/80 placeholder:text-white/25"
        />
        <input
          value={newAppProc}
          onChange={(e) => setNewAppProc(e.target.value)}
          placeholder="Discord.app"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/80 placeholder:text-white/25"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => setNewAppMode((m) => (m === "always" ? "focus_only" : "always"))}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] text-white/60"
        >
          block {newAppMode === "always" ? "always" : "during focus only"}
        </button>
        <button
          onClick={addApp}
          disabled={busy}
          className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium ${
            busy ? "bg-white/10 text-white/30" : "bg-indigo-500/20 text-indigo-300"
          }`}
        >
          Add
        </button>
      </div>

      {loading ? null : apps.length === 0 ? (
        <p className="text-[10px] text-white/30">No apps blocked yet.</p>
      ) : (
        apps.map((a) => {
          const live = blockedProcesses.has(a.process_name);
          const why = reasonFor(verdict?.reasons, a.process_name);
          return (
            <div key={a.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-white/85">
                  {a.display_name}
                </span>
                {verdict && (
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] ${
                      live ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"
                    }`}
                  >
                    {live ? "blocked now" : "open now"}
                  </span>
                )}
                <button
                  onClick={() => toggleApp(a)}
                  disabled={busy}
                  className={`shrink-0 rounded px-2 py-1 text-[10px] font-medium ${
                    a.enabled ? "bg-indigo-500/15 text-indigo-300" : "bg-white/[0.06] text-white/40"
                  }`}
                >
                  {a.enabled ? "on" : "off"}
                </button>
                <button
                  onClick={() => delApp(a)}
                  disabled={busy}
                  className="shrink-0 rounded px-1.5 py-1 text-[10px] text-white/30"
                >
                  ✕
                </button>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="min-w-0 truncate font-mono text-[10px] text-white/35">
                  {a.process_name}
                </span>
                <button
                  onClick={() => toggleAppMode(a)}
                  disabled={busy}
                  className="ml-auto shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-white/50"
                >
                  {a.block_mode === "always" ? "always" : "during focus"}
                </button>
              </div>
              {why && <div className="mt-1 text-[10px] text-white/40">{why}</div>}
            </div>
          );
        })
      )}

      {msg && <div className="text-[10px] text-white/45">{msg}</div>}
    </section>
  );
}
