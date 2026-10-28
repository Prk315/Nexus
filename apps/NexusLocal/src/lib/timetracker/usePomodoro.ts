/**
 * The pomodoro as seen from a window: Rust's status, kept fresh, plus the
 * actions. Shared by `PomodoroPanel` and `FloatingTimer` so the two can never
 * disagree about what second it is.
 *
 * Freshness comes from three places, cheapest first:
 *
 * 1. `pomodoro:status` events. Every `tt_pomodoro_*` command and the desktop
 *    driver broadcast after each reconcile, so a button pressed in the floating
 *    window shows up in the main window in the same frame.
 * 2. A re-read on mount, focus and `visibilitychange` (iOS WKWebView does not
 *    reliably fire window focus on foregrounding).
 * 3. A slow poll. On the phone nothing else advances the run — there is no
 *    driver — and `tt_pomodoro_status` reconciles before it answers.
 *
 * The 1s tick is display-only: the countdown is derived from `ends_at`, never
 * decremented, so a frozen WebView is right again on its first tick.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { STATUS_EVENT, type PomodoroStatus, type RecentTask } from "./pomodoro";

const POLL_MS = 15_000;

export type PomodoroCommand =
  | "tt_pomodoro_start"
  | "tt_pomodoro_pause"
  | "tt_pomodoro_resume"
  | "tt_pomodoro_skip"
  | "tt_pomodoro_end";

export function usePomodoro() {
  const [status, setStatus] = useState<PomodoroStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Monotonic id: a slow read that resolves after a command (or an event)
  // would otherwise put back the state that command just replaced.
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const my = ++seq.current;
    try {
      const s = await invoke<PomodoroStatus>("tt_pomodoro_status");
      if (!mounted.current || my !== seq.current) return;
      setStatus(s);
      setError(null);
    } catch (e) {
      if (!mounted.current || my !== seq.current) return;
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<PomodoroStatus>(STATUS_EVENT, (event) => {
      seq.current++;
      setStatus(event.payload);
      setError(null);
    })
      .then((un) => {
        if (cancelled) un();
        else unlisten = un;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(poll);
    };
  }, [refresh]);

  // Tick only while something is counting.
  const counting =
    (status?.run != null && status.run.ends_at !== null) || status?.session.state === "running";
  useEffect(() => {
    if (!counting) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [counting]);

  const act = useCallback(
    async (command: PomodoroCommand, args?: Record<string, unknown>) => {
      const my = ++seq.current;
      setBusy(true);
      try {
        const s = await invoke<PomodoroStatus>(command, args);
        if (mounted.current && my === seq.current) {
          setStatus(s);
          setError(null);
        }
        return s;
      } catch (e) {
        if (mounted.current) setError(String(e));
        return null;
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    []
  );

  return { status, error, busy, now, act, refresh };
}

/**
 * Recently tracked tasks, for one-tap starts. Re-read whenever the timer goes
 * idle, which is when a just-stopped task has become the newest entry.
 */
export function useRecentTasks(sessionState: string | undefined, limit = 6) {
  const [tasks, setTasks] = useState<RecentTask[]>([]);
  useEffect(() => {
    if (sessionState !== undefined && sessionState !== "idle") return;
    let cancelled = false;
    invoke<RecentTask[]>("tt_recent_tasks", { limit })
      .then((t) => {
        if (!cancelled) setTasks(t);
      })
      // No chips is a fine fallback; an error line for a convenience is not.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionState, limit]);
  return tasks;
}

/** The phone has no floating window; hide the controls that would open one. */
export const IS_IOS =
  typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
