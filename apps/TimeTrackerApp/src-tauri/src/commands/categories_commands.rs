use crate::config::settings::timetracker_dir;
use std::fs;

#[tauri::command]
pub fn get_categories() -> Result<serde_json::Value, String> {
    let path = timetracker_dir().join("categories.json");
    if !path.exists() {
        // Try legacy location next to the binary
        let legacy = std::env::current_dir()
            .unwrap_or_default()
            .join("categories.json");
        if legacy.exists() {
            let s = fs::read_to_string(&legacy).map_err(|e| e.to_string())?;
            return serde_json::from_str(&s).map_err(|e| e.to_string());
        }
        return Ok(serde_json::json!({}));
    }
    let s = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&s).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_categories(categories: serde_json::Value) -> Result<(), String> {
    let path = timetracker_dir().join("categories.json");
    let s = serde_json::to_string_pretty(&categories).map_err(|e| e.to_string())?;
    fs::write(&path, s).map_err(|e| e.to_string())
}
