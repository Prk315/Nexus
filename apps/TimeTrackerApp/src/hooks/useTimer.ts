import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { sendNotification } from "@tauri-apps/plugin-notification";
import type { AppDispatch, RootState } from "../store";
import {
  fetchStatus,
  tick,
  setPomodoroPhase,
  setPomodoroSecondsRemaining,
  incrementPomodoroSessions,
} from "../store/slices/timerSlice";

export function useTimer() {
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((s: RootState) => s.timer.status);
  const pomodoroEnabled = useSelector((s: RootState) => s.timer.pomodoroEnabled);
  const pomodoroPhase = useSelector((s: RootState) => s.timer.pomodoroPhase);
  const pomodoroSecondsRemaining = useSelector((s: RootState) => s.timer.pomodoroSecondsRemaining);
  const completedSessions = useSelector((s: RootState) => s.timer.pomodoroCompletedSessions);
  const pomodoro = useSelector((s: RootState) => s.settings.pomodoro);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track last value to detect the zero crossing (not re-fire every render)
  const prevRemainingRef = useRef<number>(pomodoroSecondsRemaining);

  // Sync truth from Rust on mount and window focus
  useEffect(() => {
    dispatch(fetchStatus());
    const onFocus = () => dispatch(fetchStatus());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [dispatch]);

  // Local tick for smooth display
  useEffect(() => {
    if (status === "running") {
      intervalRef.current = setInterval(() => dispatch(tick()), 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [status, dispatch]);

  // Pomodoro phase transition when countdown hits zero
  useEffect(() => {
    const prev = prevRemainingRef.current;
    prevRemainingRef.current = pomodoroSecondsRemaining;

    if (!pomodoroEnabled || status !== "running") return;
    // Only trigger when we cross from >0 to 0
    if (pomodoroSecondsRemaining !== 0 || prev === 0) return;

    if (pomodoroPhase === "work") {
      const newCompleted = completedSessions + 1;
      dispatch(incrementPomodoroSessions());
      const nextPhase =
        newCompleted % pomodoro.sessionsPerCycle === 0 ? "long_break" : "break";
      const nextSeconds =
        nextPhase === "long_break"
          ? pomodoro.longBreakMinutes * 60
          : pomodoro.breakMinutes * 60;
      dispatch(setPomodoroPhase(nextPhase));
      dispatch(setPomodoroSecondsRemaining(nextSeconds));
      sendNotification({
        title: "Pomodoro",
        body: nextPhase === "long_break" ? "Long break — well earned!" : "Short break time!",
      });
    } else {
      dispatch(setPomodoroPhase("work"));
      dispatch(setPomodoroSecondsRemaining(pomodoro.workMinutes * 60));
      sendNotification({ title: "Pomodoro", body: "Break over — back to work!" });
    }
  }, [pomodoroSecondsRemaining]);
}
