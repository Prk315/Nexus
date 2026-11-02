import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Mac enforcement controls.
 *
 * `BlockingPanel` edits the *inputs* of the policy and shows the server's
 * verdict. This panel is about whether this machine ever acts on that verdict —
 * which was, until now, off by default with no way to change it short of
 * hand-editing `~/.nexuslocalrc` and relaunching.
 *
 * Two switches, and they are genuinely independent:
 *
 *  - **Enforce blocking** — whether the 30s tick applies the verdict to
 *    `/etc/hosts` and quits blocked apps.
 *  - **Background service** — a LaunchAgent running `nexus-local --daemon`: a
 *    headless process that starts at login, relaunches on crash, and keeps
 *    enforcing after this app is quit.
 *
 * On macOS the enforcing is done **by the daemon, not by this app** — the
 * desktop app spawns no grid at all (see `lib.rs`), because two processes
 * writing `/etc/hosts` means two admin password dialogs. So "enforce" without
 * "background service" is a setting with nothing to act on it, and the panel
 * says exactly that rather than showing a green tick for each.
 *
 * Renders `null` off macOS: iOS enforces through the Safari content blocker, has
 * no hosts file, and cannot enumerate processes.
 *
 * The third control is the **root enforcer** (`hosts_enforcer.rs`): one admin
 * password installs a system LaunchDaemon that writes /etc/hosts itself. Without
 * it every change of blocked sites is a password dialog — including the re-lock
 * when a meal unblock ends, which Cancel would simply skip.
 *
 * There is deliberately no Remove button. The panel can only *request* removal;
 * the enforcer uninstalls itself a day later, blocking the whole time, and the
 * request can be withdrawn. Leaving on impulse is the thing it exists to stop.
 */

type Status = {
  supported: boolean;
  enforcing: boolean;
  autostart: boolean;
  daemon_running: boolean;
  exe_path: string;
  agent_path: string;
  hosts_domains: string[];
  hosts_error: string | null;
};

/** Mirror of `HostsEnforcerStatus` in `hosts_enforcer.rs`. */
type EnforcerStatus = {
  supported: boolean;
  installed: boolean;
  running: boolean;
  installed_version: string | null;
  app_version: string;
  outdated: boolean;
  last_run_at: string | null;
  last_ok: boolean | null;
  last_outcome: string | null;
  removal_requested: boolean;
  removal_due_at: string | null;
  removal_delay_secs: number;
};

/** "in 23 h" / "in 40 min" until an instant. */
function until(iso: string): string {
  const s = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 1000));
  return s >= 5400 ? `in ${Math.round(s / 3600)} h` : `in ${Math.max(1, Math.round(s / 60))} min`;
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 90 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}

/**
 * A dev binary is a real trap here: registering `target/debug/nexus-local` for
 * launch-at-login points launchd at a path that gets overwritten by every
 * rebuild and vanishes on `cargo clean`. The user sees "launch at login: on" and
 * gets nothing at the next reboot.
 */
function isDevBuild(exePath: string): boolean {
  return /\/target\/(debug|release)\//.test(exePath);
}

export function EnforcementPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [enforcer, setEnforcer] = useState<EnforcerStatus | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const mounted = useRef(true);
  const alive = useCallback(() => mounted.current, []);

  const load = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([
        invoke<Status>("tt_enforcement_get"),
        invoke<EnforcerStatus>("tt_hosts_enforcer_status"),
      ]);
      if (alive()) {
        setStatus(s);
        setEnforcer(e);
      }
    } catch (e) {
      // Unlike the verdict, a failure here is genuinely unexpected — the command
      // reads local state only. Surface it rather than rendering a dead panel.
      if (alive()) setMsg(String(e));
    }
  }, [alive]);

  useEffect(() => {
    mounted.current = true;
    load();
    // Slow poll: picks up an enforcement pass landing in /etc/hosts, and the
    // case where the agent was booted out from a terminal.
    const t = setInterval(load, 15000);
    return () => {
      mounted.current = false;
      clearInterval(t);
    };
  }, [load]);

  async function toggleEnforcing() {
    if (!status) return;
    const next = !status.enforcing;
    setBusy(true);
    setMsg("");
    try {
      await invoke("tt_enforcement_set", { enforcing: next });
      if (next) {
        // Don't make the user stare at an unchanged hosts file for 30 seconds
        // wondering whether the switch did anything. This is also where the
        // admin password dialog appears, which is worth it being tied to a
        // button press rather than arriving unexplained mid-tick.
        setMsg("applying…");
        const r = await invoke<{ domains: number; processes: number }>(
          "tt_enforcement_apply_now",
        );
        if (alive()) setMsg(`enforcing · ${r.domains} domain(s), ${r.processes} process(es)`);
      } else {
        // Deliberately does not clear /etc/hosts: switching enforcement off
        // stops future passes, and silently unblocking everything is not what
        // "stop enforcing" should mean. `clear` is its own explicit action.
        if (alive()) setMsg("enforcement off — existing hosts entries left in place");
      }
    } catch (e) {
      if (alive()) setMsg(String(e));
    }
    await load();
    if (alive()) setBusy(false);
  }

  async function toggleAutostart() {
    if (!status) return;
    const next = !status.autostart;
    setBusy(true);
    setMsg("");
    try {
      await invoke("tt_enforcement_autostart_set", { enabled: next });
      if (alive()) setMsg(next ? "launch at login enabled" : "launch at login removed");
    } catch (e) {
      if (alive()) setMsg(String(e));
    }
    await load();
    if (alive()) setBusy(false);
  }

  /** Install or reinstall the root enforcer — one admin password. */
  async function installEnforcer() {
    setBusy(true);
    setMsg("waiting for the admin password…");
    try {
      await invoke("tt_hosts_enforcer_install");
      if (alive()) setMsg("root enforcer installed — site changes now apply on their own within 30s");
    } catch (e) {
      // A cancelled dialog lands here too ("User canceled"), which is fine to show.
      if (alive()) setMsg(String(e));
    }
    await load();
    if (alive()) setBusy(false);
  }

  /** Start or withdraw the delayed removal. No password — it only starts a clock. */
  async function setRemovalRequested(request: boolean) {
    setBusy(true);
    setMsg("");
    try {
      await invoke(request ? "tt_hosts_enforcer_request_removal" : "tt_hosts_enforcer_cancel_removal");
      if (alive())
        setMsg(
          request
            ? "removal requested — blocking continues until it takes effect"
            : "removal request withdrawn",
        );
    } catch (e) {
      if (alive()) setMsg(String(e));
    }
    await load();
    if (alive()) setBusy(false);
  }

  if (!status) return null;
  if (!status.supported) return null;

  const rootSites = !!enforcer?.installed && enforcer.running;

  const dev = isDevBuild(status.exe_path);
  // The honest summary, in the order things actually break. The daemon is the
  // only thing that enforces on macOS, so "enforce on, service off" is not a
  // partial success — it is nothing happening.
  const gap = !status.enforcing
    ? rootSites
      ? "Sites are enforced by the root enforcer, but blocked apps aren't being quit — enforcement is off."
      : "Nothing is being enforced on this Mac."
    : !status.daemon_running
      ? "Enforcement is on, but the background service isn't running — so nothing is applying it."
      : !status.autostart
        ? "Enforcing now, but the service won't start again after a reboot."
        : null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs uppercase tracking-wide text-white/40">Enforcement · this Mac</h2>

      {gap ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-3 text-[10px] text-amber-200/80">
          {gap}
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] p-3 text-[10px] text-emerald-200/80">
          Enforcing continuously · runs in the background, survives quitting this app,
          starts at login, relaunches if it crashes.
        </div>
      )}

      <Toggle
        label="Enforce blocking"
        hint="Applies the server's verdict every 30s — hosts file and app quits."
        on={status.enforcing}
        busy={busy}
        onClick={toggleEnforcing}
      />
      <Toggle
        label="Background service"
        hint={
          dev
            ? "⚠ This is a dev build — the path changes on every rebuild."
            : status.autostart && !status.daemon_running
              ? "⚠ Installed but not running — check Console for nexus-local."
              : "Headless daemon. Keeps blocking after you quit this app."
        }
        on={status.autostart}
        busy={busy}
        onClick={toggleAutostart}
        warn={dev || (status.autostart && !status.daemon_running)}
      />

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[10px]">
        {status.hosts_error ? (
          <span className="text-red-300">/etc/hosts: {status.hosts_error}</span>
        ) : status.hosts_domains.length === 0 ? (
          <span className="text-white/40">Nothing currently written to /etc/hosts.</span>
        ) : (
          <>
            <span className="text-white/45">
              {status.hosts_domains.length} domain
              {status.hosts_domains.length === 1 ? "" : "s"} blocked in /etc/hosts right now
            </span>
            <div className="mt-1 font-mono text-[10px] leading-relaxed text-white/35">
              {status.hosts_domains.join(", ")}
            </div>
          </>
        )}
      </div>

      {enforcer?.supported && (
        <div
          className={`rounded-xl border p-3 text-[10px] ${
            !enforcer.installed
              ? "border-white/10 bg-white/[0.03]"
              : enforcer.running && !enforcer.outdated && enforcer.last_ok !== false
                ? "border-emerald-500/20 bg-emerald-500/[0.07]"
                : "border-amber-500/20 bg-amber-500/[0.07]"
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-white/85">Auto-lock sites (no password)</div>
              {!enforcer.installed ? (
                <div className="mt-0.5 text-white/40">
                  Today every change to blocked sites asks for your password — including
                  the re-lock when a meal's 30 minutes end, and Cancel skips it. Install
                  once and changes apply on their own within 30s. It can't be removed on
                  the spot — removal takes effect a day after you ask.
                </div>
              ) : !enforcer.running ? (
                <div className="mt-0.5 text-amber-200/80">
                  Installed, but no run in the last 90s — check
                  /Library/Logs/nexus-local-hosts.log. Last: {ago(enforcer.last_run_at)}.
                </div>
              ) : (
                <div className="mt-0.5 text-emerald-200/80">
                  Root enforcer running · checked {ago(enforcer.last_run_at)}
                  {enforcer.last_outcome ? ` · ${enforcer.last_outcome}` : ""}
                </div>
              )}
              {enforcer.installed && enforcer.outdated && (
                <div className="mt-1 text-amber-200/80">
                  Helper is from v{enforcer.installed_version ?? "?"}, the app is v
                  {enforcer.app_version} — reinstall to update it.
                </div>
              )}
              {enforcer.installed &&
                (enforcer.removal_requested ? (
                  <div className="mt-1 text-amber-200/80">
                    {enforcer.removal_due_at
                      ? `Removal requested — it uninstalls itself ${until(enforcer.removal_due_at)} (${new Date(enforcer.removal_due_at).toLocaleString()}). Sites stay blocked until then.`
                      : "Removal requested — the countdown starts on the enforcer's next run (within 30s)."}
                  </div>
                ) : (
                  <div className="mt-1 text-white/30">
                    No uninstall button, on purpose: a removal request takes effect{" "}
                    {Math.round(enforcer.removal_delay_secs / 3600)} h later, and blocking
                    continues meanwhile.
                  </div>
                ))}
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              {(!enforcer.installed || enforcer.outdated) && (
                <button
                  onClick={installEnforcer}
                  disabled={busy}
                  className="rounded bg-indigo-500/20 px-2.5 py-1 text-[10px] font-medium text-indigo-300 disabled:opacity-40"
                >
                  {enforcer.installed ? "Reinstall" : "Install"}
                </button>
              )}
              {enforcer.installed && (
                <button
                  onClick={() => setRemovalRequested(!enforcer.removal_requested)}
                  disabled={busy}
                  className="rounded bg-white/[0.06] px-2.5 py-1 text-[10px] text-white/45 disabled:opacity-40"
                >
                  {enforcer.removal_requested ? "Cancel removal" : "Request removal"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <p className="text-[10px] text-white/30">
        {enforcer?.installed
          ? "Site changes need no password: the root enforcer applies the verdict itself. Blocked apps are still quit by the background service."
          : "Changing what is blocked needs an admin password — macOS requires it to write /etc/hosts. An unchanged verdict writes nothing, so the 30s tick stays silent."}
      </p>

      {msg && <div className="text-[10px] text-white/45">{msg}</div>}
    </section>
  );
}

function Toggle({
  label,
  hint,
  on,
  busy,
  onClick,
  warn,
}: {
  label: string;
  hint: string;
  on: boolean;
  busy: boolean;
  onClick: () => void;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-white/85">{label}</div>
        <div className={`mt-0.5 text-[10px] ${warn ? "text-amber-300/70" : "text-white/35"}`}>
          {hint}
        </div>
      </div>
      <button
        onClick={onClick}
        disabled={busy}
        className={`shrink-0 rounded px-2.5 py-1 text-[10px] font-medium ${
          busy
            ? "bg-white/10 text-white/30"
            : on
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-white/[0.06] text-white/40"
        }`}
      >
        {on ? "on" : "off"}
      </button>
    </div>
  );
}
