use crate::models::BlockedSite;
use rusqlite::{Connection, Result};

pub fn get_all(conn: &Connection) -> Result<Vec<BlockedSite>> {
    let mut stmt =
        conn.prepare("SELECT id, domain, enabled FROM blocked_sites ORDER BY domain")?;
    let rows = stmt.query_map([], |row| {
        Ok(BlockedSite {
            id: row.get(0)?,
            domain: row.get(1)?,
            enabled: row.get::<_, i64>(2)? != 0,
        })
    })?;
    rows.collect()
}

pub fn add(conn: &Connection, domain: &str) -> Result<BlockedSite> {
    // Normalise: strip scheme and trailing slashes
    let domain = domain
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_lowercase();

    conn.execute(
        "INSERT OR IGNORE INTO blocked_sites (domain, enabled) VALUES (?1, 1)",
        rusqlite::params![domain],
    )?;
    let id = conn.last_insert_rowid();
    Ok(BlockedSite { id, domain, enabled: true })
}

pub fn remove(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM blocked_sites WHERE id = ?1", [id])?;
    Ok(())
}

pub fn set_enabled(conn: &Connection, id: i64, enabled: bool) -> Result<()> {
    conn.execute(
        "UPDATE blocked_sites SET enabled = ?1 WHERE id = ?2",
        rusqlite::params![enabled as i64, id],
    )?;
    Ok(())
}
