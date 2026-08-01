import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { CreateHabit, UpdateHabit, Habit, HabitCompletion, CreateHabitStack, HabitStack } from "../types";

interface HabitsState {
  habits: Habit[];
  completions: HabitCompletion[];
  stacks: HabitStack[];
  loading: boolean;
  error: string | null;
}

const initialState: HabitsState = {
  habits: [],
  completions: [],
  stacks: [],
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

export const editHabit = createAsyncThunk("habits/edit", async (habit: UpdateHabit) => {
  const { updateHabit } = await import("../../lib/tauriApi");
  await updateHabit(habit);
  return habit;
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

export const fetchHabitStacks = createAsyncThunk("habits/fetchStacks", async () => {
  const { getHabitStacks } = await import("../../lib/tauriApi");
  return getHabitStacks();
});

export const addHabitStack = createAsyncThunk("habits/addStack", async (stack: CreateHabitStack) => {
  const { createHabitStack } = await import("../../lib/tauriApi");
  return createHabitStack(stack);
});

export const removeHabitStack = createAsyncThunk("habits/removeStack", async (id: string) => {
  const { deleteHabitStack } = await import("../../lib/tauriApi");
  await deleteHabitStack(id);
  return id;
});

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
      .addCase(editHabit.fulfilled, (state, action) => {
        const habit = state.habits.find((h) => h.id === action.payload.id);
        if (habit) Object.assign(habit, action.payload);
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
      })
      .addCase(fetchHabitStacks.fulfilled, (state, action) => {
        state.stacks = action.payload;
      })
      .addCase(addHabitStack.fulfilled, (state, action) => {
        state.stacks.push(action.payload);
      })
      .addCase(removeHabitStack.fulfilled, (state, action) => {
        state.stacks = state.stacks.filter((s) => s.id !== action.payload);
        state.habits.forEach((h) => {
          if (h.stack_id === action.payload) h.stack_id = null;
        });
      });
  },
});

export default habitsSlice.reducer;
