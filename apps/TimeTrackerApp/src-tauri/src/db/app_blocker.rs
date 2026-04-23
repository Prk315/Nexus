use crate::models::BlockedApp;
use rusqlite::{Connection, Result};

pub fn get_all(conn: &Connection) -> Result<Vec<BlockedApp>> {
    let mut stmt = conn.prepare(
        "SELECT id, display_name, process_name, block_mode, enabled FROM blocked_apps ORDER BY display_name",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(BlockedApp {
            id: row.get(0)?,
            display_name: row.get(1)?,
            process_name: row.get(2)?,
            block_mode: row.get(3)?,
            enabled: row.get::<_, i64>(4)? != 0,
        })
    })?;
    rows.collect()
}

pub fn add(
    conn: &Connection,
    display_name: &str,
    process_name: &str,
    block_mode: &str,
) -> Result<BlockedApp> {
    conn.execute(
        "INSERT OR REPLACE INTO blocked_apps (display_name, process_name, block_mode, enabled)
         VALUES (?1, ?2, ?3, 1)",
        rusqlite::params![display_name, process_name, block_mode],
    )?;
    let id = conn.last_insert_rowid();
    Ok(BlockedApp {
        id,
        display_name: display_name.to_owned(),
        process_name: process_name.to_owned(),
        block_mode: block_mode.to_owned(),
        enabled: true,
    })
}

pub fn remove(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM blocked_apps WHERE id = ?1", [id])?;
    Ok(())
}

pub fn set_enabled(conn: &Connection, id: i64, enabled: bool) -> Result<()> {
    conn.execute(
        "UPDATE blocked_apps SET enabled = ?1 WHERE id = ?2",
        rusqlite::params![enabled as i64, id],
    )?;
    Ok(())
}

pub fn is_blocker_on(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT enabled FROM blocker_settings WHERE id = 1",
        [],
        |row| row.get::<_, i64>(0),
    )
    .map(|v| v != 0)
    .unwrap_or(false)
}

pub fn set_blocker_on(conn: &Connection, enabled: bool) -> Result<()> {
    conn.execute(
        "UPDATE blocker_settings SET enabled = ?1 WHERE id = 1",
        [enabled as i64],
    )?;
    Ok(())
}
