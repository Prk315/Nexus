// Shared TypeScript types mirroring Rust models

export interface TimeEntry {
  id: number;
  task_name: string;
  project: string | null;
  start_time: string;
  end_time: string | null;
  duration_seconds: number;
  tags: string | null;
  notes: string | null;
  billable: boolean;
  hourly_rate: number;
  synced: boolean;
  user_id: string | null;
  created_at: string | null;
}

export interface ActiveSession {
  task_name: string;
  project: string | null;
  start_time: string;
  tags: string | null;
  notes: string | null;
  billable: boolean;
  hourly_rate: number;
  user_id: string | null;
  elapsed_seconds: number;
}

export interface PausedSession {
  task_name: string;
  project: string | null;
  start_time: string;
  paused_at: string;
  elapsed_seconds: number;
  tags: string | null;
  notes: string | null;
  billable: boolean;
  hourly_rate: number;
}

export interface TimerStatus {
  active: ActiveSession | null;
  paused: PausedSession | null;
}

export interface Template {
  id: number;
  name: string;
  task_name: string;
  project: string | null;
  tags: string | null;
  notes: string | null;
  billable: boolean;
  hourly_rate: number;
  created_at: string | null;
}

export interface Goal {
  id: number;
  project: string | null;
  target_hours: number;
  period: string;
  start_date: string;
  end_date: string;
  active: boolean;
  created_at: string | null;
}

export interface GoalProgress {
  goal: Goal;
  actual_hours: number;
  target_hours: number;
  progress_percent: number;
  remaining_hours: number;
}

export interface ProjectStat {
  project: string | null;
  total: number;
  count: number;
}

export interface TaskStat {
  task_name: string;
  total: number;
  count: number;
}

export interface Statistics {
  total_seconds: number;
  by_project: ProjectStat[];
  by_task: TaskStat[];
}

export interface LocalUser {
  id: number;
  name: string;
  created_at: string | null;
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

export interface SupabaseConfig {
  url: string;
  key: string;
  table_name: string;
  auto_sync: boolean;
}

export interface AppConfig {
  database_path: string;
  default_project: string | null;
  default_tags: string | null;
  billable_by_default: boolean;
  default_hourly_rate: number;
  supabase: SupabaseConfig;
  display: {
    date_format: string;
    show_billable_in_list: boolean;
    show_tags_in_list: boolean;
  };
  theme: string;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  errors: string[];
}
