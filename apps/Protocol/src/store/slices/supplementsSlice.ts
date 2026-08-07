import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { Supplement, CreateSupplement, UpdateSupplement, SupplementLog } from "../types";

interface SupplementsState {
  items: Supplement[];
  logs: SupplementLog[];
  loading: boolean;
  error: string | null;
}

const initialState: SupplementsState = {
  items: [],
  logs: [],
  loading: false,
  error: null,
};

export const fetchSupplements = createAsyncThunk("supplements/fetch", async () => {
  const { getSupplements } = await import("../../lib/tauriApi");
  return getSupplements();
});

export const addSupplement = createAsyncThunk("supplements/add", async (s: CreateSupplement) => {
  const { createSupplement } = await import("../../lib/tauriApi");
  return createSupplement(s);
});

export const editSupplement = createAsyncThunk("supplements/edit", async (s: UpdateSupplement) => {
  const { updateSupplement } = await import("../../lib/tauriApi");
  return updateSupplement(s);
});

export const removeSupplement = createAsyncThunk("supplements/remove", async (id: string) => {
  const { deleteSupplement } = await import("../../lib/tauriApi");
  await deleteSupplement(id);
  return id;
});

export const fetchSupplementLogs = createAsyncThunk("supplements/fetchLogs", async (since: string) => {
  const { getSupplementLogs } = await import("../../lib/tauriApi");
  return getSupplementLogs(since);
});

export const takeSupplement = createAsyncThunk(
  "supplements/take",
  async ({ supplementId, date }: { supplementId: string; date: string }) => {
    const { addSupplementLog } = await import("../../lib/tauriApi");
    return addSupplementLog(supplementId, date);
  },
);

export const untakeSupplement = createAsyncThunk(
  "supplements/untake",
  async ({ supplementId, date }: { supplementId: string; date: string }) => {
    const { removeSupplementLog } = await import("../../lib/tauriApi");
    await removeSupplementLog(supplementId, date);
    return { supplementId, date };
  },
);

const supplementsSlice = createSlice({
  name: "supplements",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchSupplements.pending, (state) => { state.loading = true; state.error = null; })
      .addCase(fetchSupplements.fulfilled, (state, action) => { state.items = action.payload; state.loading = false; })
      .addCase(fetchSupplements.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to load supplements";
      })
      .addCase(addSupplement.fulfilled, (state, action) => { state.items.push(action.payload); })
      .addCase(editSupplement.fulfilled, (state, action) => {
        const i = state.items.findIndex((s) => s.id === action.payload.id);
        if (i >= 0) state.items[i] = action.payload;
      })
      .addCase(removeSupplement.fulfilled, (state, action) => {
        state.items = state.items.filter((s) => s.id !== action.payload);
        state.logs = state.logs.filter((l) => l.supplement_id !== action.payload);
      })
      .addCase(fetchSupplementLogs.fulfilled, (state, action) => { state.logs = action.payload; })
      .addCase(takeSupplement.fulfilled, (state, action) => { state.logs.push(action.payload); })
      .addCase(untakeSupplement.fulfilled, (state, action) => {
        state.logs = state.logs.filter(
          (l) => !(l.supplement_id === action.payload.supplementId && l.date === action.payload.date),
        );
      });
  },
});

export default supplementsSlice.reducer;
