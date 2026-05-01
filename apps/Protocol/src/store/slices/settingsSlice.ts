import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { Theme } from "../types";

interface SettingsState {
  theme: Theme;
  loaded: boolean;
}

const initialState: SettingsState = {
  theme: "system",
  loaded: false,
};

export const fetchSettings = createAsyncThunk("settings/fetch", async (): Promise<Theme> => {
  const stored = localStorage.getItem("protocol_theme") as Theme | null;
  return stored ?? "system";
});

const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    setTheme(state, action: PayloadAction<Theme>) {
      state.theme = action.payload;
      localStorage.setItem("protocol_theme", action.payload);
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchSettings.fulfilled, (state, action) => {
      state.theme = action.payload;
      state.loaded = true;
    });
  },
});

export const { setTheme } = settingsSlice.actions;
export default settingsSlice.reducer;
