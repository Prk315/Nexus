import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoginScreen, useNexusAuth } from "@nexus/core";
import { BleScan } from "./lib/BleScan";
import { KeychainDebug } from "./lib/KeychainDebug";
import { TimeTrackerPanels } from "./lib/timetracker";
import { LearnPage } from "./lib/learn";

type ModuleManifest = {
  id: string;
  name: string;
  version: string;
  actions: string[];
  tick_interval_secs: number | null;
};

type GridStatus = {
  device_id: string;
  platform: string;
  hostname: string;
  version: string;
  supabase_configured: boolean;
  modules: ModuleManifest[];
};

export default function App() {
  const [page, setPage] = useState<"node" | "learn">("node");
  const [status, setStatus] = useState<GridStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Sign-in is reachable, not mandatory. Everything below reads tables that are
  // anon-keyed (`user_id = "default"`), so gating the whole app behind a session
  // hid the timer, pomodoro, schedules, blocking and rewards from a signed-out
  // launch — with no hint that anything existed. A session only buys the widgets
  // a JWT via SessionBridge, so it is worth prompting for, not worth blocking on.
  const { session, loading } = useNexusAuth();
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      invoke<GridStatus>("grid_status")
        .then((s) => alive && setStatus(s))
        .catch((e) => alive && setErr(String(e)));
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);


  if (showLogin && !session) return <LoginScreen appName="Nexus Local" />;

  return (
    // Top padding tracks env(safe-area-inset-top) so the header clears the
    // iPhone notch/Dynamic Island — this is shared by both pages ("learn"
    // cancels the horizontal/bottom p-6 via `-mx-6 -mb-6` in LearnPage but
    // never the top). Requires index.html's viewport meta to carry
    // `viewport-fit=cover`, otherwise env() resolves to 0 and this is a
    // no-op — see index.html.
    <div className="min-h-screen flex flex-col gap-5 px-6 pb-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-600 grid place-items-center text-lg shrink-0">
          ◈
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight truncate">Nexus Local</h1>
          <p className="text-xs text-white/40 truncate">Local grid · background services node</p>
        </div>
        <span
          className={`ml-auto shrink-0 text-xs px-2 py-1 rounded-full ${
            status?.supabase_configured
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-amber-500/15 text-amber-300"
          }`}
        >
          {status?.supabase_configured ? "● online" : "○ no backend"}
        </span>
      </header>

      <nav className="flex w-fit gap-1 rounded-lg bg-white/[0.04] p-1">
        {(["node", "learn"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPage(p)}
            className={`flex min-h-[44px] items-center justify-center rounded-md px-4 py-1.5 text-xs font-medium capitalize transition-colors ${
              page === p ? "bg-white/10 text-white/90" : "text-white/40 active:text-white/70"
            }`}
          >
            {p}
          </button>
        ))}
      </nav>

      {err && (
        <div className="text-xs text-red-300 bg-red-500/10 rounded-lg p-3">{err}</div>
      )}

      {page === "node" && (
        <>
          {!loading && !session && (
            <div className="flex items-center gap-3 text-xs rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-3">
              <span className="text-amber-200/80">
                Signed out — home-screen widgets can’t get a session token.
              </span>
              <button
                onClick={() => setShowLogin(true)}
                className="ml-auto shrink-0 px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
              >
                Sign in
              </button>
            </div>
          )}

          {status && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <Field label="Device" value={status.hostname} />
              <Field label="Platform" value={status.platform} />
              <Field label="Node ID" value={status.device_id.slice(0, 8)} />
              <Field label="Version" value={status.version} />
            </div>
          )}

          <section className="flex flex-col gap-2">
            <h2 className="text-xs uppercase tracking-wide text-white/40">
              Installed modules
            </h2>
            {status?.modules.length ? (
              status.modules.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{m.name}</span>
                    <span className="text-[10px] text-white/40">v{m.version}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {m.actions.map((a) => (
                      <span
                        key={a}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-white/30">No modules registered.</p>
            )}
          </section>

          <TimeTrackerPanels />

          <KeychainDebug />

          <BleScan />
        </>
      )}

      {page === "learn" && <LearnPage />}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-white/35">{label}</div>
      <div className="mt-0.5 font-mono text-white/80 truncate">{value}</div>
    </div>
  );
}
