mod db;

use db::DbState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir).expect("failed to create app data dir");
            let db_path = data_dir.join("stonks.db");
            let conn =
                rusqlite::Connection::open(&db_path).expect("failed to open SQLite database");
            db::init_db(&conn).expect("failed to initialise database schema");
            app.manage(DbState(std::sync::Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::db_load_workbook,
            db::db_save_cell,
            db::db_delete_cell,
            db::db_add_sheet,
            db::db_delete_sheet,
            db::db_rename_sheet,
            db::db_set_col_width,
            db::db_set_row_height,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
