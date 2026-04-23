import { useState } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks/useAppDispatch";
import {
  cancelPaused,
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
} from "../../store/slices/timerSlice";
import DurationDisplay from "../shared/DurationDisplay";
import PomodoroRing from "./PomodoroRing";
import ProjectPicker from "./ProjectPicker";

export default function TimerPanel() {
  const dispatch = useAppDispatch();
  const { status, elapsedSeconds, active, paused, pomodoroEnabled, pomodoroPhase, pomodoroSecondsRemaining } =
    useAppSelector((s) => s.timer);
  const settings = useAppSelector((s) => s.settings);

  const [taskName, setTaskName] = useState("");
  const [project, setProject] = useState<string | undefined>();
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [billable, setBillable] = useState(false);

  const handleStart = () => {
    if (!taskName.trim()) return;
    dispatch(
      startTimer({
        taskName: taskName.trim(),
        project,
        tags: tags || undefined,
        notes: notes || undefined,
        billable,
        hourlyRate: settings.config?.default_hourly_rate ?? 0,
      })
    );
  };

  const handleStop = () => {
    dispatch(stopTimer());
    setTaskName("");
    setProject(undefined);
    setTags("");
    setNotes("");
  };

  const pomodoroTotal =
    pomodoroPhase === "work"
      ? settings.pomodoro.workMinutes * 60
      : pomodoroPhase === "break"
      ? settings.pomodoro.breakMinutes * 60
      : settings.pomodoro.longBreakMinutes * 60;

  const displayName =
    status !== "idle"
      ? (active?.task_name ?? paused?.task_name ?? "")
      : "";
  const displayProject =
    status !== "idle"
      ? (active?.project ?? paused?.project ?? undefined)
      : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, padding: "32px 24px" }}>
      {/* Ring + Clock */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {pomodoroEnabled && status === "running" && (
          <div style={{ position: "absolute" }}>
            <PomodoroRing
              totalSeconds={pomodoroTotal}
              remainingSeconds={pomodoroSecondsRemaining}
              phase={pomodoroPhase}
              size={180}
            />
          </div>
        )}
        <div style={{ textAlign: "center" }}>
          <DurationDisplay seconds={elapsedSeconds} large />
          {displayName && (
            <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}>
              {displayName}
              {displayProject && (
                <span style={{ color: "var(--text-muted)" }}> · {displayProject}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Input fields — only shown when idle */}
      {status === "idle" && (
        <div style={{ width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            placeholder="What are you working on?"
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleStart()}
            autoFocus
          />
          <ProjectPicker value={project} onChange={setProject} />
          <input
            placeholder="Tags (comma-separated)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          <input
            placeholder="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-secondary)", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={billable}
              onChange={(e) => setBillable(e.target.checked)}
              style={{ width: "auto" }}
            />
            Billable
          </label>
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: 10 }}>
        {status === "idle" && (
          <button
            onClick={handleStart}
            disabled={!taskName.trim()}
            style={{ background: "var(--accent)", color: "var(--accent-fg)", padding: "10px 28px", borderRadius: "var(--radius)", fontWeight: 500 }}
          >
            Start
          </button>
        )}
        {status === "running" && (
          <>
            <button
              onClick={() => dispatch(pauseTimer())}
              style={{ background: "var(--surface-raised)", color: "var(--text)", padding: "10px 20px", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}
            >
              Pause
            </button>
            <button
              onClick={handleStop}
              style={{ background: "var(--danger)", color: "#fff", padding: "10px 20px", borderRadius: "var(--radius)" }}
            >
              Stop
            </button>
          </>
        )}
        {status === "paused" && (
          <>
            <button
              onClick={() => dispatch(resumeTimer())}
              style={{ background: "var(--accent)", color: "var(--accent-fg)", padding: "10px 20px", borderRadius: "var(--radius)" }}
            >
              Resume
            </button>
            <button
              onClick={handleStop}
              style={{ background: "var(--surface-raised)", color: "var(--text)", padding: "10px 20px", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}
            >
              Stop
            </button>
            <button
              onClick={() => dispatch(cancelPaused())}
              style={{ background: "transparent", color: "var(--text-muted)", padding: "10px 14px", borderRadius: "var(--radius)" }}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
