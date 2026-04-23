use crate::config::ConfigState;
use crate::models::AppConfig;
use tauri::State;

#[tauri::command]
pub fn get_config(config: State<'_, ConfigState>) -> Result<AppConfig, String> {
    Ok(config.get())
}

#[tauri::command]
pub fn set_config(
    config: State<'_, ConfigState>,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    config.set_key(&key, value)
}
