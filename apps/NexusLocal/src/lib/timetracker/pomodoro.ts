/**
 * Pomodoro wire types and display helpers — pure functions only.
 *
 * The phase machine itself is Rust now (`src-tauri/src/timetracker/pomodoro.rs`).
 * It used to live here, ported from TimeTracker's `useTimer.ts`, and that is
 * exactly why a reload restarted the cycle and breaks were billed as work: the
 * WebView forgot the phase, and nothing paused the session at a boundary. What
 * is left here is the shape of what Rust reports and how to draw it.
 *
 * Field names are snake_case because this is the exact wire shape of Rust's
 * structs. Tauri camelCases *parameter* names — `invoke("tt_pomodoro_set",
 * { config })` — not the contents of the struct it deserializes.
 */

export type Phase = "work" | "break" | "long_break";

export type PomodoroConfig = {
  /** Unused since the run moved to Rust; kept so a save round-trips the column. */
  enabled: boolean;
  work_minutes: number;
  break_minutes: number;
  long_break_minutes: number;
  sessions_per_cycle: number;
};

export const DEFAULT_CONFIG: PomodoroConfig = {
  enabled: false,
  work_minutes: 25,
  break_minutes: 5,
  long_break_minutes: 15,
  sessions_per_cycle: 4,
};

/** Smallest legal value for every numeric field; also the input `min`. */
export const MIN_VALUE = 1;

/**
 * Largest legal value: `u32::MAX`, matching the Rust field type.
 *
 * Not a taste judgement about how long a pomodoro should be — it is where the
 * IPC boundary is. Anything above it fails serde's `u32` deserialization before
 * `tt_pomodoro_set` runs, so the user would get a raw
 * `invalid value: integer …, expected u32` as a save error while the panel went
 * on displaying the value it could not store.
 */
export const MAX_VALUE = 4294967295;

/**
 * Clamp a config read from anywhere that isn't `tt_pomodoro_set`.
 *
 * Rust validates the write path, but a row predating that validation — or a
 * hand-edited one — can still hold a zero, and `x % 0` is `NaN`.
 */
export function sanitizeConfig(config: PomodoroConfig): PomodoroConfig {
  const atLeast = (n: number, fallback: number) =>
    Number.isFinite(n) && n >= MIN_VALUE && n <= MAX_VALUE ? Math.floor(n) : fallback;
  return {
    enabled: !!config.enabled,
    work_minutes: atLeast(config.work_minutes, DEFAULT_CONFIG.work_minutes),
    break_minutes: atLeast(config.break_minutes, DEFAULT_CONFIG.break_minutes),
    long_break_minutes: atLeast(config.long_break_minutes, DEFAULT_CONFIG.long_break_minutes),
    sessions_per_cycle: atLeast(config.sessions_per_cycle, DEFAULT_CONFIG.sessions_per_cycle),
  };
}

/** Mirror of `SessionStatus` in `session.rs`. */
export type SessionStatus = {
  state: "idle" | "running" | "paused";
  task_name: string | null;
  project: string | null;
  /** RFC3339 UTC, back-dated on resume so `now - start_time` is the elapsed. */
  start_time: string | null;
  elapsed_seconds: number;
};

/** Mirror of `RunView` in `pomodoro.rs`. Exactly one of the two clocks is set. */
export type RunView = {
  phase: Phase;
  completed: number;
  done_in_cycle: number;
  ends_at: string | null;
  held_seconds: number | null;
  total_seconds: number;
};

/** Mirror of `PomodoroStatus` — the payload of every `pomodoro:status` event. */
export type PomodoroStatus = {
  config: PomodoroConfig;
  run: RunView | null;
  session: SessionStatus;
};

/** Mirror of `RecentTask` in `session.rs`. */
export type RecentTask = { task_name: string; project: string | null };

export const STATUS_EVENT = "pomodoro:status";

/**
 * Seconds left in the current phase, rounded up so a phase reads its full
 * length for its first second and 0 only once the deadline has passed.
 *
 * Derived from the deadline Rust wrote rather than counted down locally, so
 * every window and device shows the same second and a suspended WebView
 * catches up on its first tick instead of drifting.
 */
export function remainingOf(run: RunView, nowMs: number): number {
  if (run.held_seconds !== null) return Math.max(0, run.held_seconds);
  const ends = run.ends_at ? Date.parse(run.ends_at) : NaN;
  if (!Number.isFinite(ends)) return 0;
  return Math.max(0, Math.ceil((ends - nowMs) / 1000));
}

/** Elapsed seconds of a session, derived the same way Rust derives it. */
export function elapsedOf(session: SessionStatus, nowMs: number): number {
  if (session.state !== "running") return session.elapsed_seconds;
  const start = session.start_time ? Date.parse(session.start_time) : NaN;
  if (!Number.isFinite(start)) return session.elapsed_seconds;
  return Math.max(0, Math.floor((nowMs - start) / 1000));
}

export function phaseLabel(phase: Phase): string {
  return phase === "long_break" ? "Long break" : phase === "break" ? "Break" : "Focus";
}

export const PHASE_COLOR: Record<Phase, string> = {
  work: "#818cf8", // indigo-400
  break: "#34d399", // emerald-400
  long_break: "#fbbf24", // amber-400
};

/** `mm:ss`, with hours folded into minutes — no phase runs past 99 minutes in practice. */
export function formatRemaining(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** `h:mm:ss` for the count-up timer. */
export function formatElapsed(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
