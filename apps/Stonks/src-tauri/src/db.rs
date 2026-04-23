use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

// ─── Types ───────────────────────────────────────────────────────────────────

pub struct DbState(pub Mutex<Connection>);

#[derive(Debug, Serialize, Deserialize)]
pub struct CellRow {
    pub cell_key: String,
    pub value: String,
    pub format: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SheetData {
    pub id: String,
    pub name: String,
    pub position: i64,
    pub cells: Vec<CellRow>,
    pub col_widths: Vec<(i64, i64)>,
    pub row_heights: Vec<(i64, i64)>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkbookData {
    pub sheets: Vec<SheetData>,
}

// ─── Init ─────────────────────────────────────────────────────────────────────

pub fn init_db(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS workbooks (
             id          TEXT PRIMARY KEY,
             name        TEXT NOT NULL,
             created_at  INTEGER NOT NULL,
             updated_at  INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS sheets (
             id          TEXT PRIMARY KEY,
             workbook_id TEXT NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,
             name        TEXT NOT NULL,
             position    INTEGER NOT NULL,
             created_at  INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS cells (
             sheet_id    TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
             cell_key    TEXT NOT NULL,
             value       TEXT NOT NULL,
             format      TEXT,
             PRIMARY KEY (sheet_id, cell_key)
         );
         CREATE TABLE IF NOT EXISTS col_sizes (
             sheet_id    TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
             col_index   INTEGER NOT NULL,
             width_px    INTEGER NOT NULL,
             PRIMARY KEY (sheet_id, col_index)
         );
         CREATE TABLE IF NOT EXISTS row_sizes (
             sheet_id    TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
             row_index   INTEGER NOT NULL,
             height_px   INTEGER NOT NULL,
             PRIMARY KEY (sheet_id, row_index)
         );",
    )?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    conn.execute(
        "INSERT OR IGNORE INTO workbooks (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params!["default", "Stonks", now],
    )?;

    Ok(())
}

// ─── Internal helpers ────────────────────────────────────────────────────────

fn load_cells(conn: &Connection, sheet_id: &str) -> SqlResult<Vec<CellRow>> {
    let mut stmt =
        conn.prepare("SELECT cell_key, value, format FROM cells WHERE sheet_id = ?1")?;
    let rows = stmt
        .query_map(params![sheet_id], |row| {
            Ok(CellRow {
                cell_key: row.get(0)?,
                value: row.get(1)?,
                format: row.get(2)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

fn load_col_widths(conn: &Connection, sheet_id: &str) -> SqlResult<Vec<(i64, i64)>> {
    let mut stmt =
        conn.prepare("SELECT col_index, width_px FROM col_sizes WHERE sheet_id = ?1")?;
    let rows = stmt
        .query_map(params![sheet_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

fn load_row_heights(conn: &Connection, sheet_id: &str) -> SqlResult<Vec<(i64, i64)>> {
    let mut stmt =
        conn.prepare("SELECT row_index, height_px FROM row_sizes WHERE sheet_id = ?1")?;
    let rows = stmt
        .query_map(params![sheet_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_load_workbook(state: tauri::State<'_, DbState>) -> Result<WorkbookData, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, position FROM sheets WHERE workbook_id = 'default' ORDER BY position",
        )
        .map_err(|e| e.to_string())?;

    let sheets: Vec<SheetData> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .map(|(id, name, position)| {
            let cells = load_cells(&conn, &id).unwrap_or_default();
            let col_widths = load_col_widths(&conn, &id).unwrap_or_default();
            let row_heights = load_row_heights(&conn, &id).unwrap_or_default();
            SheetData { id, name, position, cells, col_widths, row_heights }
        })
        .collect();

    Ok(WorkbookData { sheets })
}

#[tauri::command]
pub fn db_save_cell(
    state: tauri::State<'_, DbState>,
    sheet_id: String,
    cell_key: String,
    value: String,
    format: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO cells (sheet_id, cell_key, value, format) VALUES (?1, ?2, ?3, ?4)",
        params![sheet_id, cell_key, value, format],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_delete_cell(
    state: tauri::State<'_, DbState>,
    sheet_id: String,
    cell_key: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM cells WHERE sheet_id = ?1 AND cell_key = ?2",
        params![sheet_id, cell_key],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_add_sheet(
    state: tauri::State<'_, DbState>,
    id: String,
    name: String,
    position: i64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    conn.execute(
        "INSERT OR REPLACE INTO sheets (id, workbook_id, name, position, created_at) VALUES (?1, 'default', ?2, ?3, ?4)",
        params![id, name, position, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_delete_sheet(
    state: tauri::State<'_, DbState>,
    sheet_id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sheets WHERE id = ?1", params![sheet_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_rename_sheet(
    state: tauri::State<'_, DbState>,
    sheet_id: String,
    name: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE sheets SET name = ?2 WHERE id = ?1",
        params![sheet_id, name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_set_col_width(
    state: tauri::State<'_, DbState>,
    sheet_id: String,
    col_index: i64,
    width_px: i64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO col_sizes (sheet_id, col_index, width_px) VALUES (?1, ?2, ?3)",
        params![sheet_id, col_index, width_px],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_set_row_height(
    state: tauri::State<'_, DbState>,
    sheet_id: String,
    row_index: i64,
    height_px: i64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO row_sizes (sheet_id, row_index, height_px) VALUES (?1, ?2, ?3)",
        params![sheet_id, row_index, height_px],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
