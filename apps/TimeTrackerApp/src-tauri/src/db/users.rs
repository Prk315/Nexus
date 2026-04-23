use crate::models::LocalUser;
use rusqlite::{params, Connection, Result};

pub fn get_all(conn: &Connection) -> Result<Vec<LocalUser>> {
    let mut stmt =
        conn.prepare("SELECT id, name, created_at FROM local_users ORDER BY name")?;
    let users = stmt
        .query_map([], |row| {
            Ok(LocalUser {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(users)
}

pub fn create(conn: &Connection, name: &str) -> Result<Option<i64>> {
    match conn.execute("INSERT INTO local_users (name) VALUES (?)", params![name]) {
        Ok(_) => Ok(Some(conn.last_insert_rowid())),
        Err(rusqlite::Error::SqliteFailure(e, _))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            Ok(None)
        }
        Err(e) => Err(e),
    }
}

pub fn get_by_name(conn: &Connection, name: &str) -> Result<Option<LocalUser>> {
    let result = conn.query_row(
        "SELECT id, name, created_at FROM local_users WHERE name = ?",
        params![name],
        |row| {
            Ok(LocalUser {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        },
    );
    match result {
        Ok(u) => Ok(Some(u)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}
