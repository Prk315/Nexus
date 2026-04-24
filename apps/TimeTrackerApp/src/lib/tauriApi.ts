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
    taskName: params.taskName,
    project: params.project ?? null,
    tags: params.tags ?? null,
    notes: params.notes ?? null,
    billable: params.billable,
    hourlyRate: params.hourlyRate,
    userId: params.userId ?? null,
  });

export const stopTimer = () => invoke<TimeEntry>("stop_timer");
export const pauseTimer = () => invoke<PausedSession>("pause_timer");
export const resumeTimer = () => invoke<ActiveSession>("resume_timer");
export const cancelPaused = () => invoke<boolean>("cancel_paused");

export const startFromTemplate = (templateName: string, userId?: string) =>
  invoke<void>("start_from_template", {
    templateName,
    userId: userId ?? null,
  });

export const resumeFromEntry = (entryId: number, userId?: string) =>
  invoke<void>("resume_from_entry", {
    entryId,
    userId: userId ?? null,
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
    startDate: params?.startDate ?? null,
    endDate: params?.endDate ?? null,
    tags: params?.tags ?? null,
    userId: params?.userId ?? null,
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
    entryId: params.entryId,
    taskName: params.taskName ?? null,
    project: params.project ?? null,
    tags: params.tags ?? null,
    notes: params.notes ?? null,
    billable: params.billable ?? null,
    hourlyRate: params.hourlyRate ?? null,
  });

export const deleteEntry = (entryId: number) =>
  invoke<boolean>("delete_entry", { entryId });

export const getStatistics = (params?: { startDate?: string; endDate?: string }) =>
  invoke<Statistics>("get_statistics", {
    startDate: params?.startDate ?? null,
    endDate: params?.endDate ?? null,
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
    taskName: params.taskName,
    project: params.project ?? null,
    tags: params.tags ?? null,
    notes: params.notes ?? null,
    billable: params.billable,
    hourlyRate: params.hourlyRate,
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
    targetHours: params.targetHours,
    period: params.period,
    startDate: params.startDate,
    endDate: params.endDate,
    project: params.project ?? null,
  });

export const deactivateGoal = (goalId: number) =>
  invoke<boolean>("deactivate_goal", { goalId });

// ── Sync ─────────────────────────────────────────────────────────────────────

// ── Active session poll ───────────────────────────────────────────────────────

export type PollResult =
  | { type: "NoChange" }
  | { type: "Adopted" }
  | { type: "Conflict"; data: RemoteSession }
  | { type: "RemoteGone" };

export interface RemoteSession {
  device_id: string;
  task_name: string;
  project: string | null;
  tags: string | null;
  notes: string | null;
  billable: boolean;
  hourly_rate: number;
  start_time: string;
  paused_at: string | null;
  elapsed_seconds: number;
  user_id: string;
}

export const pollActiveSession = () => invoke<PollResult>("poll_active_session");

export const syncPush = () => invoke<SyncResult>("sync_push");
export const syncPull = (includeOwnDevice = false) =>
  invoke<SyncResult>("sync_pull", { includeOwnDevice });
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
    outputPath: params.outputPath,
    project: params.project ?? null,
    startDate: params.startDate ?? null,
    endDate: params.endDate ?? null,
  });

export const exportJson = (params: {
  outputPath: string;
  project?: string;
  startDate?: string;
  endDate?: string;
}) =>
  invoke<number>("export_json_entries", {
    outputPath: params.outputPath,
    project: params.project ?? null,
    startDate: params.startDate ?? null,
    endDate: params.endDate ?? null,
  });

export const importJson = (filePath: string) =>
  invoke<ImportResult>("import_json_entries", { filePath });

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
