import { useAppDispatch, useAppSelector } from "../hooks/useAppDispatch";
import { useTimer } from "../hooks/useTimer";
import { pauseTimer, resumeTimer, stopTimer } from "../store/slices/timerSlice";
import DurationDisplay from "../components/shared/DurationDisplay";
import PomodoroRing from "../components/timer/PomodoroRing";
import { getCurrentWindow } from "@tauri-apps/api/window";

const SIZE = 140;

export default function FloatingWidget() {
  useTimer();
  const dispatch = useAppDispatch();
  const { status, elapsedSeconds, active, pomodoroEnabled, pomodoroPhase, pomodoroSecondsRemaining } =
    useAppSelector((s) => s.timer);
  const settings = useAppSelector((s) => s.settings);

  const pomodoroTotal =
    pomodoroPhase === "work"
      ? settings.pomodoro.workMinutes * 60
      : pomodoroPhase === "break"
      ? settings.pomodoro.breakMinutes * 60
      : settings.pomodoro.longBreakMinutes * 60;

  const startDrag = () => getCurrentWindow().startDragging().catch(() => {});

  return (
    <div
      onMouseDown={startDrag}
      style={{
        width: SIZE,
        height: SIZE,
        /* 50% gives a perfect circle regardless of pixel rounding */
        borderRadius: "50%",
        /* clip-path as a belt-and-suspenders guarantee nothing bleeds out */
        clipPath: "circle(50%)",
        background: "var(--surface)",
        border: "1.5px solid var(--border)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        cursor: "grab",
        userSelect: "none",
        position: "relative",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* Pomodoro progress ring */}
      {pomodoroEnabled && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <PomodoroRing
            totalSeconds={pomodoroTotal}
            remainingSeconds={pomodoroSecondsRemaining}
            phase={pomodoroPhase}
            size={SIZE}
          />
        </div>
      )}

      {/* Clock */}
      <DurationDisplay seconds={elapsedSeconds} />

      {/* Task name */}
      {active?.task_name && (
        <div style={{
          fontSize: 10,
          color: "var(--text-muted)",
          maxWidth: 100,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "center",
        }}>
          {active.task_name}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: 5, marginTop: 2 }}>
        {status === "running" && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); dispatch(pauseTimer()); }}
              style={ctrlBtn}
            >⏸</button>
            <button
              onClick={(e) => { e.stopPropagation(); dispatch(stopTimer()); }}
              style={{ ...ctrlBtn, background: "var(--danger)", color: "#fff", borderColor: "transparent" }}
            >■</button>
          </>
        )}
        {status === "paused" && (
          <button
            onClick={(e) => { e.stopPropagation(); dispatch(resumeTimer()); }}
            style={{ ...ctrlBtn, background: "var(--accent)", color: "var(--accent-fg)", borderColor: "transparent" }}
          >▶</button>
        )}
        {status === "idle" && (
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>idle</span>
        )}
      </div>
    </div>
  );
}

const ctrlBtn: React.CSSProperties = {
  background: "var(--surface-raised)",
  color: "var(--text-secondary)",
  padding: "3px 7px",
  fontSize: 10,
  border: "1px solid var(--border)",
  borderRadius: 10,
};
