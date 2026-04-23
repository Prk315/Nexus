import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import * as api from "../../lib/tauriApi";

interface CategoriesState {
  items: Record<string, string[]>;
  loaded: boolean;
}

const initialState: CategoriesState = { items: {}, loaded: false };

export const fetchCategories = createAsyncThunk(
  "categories/fetch",
  api.getCategories
);

export const updateCategories = createAsyncThunk(
  "categories/save",
  async (categories: Record<string, string[]>) => {
    await api.saveCategories(categories);
    return categories;
  }
);

const categoriesSlice = createSlice({
  name: "categories",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchCategories.fulfilled, (state, action) => {
        state.items = action.payload;
        state.loaded = true;
      })
      .addCase(updateCategories.fulfilled, (state, action) => {
        state.items = action.payload;
      });
  },
});

export default categoriesSlice.reducer;
