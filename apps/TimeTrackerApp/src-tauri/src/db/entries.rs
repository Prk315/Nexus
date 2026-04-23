use crate::models::TimeEntry;
use rusqlite::{params, Connection, Result};

pub fn get_entries(
    conn: &Connection,
    limit: Option<i64>,
    project: Option<&str>,
    start_date: Option<&str>,
    end_date: Option<&str>,
    tags: Option<&str>,
    user_id: Option<&str>,
) -> Result<Vec<TimeEntry>> {
    let mut query = "SELECT id, task_name, project, start_time, end_time, duration_seconds,
                            tags, notes, billable, hourly_rate, synced, user_id, created_at
                     FROM time_entries WHERE 1=1"
        .to_string();
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = vec![];

    if let Some(p) = project {
        query.push_str(" AND project = ?");
        values.push(Box::new(p.to_string()));
    }
    if let Some(s) = start_date {
        query.push_str(" AND date(start_time) >= ?");
        values.push(Box::new(s.to_string()));
    }
    if let Some(e) = end_date {
        query.push_str(" AND date(start_time) <= ?");
        values.push(Box::new(e.to_string()));
    }
    if let Some(u) = user_id {
        query.push_str(" AND user_id = ?");
        values.push(Box::new(u.to_string()));
    }

    query.push_str(" ORDER BY start_time DESC");

    if let Some(l) = limit {
        query.push_str(&format!(" LIMIT {l}"));
    }

    let params_refs: Vec<&dyn rusqlite::ToSql> = values.iter().map(|v| v.as_ref()).collect();
    let mut stmt = conn.prepare(&query)?;
    let mut entries: Vec<TimeEntry> = stmt
        .query_map(params_refs.as_slice(), row_to_entry)?
        .filter_map(|r| r.ok())
        .collect();

    // Tag filter (done in-process to match Python behaviour)
    if let Some(tag_filter) = tags {
        let wanted: Vec<String> = tag_filter
            .split(',')
            .map(|t| t.trim().to_lowercase())
            .collect();
        entries.retain(|e| {
            e.tags.as_deref().map_or(false, |t| {
                t.split(',')
                    .any(|et| wanted.contains(&et.trim().to_lowercase()))
            })
        });
    }

    Ok(entries)
}

pub fn edit_entry(
    conn: &Connection,
    entry_id: i64,
    task_name: Option<&str>,
    project: Option<&str>,
    tags: Option<&str>,
    notes: Option<&str>,
    billable: Option<bool>,
    hourly_rate: Option<f64>,
) -> Result<bool, String> {
    // Verify exists
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM time_entries WHERE id = ?",
            params![entry_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count == 0 {
        return Ok(false);
    }

    let mut parts: Vec<String> = vec![];
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = vec![];

    if let Some(v) = task_name {
        parts.push("task_name = ?".into());
        values.push(Box::new(v.to_string()));
    }
    if let Some(v) = project {
        parts.push("project = ?".into());
        values.push(Box::new(v.to_string()));
    }
    if let Some(v) = tags {
        parts.push("tags = ?".into());
        values.push(Box::new(v.to_string()));
    }
    if let Some(v) = notes {
        parts.push("notes = ?".into());
        values.push(Box::new(v.to_string()));
    }
    if let Some(v) = billable {
        parts.push("billable = ?".into());
        values.push(Box::new(v as i64));
    }
    if let Some(v) = hourly_rate {
        parts.push("hourly_rate = ?".into());
        values.push(Box::new(v));
    }

    if parts.is_empty() {
        return Ok(false);
    }

    values.push(Box::new(entry_id));
    let sql = format!(
        "UPDATE time_entries SET {} WHERE id = ?",
        parts.join(", ")
    );
    let params_refs: Vec<&dyn rusqlite::ToSql> = values.iter().map(|v| v.as_ref()).collect();
    conn.execute(&sql, params_refs.as_slice())
        .map_err(|e| e.to_string())?;

    Ok(true)
}

pub fn delete_entry(conn: &Connection, entry_id: i64) -> Result<bool, String> {
    let rows = conn
        .execute(
            "DELETE FROM time_entries WHERE id = ?",
            params![entry_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(rows > 0)
}

pub fn get_all_projects(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT project FROM time_entries
         WHERE project IS NOT NULL AND project != ''
         ORDER BY project",
    )?;
    let projects = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(projects)
}

pub fn mark_as_synced(conn: &Connection, entry_id: i64) -> Result<bool> {
    let rows = conn.execute(
        "UPDATE time_entries SET synced = 1 WHERE id = ?",
        params![entry_id],
    )?;
    Ok(rows > 0)
}

pub fn get_unsynced_entries(conn: &Connection) -> Result<Vec<TimeEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_name, project, start_time, end_time, duration_seconds,
                tags, notes, billable, hourly_rate, synced, user_id, created_at
         FROM time_entries WHERE synced = 0 ORDER BY start_time",
    )?;
    let entries = stmt
        .query_map([], row_to_entry)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

pub fn import_entry(conn: &Connection, entry: &crate::models::TimeEntry) -> Result<Option<i64>> {
    let result = conn.execute(
        "INSERT INTO time_entries
            (task_name, project, start_time, end_time, duration_seconds,
             tags, notes, billable, hourly_rate)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            entry.task_name,
            entry.project,
            entry.start_time,
            entry.end_time,
            entry.duration_seconds,
            entry.tags,
            entry.notes,
            entry.billable as i64,
            entry.hourly_rate
        ],
    );
    match result {
        Ok(_) => Ok(Some(conn.last_insert_rowid())),
        Err(_) => Ok(None),
    }
}

// ── helper ───────────────────────────────────────────────────────────────────

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<TimeEntry> {
    Ok(TimeEntry {
        id: row.get(0)?,
        task_name: row.get(1)?,
        project: row.get(2)?,
        start_time: row.get(3)?,
        end_time: row.get(4)?,
        duration_seconds: row.get::<_, Option<i64>>(5)?.unwrap_or(0),
        tags: row.get(6)?,
        notes: row.get(7)?,
        billable: row.get::<_, i64>(8)? != 0,
        hourly_rate: row.get::<_, f64>(9)?,
        synced: row.get::<_, i64>(10)? != 0,
        user_id: row.get(11)?,
        created_at: row.get(12)?,
    })
}
