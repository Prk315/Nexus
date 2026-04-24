import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import * as api from "../../lib/tauriApi";
import type { ActiveSession, PausedSession, TimeEntry, TimerStatus } from "../types";

export type TimerStatus2 = "idle" | "running" | "paused";
export type PomodoroPhase = "work" | "break" | "long_break";

export interface RemoteSession {
  device_id: string;
  task_name: string;
  project: string | null;
  tags: string | null;
  notes: string | null;
  billable: boolean;
  hourly_rate: number;
  start_time: string;
  paused_at: string | null;
  elapsed_seconds: number;
  user_id: string;
}

interface TimerState {
  status: TimerStatus2;
  active: ActiveSession | null;
  paused: PausedSession | null;
  elapsedSeconds: number;
  loading: boolean;
  error: string | null;
  pomodoroEnabled: boolean;
  pomodoroPhase: PomodoroPhase;
  pomodoroSecondsRemaining: number;
  pomodoroCompletedSessions: number;
  remoteConflict: RemoteSession | null;
}

const initialState: TimerState = {
  status: "idle",
  active: null,
  paused: null,
  elapsedSeconds: 0,
  loading: false,
  error: null,
  pomodoroEnabled: false,
  pomodoroPhase: "work",
  pomodoroSecondsRemaining: 25 * 60,
  pomodoroCompletedSessions: 0,
  remoteConflict: null,
};

// ── Thunks ────────────────────────────────────────────────────────────────────

export const fetchStatus = createAsyncThunk("timer/fetchStatus", async () => {
  return await api.getStatus();
});

export const startTimer = createAsyncThunk(
  "timer/start",
  async (params: Parameters<typeof api.startTimer>[0]) => {
    await api.startTimer(params);
    return await api.getStatus();
  }
);

export const stopTimer = createAsyncThunk("timer/stop", async (): Promise<TimeEntry> => {
  return await api.stopTimer();
});

export const pauseTimer = createAsyncThunk("timer/pause", async () => {
  await api.pauseTimer();
  return await api.getStatus();
});

export const resumeTimer = createAsyncThunk("timer/resume", async () => {
  await api.resumeTimer();
  return await api.getStatus();
});

export const cancelPaused = createAsyncThunk("timer/cancel", async () => {
  await api.cancelPaused();
  return await api.getStatus();
});

export const resumeFromEntry = createAsyncThunk(
  "timer/resumeFromEntry",
  async (params: { entryId: number; userId?: string }) => {
    await api.resumeFromEntry(params.entryId, params.userId);
    return await api.getStatus();
  }
);

// ── Slice ─────────────────────────────────────────────────────────────────────

const applyStatus = (state: TimerState, s: TimerStatus) => {
  if (s.active) {
    state.status = "running";
    state.active = s.active;
    state.paused = null;
    state.elapsedSeconds = s.active.elapsed_seconds;
  } else if (s.paused) {
    state.status = "paused";
    state.active = null;
    state.paused = s.paused;
    state.elapsedSeconds = s.paused.elapsed_seconds;
  } else {
    state.status = "idle";
    state.active = null;
    state.paused = null;
    state.elapsedSeconds = 0;
  }
  state.loading = false;
  state.error = null;
};

const timerSlice = createSlice({
  name: "timer",
  initialState,
  reducers: {
    tick(state) {
      if (state.status === "running") {
        state.elapsedSeconds += 1;
        if (state.pomodoroEnabled && state.pomodoroSecondsRemaining > 0) {
          state.pomodoroSecondsRemaining -= 1;
        }
      }
    },
    setPomodoroEnabled(state, action: PayloadAction<boolean>) {
      state.pomodoroEnabled = action.payload;
    },
    setPomodoroPhase(state, action: PayloadAction<PomodoroPhase>) {
      state.pomodoroPhase = action.payload;
    },
    setPomodoroSecondsRemaining(state, action: PayloadAction<number>) {
      state.pomodoroSecondsRemaining = action.payload;
    },
    incrementPomodoroSessions(state) {
      state.pomodoroCompletedSessions += 1;
    },
    setRemoteConflict(state, action: PayloadAction<RemoteSession>) {
      state.remoteConflict = action.payload;
    },
    clearRemoteConflict(state) {
      state.remoteConflict = null;
    },
  },
  extraReducers: (builder) => {
    const pending = (state: TimerState) => {
      state.loading = true;
      state.error = null;
    };
    const rejected = (state: TimerState, action: { error: { message?: string } }) => {
      state.loading = false;
      state.error = action.error.message ?? "Unknown error";
    };

    builder
      .addCase(fetchStatus.pending, pending)
      .addCase(fetchStatus.fulfilled, (state, action) => applyStatus(state, action.payload))
      .addCase(fetchStatus.rejected, rejected)

      .addCase(startTimer.pending, pending)
      .addCase(startTimer.fulfilled, (state, action) => {
        applyStatus(state, action.payload);
        state.remoteConflict = null; // clear any conflict when we start fresh
      })
      .addCase(startTimer.rejected, rejected)

      .addCase(stopTimer.pending, pending)
      .addCase(stopTimer.fulfilled, (state) => {
        state.status = "idle";
        state.active = null;
        state.paused = null;
        state.elapsedSeconds = 0;
        state.loading = false;
        state.remoteConflict = null;
      })
      .addCase(stopTimer.rejected, rejected)

      .addCase(pauseTimer.pending, pending)
      .addCase(pauseTimer.fulfilled, (state, action) => applyStatus(state, action.payload))
      .addCase(pauseTimer.rejected, rejected)

      .addCase(resumeTimer.pending, pending)
      .addCase(resumeTimer.fulfilled, (state, action) => applyStatus(state, action.payload))
      .addCase(resumeTimer.rejected, rejected)

      .addCase(cancelPaused.pending, pending)
      .addCase(cancelPaused.fulfilled, (state, action) => {
        applyStatus(state, action.payload);
        state.remoteConflict = null;
      })
      .addCase(cancelPaused.rejected, rejected)

      .addCase(resumeFromEntry.pending, pending)
      .addCase(resumeFromEntry.fulfilled, (state, action) => applyStatus(state, action.payload))
      .addCase(resumeFromEntry.rejected, rejected);
  },
});

export const {
  tick,
  setPomodoroEnabled,
  setPomodoroPhase,
  setPomodoroSecondsRemaining,
  incrementPomodoroSessions,
  setRemoteConflict,
  clearRemoteConflict,
} = timerSlice.actions;
export default timerSlice.reducer;
