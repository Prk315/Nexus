/**
 * Pomodoro phase machine — pure functions only.
 *
 * Ported from `apps/TimeTrackerApp/src/hooks/useTimer.ts`, where the same logic
 * was welded into a `useEffect` over four Redux dispatches and could only be
 * exercised by watching a clock for 25 minutes. Everything here is a plain
 * function of its arguments, so the cycle is verifiable without a running timer.
 *
 * Field names are snake_case because this is the exact wire shape of Rust's
 * `PomodoroConfig` (`src-tauri/src/timetracker/pomodoro.rs`). Tauri camelCases
 * *parameter* names — `invoke("tt_pomodoro_set", { config })` — not the contents
 * of the struct it deserializes.
 */

export type Phase = "work" | "break" | "long_break";

export type PomodoroConfig = {
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
 * hand-edited one — can still hold a zero, and `x % 0` is `NaN`, which never
 * equals 0, so the cycle would silently never reach a long break.
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

/** How long a phase runs, in seconds. */
export function phaseDurationSeconds(phase: Phase, config: PomodoroConfig): number {
  const safe = sanitizeConfig(config);
  switch (phase) {
    case "work":
      return safe.work_minutes * 60;
    case "break":
      return safe.break_minutes * 60;
    case "long_break":
      return safe.long_break_minutes * 60;
  }
}

/**
 * The phase that follows `phase` once its countdown hits zero.
 *
 * `completed` is the **post-increment** count of finished work sessions — the
 * work phase that just ended is already counted. That is what makes the fourth
 * session of a 4-per-cycle config the one that earns the long break, and it is
 * the same convention as TimeTracker's `newCompleted = completedSessions + 1`.
 * Both breaks return to work; only a work phase advances the counter.
 */
export function nextPhase(phase: Phase, completed: number, config: PomodoroConfig): Phase {
  if (phase !== "work") return "work";
  const perCycle = sanitizeConfig(config).sessions_per_cycle;
  return completed % perCycle === 0 ? "long_break" : "break";
}

/**
 * Seconds left until `deadlineMs`, rounded up so a phase reads its full
 * duration for its first second and reaches 0 only once the deadline passes.
 *
 * Deriving from a wall-clock deadline rather than decrementing a counter is
 * what makes the countdown survive the WebView suspending: iOS stops the app's
 * timers when it backgrounds, and a `remaining - 1` per tick silently loses
 * every suspended minute. It also matches how the session itself derives
 * elapsed time (`now - start_time`), so the two cannot drift apart.
 */
export function remainingFromDeadline(deadlineMs: number | null, nowMs: number): number {
  if (deadlineMs === null || !Number.isFinite(deadlineMs)) return 0;
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

/** Notification copy for a transition. TimeTracker fired one on every switch. */
export function phaseMessage(next: Phase): string {
  switch (next) {
    case "long_break":
      return "Long break — well earned!";
    case "break":
      return "Short break time!";
    case "work":
      return "Break over — back to work!";
  }
}

export function phaseLabel(phase: Phase): string {
  return phase === "long_break" ? "Long break" : phase === "break" ? "Break" : "Focus";
}

/** `mm:ss`, with hours folded into minutes — no phase runs past 99 minutes in practice. */
export function formatRemaining(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
