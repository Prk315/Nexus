import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import * as api from "../../lib/tauriApi";
import { fetchBlockerState } from "./blockerSlice";
import { fetchBlockedSites, syncBlockedSites } from "./siteBlockerSlice";
import { fetchScheduleBlocks, fetchUnlockRules } from "./scheduleSlice";
import type { SyncResult } from "../types";

interface SyncState {
  lastSync: string | null;
  isSyncing: boolean;
  result: SyncResult | null;
  error: string | null;
}

const initialState: SyncState = {
  lastSync: null,
  isSyncing: false,
  result: null,
  error: null,
};

export const runSync = createAsyncThunk("sync/bidirectional", async (_, { dispatch }) => {
  // Sync time entries
  const result = await api.syncBidirectional();
  // Sync blocking data (apps, sites, schedule blocks, unlock rules)
  const blockingResult = await api.syncBlockingBidirectional();
  // Refresh local Redux state so UI reflects pulled changes
  dispatch(fetchBlockerState());
  dispatch(fetchBlockedSites());
  dispatch(fetchScheduleBlocks());
  dispatch(fetchUnlockRules());
  // Push the pulled site list into the OS-level enforcement layer.
  // The blocker UI is read-only (lists are managed from Supabase), so this is
  // now the only path that reaches /etc/hosts on macOS and the Safari content
  // blocker on iOS. `hosts::apply` no-ops when the file is unchanged, so this
  // does not trigger a password prompt on syncs that pulled nothing new.
  await dispatch(syncBlockedSites());
  // Merge errors
  return {
    pushed: result.pushed + blockingResult.apps_pushed + blockingResult.sites_pushed + blockingResult.blocks_pushed + blockingResult.rules_pushed,
    pulled: result.pulled + blockingResult.apps_pulled + blockingResult.sites_pulled + blockingResult.blocks_pulled + blockingResult.rules_pulled,
    errors: [...result.errors, ...blockingResult.errors],
  } as SyncResult;
});
export const runPush = createAsyncThunk("sync/push", api.syncPush);
export const runPull = createAsyncThunk("sync/pull", () => api.syncPull(false));

const syncSlice = createSlice({
  name: "sync",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    const pending = (state: SyncState) => {
      state.isSyncing = true;
      state.error = null;
    };
    const fulfilled = (state: SyncState, action: { payload: SyncResult }) => {
      state.isSyncing = false;
      state.result = action.payload;
      state.lastSync = new Date().toISOString();
      if (action.payload.errors.length > 0) {
        state.error = action.payload.errors.join("; ");
      }
    };
    const rejected = (state: SyncState, action: { error: { message?: string } }) => {
      state.isSyncing = false;
      state.error = action.error.message ?? "Sync failed";
    };
    builder
      .addCase(runSync.pending, pending)
      .addCase(runSync.fulfilled, fulfilled)
      .addCase(runSync.rejected, rejected)
      .addCase(runPush.pending, pending)
      .addCase(runPush.fulfilled, fulfilled)
      .addCase(runPush.rejected, rejected)
      .addCase(runPull.pending, pending)
      .addCase(runPull.fulfilled, fulfilled)
      .addCase(runPull.rejected, rejected);
  },
});

export default syncSlice.reducer;
