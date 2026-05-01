import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type {
  BodyMetric,
  CreateBodyMetric,
  CreateNutritionEntry,
  CreateSleepEntry,
  NutritionEntry,
  SleepEntry,
} from "../types";

interface BiomarkersState {
  sleep: SleepEntry[];
  nutrition: NutritionEntry[];
  bodyMetrics: BodyMetric[];
  loading: boolean;
  error: string | null;
}

const initialState: BiomarkersState = {
  sleep: [],
  nutrition: [],
  bodyMetrics: [],
  loading: false,
  error: null,
};

export const fetchSleep = createAsyncThunk("biomarkers/fetchSleep", async () => {
  const { getSleepEntries } = await import("../../lib/tauriApi");
  return getSleepEntries();
});

export const addSleepEntry = createAsyncThunk(
  "biomarkers/addSleep",
  async (entry: CreateSleepEntry) => {
    const { createSleepEntry } = await import("../../lib/tauriApi");
    return createSleepEntry(entry);
  },
);

export const removeSleepEntry = createAsyncThunk(
  "biomarkers/removeSleep",
  async (id: string) => {
    const { deleteSleepEntry } = await import("../../lib/tauriApi");
    await deleteSleepEntry(id);
    return id;
  },
);

export const fetchNutrition = createAsyncThunk("biomarkers/fetchNutrition", async () => {
  const { getNutritionEntries } = await import("../../lib/tauriApi");
  return getNutritionEntries();
});

export const addNutritionEntry = createAsyncThunk(
  "biomarkers/addNutrition",
  async (entry: CreateNutritionEntry) => {
    const { createNutritionEntry } = await import("../../lib/tauriApi");
    return createNutritionEntry(entry);
  },
);

export const removeNutritionEntry = createAsyncThunk(
  "biomarkers/removeNutrition",
  async (id: string) => {
    const { deleteNutritionEntry } = await import("../../lib/tauriApi");
    await deleteNutritionEntry(id);
    return id;
  },
);

export const fetchBodyMetrics = createAsyncThunk("biomarkers/fetchBodyMetrics", async () => {
  const { getBodyMetrics } = await import("../../lib/tauriApi");
  return getBodyMetrics();
});

export const addBodyMetric = createAsyncThunk(
  "biomarkers/addBodyMetric",
  async (entry: CreateBodyMetric) => {
    const { createBodyMetric } = await import("../../lib/tauriApi");
    return createBodyMetric(entry);
  },
);

export const removeBodyMetric = createAsyncThunk(
  "biomarkers/removeBodyMetric",
  async (id: string) => {
    const { deleteBodyMetric } = await import("../../lib/tauriApi");
    await deleteBodyMetric(id);
    return id;
  },
);

const biomarkersSlice = createSlice({
  name: "biomarkers",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchSleep.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchSleep.fulfilled, (state, action) => {
        state.sleep = action.payload;
        state.loading = false;
      })
      .addCase(fetchSleep.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to load sleep entries";
      })
      .addCase(addSleepEntry.fulfilled, (state, action) => {
        state.sleep.unshift(action.payload);
      })
      .addCase(removeSleepEntry.fulfilled, (state, action) => {
        state.sleep = state.sleep.filter((e) => e.id !== action.payload);
      })
      .addCase(fetchNutrition.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchNutrition.fulfilled, (state, action) => {
        state.nutrition = action.payload;
        state.loading = false;
      })
      .addCase(fetchNutrition.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to load nutrition";
      })
      .addCase(addNutritionEntry.fulfilled, (state, action) => {
        state.nutrition.unshift(action.payload);
      })
      .addCase(removeNutritionEntry.fulfilled, (state, action) => {
        state.nutrition = state.nutrition.filter((e) => e.id !== action.payload);
      })
      .addCase(fetchBodyMetrics.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchBodyMetrics.fulfilled, (state, action) => {
        state.bodyMetrics = action.payload;
        state.loading = false;
      })
      .addCase(fetchBodyMetrics.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to load body metrics";
      })
      .addCase(addBodyMetric.fulfilled, (state, action) => {
        state.bodyMetrics.unshift(action.payload);
      })
      .addCase(removeBodyMetric.fulfilled, (state, action) => {
        state.bodyMetrics = state.bodyMetrics.filter((e) => e.id !== action.payload);
      });
  },
});

export default biomarkersSlice.reducer;
