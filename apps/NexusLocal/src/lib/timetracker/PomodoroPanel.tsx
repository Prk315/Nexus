/**
 * Pomodoro panel — the ring, the phase machine's driver, and the durations.
 *
 * The cycle logic itself is in `pomodoro.ts` as pure functions; this file is the
 * part that needs a clock and a network. Two things it does that TimeTracker's
 * version did not:
 *
 * 1. **Config is persisted.** TimeTracker kept pomodoro settings in a Redux
 *    slice with no persistence call, so the enable flag and every duration reset
 *    to the default on each launch. Here they load from `tt_pomodoro_get` on
 *    mount and save through `tt_pomodoro_set` (debounced) on change.
 * 2. **The durations are editable in the panel.** Nexus Local has no settings
 *    page, so a setting that lives only in a settings page doesn't exist.
 *
 * The countdown only advances while a session is actually running: the pomodoro
 * is a view onto the timer, not a second independent clock. Session state comes
 * from `tt_session_status` (work unit 2) — read, never shared, so this panel and
 * unit 3's timer panel stay independent.
 *
 * Filename note: this is `PomodoroPanel.tsx` rather than `Pomodoro.tsx` because
 * the pure module beside it is `pomodoro.ts`, and on a case-insensitive
 * filesystem TypeScript resolves both spellings to one file (TS1261).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_CONFIG,
  MAX_VALUE,
  MIN_VALUE,
  formatRemaining,
  nextPhase,
  phaseDurationSeconds,
  phaseLabel,
  phaseMessage,
  remainingFromDeadline,
  sanitizeConfig,
  type Phase,
  type PomodoroConfig,
} from "./pomodoro";

/** Matches unit 2's `SessionStatus`. Only `state` matters to the pomodoro. */
type SessionState = "idle" | "running" | "paused";

/**
 * Session status is a network round trip — 5s, not the 1s of the display tick.
 * The cost is that the pomodoro keeps counting for up to one poll after the
 * timer is paused elsewhere. That is poll granularity, not drift: the deadline
 * is nulled the moment the pause is observed, and a `visibilitychange` or window
 * focus resyncs immediately.
 */
const STATUS_POLL_MS = 5_000;
const PERSIST_DEBOUNCE_MS = 600;

const PHASE_COLOR: Record<Phase, string> = {
  work: "#818cf8", // indigo-400
  break: "#34d399", // emerald-400
  long_break: "#fbbf24", // amber-400
};

export function Pomodoro() {
  const [config, setConfig] = useState<PomodoroConfig>(DEFAULT_CONFIG);
  const [phase, setPhase] = useState<Phase>("work");
  const [completed, setCompleted] = useState(0);
  const [remaining, setRemaining] = useState(() => phaseDurationSeconds("work", DEFAULT_CONFIG));
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [status, setStatus] = useState("");

  // Only a real user edit may trigger a write. Gating on "the initial read has
  // settled" instead lets a *successful* read echo itself straight back — which
  // bumps `updated_at` and clobbers another device's edit merely by opening the
  // app — and lets an edit made before the read resolves get silently reverted.
  // The dirty flag closes both.
  //
  // What it does NOT close: after a *failed* read the panel is showing defaults,
  // so the first edit persists those defaults alongside it and overwrites the
  // other columns of the row nobody managed to read. Deferring the write to an
  // explicit edit is the honest behaviour available here — the status line says
  // the config could not be read, and what gets saved is exactly what the user
  // is looking at — but it is not the same as protecting the stored row. Doing
  // that properly needs a read-succeeded flag that disables the fields, which is
  // worth adding once the table exists and a failed read stops being the norm.
  const edited = useRef(false);
  const persistTimer = useRef<number | null>(null);

  // --- config: load once, then persist edits ------------------------------
  useEffect(() => {
    let cancelled = false;
    invoke<PomodoroConfig>("tt_pomodoro_get")
      .then((c) => {
        // A read that lands after the user has already touched something is
        // stale by definition — their edit wins.
        if (cancelled || edited.current) return;
        const safe = sanitizeConfig(c);
        setConfig(safe);
        setRemaining(phaseDurationSeconds("work", safe));
      })
      .catch((e) => {
        // Until work unit 1's migration is applied, `pomodoro_config` does not
        // exist and this is a PostgREST error. Defaults are still a usable panel.
        if (!cancelled) setStatus(`config unavailable — using defaults (${String(e)})`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!edited.current) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      invoke("tt_pomodoro_set", { config })
        .then(() => setStatus("saved ✓"))
        .catch((e) => setStatus(`save failed: ${String(e)}`));
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [config]);

  // --- session state ------------------------------------------------------
  // Read-only: this panel never mutates the session, so it needs none of unit
  // 3's in-flight-command guarding. A monotonic id is still required — two polls
  // can overlap and resolve out of order, which would resurrect a stale state.
  useEffect(() => {
    let cancelled = false;
    let latest = 0;
    const read = () => {
      const id = ++latest;
      invoke<{ state: SessionState }>("tt_session_status")
        .then((s) => {
          if (!cancelled && id === latest) setSessionState(s?.state ?? "idle");
        })
        // A rejection means "not running", and must stay quiet rather than fill
        // the panel with the same error every 5s.
        .catch(() => {
          if (!cancelled && id === latest) setSessionState("idle");
        });
    };
    read();
    const poll = window.setInterval(read, STATUS_POLL_MS);
    // WKWebView on iOS does not reliably fire window `focus` on foregrounding,
    // so `visibilitychange` is the one that actually arrives on device.
    const onVisible = () => {
      if (document.visibilityState === "visible") read();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", read);
    return () => {
      cancelled = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", read);
    };
  }, []);

  const running = sessionState === "running" && config.enabled;

  // --- the countdown ------------------------------------------------------
  // Derived from a deadline, never accumulated from ticks. WebView timers stop
  // when the app backgrounds, so a `remaining - 1` per interval quietly loses
  // every suspended minute and drifts away from the session's own elapsed time
  // (which unit 2 derives as `now - start_time` for exactly this reason).
  // Re-reading the clock each tick means a phase boundary crossed while
  // backgrounded lands on the next wake instead of never.
  //
  // Invariant the rest of this component leans on: `deadline.current` is
  // non-null exactly when `running` is true. That is what makes the
  // duration-edit effect below safe to call `setRemaining` unguarded — it only
  // fires while stopped, when there is no deadline to disagree with.
  const deadline = useRef<number | null>(null);

  // ORDERING: this effect must stay declared *before* the transition effect.
  // Resuming with `remaining === 0` runs both bodies in declaration order; this
  // one seeds `deadline = now + 0`, and the transition's reseed has to land
  // after it to win. Swap them and the deadline stays in the past, the next tick
  // reads 0 again, and the whole cycle cascades through in a second.
  useEffect(() => {
    if (!running) {
      deadline.current = null;
      return;
    }
    deadline.current = Date.now() + remaining * 1000;
    const sync = () => setRemaining(remainingFromDeadline(deadline.current, Date.now()));
    const id = window.setInterval(sync, 1000);
    // Foregrounding resyncs immediately rather than waiting out the next tick.
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", sync);
      deadline.current = null;
    };
    // `remaining` seeds the deadline but must not re-arm it every tick.
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hitting zero advances the phase. Split from the tick so the transition is a
  // function of the value reaching 0 rather than of a particular interval firing
  // — a paused timer parked at 0 transitions when it resumes, not before.
  // Must stay declared after the countdown effect; see the ORDERING note above.
  useEffect(() => {
    if (remaining !== 0 || !running) return;
    const done = phase === "work" ? completed + 1 : completed;
    const next = nextPhase(phase, done, config);
    const seconds = phaseDurationSeconds(next, config);
    setCompleted(done);
    setPhase(next);
    // The deadline moves with the phase; leaving it in the past would make the
    // very next tick read 0 again and cascade through the whole cycle at once.
    deadline.current = Date.now() + seconds * 1000;
    setRemaining(seconds);
    notifyTransition(next);
  }, [remaining, running]); // eslint-disable-line react-hooks/exhaustive-deps

  // Editing a duration retimes the current phase, but only when the duration
  // actually changed and only while the clock is stopped. Keying off `running`
  // alone would rewind the countdown to full every time the timer was paused.
  const phaseTotal = useRef(phaseDurationSeconds("work", DEFAULT_CONFIG));
  useEffect(() => {
    const total = phaseDurationSeconds(phase, config);
    if (total === phaseTotal.current) return;
    phaseTotal.current = total;
    if (!running) setRemaining(total);
  }, [config, phase, running]);

  const reset = useCallback(() => {
    const seconds = phaseDurationSeconds("work", config);
    setPhase("work");
    setCompleted(0);
    if (deadline.current !== null) deadline.current = Date.now() + seconds * 1000;
    setRemaining(seconds);
  }, [config]);

  // The only path that marks the config dirty. Anything that writes `config`
  // without going through here would be indistinguishable from the initial load.
  const set = useCallback(
    <K extends keyof PomodoroConfig>(key: K, value: PomodoroConfig[K]) => {
      edited.current = true;
      setConfig((c) => ({ ...c, [key]: value }));
    },
    []
  );

  const total = phaseDurationSeconds(phase, config);
  const cycleSlot = config.sessions_per_cycle > 0 ? (completed % config.sessions_per_cycle) + 1 : 1;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wide text-white/40">Pomodoro</h2>
        <button
          onClick={() => set("enabled", !config.enabled)}
          className={`rounded-lg px-2.5 py-1 text-[11px] font-medium ${
            config.enabled ? "bg-indigo-500/20 text-indigo-300" : "bg-white/[0.06] text-white/40"
          }`}
        >
          {config.enabled ? "On" : "Off"}
        </button>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <Ring total={total} remaining={remaining} phase={phase} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium" style={{ color: PHASE_COLOR[phase] }}>
            {phaseLabel(phase)}
          </div>
          <div className="mt-0.5 font-mono text-2xl font-semibold tabular-nums text-white/90">
            {formatRemaining(remaining)}
          </div>
          <div className="mt-1 text-[10px] text-white/35">
            {config.enabled
              ? running
                ? `session ${cycleSlot} of ${config.sessions_per_cycle} · ${completed} done`
                : sessionState === "paused"
                  ? "timer paused — pomodoro held"
                  : "waiting for a running timer"
              : "disabled"}
          </div>
        </div>
        <button
          onClick={reset}
          className="self-start rounded-lg bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/50"
        >
          Reset
        </button>
      </div>

      {/* No settings page in Nexus Local — the durations live here or nowhere. */}
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Work (min)"
          value={config.work_minutes}
          onCommit={(v) => set("work_minutes", v)}
        />
        <NumberField
          label="Break (min)"
          value={config.break_minutes}
          onCommit={(v) => set("break_minutes", v)}
        />
        <NumberField
          label="Long break (min)"
          value={config.long_break_minutes}
          onCommit={(v) => set("long_break_minutes", v)}
        />
        <NumberField
          label="Sessions / cycle"
          value={config.sessions_per_cycle}
          onCommit={(v) => set("sessions_per_cycle", v)}
        />
      </div>

      {status && <div className="text-[10px] text-white/35">{status}</div>}
    </section>
  );
}

/**
 * Progress ring. The rotation is an SVG attribute on the circle rather than a
 * CSS `transform` on the `<svg>` — `transform-origin` on SVG elements is
 * inconsistent in WKWebView, which is the only engine this app ships against.
 */
function Ring({
  total,
  remaining,
  phase,
  size = 84,
}: {
  total: number;
  remaining: number;
  phase: Phase;
  size?: number;
}) {
  const stroke = 6;
  const radius = (size - stroke * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 1;
  const center = size / 2;

  return (
    <svg width={size} height={size} className="shrink-0" aria-hidden>
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={stroke}
      />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={PHASE_COLOR[phase]}
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
        strokeLinecap="round"
        transform={`rotate(-90 ${center} ${center})`}
        style={{ transition: "stroke-dashoffset 1s linear" }}
      />
    </svg>
  );
}

/**
 * Integer input that keeps its own draft so a field can be cleared mid-edit
 * without a half-typed value reaching the config (and therefore the network).
 * Commits on blur and on Enter.
 */
function NumberField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    // Clamped at both ends. Without the ceiling, an over-large number reaches
    // `tt_pomodoro_set`, fails serde's `u32` before the command body runs, and
    // the panel keeps displaying a value it never managed to store.
    const next =
      Number.isFinite(parsed) && parsed >= MIN_VALUE
        ? Math.min(parsed, MAX_VALUE)
        : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <label className="flex flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-2">
      <span className="text-[9px] uppercase tracking-wide text-white/35">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={MIN_VALUE}
        max={MAX_VALUE}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-full bg-transparent font-mono text-sm text-white/85 outline-none"
      />
    </label>
  );
}

/**
 * TODO(notifications): TimeTracker fired a local notification on every phase
 * transition via `@tauri-apps/plugin-notification`. That plugin is wired into
 * neither `apps/NexusLocal/package.json` nor `src-tauri/Cargo.toml` /
 * `tauri.conf.json`, and adding it touches shared config that a dozen parallel
 * work units depend on. Swap this for `sendNotification({ title: "Pomodoro",
 * body: phaseMessage(next) })` once the plugin lands.
 */
function notifyTransition(next: Phase) {
  console.info(`[pomodoro] ${phaseMessage(next)}`);
}
