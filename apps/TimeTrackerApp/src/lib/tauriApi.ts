import { invoke } from "@tauri-apps/api/core";
import type {
  ActiveSession,
  AppConfig,
  GoalProgress,
  ImportResult,
  LocalUser,
  PausedSession,
  Statistics,
  SyncResult,
  Template,
  TimeEntry,
  TimerStatus,
} from "../store/types";

// ── Timer ────────────────────────────────────────────────────────────────────

export const getStatus = () => invoke<TimerStatus>("get_status");

export const startTimer = (params: {
  taskName: string;
  project?: string;
  tags?: string;
  notes?: string;
  billable: boolean;
  hourlyRate: number;
  userId?: string;
}) =>
  invoke<void>("start_timer", {
    task_name: params.taskName,
    project: params.project ?? null,
    tags: params.tags ?? null,
    notes: params.notes ?? null,
    billable: params.billable,
    hourly_rate: params.hourlyRate,
    user_id: params.userId ?? null,
  });

export const stopTimer = () => invoke<TimeEntry>("stop_timer");
export const pauseTimer = () => invoke<PausedSession>("pause_timer");
export const resumeTimer = () => invoke<ActiveSession>("resume_timer");
export const cancelPaused = () => invoke<boolean>("cancel_paused");

export const startFromTemplate = (templateName: string, userId?: string) =>
  invoke<void>("start_from_template", {
    template_name: templateName,
    user_id: userId ?? null,
  });

export const resumeFromEntry = (entryId: number, userId?: string) =>
  invoke<void>("resume_from_entry", {
    entry_id: entryId,
    user_id: userId ?? null,
  });

// ── Entries ──────────────────────────────────────────────────────────────────

export const getEntries = (params?: {
  limit?: number;
  project?: string;
  startDate?: string;
  endDate?: string;
  tags?: string;
  userId?: string;
}) =>
  invoke<TimeEntry[]>("get_entries", {
    limit: params?.limit ?? null,
    project: params?.project ?? null,
    start_date: params?.startDate ?? null,
    end_date: params?.endDate ?? null,
    tags: params?.tags ?? null,
    user_id: params?.userId ?? null,
  });

export const editEntry = (params: {
  entryId: number;
  taskName?: string;
  project?: string;
  tags?: string;
  notes?: string;
  billable?: boolean;
  hourlyRate?: number;
}) =>
  invoke<boolean>("edit_entry", {
    entry_id: params.entryId,
    task_name: params.taskName ?? null,
    project: params.project ?? null,
    tags: params.tags ?? null,
    notes: params.notes ?? null,
    billable: params.billable ?? null,
    hourly_rate: params.hourlyRate ?? null,
  });

export const deleteEntry = (entryId: number) =>
  invoke<boolean>("delete_entry", { entry_id: entryId });

export const getStatistics = (params?: { startDate?: string; endDate?: string }) =>
  invoke<Statistics>("get_statistics", {
    start_date: params?.startDate ?? null,
    end_date: params?.endDate ?? null,
  });

export const getAllProjects = () => invoke<string[]>("get_all_projects");

// ── Templates ────────────────────────────────────────────────────────────────

export const getAllTemplates = () => invoke<Template[]>("get_all_templates");

export const saveTemplate = (params: {
  name: string;
  taskName: string;
  project?: string;
  tags?: string;
  notes?: string;
  billable: boolean;
  hourlyRate: number;
}) =>
  invoke<boolean>("save_template", {
    name: params.name,
    task_name: params.taskName,
    project: params.project ?? null,
    tags: params.tags ?? null,
    notes: params.notes ?? null,
    billable: params.billable,
    hourly_rate: params.hourlyRate,
  });

export const deleteTemplate = (name: string) =>
  invoke<boolean>("delete_template", { name });

// ── Goals ────────────────────────────────────────────────────────────────────

export const getActiveGoals = (project?: string) =>
  invoke<GoalProgress[]>("get_active_goals", { project: project ?? null });

export const addGoal = (params: {
  targetHours: number;
  period: string;
  startDate: string;
  endDate: string;
  project?: string;
}) =>
  invoke<number>("add_goal", {
    target_hours: params.targetHours,
    period: params.period,
    start_date: params.startDate,
    end_date: params.endDate,
    project: params.project ?? null,
  });

export const deactivateGoal = (goalId: number) =>
  invoke<boolean>("deactivate_goal", { goal_id: goalId });

// ── Sync ─────────────────────────────────────────────────────────────────────

export const syncPush = () => invoke<SyncResult>("sync_push");
export const syncPull = (includeOwnDevice = false) =>
  invoke<SyncResult>("sync_pull", { include_own_device: includeOwnDevice });
export const syncBidirectional = () => invoke<SyncResult>("sync_bidirectional");
export const testSupabaseConnection = () =>
  invoke<boolean>("test_supabase_connection");

// ── Export / Import ──────────────────────────────────────────────────────────

export const exportCsv = (params: {
  outputPath: string;
  project?: string;
  startDate?: string;
  endDate?: string;
}) =>
  invoke<number>("export_csv", {
    output_path: params.outputPath,
    project: params.project ?? null,
    start_date: params.startDate ?? null,
    end_date: params.endDate ?? null,
  });

export const exportJson = (params: {
  outputPath: string;
  project?: string;
  startDate?: string;
  endDate?: string;
}) =>
  invoke<number>("export_json_entries", {
    output_path: params.outputPath,
    project: params.project ?? null,
    start_date: params.startDate ?? null,
    end_date: params.endDate ?? null,
  });

export const importJson = (filePath: string) =>
  invoke<ImportResult>("import_json_entries", { file_path: filePath });

// ── Config ───────────────────────────────────────────────────────────────────

export const getConfig = () => invoke<AppConfig>("get_config");
export const setConfig = (key: string, value: unknown) =>
  invoke<void>("set_config", { key, value });

// ── Categories ───────────────────────────────────────────────────────────────

export const getCategories = () =>
  invoke<Record<string, string[]>>("get_categories");
export const saveCategories = (categories: Record<string, string[]>) =>
  invoke<void>("save_categories", { categories });

// ── Users ────────────────────────────────────────────────────────────────────

export const getLocalUsers = () => invoke<LocalUser[]>("get_local_users");
export const createLocalUser = (name: string) =>
  invoke<number | null>("create_local_user", { name });
