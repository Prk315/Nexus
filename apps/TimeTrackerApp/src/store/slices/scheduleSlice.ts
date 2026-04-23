import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { invoke } from "@tauri-apps/api/core";

export interface FocusBlock {
  id: number;
  name: string;
  start_time: string;   // "HH:MM"
  end_time: string;     // "HH:MM"
  days_of_week: string; // "1,2,3,4,5"
  color: string;
  enabled: boolean;
  blocked_apps: string[];  // process names
  blocked_sites: string[]; // domains
}

export interface TimeUnlockRule {
  id: number;
  process_name: string | null;
  domain: string | null;
  required_minutes: number;
  enabled: boolean;
}

interface ScheduleState {
  blocks: FocusBlock[];
  unlockRules: TimeUnlockRule[];
  todayMinutes: number;
  loading: boolean;
}

const initialState: ScheduleState = {
  blocks: [],
  unlockRules: [],
  todayMinutes: 0,
  loading: false,
};

export const fetchScheduleBlocks = createAsyncThunk("schedule/fetchBlocks", () =>
  invoke<FocusBlock[]>("get_schedule_blocks")
);

export const addScheduleBlock = createAsyncThunk(
  "schedule/addBlock",
  (p: { name: string; start_time: string; end_time: string; days_of_week: string; color: string }) =>
    invoke<FocusBlock>("add_schedule_block", {
      name: p.name,
      startTime: p.start_time,
      endTime: p.end_time,
      daysOfWeek: p.days_of_week,
      color: p.color,
    })
);

export const updateScheduleBlock = createAsyncThunk(
  "schedule/updateBlock",
  async (block: FocusBlock) => {
    await invoke("update_schedule_block", {
      id: block.id,
      name: block.name,
      startTime: block.start_time,
      endTime: block.end_time,
      daysOfWeek: block.days_of_week,
      color: block.color,
      enabled: block.enabled,
      blockedApps: block.blocked_apps,
      blockedSites: block.blocked_sites,
    });
    return block;
  }
);

export const removeScheduleBlock = createAsyncThunk(
  "schedule/removeBlock",
  async (id: number) => {
    await invoke("remove_schedule_block", { id });
    return id;
  }
);

export const fetchUnlockRules = createAsyncThunk("schedule/fetchUnlockRules", () =>
  invoke<TimeUnlockRule[]>("get_time_unlock_rules")
);

export const addUnlockRule = createAsyncThunk(
  "schedule/addUnlockRule",
  (p: { process_name?: string; domain?: string; required_minutes: number }) =>
    invoke<TimeUnlockRule>("add_time_unlock_rule", {
      processName: p.process_name ?? null,
      domain: p.domain ?? null,
      requiredMinutes: p.required_minutes,
    })
);

export const removeUnlockRule = createAsyncThunk(
  "schedule/removeUnlockRule",
  async (id: number) => {
    await invoke("remove_time_unlock_rule", { id });
    return id;
  }
);

export const fetchTodayMinutes = createAsyncThunk("schedule/fetchTodayMinutes", () =>
  invoke<number>("get_today_minutes")
);

const scheduleSlice = createSlice({
  name: "schedule",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchScheduleBlocks.pending, (state) => { state.loading = true; })
      .addCase(fetchScheduleBlocks.fulfilled, (state, action) => {
        state.blocks = action.payload;
        state.loading = false;
      })
      .addCase(addScheduleBlock.fulfilled, (state, action) => {
        state.blocks.push(action.payload);
      })
      .addCase(updateScheduleBlock.fulfilled, (state, action) => {
        const idx = state.blocks.findIndex((b) => b.id === action.payload.id);
        if (idx >= 0) state.blocks[idx] = action.payload;
      })
      .addCase(removeScheduleBlock.fulfilled, (state, action) => {
        state.blocks = state.blocks.filter((b) => b.id !== action.payload);
      })
      .addCase(fetchUnlockRules.fulfilled, (state, action) => {
        state.unlockRules = action.payload;
      })
      .addCase(addUnlockRule.fulfilled, (state, action) => {
        state.unlockRules.push(action.payload);
      })
      .addCase(removeUnlockRule.fulfilled, (state, action) => {
        state.unlockRules = state.unlockRules.filter((r) => r.id !== action.payload);
      })
      .addCase(fetchTodayMinutes.fulfilled, (state, action) => {
        state.todayMinutes = action.payload;
      });
  },
});

export default scheduleSlice.reducer;
