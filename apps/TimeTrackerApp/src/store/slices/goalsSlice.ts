import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import * as api from "../../lib/tauriApi";
import type { GoalProgress } from "../types";

interface GoalsState {
  items: GoalProgress[];
  loading: boolean;
  error: string | null;
}

const initialState: GoalsState = { items: [], loading: false, error: null };

export const fetchGoals = createAsyncThunk(
  "goals/fetch",
  async (project?: string) => api.getActiveGoals(project)
);

export const addGoal = createAsyncThunk(
  "goals/add",
  async (params: Parameters<typeof api.addGoal>[0]) => {
    await api.addGoal(params);
    return await api.getActiveGoals();
  }
);

export const deactivateGoal = createAsyncThunk(
  "goals/deactivate",
  async (goalId: number) => {
    await api.deactivateGoal(goalId);
    return goalId;
  }
);

const goalsSlice = createSlice({
  name: "goals",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchGoals.pending, (state) => { state.loading = true; })
      .addCase(fetchGoals.fulfilled, (state, action) => {
        state.items = action.payload;
        state.loading = false;
      })
      .addCase(fetchGoals.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? null;
      })
      .addCase(addGoal.fulfilled, (state, action) => {
        state.items = action.payload;
      })
      .addCase(deactivateGoal.fulfilled, (state, action) => {
        state.items = state.items.filter((g) => g.goal.id !== action.payload);
      });
  },
});

export default goalsSlice.reducer;
