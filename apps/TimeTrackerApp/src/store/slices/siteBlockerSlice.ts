import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { invoke } from "@tauri-apps/api/core";

export interface BlockedSite {
  id: number;
  domain: string;
  enabled: boolean;
}

interface SiteBlockerState {
  sites: BlockedSite[];
  loading: boolean;
  error: string | null;
}

const initialState: SiteBlockerState = {
  sites: [],
  loading: false,
  error: null,
};

export const fetchBlockedSites = createAsyncThunk("siteBlocker/fetch", async () => {
  return invoke<BlockedSite[]>("get_blocked_sites");
});

export const addBlockedSite = createAsyncThunk(
  "siteBlocker/add",
  async (domain: string) => {
    return invoke<BlockedSite>("add_blocked_site", { domain });
  }
);

export const removeBlockedSite = createAsyncThunk(
  "siteBlocker/remove",
  async (id: number) => {
    await invoke("remove_blocked_site", { id });
    return id;
  }
);

export const setSiteEnabled = createAsyncThunk(
  "siteBlocker/setEnabled",
  async ({ id, enabled }: { id: number; enabled: boolean }) => {
    await invoke("set_blocked_site_enabled", { id, enabled });
    return { id, enabled };
  }
);

export const syncBlockedSites = createAsyncThunk("siteBlocker/sync", async () => {
  await invoke("sync_blocked_sites");
});

const siteBlockerSlice = createSlice({
  name: "siteBlocker",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchBlockedSites.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchBlockedSites.fulfilled, (state, action) => {
        state.sites = action.payload;
        state.loading = false;
      })
      .addCase(fetchBlockedSites.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to load blocked sites";
      })
      .addCase(addBlockedSite.fulfilled, (state, action) => {
        state.sites.push(action.payload);
      })
      .addCase(removeBlockedSite.fulfilled, (state, action) => {
        state.sites = state.sites.filter((s) => s.id !== action.payload);
      })
      .addCase(setSiteEnabled.fulfilled, (state, action) => {
        const site = state.sites.find((s) => s.id === action.payload.id);
        if (site) site.enabled = action.payload.enabled;
      });
  },
});

export default siteBlockerSlice.reducer;
