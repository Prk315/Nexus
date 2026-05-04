mod garmin;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            garmin::garmin_run,
            garmin::garmin_auth,
            garmin::garmin_bridge_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
