use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TimeEntry {
    pub id: i64,
    pub task_name: String,
    pub project: Option<String>,
    pub start_time: String,
    pub end_time: Option<String>,
    pub duration_seconds: i64,
    pub tags: Option<String>,
    pub notes: Option<String>,
    pub billable: bool,
    pub hourly_rate: f64,
    pub synced: bool,
    pub user_id: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActiveSession {
    pub task_name: String,
    pub project: Option<String>,
    pub start_time: String,
    pub tags: Option<String>,
    pub notes: Option<String>,
    pub billable: bool,
    pub hourly_rate: f64,
    pub user_id: Option<String>,
    pub elapsed_seconds: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PausedSession {
    pub task_name: String,
    pub project: Option<String>,
    pub start_time: String,
    pub paused_at: String,
    pub elapsed_seconds: i64,
    pub tags: Option<String>,
    pub notes: Option<String>,
    pub billable: bool,
    pub hourly_rate: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TimerStatus {
    pub active: Option<ActiveSession>,
    pub paused: Option<PausedSession>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BlockedApp {
    pub id: i64,
    pub display_name: String,
    pub process_name: String,
    /// "always" | "focus_only"
    pub block_mode: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BlockedSite {
    pub id: i64,
    pub domain: String,
    pub enabled: bool,
}

/// A named time-window on the 24h schedule timeline.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FocusBlock {
    pub id: i64,
    pub name: String,
    /// "HH:MM" 24-hour local time
    pub start_time: String,
    /// "HH:MM" 24-hour local time
    pub end_time: String,
    /// Comma-separated ISO weekday numbers, e.g. "1,2,3,4,5" (Mon–Fri)
    pub days_of_week: String,
    /// CSS colour string, e.g. "#4f46e5"
    pub color: String,
    pub enabled: bool,
    /// Process names blocked while this window is active
    pub blocked_apps: Vec<String>,
    /// Domains blocked while this window is active
    pub blocked_sites: Vec<String>,
}

/// An app or website unlocked after N minutes of tracked time today.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TimeUnlockRule {
    pub id: i64,
    pub process_name: Option<String>,
    pub domain: Option<String>,
    pub required_minutes: i64,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InstalledApp {
    pub display_name: String,
    pub process_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Template {
    pub id: i64,
    pub name: String,
    pub task_name: String,
    pub project: Option<String>,
    pub tags: Option<String>,
    pub notes: Option<String>,
    pub billable: bool,
    pub hourly_rate: f64,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Goal {
    pub id: i64,
    pub project: Option<String>,
    pub target_hours: f64,
    pub period: String,
    pub start_date: String,
    pub end_date: String,
    pub active: bool,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoalProgress {
    pub goal: Goal,
    pub actual_hours: f64,
    pub target_hours: f64,
    pub progress_percent: f64,
    pub remaining_hours: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectStat {
    pub project: Option<String>,
    pub total: i64,
    pub count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TaskStat {
    pub task_name: String,
    pub total: i64,
    pub count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Statistics {
    pub total_seconds: i64,
    pub by_project: Vec<ProjectStat>,
    pub by_task: Vec<TaskStat>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalUser {
    pub id: i64,
    pub name: String,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SupabaseConfig {
    pub url: String,
    pub key: String,
    pub table_name: String,
    pub auto_sync: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DisplayConfig {
    pub date_format: String,
    pub show_billable_in_list: bool,
    pub show_tags_in_list: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    #[serde(default = "default_db_path")]
    pub database_path: String,
    #[serde(default)]
    pub default_project: Option<String>,
    #[serde(default)]
    pub default_tags: Option<String>,
    #[serde(default)]
    pub billable_by_default: bool,
    #[serde(default)]
    pub default_hourly_rate: f64,
    #[serde(default)]
    pub supabase: SupabaseConfig,
    #[serde(default = "default_display")]
    pub display: DisplayConfig,
    #[serde(default = "default_theme")]
    pub theme: String,
}

fn default_db_path() -> String {
    "timetracker.db".to_string()
}

fn default_theme() -> String {
    "system".to_string()
}

fn default_display() -> DisplayConfig {
    DisplayConfig {
        date_format: "%Y-%m-%d %H:%M:%S".to_string(),
        show_billable_in_list: true,
        show_tags_in_list: true,
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            database_path: default_db_path(),
            default_project: None,
            default_tags: None,
            billable_by_default: false,
            default_hourly_rate: 0.0,
            supabase: SupabaseConfig {
                url: "https://efxmzsdisaymtpebaxlp.supabase.co".to_string(),
                key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmeG16c2Rpc2F5bXRwZWJheGxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NDM1NjksImV4cCI6MjA5MjAxOTU2OX0.ebOsEwVB2HXC-EV0n6ZhIKTeJML25ddMpvcZshrIQvs".to_string(),
                table_name: "time_entries".to_string(),
                auto_sync: true,
            },
            display: default_display(),
            theme: default_theme(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncResult {
    pub pushed: usize,
    pub pulled: usize,
    pub errors: Vec<String>,
}
