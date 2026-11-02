/**
 * The floating focus timer — what renders in the `float` window (see
 * `src-tauri/src/float.rs`). A 148px circle: the ring and the countdown, with
 * the controls fading in on hover so it stays out of the way otherwise.
 *
 * Three states, one per question it answers at a glance:
 *
 * - **Pomodoro running** — phase, time left, cycle dots.
 * - **Timer without a pomodoro** — the count-up clock, and 🍅 to attach one.
 * - **Idle** — one button that starts a focus block on the most recent task.
 *   That is the one-click start: the window is already on screen.
 *
 * Dragging is `startDragging()` from a mousedown anywhere but a button, which
 * needs `core:window:allow-start-dragging` in the capability.
 */

import { useEffect, type MouseEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  PHASE_COLOR,
  elapsedOf,
  formatElapsed,
  formatRemaining,
  phaseLabel,
  remainingOf,
  type Phase,
} from "./pomodoro";
import { CycleDots, PomodoroRing } from "./PomodoroRing";
import { usePomodoro, useRecentTasks } from "./usePomodoro";

const SIZE = 148;

export function FloatingTimer() {
  const { status, error, busy, now, act } = usePomodoro();
  const recents = useRecentTasks(status?.session.state, 1);

  // The page background is opaque app-wide (`index.css`); this window is a
  // transparent circle, so the corners outside it must show the desktop.
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    document.body.style.overflow = "hidden";
  }, []);

  const drag = (e: MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    getCurrentWindow().startDragging().catch(() => {});
  };

  const run = status?.run ?? null;
  const session = status?.session;
  const per = status?.config.sessions_per_cycle ?? 4;
  const next = recents[0];

  let body: ReactNode;
  let controls: ReactNode;
  let ring: { total: number; remaining: number; phase: Phase } = {
    total: 1,
    remaining: 1,
    phase: "work",
  };

  if (run) {
    const held = run.held_seconds !== null;
    ring = { total: run.total_seconds, remaining: remainingOf(run, now), phase: run.phase };
    body = (
      <>
        <span className="text-[10px] font-medium" style={{ color: PHASE_COLOR[run.phase] }}>
          {phaseLabel(run.phase)}
          {held && " · paused"}
        </span>
        <span
          className={`font-mono text-[26px] font-semibold leading-tight tabular-nums ${
            held ? "text-white/45" : "text-white/90"
          }`}
        >
          {formatRemaining(ring.remaining)}
        </span>
        <CycleDots done={run.done_in_cycle} total={per} phase={run.phase} />
        <TaskLine text={session?.task_name} />
      </>
    );
    controls = (
      <>
        <Icon
          label={held ? "Resume" : "Pause"}
          disabled={busy}
          onClick={() => act(held ? "tt_pomodoro_resume" : "tt_pomodoro_pause")}
        >
          {held ? "▶" : "❚❚"}
        </Icon>
        <Icon label={run.phase === "work" ? "Skip to break" : "Skip break"} disabled={busy} onClick={() => act("tt_pomodoro_skip")}>
          ⏭
        </Icon>
        <Icon label="End and log" disabled={busy} onClick={() => act("tt_pomodoro_end")}>
          ■
        </Icon>
      </>
    );
  } else if (session && session.state !== "idle") {
    body = (
      <>
        <span className="text-[10px] text-white/40">
          {session.state === "running" ? "Timer" : "Timer · paused"}
        </span>
        <span className="font-mono text-[22px] font-semibold leading-tight tabular-nums text-white/80">
          {formatElapsed(elapsedOf(session, now))}
        </span>
        <TaskLine text={session.task_name} />
      </>
    );
    controls = (
      <Icon label="Start a pomodoro on this timer" disabled={busy} onClick={() => act("tt_pomodoro_start")}>
        🍅
      </Icon>
    );
  } else {
    body = next ? (
      <button
        disabled={busy}
        onClick={() =>
          act("tt_pomodoro_start", { taskName: next.task_name, project: next.project })
        }
        title={`Start a focus block on “${next.task_name}”`}
        className="flex flex-col items-center gap-0.5 rounded-full px-3 py-2 hover:bg-white/[0.06]"
      >
        <span className="text-2xl leading-none text-indigo-300">▶</span>
        <span className="text-[10px] font-medium text-white/70">Focus</span>
        <TaskLine text={next.task_name} />
      </button>
    ) : (
      <button
        onClick={() => invoke("tt_main_show").catch(() => {})}
        className="flex flex-col items-center gap-1 rounded-full px-3 py-2 text-[10px] text-white/50 hover:bg-white/[0.06]"
      >
        <span className="text-xl leading-none">＋</span>
        Start a timer
      </button>
    );
    controls = null;
  }

  return (
    <div
      onMouseDown={drag}
      className="group relative select-none overflow-hidden rounded-full border border-white/10"
      style={{
        width: SIZE,
        height: SIZE,
        background: "rgba(10,10,15,0.92)",
        // Belt and braces with `rounded-full`: nothing may paint outside the
        // circle, or the transparent window shows square corners.
        clipPath: "circle(50%)",
      }}
    >
      <PomodoroRing
        total={ring.total}
        remaining={ring.remaining}
        phase={ring.phase}
        size={SIZE}
        stroke={run ? 5 : 0}
      >
        <div className="flex max-w-[110px] flex-col items-center">{body}</div>
      </PomodoroRing>

      {/* Hover chrome. Top: open the app / hide. Bottom: the run's controls. */}
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
        <div className="absolute left-1/2 top-3 flex -translate-x-1/2 gap-1">
          <Icon label="Open Nexus Local" small onClick={() => invoke("tt_main_show").catch(() => {})}>
            ⤢
          </Icon>
          <Icon label="Hide" small onClick={() => invoke("tt_float_set", { visible: false }).catch(() => {})}>
            ✕
          </Icon>
        </div>
        {controls && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1">{controls}</div>
        )}
      </div>

      {error && (
        <span
          title={error}
          className="absolute right-6 top-6 h-2 w-2 rounded-full bg-red-400"
          aria-label={error}
        />
      )}
    </div>
  );
}

function TaskLine({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return <span className="mt-0.5 max-w-[100px] truncate text-[9px] text-white/40">{text}</span>;
}

function Icon({
  label,
  onClick,
  disabled = false,
  small = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`flex items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white disabled:opacity-40 ${
        small ? "h-5 w-5 text-[9px]" : "h-7 w-7 text-[11px]"
      }`}
    >
      {children}
    </button>
  );
}
