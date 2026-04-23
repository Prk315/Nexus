import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { invoke } from "@tauri-apps/api/core";

export interface BlockedApp {
  id: number;
  display_name: string;
  process_name: string;
  block_mode: "always" | "focus_only";
  enabled: boolean;
}

export interface InstalledApp {
  display_name: string;
  process_name: string;
}

interface BlockerState {
  enabled: boolean;
  apps: BlockedApp[];
  installedApps: InstalledApp[];
  loading: boolean;
}

const initialState: BlockerState = {
  enabled: false,
  apps: [],
  installedApps: [],
  loading: false,
};

export const fetchBlockerState = createAsyncThunk("blocker/fetchState", async () => {
  const [enabled, apps] = await Promise.all([
    invoke<boolean>("get_blocker_enabled"),
    invoke<BlockedApp[]>("get_blocked_apps"),
  ]);
  return { enabled, apps };
});

export const fetchInstalledApps = createAsyncThunk("blocker/fetchInstalled", async () => {
  return invoke<InstalledApp[]>("get_installed_apps");
});

export const setBlockerEnabled = createAsyncThunk(
  "blocker/setEnabled",
  async (enabled: boolean) => {
    await invoke("set_blocker_enabled", { enabled });
    return enabled;
  }
);

export const addBlockedApp = createAsyncThunk(
  "blocker/addApp",
  async (payload: { display_name: string; process_name: string; block_mode: string }) => {
    return invoke<BlockedApp>("add_blocked_app", {
      displayName: payload.display_name,
      processName: payload.process_name,
      blockMode: payload.block_mode,
    });
  }
);

export const removeBlockedApp = createAsyncThunk("blocker/removeApp", async (id: number) => {
  await invoke("remove_blocked_app", { id });
  return id;
});

export const setAppEnabled = createAsyncThunk(
  "blocker/setAppEnabled",
  async ({ id, enabled }: { id: number; enabled: boolean }) => {
    await invoke("set_blocked_app_enabled", { id, enabled });
    return { id, enabled };
  }
);

const blockerSlice = createSlice({
  name: "blocker",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchBlockerState.fulfilled, (state, action) => {
        state.enabled = action.payload.enabled;
        state.apps = action.payload.apps;
      })
      .addCase(fetchInstalledApps.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchInstalledApps.fulfilled, (state, action) => {
        state.installedApps = action.payload;
        state.loading = false;
      })
      .addCase(setBlockerEnabled.fulfilled, (state, action) => {
        state.enabled = action.payload;
      })
      .addCase(addBlockedApp.fulfilled, (state, action) => {
        state.apps.push(action.payload);
      })
      .addCase(removeBlockedApp.fulfilled, (state, action) => {
        state.apps = state.apps.filter((a) => a.id !== action.payload);
      })
      .addCase(setAppEnabled.fulfilled, (state, action) => {
        const app = state.apps.find((a) => a.id === action.payload.id);
        if (app) app.enabled = action.payload.enabled;
      });
  },
});

export default blockerSlice.reducer;
