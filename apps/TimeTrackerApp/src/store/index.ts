import { configureStore } from "@reduxjs/toolkit";
import timerReducer from "./slices/timerSlice";
import entriesReducer from "./slices/entriesSlice";
import settingsReducer from "./slices/settingsSlice";
import categoriesReducer from "./slices/categoriesSlice";
import syncReducer from "./slices/syncSlice";
import blockerReducer from "./slices/blockerSlice";
import siteBlockerReducer from "./slices/siteBlockerSlice";
import scheduleReducer from "./slices/scheduleSlice";

export const store = configureStore({
  reducer: {
    timer: timerReducer,
    entries: entriesReducer,
    settings: settingsReducer,
    categories: categoriesReducer,
    sync: syncReducer,
    blocker: blockerReducer,
    siteBlocker: siteBlockerReducer,
    schedule: scheduleReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
