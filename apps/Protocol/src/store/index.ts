import { configureStore } from "@reduxjs/toolkit";
import biomarkersReducer from "./slices/biomarkersSlice";
import workoutsReducer from "./slices/workoutsSlice";
import runningReducer from "./slices/runningSlice";
import settingsReducer from "./slices/settingsSlice";
import habitsReducer from "./slices/habitsSlice";
import mealPlannerReducer from "./slices/mealPlannerSlice";
import supplementsReducer from "./slices/supplementsSlice";
import dataSourceSettingsReducer from "./slices/dataSourceSettingsSlice";

export const store = configureStore({
  reducer: {
    biomarkers: biomarkersReducer,
    workouts: workoutsReducer,
    running: runningReducer,
    settings: settingsReducer,
    habits: habitsReducer,
    mealPlanner: mealPlannerReducer,
    supplements: supplementsReducer,
    dataSourceSettings: dataSourceSettingsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
