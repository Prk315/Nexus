import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import * as api from "../../lib/tauriApi";
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

export const runSync = createAsyncThunk("sync/bidirectional", api.syncBidirectional);
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
