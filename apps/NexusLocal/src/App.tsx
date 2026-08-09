import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoginScreen, useNexusAuth } from "@nexus/core";
import { AccountMenu } from "./lib/AccountMenu";
import { Sidebar, SidebarToggle } from "./lib/Sidebar";
import { BleScan } from "./lib/BleScan";
import { GarminPanel } from "./lib/GarminPanel";
import { KeychainDebug } from "./lib/KeychainDebug";
import { TimeTrackerDashboard, TimeTrackerSettings } from "./lib/timetracker";
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

/** The dashboards in the header bar. Add one here and to `renderPage` below. */
const PAGES = ["time", "learn"] as const;
type Page = (typeof PAGES)[number];

/**
 * Remembered so the sidebar doesn't reopen on every launch — it is a workspace
 * preference, not app state. Narrow screens default to closed regardless: an
 * overlay covering the whole phone on launch would hide the dashboard entirely.
 */
const SIDEBAR_KEY = "nexuslocal.sidebar.open";

function initialSidebarOpen(): boolean {
  if (typeof window === "undefined") return false;
  const wide = window.matchMedia("(min-width: 640px)").matches;
  if (!wide) return false;
  return window.localStorage.getItem(SIDEBAR_KEY) !== "0";
}

export default function App() {
  const [page, setPage] = useState<Page>("time");
  const [status, setStatus] = useState<GridStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen);
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

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_KEY, sidebarOpen ? "1" : "0");
  }, [sidebarOpen]);

  if (showLogin && !session) return <LoginScreen appName="Nexus Local" />;

  return (
    // Full height with `min-h-0` on the row below, so the dashboard scrolls
    // inside itself rather than the whole page scrolling and taking the header
    // with it. `h-screen` (not `min-h-screen`) is what makes that possible.
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        {/* Account first: the avatar is the control you reach for, and the ◈ is
            decoration, so it should not hold the leading slot. */}
        <AccountMenu onRequestLogin={() => setShowLogin(true)} />
        <SidebarToggle open={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />

        <div className="hidden min-w-0 sm:block">
          <h1 className="truncate text-sm font-semibold leading-tight">Nexus Local</h1>
        </div>

        {/* The dashboards. Centred-ish rather than left-aligned so it reads as a
            switch between views, not as a sub-item of the title. */}
        <nav className="flex gap-1 rounded-lg bg-white/[0.04] p-1">
          {PAGES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPage(p)}
              className={`flex min-h-[36px] items-center justify-center rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                page === p ? "bg-white/10 text-white/90" : "text-white/40 hover:text-white/70"
              }`}
            >
              {p}
            </button>
          ))}
        </nav>

        <span
          className={`ml-auto shrink-0 rounded-full px-2 py-1 text-[10px] ${
            status?.supabase_configured
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-amber-500/15 text-amber-300"
          }`}
        >
          {status?.supabase_configured ? "● online" : "○ no backend"}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)}>
          {err && (
            <div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-300">{err}</div>
          )}

          {!loading && !session && (
            <div className="flex flex-col gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-3 text-xs">
              <span className="text-amber-200/80">
                Signed out — home-screen widgets can’t get a session token.
              </span>
              <button
                onClick={() => setShowLogin(true)}
                className="shrink-0 rounded-lg bg-amber-500/15 px-2.5 py-1 text-amber-200 hover:bg-amber-500/25"
              >
                Sign in
              </button>
            </div>
          )}

          {/* Configuration: the lists you edit occasionally. See the split in
              `lib/timetracker/index.tsx`. */}
          <TimeTrackerSettings />

          <section className="flex flex-col gap-2">
            <h3 className="text-xs uppercase tracking-wide text-white/40">Installed modules</h3>
            {status?.modules.length ? (
              status.modules.map((m) => (
                <div key={m.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">{m.name}</span>
                    <span className="shrink-0 text-[10px] text-white/40">v{m.version}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {m.actions.map((a) => (
                      <span
                        key={a}
                        className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-[10px] text-white/30">
                No modules registered. On macOS the daemon owns them — the app
                itself runs none.
              </p>
            )}
          </section>

          {status && (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs uppercase tracking-wide text-white/40">This device</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Field label="Device" value={status.hostname} />
                <Field label="Platform" value={status.platform} />
                <Field label="Node ID" value={status.device_id.slice(0, 8)} />
                <Field label="Version" value={status.version} />
              </div>
            </section>
          )}

          <GarminPanel platform={status?.platform ?? null} />

          <KeychainDebug />
          <BleScan />
        </Sidebar>

        {/* px-6 pb-6 is load-bearing: LearnPage cancels it with `-mx-6 -mb-6` to
            bleed its light background to the edges. */}
        <main className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6 pt-5">
          {page === "time" && <TimeTrackerDashboard />}
          {page === "learn" && <LearnPage />}
        </main>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-white/35">{label}</div>
      <div className="mt-0.5 truncate font-mono text-white/80">{value}</div>
    </div>
  );
}
