import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type {
  CreateRunningPlan,
  CreateRunningSession,
  RunningPlan,
  RunningSession,
} from "../types";

interface RunningState {
  plans: RunningPlan[];
  sessions: RunningSession[];
  loading: boolean;
  error: string | null;
}

const initialState: RunningState = {
  plans: [],
  sessions: [],
  loading: false,
  error: null,
};

export const fetchRunningPlans = createAsyncThunk("running/fetchPlans", async () => {
  const { getRunningPlans } = await import("../../lib/tauriApi");
  return getRunningPlans();
});

export const addRunningPlan = createAsyncThunk(
  "running/addPlan",
  async (plan: CreateRunningPlan) => {
    const { createRunningPlan } = await import("../../lib/tauriApi");
    return createRunningPlan(plan);
  },
);

export const removeRunningPlan = createAsyncThunk(
  "running/removePlan",
  async (id: string) => {
    const { deleteRunningPlan } = await import("../../lib/tauriApi");
    await deleteRunningPlan(id);
    return id;
  },
);

export const fetchRunningSessions = createAsyncThunk(
  "running/fetchSessions",
  async (planId?: string) => {
    const { getRunningSessions } = await import("../../lib/tauriApi");
    return getRunningSessions(planId);
  },
);

export const addRunningSession = createAsyncThunk(
  "running/addSession",
  async (session: CreateRunningSession) => {
    const { createRunningSession } = await import("../../lib/tauriApi");
    return createRunningSession(session);
  },
);

export const completeRunningSession = createAsyncThunk(
  "running/completeSession",
  async ({
    id,
    actualKm,
    avgPaceSPerKm,
    heartRateAvg,
  }: {
    id: string;
    actualKm?: number;
    avgPaceSPerKm?: number;
    heartRateAvg?: number;
  }) => {
    const { completeRunningSessionApi } = await import("../../lib/tauriApi");
    await completeRunningSessionApi(id, actualKm, avgPaceSPerKm, heartRateAvg);
    return { id, actualKm, avgPaceSPerKm, heartRateAvg };
  },
);

export const removeRunningSession = createAsyncThunk(
  "running/removeSession",
  async (id: string) => {
    const { deleteRunningSession } = await import("../../lib/tauriApi");
    await deleteRunningSession(id);
    return id;
  },
);

const runningSlice = createSlice({
  name: "running",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchRunningPlans.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchRunningPlans.fulfilled, (state, action) => {
        state.plans = action.payload;
        state.loading = false;
      })
      .addCase(fetchRunningPlans.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to load running plans";
      })
      .addCase(addRunningPlan.fulfilled, (state, action) => {
        state.plans.unshift(action.payload);
      })
      .addCase(removeRunningPlan.fulfilled, (state, action) => {
        state.plans = state.plans.filter((p) => p.id !== action.payload);
      })
      .addCase(fetchRunningSessions.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchRunningSessions.fulfilled, (state, action) => {
        state.sessions = action.payload;
        state.loading = false;
      })
      .addCase(fetchRunningSessions.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to load running sessions";
      })
      .addCase(addRunningSession.fulfilled, (state, action) => {
        state.sessions.unshift(action.payload);
      })
      .addCase(completeRunningSession.fulfilled, (state, action) => {
        const session = state.sessions.find((s) => s.id === action.payload.id);
        if (session) {
          session.completed = true;
          if (action.payload.actualKm !== undefined) session.actual_km = action.payload.actualKm;
          if (action.payload.avgPaceSPerKm !== undefined) session.avg_pace_s_per_km = action.payload.avgPaceSPerKm;
          if (action.payload.heartRateAvg !== undefined) session.heart_rate_avg = action.payload.heartRateAvg;
        }
      })
      .addCase(removeRunningSession.fulfilled, (state, action) => {
        state.sessions = state.sessions.filter((s) => s.id !== action.payload);
      });
  },
});

export default runningSlice.reducer;
