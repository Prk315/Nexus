/**
 * Pomodoro panel — the ring, the run's controls, and the durations.
 *
 * The run itself lives in Rust (`timetracker/pomodoro.rs`): it pauses the
 * timer at each break and resumes it after, survives reloads and closed
 * windows, and is the same run on every device. This panel only draws it and
 * forwards button presses; `usePomodoro` keeps it fresh.
 *
 * Starting one is the timer panel's job — "Focus" there starts the timer and
 * the pomodoro together. From here you can attach a pomodoro to a timer that
 * is already running.
 *
 * Config is persisted separately (`tt_pomodoro_get` / `tt_pomodoro_set`).
 * Nexus Local has no settings page, so the durations live here or nowhere.
 *
 * Filename note: this is `PomodoroPanel.tsx` rather than `Pomodoro.tsx` because
 * the pure module beside it is `pomodoro.ts`, and on a case-insensitive
 * filesystem TypeScript resolves both spellings to one file (TS1261).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_CONFIG,
  MAX_VALUE,
  MIN_VALUE,
  PHASE_COLOR,
  formatRemaining,
  phaseLabel,
  remainingOf,
  sanitizeConfig,
  type PomodoroConfig,
} from "./pomodoro";
import { CycleDots, PomodoroRing } from "./PomodoroRing";
import { IS_IOS, usePomodoro } from "./usePomodoro";

const PERSIST_DEBOUNCE_MS = 600;

export function Pomodoro() {
  const { status, error, busy, now, act } = usePomodoro();
  const [config, setConfig] = useState<PomodoroConfig>(DEFAULT_CONFIG);
  const [configStatus, setConfigStatus] = useState("");

  // Only a real user edit may trigger a write. Gating on "the initial read has
  // settled" instead lets a *successful* read echo itself straight back — which
  // bumps `updated_at` and clobbers another device's edit merely by opening the
  // app — and lets an edit made before the read resolves get silently reverted.
  const edited = useRef(false);
  const persistTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<PomodoroConfig>("tt_pomodoro_get")
      .then((c) => {
        // A read that lands after the user has already touched something is
        // stale by definition — their edit wins.
        if (cancelled || edited.current) return;
        setConfig(sanitizeConfig(c));
      })
      .catch((e) => {
        if (!cancelled) setConfigStatus(`config unavailable — using defaults (${String(e)})`);
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
        .then(() => setConfigStatus("saved ✓ — applies from the next phase"))
        .catch((e) => setConfigStatus(`save failed: ${String(e)}`));
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [config]);

  // The only path that marks the config dirty.
  const set = useCallback(
    <K extends keyof PomodoroConfig>(key: K, value: PomodoroConfig[K]) => {
      edited.current = true;
      setConfig((c) => ({ ...c, [key]: value }));
    },
    []
  );

  const run = status?.run ?? null;
  const session = status?.session;
  const phase = run?.phase ?? "work";
  const total = run?.total_seconds ?? config.work_minutes * 60;
  const remaining = run ? remainingOf(run, now) : total;
  const held = run !== null && run.held_seconds !== null;
  const per = config.sessions_per_cycle;

  let caption: string;
  if (run) {
    // Held covers both a hand pause and a break that ended while nobody was
    // watching — the data can't tell them apart, and the action is the same.
    caption = held
      ? "paused — press Resume to carry on"
      : run.phase === "work"
        ? `block ${(run.completed % per) + 1} of ${per}`
        : "tracking paused for the break";
  } else if (session && session.state !== "idle") {
    caption = "timer running without a pomodoro";
  } else {
    caption = "start one with Focus in the timer";
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wide text-white/40">Pomodoro</h2>
        {!IS_IOS && (
          <button
            onClick={() => invoke("tt_float_set", { visible: true }).catch(() => {})}
            title="Show the floating timer"
            className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/50 hover:text-white/80"
          >
            ◉ Float
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <PomodoroRing total={total} remaining={remaining} phase={phase} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium" style={{ color: PHASE_COLOR[phase] }}>
              {run ? phaseLabel(phase) : "Ready"}
            </span>
            {run && <CycleDots done={run.done_in_cycle} total={per} phase={phase} />}
          </div>
          <div
            className={`mt-0.5 font-mono text-2xl font-semibold tabular-nums ${
              run && !held ? "text-white/90" : "text-white/45"
            }`}
          >
            {formatRemaining(remaining)}
          </div>
          <div className="mt-1 truncate text-[10px] text-white/35">{caption}</div>
        </div>
      </div>

      <div className="flex gap-2">
        {run ? (
          <>
            <ActionButton
              disabled={busy}
              tone={held ? "emerald" : "amber"}
              onClick={() => act(held ? "tt_pomodoro_resume" : "tt_pomodoro_pause")}
            >
              {held ? "Resume" : "Pause"}
            </ActionButton>
            <ActionButton disabled={busy} tone="neutral" onClick={() => act("tt_pomodoro_skip")}>
              {phase === "work" ? "Skip to break" : "Skip break"}
            </ActionButton>
            <ActionButton disabled={busy} tone="red" onClick={() => act("tt_pomodoro_end")}>
              End
            </ActionButton>
          </>
        ) : (
          session &&
          session.state !== "idle" && (
            <ActionButton disabled={busy} tone="indigo" onClick={() => act("tt_pomodoro_start")}>
              🍅 Start a pomodoro on “{session.task_name || "this timer"}”
            </ActionButton>
          )
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 p-2 text-[10px] text-red-300 break-words">
          {error}
        </div>
      )}

      <details className="group">
        <summary className="cursor-pointer select-none text-[10px] uppercase tracking-wide text-white/30 hover:text-white/50">
          Durations · {config.work_minutes}/{config.break_minutes}/{config.long_break_minutes} ×{" "}
          {config.sessions_per_cycle}
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <NumberField
            label="Focus (min)"
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
            label="Blocks / cycle"
            value={config.sessions_per_cycle}
            onCommit={(v) => set("sessions_per_cycle", v)}
          />
        </div>
        {configStatus && <div className="mt-1 text-[10px] text-white/35">{configStatus}</div>}
      </details>
    </section>
  );
}

const TONES = {
  indigo: "bg-indigo-500/20 text-indigo-300",
  emerald: "bg-emerald-500/20 text-emerald-300",
  amber: "bg-amber-500/20 text-amber-300",
  red: "bg-red-500/20 text-red-300",
  neutral: "bg-white/[0.06] text-white/60",
} as const;

function ActionButton({
  tone,
  disabled,
  onClick,
  children,
}: {
  tone: keyof typeof TONES;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 truncate rounded-lg px-3 py-2 text-xs font-medium ${
        disabled ? "bg-white/10 text-white/30" : TONES[tone]
      }`}
    >
      {children}
    </button>
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
      Number.isFinite(parsed) && parsed >= MIN_VALUE ? Math.min(parsed, MAX_VALUE) : value;
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
