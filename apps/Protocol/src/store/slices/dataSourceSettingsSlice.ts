import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { DEFAULT_DATA_SOURCE_SETTINGS, type DataSourceSettings } from "../types";

interface DataSourceSettingsState {
  settings: DataSourceSettings;
  loading: boolean;
  error: string | null;
}

const initialState: DataSourceSettingsState = {
  settings: DEFAULT_DATA_SOURCE_SETTINGS,
  loading: false,
  error: null,
};

export const fetchDataSourceSettings = createAsyncThunk(
  "dataSourceSettings/fetch",
  async () => {
    const { fetchDataSourceSettingsFromCloud } = await import("../../lib/api");
    return (await fetchDataSourceSettingsFromCloud()) ?? DEFAULT_DATA_SOURCE_SETTINGS;
  },
);

export const updateDataSourceSettings = createAsyncThunk(
  "dataSourceSettings/update",
  async (settings: DataSourceSettings) => {
    const { upsertDataSourceSettingsInCloud } = await import("../../lib/api");
    await upsertDataSourceSettingsInCloud(settings);
    return settings;
  },
);

const dataSourceSettingsSlice = createSlice({
  name: "dataSourceSettings",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchDataSourceSettings.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchDataSourceSettings.fulfilled, (state, action) => {
        state.settings = action.payload;
        state.loading = false;
      })
      .addCase(fetchDataSourceSettings.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to load data source settings";
      })
      .addCase(updateDataSourceSettings.fulfilled, (state, action) => {
        state.settings = action.payload;
      })
      .addCase(updateDataSourceSettings.rejected, (state, action) => {
        state.error = action.error.message ?? "Failed to save data source settings";
      });
  },
});

export default dataSourceSettingsSlice.reducer;
