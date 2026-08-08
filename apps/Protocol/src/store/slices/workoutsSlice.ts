import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type {
  CreateExercise,
  CreateWorkoutPlan,
  CreateWorkoutSession,
  Exercise,
  WorkoutPlan,
  WorkoutSession,
  WorkoutRoutine,
  CreateWorkoutRoutine,
  UpdateWorkoutRoutine,
  RoutineExercise,
  CreateRoutineExercise,
  UpdateRoutineExercise,
  ExerciseHistory,
} from "../types";

interface WorkoutsState {
  plans: WorkoutPlan[];
  sessions: WorkoutSession[];
  exercises: Exercise[];
  routines: WorkoutRoutine[];
  routineExercises: Record<string, RoutineExercise[]>; // by routine_id
  exerciseHistory: ExerciseHistory[];
  loading: boolean;
  error: string | null;
}

const initialState: WorkoutsState = {
  plans: [],
  sessions: [],
  exercises: [],
  routines: [],
  routineExercises: {},
  exerciseHistory: [],
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

export const editExercise = createAsyncThunk("workouts/editExercise", async (e: Exercise) => {
  const { updateExercise } = await import("../../lib/tauriApi");
  return updateExercise(e);
});

// ── Training routines (designer) ──────────────────────────────────────────────

export const fetchRoutines = createAsyncThunk("workouts/fetchRoutines", async () => {
  const { getRoutines } = await import("../../lib/tauriApi");
  return getRoutines();
});

export const addRoutine = createAsyncThunk("workouts/addRoutine", async (r: CreateWorkoutRoutine) => {
  const { createRoutine } = await import("../../lib/tauriApi");
  return createRoutine(r);
});

export const editRoutine = createAsyncThunk("workouts/editRoutine", async (r: UpdateWorkoutRoutine) => {
  const { updateRoutine } = await import("../../lib/tauriApi");
  return updateRoutine(r);
});

export const removeRoutine = createAsyncThunk("workouts/removeRoutine", async (id: string) => {
  const { deleteRoutine } = await import("../../lib/tauriApi");
  await deleteRoutine(id);
  return id;
});

export const fetchRoutineExercises = createAsyncThunk(
  "workouts/fetchRoutineExercises",
  async (routineId: string) => {
    const { getRoutineExercises } = await import("../../lib/tauriApi");
    const items = await getRoutineExercises(routineId);
    return { routineId, items };
  },
);

export const addRoutineExercise = createAsyncThunk(
  "workouts/addRoutineExercise",
  async (e: CreateRoutineExercise) => {
    const { createRoutineExercise } = await import("../../lib/tauriApi");
    return createRoutineExercise(e);
  },
);

export const editRoutineExercise = createAsyncThunk(
  "workouts/editRoutineExercise",
  async (e: UpdateRoutineExercise) => {
    const { updateRoutineExercise } = await import("../../lib/tauriApi");
    return updateRoutineExercise(e);
  },
);

export const removeRoutineExercise = createAsyncThunk(
  "workouts/removeRoutineExercise",
  async ({ id, routineId }: { id: string; routineId: string }) => {
    const { deleteRoutineExercise } = await import("../../lib/tauriApi");
    await deleteRoutineExercise(id);
    return { id, routineId };
  },
);

export const fetchExerciseHistory = createAsyncThunk(
  "workouts/fetchExerciseHistory",
  async (sessions: { id: string; date: string }[]) => {
    const { getExerciseHistory } = await import("../../lib/tauriApi");
    return getExerciseHistory(sessions);
  },
);

/** Start a workout from a routine: create the session + pre-fill an exercise row
 *  per prescribed exercise (actuals default to the targets). */
export const startSessionFromRoutine = createAsyncThunk(
  "workouts/startFromRoutine",
  async ({ routine, exercises, date }: { routine: WorkoutRoutine; exercises: RoutineExercise[]; date: string }) => {
    const { createWorkoutSession, createExercise } = await import("../../lib/tauriApi");
    const session = await createWorkoutSession({
      name: routine.name, scheduled_date: date, plan_id: routine.plan_id, routine_id: routine.id,
    });
    const parseReps = (r: string | null) => { const m = r?.match(/\d+/); return m ? Number(m[0]) : null; };
    const created: Exercise[] = [];
    for (const ex of [...exercises].sort((a, b) => a.sort_order - b.sort_order)) {
      created.push(await createExercise({
        session_id: session.id, name: ex.name, sets: ex.target_sets,
        reps: parseReps(ex.target_reps), weight_kg: ex.target_weight_kg, notes: ex.notes,
      }));
    }
    return { session, exercises: created };
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
      .addCase(editExercise.fulfilled, (state, action) => {
        const i = state.exercises.findIndex((e) => e.id === action.payload.id);
        if (i >= 0) state.exercises[i] = action.payload;
      })
      .addCase(removeExercise.fulfilled, (state, action) => {
        state.exercises = state.exercises.filter((e) => e.id !== action.payload);
      })
      // routines
      .addCase(fetchRoutines.fulfilled, (state, action) => { state.routines = action.payload; })
      .addCase(addRoutine.fulfilled, (state, action) => { state.routines.push(action.payload); })
      .addCase(editRoutine.fulfilled, (state, action) => {
        const i = state.routines.findIndex((r) => r.id === action.payload.id);
        if (i >= 0) state.routines[i] = action.payload;
      })
      .addCase(removeRoutine.fulfilled, (state, action) => {
        state.routines = state.routines.filter((r) => r.id !== action.payload);
        delete state.routineExercises[action.payload];
      })
      .addCase(fetchRoutineExercises.fulfilled, (state, action) => {
        state.routineExercises[action.payload.routineId] = action.payload.items;
      })
      .addCase(addRoutineExercise.fulfilled, (state, action) => {
        const rid = action.payload.routine_id;
        state.routineExercises[rid] = [...(state.routineExercises[rid] ?? []), action.payload];
      })
      .addCase(editRoutineExercise.fulfilled, (state, action) => {
        const list = state.routineExercises[action.payload.routine_id] ?? [];
        const i = list.findIndex((e) => e.id === action.payload.id);
        if (i >= 0) list[i] = action.payload;
      })
      .addCase(removeRoutineExercise.fulfilled, (state, action) => {
        const list = state.routineExercises[action.payload.routineId] ?? [];
        state.routineExercises[action.payload.routineId] = list.filter((e) => e.id !== action.payload.id);
      })
      .addCase(fetchExerciseHistory.fulfilled, (state, action) => { state.exerciseHistory = action.payload; })
      .addCase(startSessionFromRoutine.fulfilled, (state, action) => {
        state.sessions.unshift(action.payload.session);
        state.exercises = action.payload.exercises;
      });
  },
});

export default workoutsSlice.reducer;
