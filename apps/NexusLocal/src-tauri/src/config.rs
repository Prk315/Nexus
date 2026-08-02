use dirs::home_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Supabase connection — the always-on backbone the grid coordinates through.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SupabaseConfig {
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub key: String,
}

/// On-disk config for the local node. Mirrors the convention used by the other
/// ecosystem apps (`~/.timetrackerrc` etc.): a JSON file in the writable root,
/// with the shared NEXUS Supabase credentials backfilled if absent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default = "default_user_id")]
    pub user_id: String,
    #[serde(default)]
    pub supabase: SupabaseConfig,
    /// Seconds between command-queue polls / presence heartbeats.
    #[serde(default = "default_poll_secs")]
    pub poll_secs: u64,
    /// Master switch for autonomous site-blocking enforcement (the blocking
    /// module's tick). Off by default so the node never edits /etc/hosts —
    /// which needs an admin prompt — unless the user opts in. Explicit
    /// apply/clear commands still work regardless.
    #[serde(default)]
    pub blocking_enabled: bool,
}

fn default_user_id() -> String {
    "default".to_string()
}

fn default_poll_secs() -> u64 {
    10
}

// Shared NEXUS project — same values the desktop apps ship with. Swapped for
// auth.uid()-scoped credentials once ecosystem auth is wired into the node.
const DEFAULT_SUPABASE_URL: &str = "https://efxmzsdisaymtpebaxlp.supabase.co";
const DEFAULT_SUPABASE_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmeG16c2Rpc2F5bXRwZWJheGxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NDM1NjksImV4cCI6MjA5MjAxOTU2OX0.ebOsEwVB2HXC-EV0n6ZhIKTeJML25ddMpvcZshrIQvs";

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            user_id: default_user_id(),
            supabase: SupabaseConfig {
                url: DEFAULT_SUPABASE_URL.to_string(),
                key: DEFAULT_SUPABASE_KEY.to_string(),
            },
            poll_secs: default_poll_secs(),
            blocking_enabled: false,
        }
    }
}

impl AppConfig {
    pub fn load() -> Self {
        let path = config_path();
        let mut config: AppConfig = if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            AppConfig::default()
        };

        // Backfill Supabase credentials if missing (migrates partial configs).
        let defaults = AppConfig::default();
        if config.supabase.url.is_empty() {
            config.supabase.url = defaults.supabase.url;
        }
        if config.supabase.key.is_empty() {
            config.supabase.key = defaults.supabase.key;
        }

        // Persist so the file exists and is editable by the user.
        if let Ok(serialized) = serde_json::to_string_pretty(&config) {
            let _ = fs::write(&path, serialized);
        }
        config
    }
}

/// Root of writable storage. `$HOME` on desktop; `$HOME/Documents` on iOS,
/// where the container root is read-only (see the ecosystem iOS notes).
fn writable_root() -> PathBuf {
    let home = home_dir().unwrap_or_else(|| PathBuf::from("."));
    if cfg!(target_os = "ios") {
        home.join("Documents")
    } else {
        home
    }
}

fn config_path() -> PathBuf {
    writable_root().join(".nexuslocalrc")
}

/// Directory the node uses for its own state (device id, module data).
pub fn state_dir() -> PathBuf {
    let dir = writable_root().join(".nexuslocal");
    let _ = fs::create_dir_all(&dir);
    dir
}
