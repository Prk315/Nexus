import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type {
  Supplement, CreateSupplement, UpdateSupplement, SupplementLog,
  SupplementStack, CreateSupplementStack, UpdateSupplementStack,
} from "../types";

interface SupplementsState {
  items: Supplement[];
  stacks: SupplementStack[];
  logs: SupplementLog[];
  loading: boolean;
  error: string | null;
}

const initialState: SupplementsState = {
  items: [],
  stacks: [],
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

// ── Stacks ───────────────────────────────────────────────────────────────────

export const fetchSupplementStacks = createAsyncThunk("supplements/fetchStacks", async () => {
  const { getSupplementStacks } = await import("../../lib/tauriApi");
  return getSupplementStacks();
});

export const addSupplementStack = createAsyncThunk("supplements/addStack", async (stack: CreateSupplementStack) => {
  const { createSupplementStack } = await import("../../lib/tauriApi");
  return createSupplementStack(stack);
});

export const editSupplementStack = createAsyncThunk("supplements/editStack", async (stack: UpdateSupplementStack) => {
  const { updateSupplementStack } = await import("../../lib/tauriApi");
  return updateSupplementStack(stack);
});

/** Delete a stack. If `moveToStackId` is given, its supplements are reassigned
 *  there first so nothing is orphaned; the reducer mirrors that in state. */
export const removeSupplementStack = createAsyncThunk(
  "supplements/removeStack",
  async ({ id, moveToStackId }: { id: string; moveToStackId: string | null }) => {
    const { reassignSupplements, deleteSupplementStack } = await import("../../lib/tauriApi");
    if (moveToStackId) await reassignSupplements(id, moveToStackId);
    await deleteSupplementStack(id);
    return { id, moveToStackId };
  },
);

/** Persist a batch of (stack_id, sort_order) changes from a drag. */
export const reorderSupplements = createAsyncThunk(
  "supplements/reorder",
  async (updates: { id: string; stack_id: string | null; sort_order: number }[]) => {
    const { moveSupplements } = await import("../../lib/tauriApi");
    await moveSupplements(updates);
    return updates;
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
      })
      // ── Stacks ──
      .addCase(fetchSupplementStacks.fulfilled, (state, action) => { state.stacks = action.payload; })
      .addCase(addSupplementStack.fulfilled, (state, action) => { state.stacks.push(action.payload); })
      .addCase(editSupplementStack.fulfilled, (state, action) => {
        const i = state.stacks.findIndex((s) => s.id === action.payload.id);
        if (i >= 0) state.stacks[i] = action.payload;
      })
      .addCase(removeSupplementStack.fulfilled, (state, action) => {
        const { id, moveToStackId } = action.payload;
        state.stacks = state.stacks.filter((s) => s.id !== id);
        // Mirror the reassign the thunk performed so the UI updates immediately.
        for (const s of state.items) if (s.stack_id === id) s.stack_id = moveToStackId;
      })
      .addCase(reorderSupplements.fulfilled, (state, action) => {
        const byId = new Map(action.payload.map((u) => [u.id, u]));
        for (const s of state.items) {
          const u = byId.get(s.id);
          if (u) { s.stack_id = u.stack_id; s.sort_order = u.sort_order; }
        }
      });
  },
});

export default supplementsSlice.reducer;
