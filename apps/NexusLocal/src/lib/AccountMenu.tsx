import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNexusAuth } from "@nexus/core";

/**
 * Account avatar + profile switcher for the header.
 *
 * # Why this shows two different things
 *
 * "Who is signed in" and "where usage is exported" are genuinely separate facts
 * on this machine, and conflating them would make the switcher lie:
 *
 *  - The **session** lives in this app's localStorage. Signing in changes it
 *    instantly.
 *  - The **export target** is `active_user_id` in `~/.nexuslocalrc`, read by the
 *    *daemon* — a different process — on its next sync pass, up to ~5 minutes
 *    later. Intervals already uploaded stay with whoever owned them at the time,
 *    which is correct: they were that person's.
 *
 * So switching profile writes the config and then says so, rather than implying
 * the change is already live everywhere.
 *
 * # Signed out
 *
 * Renders a muted button that opens the login screen. Everything else in this
 * app is anon-keyed and works signed out (see `App.tsx`), so this is an entry
 * point, not a gate.
 */

/** Initial for the avatar. Falls back to a dot rather than an empty circle. */
function initialOf(email: string | undefined): string {
  const c = email?.trim()?.[0];
  return c ? c.toUpperCase() : "·";
}

/**
 * A stable colour per account, so two profiles are distinguishable at a glance
 * without needing avatars to load from anywhere.
 */
function hueOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

export function AccountMenu({ onRequestLogin }: { onRequestLogin: () => void }) {
  const { session, user, signOut, loading } = useNexusAuth();
  const [open, setOpen] = useState(false);
  const [exportTarget, setExportTarget] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const mounted = useRef(true);
  const alive = useCallback(() => mounted.current, []);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const loadTarget = useCallback(async () => {
    try {
      const t = await invoke<string>("tt_active_profile_get");
      if (alive()) setExportTarget(t);
    } catch {
      // Not fatal — the menu still works as a sign-in/out control. Only the
      // export-target line is unavailable, and it is rendered conditionally.
    }
  }, [alive]);

  useEffect(() => {
    mounted.current = true;
    loadTarget();
    return () => {
      mounted.current = false;
    };
  }, [loadTarget]);

  // Close on outside click. Without this the panel sits over the content and
  // there is no obvious way to dismiss it on a trackpad.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const email = user?.email ?? undefined;
  const uid = user?.id ?? "";
  const hue = hueOf(uid || email || "anon");

  // The case worth surfacing: signed in as one account while the daemon is
  // still exporting to another. Silent divergence here means a day of usage
  // filed under the wrong person.
  const mismatch = !!session && !!uid && exportTarget !== "" && exportTarget !== uid;
  const notSet = !!session && !!uid && exportTarget === "";

  async function useThisAccount() {
    if (!uid) return;
    setBusy(true);
    setMsg("");
    try {
      // camelCase over IPC — snake_case works on macOS and hard-fails on iOS.
      await invoke("tt_active_profile_set", { userId: uid });
      await loadTarget();
      if (alive()) setMsg("Export target updated — the daemon picks it up within 5 min.");
    } catch (e) {
      if (alive()) setMsg(String(e));
    }
    if (alive()) setBusy(false);
  }

  async function switchAccount() {
    setBusy(true);
    setMsg("");
    try {
      await signOut();
      if (alive()) {
        setOpen(false);
        onRequestLogin();
      }
    } catch (e) {
      if (alive()) setMsg(String(e));
    }
    if (alive()) setBusy(false);
  }

  if (loading) {
    return <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />;
  }

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => (session ? setOpen((v) => !v) : onRequestLogin())}
        title={session ? (email ?? "Account") : "Sign in"}
        className={`grid h-9 w-9 place-items-center rounded-full text-sm font-semibold transition-shadow ${
          session ? "text-white/90" : "border border-dashed border-white/20 text-white/30"
        }`}
        style={
          session
            ? {
                background: `linear-gradient(135deg, hsl(${hue} 65% 45%), hsl(${(hue + 40) % 360} 65% 35%))`,
              }
            : undefined
        }
      >
        {session ? initialOf(email) : "＋"}
      </button>

      {/* A dot rather than a full banner: the header is 36px tall and a mismatch
          is a nudge, not an emergency. The detail lives inside the menu. */}
      {(mismatch || notSet) && (
        <span
          className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0a0a0f] bg-amber-400"
          title="Usage is not exporting to this account"
        />
      )}

      {open && session && (
        <div className="absolute left-0 top-11 z-50 w-72 rounded-xl border border-white/10 bg-[#12121a] p-3 shadow-xl shadow-black/50">
          <div className="text-[11px] text-white/80">{email ?? "Signed in"}</div>
          <div className="mt-0.5 font-mono text-[10px] text-white/30">{uid.slice(0, 8)}</div>

          <div className="mt-2.5 rounded-lg border border-white/10 bg-white/[0.03] p-2">
            <div className="text-[10px] uppercase tracking-wide text-white/35">Usage exports to</div>
            {notSet ? (
              <p className="mt-1 text-[10px] leading-relaxed text-amber-200/70">
                Not set — the daemon is using its default account. Claim it for this
                profile below.
              </p>
            ) : mismatch ? (
              <p className="mt-1 text-[10px] leading-relaxed text-amber-200/70">
                Another account (
                <span className="font-mono">{exportTarget.slice(0, 8)}</span>). Time
                recorded on this Mac is being filed under that profile, not this one.
              </p>
            ) : (
              <p className="mt-1 text-[10px] leading-relaxed text-emerald-300/70">
                This account. New intervals are filed here.
              </p>
            )}
            {(mismatch || notSet) && (
              <button
                onClick={useThisAccount}
                disabled={busy}
                className="mt-2 w-full rounded-lg bg-indigo-500/20 px-2 py-1.5 text-[10px] font-medium text-indigo-300 disabled:opacity-40"
              >
                Export to this account
              </button>
            )}
          </div>

          <button
            onClick={switchAccount}
            disabled={busy}
            className="mt-2 w-full rounded-lg bg-white/[0.06] px-2 py-1.5 text-[10px] font-medium text-white/70 disabled:opacity-40"
          >
            Switch account
          </button>

          <p className="mt-2 text-[10px] leading-relaxed text-white/25">
            Switching signs you out here. Already-uploaded intervals stay with the
            account that recorded them.
          </p>

          {msg && <div className="mt-2 text-[10px] text-white/45">{msg}</div>}
        </div>
      )}
    </div>
  );
}
