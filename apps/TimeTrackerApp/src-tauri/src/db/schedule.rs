use crate::models::{FocusBlock, TimeUnlockRule};
use rusqlite::{params, Connection, Result};

// ── Focus schedule blocks ─────────────────────────────────────────────────────

pub fn get_all_blocks(conn: &Connection) -> Result<Vec<FocusBlock>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, start_time, end_time, days_of_week, color, enabled
         FROM focus_schedule_blocks ORDER BY start_time",
    )?;

    let mut blocks: Vec<FocusBlock> = stmt
        .query_map([], |row| {
            Ok(FocusBlock {
                id: row.get(0)?,
                name: row.get(1)?,
                start_time: row.get(2)?,
                end_time: row.get(3)?,
                days_of_week: row.get(4)?,
                color: row.get(5)?,
                enabled: row.get::<_, i64>(6)? != 0,
                blocked_apps: vec![],
                blocked_sites: vec![],
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    for block in &mut blocks {
        block.blocked_apps = conn
            .prepare("SELECT process_name FROM schedule_block_apps WHERE block_id = ?1")?
            .query_map([block.id], |row| row.get(0))?
            .collect::<Result<Vec<_>>>()?;
        block.blocked_sites = conn
            .prepare("SELECT domain FROM schedule_block_sites WHERE block_id = ?1")?
            .query_map([block.id], |row| row.get(0))?
            .collect::<Result<Vec<_>>>()?;
    }

    Ok(blocks)
}

pub fn add_block(
    conn: &Connection,
    name: &str,
    start_time: &str,
    end_time: &str,
    days_of_week: &str,
    color: &str,
) -> Result<FocusBlock> {
    conn.execute(
        "INSERT INTO focus_schedule_blocks (name, start_time, end_time, days_of_week, color, enabled)
         VALUES (?1, ?2, ?3, ?4, ?5, 1)",
        params![name, start_time, end_time, days_of_week, color],
    )?;
    let id = conn.last_insert_rowid();
    Ok(FocusBlock {
        id,
        name: name.to_owned(),
        start_time: start_time.to_owned(),
        end_time: end_time.to_owned(),
        days_of_week: days_of_week.to_owned(),
        color: color.to_owned(),
        enabled: true,
        blocked_apps: vec![],
        blocked_sites: vec![],
    })
}

pub fn update_block(
    conn: &Connection,
    id: i64,
    name: &str,
    start_time: &str,
    end_time: &str,
    days_of_week: &str,
    color: &str,
    enabled: bool,
    blocked_apps: &[String],
    blocked_sites: &[String],
) -> Result<()> {
    conn.execute(
        "UPDATE focus_schedule_blocks
         SET name=?1, start_time=?2, end_time=?3, days_of_week=?4, color=?5, enabled=?6
         WHERE id=?7",
        params![name, start_time, end_time, days_of_week, color, enabled as i64, id],
    )?;

    conn.execute("DELETE FROM schedule_block_apps WHERE block_id = ?1", [id])?;
    for app in blocked_apps {
        conn.execute(
            "INSERT OR IGNORE INTO schedule_block_apps (block_id, process_name) VALUES (?1, ?2)",
            params![id, app],
        )?;
    }

    conn.execute("DELETE FROM schedule_block_sites WHERE block_id = ?1", [id])?;
    for site in blocked_sites {
        conn.execute(
            "INSERT OR IGNORE INTO schedule_block_sites (block_id, domain) VALUES (?1, ?2)",
            params![id, site],
        )?;
    }

    Ok(())
}

pub fn remove_block(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM focus_schedule_blocks WHERE id = ?1", [id])?;
    Ok(())
}

// ── Time-unlock rules ─────────────────────────────────────────────────────────

pub fn get_all_unlock_rules(conn: &Connection) -> Result<Vec<TimeUnlockRule>> {
    conn.prepare(
        "SELECT id, process_name, domain, required_minutes, enabled
         FROM time_unlock_rules ORDER BY id",
    )?
    .query_map([], |row| {
        Ok(TimeUnlockRule {
            id: row.get(0)?,
            process_name: row.get(1)?,
            domain: row.get(2)?,
            required_minutes: row.get(3)?,
            enabled: row.get::<_, i64>(4)? != 0,
        })
    })?
    .collect()
}

pub fn add_unlock_rule(
    conn: &Connection,
    process_name: Option<&str>,
    domain: Option<&str>,
    required_minutes: i64,
) -> Result<TimeUnlockRule> {
    conn.execute(
        "INSERT INTO time_unlock_rules (process_name, domain, required_minutes, enabled)
         VALUES (?1, ?2, ?3, 1)",
        params![process_name, domain, required_minutes],
    )?;
    let id = conn.last_insert_rowid();
    Ok(TimeUnlockRule {
        id,
        process_name: process_name.map(|s| s.to_owned()),
        domain: domain.map(|s| s.to_owned()),
        required_minutes,
        enabled: true,
    })
}

pub fn remove_unlock_rule(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM time_unlock_rules WHERE id = ?1", [id])?;
    Ok(())
}

// ── Helpers used by the blocker daemon ───────────────────────────────────────

/// Returns total minutes logged today from completed entries.
pub fn tracked_minutes_today(conn: &Connection) -> Result<i64> {
    conn.query_row(
        "SELECT COALESCE(SUM(duration_seconds), 0) / 60
         FROM time_entries
         WHERE date(start_time) = date('now', 'localtime')
           AND end_time IS NOT NULL",
        [],
        |row| row.get(0),
    )
}
