import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import * as api from "../../lib/tauriApi";
import type { AppConfig } from "../types";

export type Theme = "light" | "dark" | "system";

interface PomodoroConfig {
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  sessionsPerCycle: number;
}

interface SettingsState {
  config: AppConfig | null;
  theme: Theme;
  pomodoro: PomodoroConfig;
  loaded: boolean;
}

const initialState: SettingsState = {
  config: null,
  theme: "system",
  pomodoro: {
    workMinutes: 25,
    breakMinutes: 5,
    longBreakMinutes: 15,
    sessionsPerCycle: 4,
  },
  loaded: false,
};

export const fetchConfig = createAsyncThunk("settings/fetchConfig", api.getConfig);

export const updateConfig = createAsyncThunk(
  "settings/updateConfig",
  async (params: { key: string; value: unknown }) => {
    await api.setConfig(params.key, params.value);
    return await api.getConfig();
  }
);

export const setTheme = createAsyncThunk("settings/setTheme", async (theme: Theme) => {
  await api.setConfig("theme", theme);
  return theme;
});

const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    setPomodoro(state, action: PayloadAction<Partial<PomodoroConfig>>) {
      state.pomodoro = { ...state.pomodoro, ...action.payload };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchConfig.fulfilled, (state, action) => {
        state.config = action.payload;
        // Restore persisted theme from config
        const t = action.payload.theme as Theme;
        if (t === "light" || t === "dark" || t === "system") {
          state.theme = t;
        }
        state.loaded = true;
      })
      .addCase(updateConfig.fulfilled, (state, action) => {
        state.config = action.payload;
      })
      .addCase(setTheme.fulfilled, (state, action) => {
        state.theme = action.payload;
      });
  },
});

export const { setPomodoro } = settingsSlice.actions;
export default settingsSlice.reducer;
