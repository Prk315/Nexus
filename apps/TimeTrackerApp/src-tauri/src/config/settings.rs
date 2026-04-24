use crate::models::AppConfig;
use dirs::home_dir;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct ConfigState {
    pub config: Mutex<AppConfig>,
    pub path: PathBuf,
}

impl ConfigState {
    pub fn load() -> Self {
        let path = config_path();
        let config = read_config(&path);
        Self {
            config: Mutex::new(config),
            path,
        }
    }

    pub fn get(&self) -> AppConfig {
        self.config.lock().unwrap().clone()
    }

    pub fn set_key(&self, key: &str, value: serde_json::Value) -> Result<(), String> {
        let mut config = self.config.lock().unwrap();
        let mut json = serde_json::to_value(&*config).map_err(|e| e.to_string())?;

        // Dot-notation key support: "supabase.url"
        let parts: Vec<&str> = key.split('.').collect();
        let mut cursor = &mut json;
        for part in &parts[..parts.len() - 1] {
            cursor = cursor
                .as_object_mut()
                .and_then(|m| m.get_mut(*part))
                .ok_or_else(|| format!("Key not found: {part}"))?;
        }
        if let Some(obj) = cursor.as_object_mut() {
            obj.insert(parts.last().unwrap().to_string(), value);
        }

        *config = serde_json::from_value(json).map_err(|e| e.to_string())?;
        let serialized = serde_json::to_string_pretty(&*config).map_err(|e| e.to_string())?;
        fs::write(&self.path, serialized).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn db_path(&self) -> PathBuf {
        let cfg = self.config.lock().unwrap();
        let raw = &cfg.database_path;
        if raw == "timetracker.db" {
            // Default: resolve relative to ~/.timetracker/
            timetracker_dir().join("timetracker.db")
        } else {
            PathBuf::from(raw)
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let config = self.config.lock().unwrap();
        let serialized = serde_json::to_string_pretty(&*config).map_err(|e| e.to_string())?;
        fs::write(&self.path, serialized).map_err(|e| e.to_string())
    }
}

/// Root of the app's writable storage area.
///
/// On desktop this is `$HOME`. On iOS the container root is read-only —
/// the only paths an app may write to are subdirectories like `Documents/`,
/// `Library/`, or `tmp/` — so we anchor into `Documents/`.
fn writable_root() -> PathBuf {
    let home = home_dir().unwrap_or_else(|| PathBuf::from("."));
    if cfg!(target_os = "ios") {
        home.join("Documents")
    } else {
        home
    }
}

fn config_path() -> PathBuf {
    writable_root().join(".timetrackerrc")
}

pub fn timetracker_dir() -> PathBuf {
    let dir = writable_root().join(".timetracker");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn read_config(path: &PathBuf) -> AppConfig {
    if !path.exists() {
        return AppConfig::default();
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}
