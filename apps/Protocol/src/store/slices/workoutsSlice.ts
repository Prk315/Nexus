import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type {
  CreateExercise,
  CreateWorkoutPlan,
  CreateWorkoutSession,
  Exercise,
  WorkoutPlan,
  WorkoutSession,
} from "../types";

interface WorkoutsState {
  plans: WorkoutPlan[];
  sessions: WorkoutSession[];
  exercises: Exercise[];
  loading: boolean;
  error: string | null;
}

const initialState: WorkoutsState = {
  plans: [],
  sessions: [],
  exercises: [],
  loading: false,
  error: null,
};

export const fetchWorkoutPlans = createAsyncThunk("workouts/fetchPlans", async () => {
  const { getWorkoutPlans } = await import("../../lib/tauriApi");
  return getWorkoutPlans();
});

export const addWorkoutPlan = createAsyncThunk(
  "workouts/addPlan",
  async (plan: CreateWorkoutPlan) => {
    const { createWorkoutPlan } = await import("../../lib/tauriApi");
    return createWorkoutPlan(plan);
  },
);

export const removeWorkoutPlan = createAsyncThunk(
  "workouts/removePlan",
  async (id: string) => {
    const { deleteWorkoutPlan } = await import("../../lib/tauriApi");
    await deleteWorkoutPlan(id);
    return id;
  },
);

export const fetchWorkoutSessions = createAsyncThunk(
  "workouts/fetchSessions",
  async (planId?: string) => {
    const { getWorkoutSessions } = await import("../../lib/tauriApi");
    return getWorkoutSessions(planId);
  },
);

export const addWorkoutSession = createAsyncThunk(
  "workouts/addSession",
  async (session: CreateWorkoutSession) => {
    const { createWorkoutSession } = await import("../../lib/tauriApi");
    return createWorkoutSession(session);
  },
);

export const completeWorkoutSession = createAsyncThunk(
  "workouts/completeSession",
  async (id: string) => {
    const { completeWorkoutSessionApi } = await import("../../lib/tauriApi");
    await completeWorkoutSessionApi(id);
    return id;
  },
);

export const removeWorkoutSession = createAsyncThunk(
  "workouts/removeSession",
  async (id: string) => {
    const { deleteWorkoutSession } = await import("../../lib/tauriApi");
    await deleteWorkoutSession(id);
    return id;
  },
);

export const fetchExercises = createAsyncThunk(
  "workouts/fetchExercises",
  async (sessionId: string) => {
    const { getExercises } = await import("../../lib/tauriApi");
    return getExercises(sessionId);
  },
);

export const addExercise = createAsyncThunk(
  "workouts/addExercise",
  async (exercise: CreateExercise) => {
    const { createExercise } = await import("../../lib/tauriApi");
    return createExercise(exercise);
  },
);

export const removeExercise = createAsyncThunk(
  "workouts/removeExercise",
  async (id: string) => {
    const { deleteExercise } = await import("../../lib/tauriApi");
    await deleteExercise(id);
    return id;
  },
);

const workoutsSlice = createSlice({
  name: "workouts",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchWorkoutPlans.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchWorkoutPlans.fulfilled, (state, action) => {
        state.plans = action.payload;
        state.loading = false;
      })
      .addCase(fetchWorkoutPlans.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to load workout plans";
      })
      .addCase(addWorkoutPlan.fulfilled, (state, action) => {
        state.plans.unshift(action.payload);
      })
      .addCase(removeWorkoutPlan.fulfilled, (state, action) => {
        state.plans = state.plans.filter((p) => p.id !== action.payload);
      })
      .addCase(fetchWorkoutSessions.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchWorkoutSessions.fulfilled, (state, action) => {
        state.sessions = action.payload;
        state.loading = false;
      })
      .addCase(fetchWorkoutSessions.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to load workout sessions";
      })
      .addCase(addWorkoutSession.fulfilled, (state, action) => {
        state.sessions.unshift(action.payload);
      })
      .addCase(completeWorkoutSession.fulfilled, (state, action) => {
        const session = state.sessions.find((s) => s.id === action.payload);
        if (session) session.completed = true;
      })
      .addCase(removeWorkoutSession.fulfilled, (state, action) => {
        state.sessions = state.sessions.filter((s) => s.id !== action.payload);
      })
      .addCase(fetchExercises.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchExercises.fulfilled, (state, action) => {
        state.exercises = action.payload;
        state.loading = false;
      })
      .addCase(fetchExercises.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to load exercises";
      })
      .addCase(addExercise.fulfilled, (state, action) => {
        state.exercises.unshift(action.payload);
      })
      .addCase(removeExercise.fulfilled, (state, action) => {
        state.exercises = state.exercises.filter((e) => e.id !== action.payload);
      });
  },
});

export default workoutsSlice.reducer;
