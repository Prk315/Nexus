import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type {
  CreateFood, Food, CreateMeal, Meal, CreateMealItem, MealItem,
  CreateMealPlanEntry, MealPlanEntry, UpdateNutritionGoals, NutritionGoals,
} from "../types";

interface MealPlannerState {
  foods: Food[];
  meals: Meal[];
  mealItems: Record<string, MealItem[]>; // by meal_id
  planEntries: MealPlanEntry[];
  goals: NutritionGoals | null;
  loading: boolean;
  error: string | null;
}

const initialState: MealPlannerState = {
  foods: [],
  meals: [],
  mealItems: {},
  planEntries: [],
  goals: null,
  loading: false,
  error: null,
};

export const fetchFoods = createAsyncThunk("mealPlanner/fetchFoods", async () => {
  const { getFoods } = await import("../../lib/tauriApi");
  return getFoods();
});

export const addFood = createAsyncThunk("mealPlanner/addFood", async (food: CreateFood) => {
  const { createFood } = await import("../../lib/tauriApi");
  return createFood(food);
});

export const fetchMeals = createAsyncThunk("mealPlanner/fetchMeals", async () => {
  const { getMeals } = await import("../../lib/tauriApi");
  return getMeals();
});

export const addMeal = createAsyncThunk("mealPlanner/addMeal", async (meal: CreateMeal) => {
  const { createMeal } = await import("../../lib/tauriApi");
  return createMeal(meal);
});

export const removeMeal = createAsyncThunk("mealPlanner/removeMeal", async (id: string) => {
  const { deleteMeal } = await import("../../lib/tauriApi");
  await deleteMeal(id);
  return id;
});

export const fetchMealItems = createAsyncThunk("mealPlanner/fetchMealItems", async (mealId: string) => {
  const { getMealItems } = await import("../../lib/tauriApi");
  const items = await getMealItems(mealId);
  return { mealId, items };
});

export const addMealItem = createAsyncThunk("mealPlanner/addMealItem", async (item: CreateMealItem) => {
  const { addMealItem: create } = await import("../../lib/tauriApi");
  return create(item);
});

export const removeMealItem = createAsyncThunk(
  "mealPlanner/removeMealItem",
  async ({ id, mealId }: { id: string; mealId: string }) => {
    const { removeMealItem: remove } = await import("../../lib/tauriApi");
    await remove(id);
    return { id, mealId };
  },
);

export const fetchMealPlanEntries = createAsyncThunk(
  "mealPlanner/fetchPlanEntries",
  async ({ start, end }: { start: string; end: string }) => {
    const { getMealPlanEntries } = await import("../../lib/tauriApi");
    return getMealPlanEntries(start, end);
  },
);

export const addMealPlanEntry = createAsyncThunk(
  "mealPlanner/addPlanEntry",
  async (entry: CreateMealPlanEntry) => {
    const { addMealPlanEntry: create } = await import("../../lib/tauriApi");
    return create(entry);
  },
);

export const toggleMealPlanEntryLogged = createAsyncThunk(
  "mealPlanner/toggleLogged",
  async ({ id, logged }: { id: string; logged: boolean }) => {
    const { setMealPlanEntryLogged } = await import("../../lib/tauriApi");
    await setMealPlanEntryLogged(id, logged);
    return { id, logged };
  },
);

export const removeMealPlanEntry = createAsyncThunk("mealPlanner/removePlanEntry", async (id: string) => {
  const { removeMealPlanEntry: remove } = await import("../../lib/tauriApi");
  await remove(id);
  return id;
});

export const fetchNutritionGoals = createAsyncThunk("mealPlanner/fetchGoals", async () => {
  const { getNutritionGoals } = await import("../../lib/tauriApi");
  return getNutritionGoals();
});

export const saveNutritionGoals = createAsyncThunk(
  "mealPlanner/saveGoals",
  async ({ current, goals }: { current: NutritionGoals | null; goals: UpdateNutritionGoals }) => {
    const { saveNutritionGoals: save } = await import("../../lib/tauriApi");
    return save(current, goals);
  },
);

const mealPlannerSlice = createSlice({
  name: "mealPlanner",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchFoods.pending, (state) => { state.loading = true; state.error = null; })
      .addCase(fetchFoods.fulfilled, (state, action) => { state.foods = action.payload; state.loading = false; })
      .addCase(fetchFoods.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to load foods";
      })
      .addCase(addFood.fulfilled, (state, action) => { state.foods.push(action.payload); })
      .addCase(fetchMeals.fulfilled, (state, action) => { state.meals = action.payload; })
      .addCase(addMeal.fulfilled, (state, action) => { state.meals.push(action.payload); })
      .addCase(removeMeal.fulfilled, (state, action) => {
        state.meals = state.meals.filter((m) => m.id !== action.payload);
      })
      .addCase(fetchMealItems.fulfilled, (state, action) => {
        state.mealItems[action.payload.mealId] = action.payload.items;
      })
      .addCase(addMealItem.fulfilled, (state, action) => {
        const items = state.mealItems[action.payload.meal_id] ?? [];
        state.mealItems[action.payload.meal_id] = [...items, action.payload];
      })
      .addCase(removeMealItem.fulfilled, (state, action) => {
        const items = state.mealItems[action.payload.mealId] ?? [];
        state.mealItems[action.payload.mealId] = items.filter((i) => i.id !== action.payload.id);
      })
      .addCase(fetchMealPlanEntries.fulfilled, (state, action) => { state.planEntries = action.payload; })
      .addCase(addMealPlanEntry.fulfilled, (state, action) => { state.planEntries.push(action.payload); })
      .addCase(toggleMealPlanEntryLogged.fulfilled, (state, action) => {
        const entry = state.planEntries.find((e) => e.id === action.payload.id);
        if (entry) entry.logged = action.payload.logged;
      })
      .addCase(removeMealPlanEntry.fulfilled, (state, action) => {
        state.planEntries = state.planEntries.filter((e) => e.id !== action.payload);
      })
      .addCase(fetchNutritionGoals.fulfilled, (state, action) => { state.goals = action.payload; })
      .addCase(saveNutritionGoals.fulfilled, (state, action) => { state.goals = action.payload; });
  },
});

export default mealPlannerSlice.reducer;
