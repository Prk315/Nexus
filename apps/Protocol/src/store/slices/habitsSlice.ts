import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { CreateHabit, Habit, HabitCompletion } from "../types";

interface HabitsState {
  habits: Habit[];
  completions: HabitCompletion[];
  loading: boolean;
  error: string | null;
}

const initialState: HabitsState = {
  habits: [],
  completions: [],
  loading: false,
  error: null,
};

export const fetchHabits = createAsyncThunk("habits/fetch", async () => {
  const { getHabits } = await import("../../lib/tauriApi");
  return getHabits();
});

export const addHabit = createAsyncThunk("habits/add", async (habit: CreateHabit) => {
  const { createHabit } = await import("../../lib/tauriApi");
  return createHabit(habit);
});

export const removeHabit = createAsyncThunk("habits/remove", async (id: string) => {
  const { archiveHabit } = await import("../../lib/tauriApi");
  await archiveHabit(id);
  return id;
});

/** Completions for the last `sinceDate` (ISO, inclusive) through today. */
export const fetchHabitCompletions = createAsyncThunk(
  "habits/fetchCompletions",
  async (sinceDate: string) => {
    const { getHabitCompletions } = await import("../../lib/tauriApi");
    return getHabitCompletions(sinceDate);
  },
);

export const checkHabit = createAsyncThunk(
  "habits/check",
  async ({ habitId, date }: { habitId: string; date: string }) => {
    const { addHabitCompletion } = await import("../../lib/tauriApi");
    return addHabitCompletion(habitId, date);
  },
);

export const uncheckHabit = createAsyncThunk(
  "habits/uncheck",
  async ({ habitId, date }: { habitId: string; date: string }) => {
    const { removeHabitCompletion } = await import("../../lib/tauriApi");
    await removeHabitCompletion(habitId, date);
    return { habitId, date };
  },
);

const habitsSlice = createSlice({
  name: "habits",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchHabits.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchHabits.fulfilled, (state, action) => {
        state.habits = action.payload;
        state.loading = false;
      })
      .addCase(fetchHabits.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to load habits";
      })
      .addCase(addHabit.fulfilled, (state, action) => {
        state.habits.push(action.payload);
      })
      .addCase(removeHabit.fulfilled, (state, action) => {
        state.habits = state.habits.filter((h) => h.id !== action.payload);
      })
      .addCase(fetchHabitCompletions.fulfilled, (state, action) => {
        state.completions = action.payload;
      })
      .addCase(checkHabit.fulfilled, (state, action) => {
        state.completions.push(action.payload);
      })
      .addCase(uncheckHabit.fulfilled, (state, action) => {
        state.completions = state.completions.filter(
          (c) => !(c.habit_id === action.payload.habitId && c.date === action.payload.date),
        );
      });
  },
});

export default habitsSlice.reducer;
