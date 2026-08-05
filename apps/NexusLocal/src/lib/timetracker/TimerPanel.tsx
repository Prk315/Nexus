import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/// Mirror of `SessionStatus` in `src-tauri/src/timetracker/session.rs`. serde uses
/// the default (snake_case) field naming, so the keys arrive exactly as declared.
type SessionStatus = {
  state: "idle" | "running" | "paused";
  task_name: string | null;
  project: string | null;
  /// RFC3339 UTC. On resume this is *back-dated* so `now - start_time` stays the
  /// true elapsed — never substitute `Date.now()` for it.
  start_time: string | null;
  elapsed_seconds: number;
};

const IDLE: SessionStatus = {
  state: "idle",
  task_name: null,
  project: null,
  start_time: null,
  elapsed_seconds: 0,
};

/// Long poll: `active_sessions` has UNIQUE(user_id), so there is exactly one
/// active session per user across every device. Re-reading it is a straight read,
/// not a merge — a timer started on the phone shows up here within 10s.
const POLL_MS = 10_000;

function formatElapsed(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/// Epoch **seconds as a float** for the Live Activity. Prefers the (possibly
/// back-dated) `start_time` from Rust; falls back to deriving it from the elapsed
/// count if the timestamp is missing or unparseable, so the Dynamic Island never
/// shows a clock starting from zero on resume.
function startTimestampOf(s: SessionStatus): number {
  const parsed = s.start_time ? new Date(s.start_time).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed / 1000 : Date.now() / 1000 - s.elapsed_seconds;
}

/// Fire-and-forget: these are no-ops off iOS and must never reject into the UI.
/// `LiveActivitySync` also drives these on a 15s reconcile loop — the Swift bridge
/// ends all existing activities before requesting a new one, so its duplicate
/// start is idempotent. We fire here as well so the transition feels instant.
function startLiveActivity(s: SessionStatus) {
  invoke("start_live_activity", {
    taskName: s.task_name ?? "Timer",
    projectName: s.project ?? "",
    startTimestamp: startTimestampOf(s),
  }).catch(() => {});
}

function endLiveActivity() {
  invoke("end_live_activity").catch(() => {});
}

/// Session recorder: start / pause / resume / stop against the Rust commands in
/// `timetracker::session`, with a live H:MM:SS clock. The 1s tick is display-only
/// smoothing — `tt_session_status` stays authoritative and is re-read on mount, on
/// window focus, and every 10s.
export function TimerPanel() {
  const [session, setSession] = useState<SessionStatus>(IDLE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [taskName, setTaskName] = useState("");
  const [project, setProject] = useState("");

  // Declared first on purpose: React runs effects in declaration order, so this
  // flips to true before the poll effect below fires on StrictMode's second pass.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Monotonic request id. Three writers race on `session` — the 10s poll, the
  // focus/visibility re-read, and the command results — and an in-flight status
  // read that resolves *after* a Stop would otherwise resurrect a dead session
  // (and with it the 1s tick). Only the most recently issued request may write.
  const seq = useRef(0);
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    // A command is mid-flight; its own result is fresher than anything we'd read.
    if (busyRef.current) return;
    const my = ++seq.current;
    try {
      const s = await invoke<SessionStatus>("tt_session_status");
      if (!mounted.current || my !== seq.current) return;
      setSession(s);
      setError(null);
    } catch (e) {
      // Unit 2 is unlanded until the command bodies exist — surface the message
      // rather than blanking the panel or leaving an unhandled rejection.
      if (!mounted.current || my !== seq.current) return;
      setError(String(e));
    }
  }, []);

  // Authoritative sync: mount, foreground, and a 10s poll for other devices.
  // `visibilitychange` is listened to alongside `focus` because iOS WKWebView
  // does not reliably fire window focus on app foregrounding — and WebView timers
  // are frozen while backgrounded, so that re-read is what corrects the clock.
  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(refresh, POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
    };
  }, [refresh]);

  // Display-only tick. Torn down whenever the timer is not running, so a paused
  // or idle panel holds no interval.
  useEffect(() => {
    if (session.state !== "running") return;
    const t = setInterval(() => {
      setSession((s) =>
        s.state === "running" ? { ...s, elapsed_seconds: s.elapsed_seconds + 1 } : s
      );
    }, 1000);
    return () => clearInterval(t);
  }, [session.state]);

  /// Runs one session command. The Live Activity side effect fires before the
  /// mount check so the Dynamic Island still settles if the panel unmounts.
  const run = useCallback(
    async (
      call: () => Promise<SessionStatus>,
      onSuccess?: (s: SessionStatus) => void
    ): Promise<SessionStatus | null> => {
      const my = ++seq.current;
      busyRef.current = true;
      setBusy(true);
      try {
        const s = await call();
        onSuccess?.(s);
        if (mounted.current && my === seq.current) {
          setSession(s);
          setError(null);
        }
        return s;
      } catch (e) {
        if (mounted.current && my === seq.current) setError(String(e));
        return null;
      } finally {
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    []
  );

  async function handleStart() {
    const name = taskName.trim();
    if (!name || busy) return;
    const s = await run(
      () =>
        invoke<SessionStatus>("tt_session_start", {
          taskName: name,
          project: project.trim() || null,
        }),
      startLiveActivity
    );
    if (s && mounted.current) {
      setTaskName("");
      setProject("");
    }
  }

  function handlePause() {
    if (busy) return;
    void run(() => invoke<SessionStatus>("tt_session_pause"), endLiveActivity);
  }

  function handleResume() {
    if (busy) return;
    // Uses the back-dated `start_time` the command returns, not `Date.now()`.
    void run(() => invoke<SessionStatus>("tt_session_resume"), startLiveActivity);
  }

  function handleStop() {
    if (busy) return;
    void run(() => invoke<SessionStatus>("tt_session_stop"), endLiveActivity);
  }

  const idle = session.state === "idle";
  const running = session.state === "running";

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs uppercase tracking-wide text-white/40">Timer</h2>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={`font-mono text-2xl tabular-nums ${
              running ? "text-emerald-300" : idle ? "text-white/40" : "text-amber-300"
            }`}
          >
            {formatElapsed(session.elapsed_seconds)}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] ${
              running
                ? "bg-emerald-500/15 text-emerald-300"
                : idle
                ? "bg-white/[0.06] text-white/40"
                : "bg-amber-500/15 text-amber-300"
            }`}
          >
            {running ? "● running" : idle ? "○ idle" : "❚❚ paused"}
          </span>
        </div>

        {!idle && (
          <div className="mt-1 truncate text-xs text-white/70">
            {session.task_name || "(untitled)"}
            {session.project && <span className="text-white/35"> · {session.project}</span>}
          </div>
        )}

        {idle && (
          <div className="mt-2 flex flex-col gap-2">
            <input
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleStart();
              }}
              placeholder="What are you working on?"
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/80 placeholder:text-white/25"
            />
            <input
              value={project}
              onChange={(e) => setProject(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleStart();
              }}
              placeholder="Project (optional)"
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/80 placeholder:text-white/25"
            />
          </div>
        )}

        <div className="mt-2 flex gap-2">
          {idle && (
            <button
              onClick={() => void handleStart()}
              disabled={busy || !taskName.trim()}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium ${
                busy || !taskName.trim()
                  ? "bg-white/10 text-white/30"
                  : "bg-indigo-500/20 text-indigo-300"
              }`}
            >
              Start
            </button>
          )}

          {running && (
            <button
              onClick={handlePause}
              disabled={busy}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium ${
                busy ? "bg-white/10 text-white/30" : "bg-amber-500/20 text-amber-300"
              }`}
            >
              Pause
            </button>
          )}

          {session.state === "paused" && (
            <button
              onClick={handleResume}
              disabled={busy}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium ${
                busy ? "bg-white/10 text-white/30" : "bg-emerald-500/20 text-emerald-300"
              }`}
            >
              Resume
            </button>
          )}

          {!idle && (
            <button
              onClick={handleStop}
              disabled={busy}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium ${
                busy ? "bg-white/10 text-white/30" : "bg-red-500/20 text-red-300"
              }`}
            >
              Stop
            </button>
          )}
        </div>

        {error && (
          <div className="mt-2 rounded-lg bg-red-500/10 p-2 text-[10px] text-red-300 break-words">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}
