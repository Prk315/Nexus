use crate::db::{entries, AppState};
use crate::models::ImportResult;
use std::fs;
use tauri::State;

#[tauri::command]
pub fn export_csv(
    state: State<'_, AppState>,
    output_path: String,
    project: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<usize, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let items = entries::get_entries(
        &db,
        None,
        project.as_deref(),
        start_date.as_deref(),
        end_date.as_deref(),
        None,
        None,
    )
    .map_err(|e| e.to_string())?;

    let count = items.len();
    let mut csv = String::from(
        "id,task_name,project,start_time,end_time,duration_seconds,tags,notes,billable,hourly_rate\n",
    );
    for e in &items {
        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{}\n",
            e.id,
            csv_field(&e.task_name),
            csv_field(e.project.as_deref().unwrap_or("")),
            e.start_time,
            e.end_time.as_deref().unwrap_or(""),
            e.duration_seconds,
            csv_field(e.tags.as_deref().unwrap_or("")),
            csv_field(e.notes.as_deref().unwrap_or("")),
            e.billable as u8,
            e.hourly_rate,
        ));
    }
    fs::write(&output_path, csv).map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
pub fn export_json_entries(
    state: State<'_, AppState>,
    output_path: String,
    project: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<usize, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let items = entries::get_entries(
        &db,
        None,
        project.as_deref(),
        start_date.as_deref(),
        end_date.as_deref(),
        None,
        None,
    )
    .map_err(|e| e.to_string())?;

    let count = items.len();
    let json = serde_json::to_string_pretty(&items).map_err(|e| e.to_string())?;
    fs::write(&output_path, json).map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
pub fn import_json_entries(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<ImportResult, String> {
    let raw = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let items: Vec<crate::models::TimeEntry> =
        serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut imported = 0usize;
    let mut skipped = 0usize;
    for entry in &items {
        match entries::import_entry(&db, entry) {
            Ok(Some(_)) => imported += 1,
            _ => skipped += 1,
        }
    }
    Ok(ImportResult { imported, skipped })
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn csv_field(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}
