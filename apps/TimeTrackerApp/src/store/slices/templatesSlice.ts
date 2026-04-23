import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import * as api from "../../lib/tauriApi";
import type { Template } from "../types";

interface TemplatesState {
  items: Template[];
  loading: boolean;
  error: string | null;
}

const initialState: TemplatesState = { items: [], loading: false, error: null };

export const fetchTemplates = createAsyncThunk("templates/fetch", api.getAllTemplates);

export const saveTemplate = createAsyncThunk(
  "templates/save",
  async (params: Parameters<typeof api.saveTemplate>[0]) => {
    await api.saveTemplate(params);
    return await api.getAllTemplates();
  }
);

export const deleteTemplate = createAsyncThunk(
  "templates/delete",
  async (name: string) => {
    await api.deleteTemplate(name);
    return name;
  }
);

const templatesSlice = createSlice({
  name: "templates",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchTemplates.pending, (state) => { state.loading = true; })
      .addCase(fetchTemplates.fulfilled, (state, action) => {
        state.items = action.payload;
        state.loading = false;
      })
      .addCase(fetchTemplates.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? null;
      })
      .addCase(saveTemplate.fulfilled, (state, action) => {
        state.items = action.payload;
      })
      .addCase(deleteTemplate.fulfilled, (state, action) => {
        state.items = state.items.filter((t) => t.name !== action.payload);
      });
  },
});

export default templatesSlice.reducer;
