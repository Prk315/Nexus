use crate::models::Template;
use rusqlite::{params, Connection, Result};

pub fn get_all(conn: &Connection) -> Result<Vec<Template>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, task_name, project, tags, notes, billable, hourly_rate, created_at
         FROM templates ORDER BY name",
    )?;
    let templates = stmt
        .query_map([], |row| {
            Ok(Template {
                id: row.get(0)?,
                name: row.get(1)?,
                task_name: row.get(2)?,
                project: row.get(3)?,
                tags: row.get(4)?,
                notes: row.get(5)?,
                billable: row.get::<_, i64>(6)? != 0,
                hourly_rate: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(templates)
}

pub fn get_by_name(conn: &Connection, name: &str) -> Result<Option<Template>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, task_name, project, tags, notes, billable, hourly_rate, created_at
         FROM templates WHERE name = ?",
    )?;
    let result = stmt.query_row(params![name], |row| {
        Ok(Template {
            id: row.get(0)?,
            name: row.get(1)?,
            task_name: row.get(2)?,
            project: row.get(3)?,
            tags: row.get(4)?,
            notes: row.get(5)?,
            billable: row.get::<_, i64>(6)? != 0,
            hourly_rate: row.get(7)?,
            created_at: row.get(8)?,
        })
    });
    match result {
        Ok(t) => Ok(Some(t)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn save(
    conn: &Connection,
    name: &str,
    task_name: &str,
    project: Option<&str>,
    tags: Option<&str>,
    notes: Option<&str>,
    billable: bool,
    hourly_rate: f64,
) -> Result<bool, String> {
    if name.trim().is_empty() {
        return Err("Template name cannot be empty".into());
    }
    if task_name.trim().is_empty() {
        return Err("Task name cannot be empty".into());
    }
    conn.execute(
        "INSERT INTO templates (name, task_name, project, tags, notes, billable, hourly_rate)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![name, task_name, project, tags, notes, billable as i64, hourly_rate],
    )
    .map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn delete(conn: &Connection, name: &str) -> Result<bool, String> {
    let rows = conn
        .execute("DELETE FROM templates WHERE name = ?", params![name])
        .map_err(|e| e.to_string())?;
    Ok(rows > 0)
}
