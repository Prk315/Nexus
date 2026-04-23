import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import * as api from "../../lib/tauriApi";
import type { Statistics, TimeEntry } from "../types";

interface Filters {
  project: string | null;
  startDate: string | null;
  endDate: string | null;
  tags: string | null;
  limit: number;
}

interface EntriesState {
  items: TimeEntry[];
  loading: boolean;
  error: string | null;
  filters: Filters;
  statistics: Statistics | null;
  statsLoading: boolean;
}

const initialState: EntriesState = {
  items: [],
  loading: false,
  error: null,
  filters: { project: null, startDate: null, endDate: null, tags: null, limit: 100 },
  statistics: null,
  statsLoading: false,
};

export const fetchEntries = createAsyncThunk(
  "entries/fetch",
  async (filters?: Partial<Filters>) => {
    return await api.getEntries({
      limit: filters?.limit,
      project: filters?.project ?? undefined,
      startDate: filters?.startDate ?? undefined,
      endDate: filters?.endDate ?? undefined,
      tags: filters?.tags ?? undefined,
    });
  }
);

export const editEntry = createAsyncThunk(
  "entries/edit",
  async (params: Parameters<typeof api.editEntry>[0]) => {
    await api.editEntry(params);
    return params;
  }
);

export const deleteEntry = createAsyncThunk("entries/delete", async (id: number) => {
  await api.deleteEntry(id);
  return id;
});

export const fetchStatistics = createAsyncThunk(
  "entries/stats",
  async (params?: { startDate?: string; endDate?: string }) => {
    return await api.getStatistics(params);
  }
);

const entriesSlice = createSlice({
  name: "entries",
  initialState,
  reducers: {
    setFilters(state, action) {
      state.filters = { ...state.filters, ...action.payload };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchEntries.pending, (state) => { state.loading = true; state.error = null; })
      .addCase(fetchEntries.fulfilled, (state, action) => {
        state.items = action.payload;
        state.loading = false;
      })
      .addCase(fetchEntries.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to load entries";
      })
      .addCase(editEntry.fulfilled, (state, action) => {
        const p = action.payload;
        const idx = state.items.findIndex((e) => e.id === p.entryId);
        if (idx !== -1) {
          if (p.taskName != null) state.items[idx].task_name = p.taskName;
          if (p.project !== undefined) state.items[idx].project = p.project ?? null;
          if (p.tags !== undefined) state.items[idx].tags = p.tags ?? null;
          if (p.notes !== undefined) state.items[idx].notes = p.notes ?? null;
          if (p.billable != null) state.items[idx].billable = p.billable;
          if (p.hourlyRate != null) state.items[idx].hourly_rate = p.hourlyRate;
        }
      })
      .addCase(deleteEntry.fulfilled, (state, action) => {
        state.items = state.items.filter((e) => e.id !== action.payload);
      })
      .addCase(fetchStatistics.pending, (state) => { state.statsLoading = true; })
      .addCase(fetchStatistics.fulfilled, (state, action) => {
        state.statistics = action.payload;
        state.statsLoading = false;
      })
      .addCase(fetchStatistics.rejected, (state) => { state.statsLoading = false; });
  },
});

export const { setFilters } = entriesSlice.actions;
export default entriesSlice.reducer;
