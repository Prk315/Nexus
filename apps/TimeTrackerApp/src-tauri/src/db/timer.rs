use crate::models::{ActiveSession, PausedSession, TimerStatus};
use chrono::{DateTime, Local};
use rusqlite::{params, Connection, Result};

pub fn get_status(conn: &Connection) -> Result<TimerStatus> {
    let active = get_active(conn)?;
    let paused = get_paused(conn)?;
    Ok(TimerStatus { active, paused })
}

pub fn get_active(conn: &Connection) -> Result<Option<ActiveSession>> {
    let mut stmt = conn.prepare(
        "SELECT task_name, project, start_time, tags, notes, billable, hourly_rate, user_id
         FROM active_session WHERE id = 1",
    )?;
    let result = stmt.query_row([], |row| {
        let start_time: String = row.get(2)?;
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            start_time.clone(),
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, f64>(6)?,
            row.get::<_, Option<String>>(7)?,
        ))
    });

    match result {
        Ok((task_name, project, start_time, tags, notes, billable, hourly_rate, user_id)) => {
            let elapsed = elapsed_since(&start_time);
            Ok(Some(ActiveSession {
                task_name,
                project,
                start_time,
                tags,
                notes,
                billable: billable != 0,
                hourly_rate,
                user_id,
                elapsed_seconds: elapsed,
            }))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn get_paused(conn: &Connection) -> Result<Option<PausedSession>> {
    let mut stmt = conn.prepare(
        "SELECT task_name, project, start_time, paused_at, elapsed_seconds,
                tags, notes, billable, hourly_rate
         FROM paused_sessions WHERE id = 1",
    )?;
    let result = stmt.query_row([], |row| {
        Ok(PausedSession {
            task_name: row.get(0)?,
            project: row.get(1)?,
            start_time: row.get(2)?,
            paused_at: row.get(3)?,
            elapsed_seconds: row.get(4)?,
            tags: row.get(5)?,
            notes: row.get(6)?,
            billable: row.get::<_, i64>(7)? != 0,
            hourly_rate: row.get(8)?,
        })
    });

    match result {
        Ok(s) => Ok(Some(s)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn start_timer(
    conn: &Connection,
    task_name: &str,
    project: Option<&str>,
    tags: Option<&str>,
    notes: Option<&str>,
    billable: bool,
    hourly_rate: f64,
    user_id: Option<&str>,
) -> Result<(), String> {
    if task_name.trim().is_empty() {
        return Err("Task name cannot be empty".into());
    }

    // Check for existing active session
    let active_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM active_session", [], |r| r.get(0))
        .unwrap_or(0);
    if active_count > 0 {
        return Err("A session is already running".into());
    }

    // Check for paused session
    let paused_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM paused_sessions", [], |r| r.get(0))
        .unwrap_or(0);
    if paused_count > 0 {
        return Err("There is a paused session. Resume or cancel it first.".into());
    }

    let now = Local::now().format("%Y-%m-%dT%H:%M:%S%.3f").to_string();
    conn.execute(
        "INSERT INTO active_session (id, task_name, project, start_time, tags, notes, billable, hourly_rate, user_id)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            task_name,
            project,
            now,
            tags,
            notes,
            billable as i64,
            hourly_rate,
            user_id
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn stop_timer(conn: &Connection) -> Result<crate::models::TimeEntry, String> {
    let session = get_active(conn)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No active session".to_string())?;

    let now = Local::now().format("%Y-%m-%dT%H:%M:%S%.3f").to_string();
    let start = parse_dt(&session.start_time);
    let end = parse_dt(&now);
    let duration = (end - start).num_seconds().max(0);

    conn.execute(
        "INSERT INTO time_entries
            (task_name, project, start_time, end_time, duration_seconds,
             tags, notes, billable, hourly_rate, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            session.task_name,
            session.project,
            session.start_time,
            now,
            duration,
            session.tags,
            session.notes,
            session.billable as i64,
            session.hourly_rate,
            session.user_id
        ],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    conn.execute("DELETE FROM active_session WHERE id = 1", [])
        .map_err(|e| e.to_string())?;

    Ok(crate::models::TimeEntry {
        id,
        task_name: session.task_name,
        project: session.project,
        start_time: session.start_time,
        end_time: Some(now),
        duration_seconds: duration,
        tags: session.tags,
        notes: session.notes,
        billable: session.billable,
        hourly_rate: session.hourly_rate,
        synced: false,
        user_id: session.user_id,
        created_at: None,
    })
}

pub fn pause_timer(conn: &Connection) -> Result<PausedSession, String> {
    let session = get_active(conn)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No active session".to_string())?;

    let now = Local::now().format("%Y-%m-%dT%H:%M:%S%.3f").to_string();
    let elapsed = session.elapsed_seconds;

    conn.execute(
        "INSERT INTO paused_sessions
            (id, task_name, project, start_time, paused_at, elapsed_seconds,
             tags, notes, billable, hourly_rate)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            session.task_name,
            session.project,
            session.start_time,
            now,
            elapsed,
            session.tags,
            session.notes,
            session.billable as i64,
            session.hourly_rate
        ],
    )
    .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM active_session WHERE id = 1", [])
        .map_err(|e| e.to_string())?;

    Ok(PausedSession {
        task_name: session.task_name,
        project: session.project,
        start_time: session.start_time,
        paused_at: now,
        elapsed_seconds: elapsed,
        tags: session.tags,
        notes: session.notes,
        billable: session.billable,
        hourly_rate: session.hourly_rate,
    })
}

pub fn resume_timer(conn: &Connection) -> Result<ActiveSession, String> {
    let active_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM active_session", [], |r| r.get(0))
        .unwrap_or(0);
    if active_count > 0 {
        return Err("A session is already running".into());
    }

    let paused = get_paused(conn)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No paused session".to_string())?;

    // New start time adjusted to account for elapsed seconds already tracked
    let now = Local::now();
    let new_start = now - chrono::Duration::seconds(paused.elapsed_seconds);
    let new_start_str = new_start.format("%Y-%m-%dT%H:%M:%S%.3f").to_string();

    conn.execute(
        "INSERT INTO active_session
            (id, task_name, project, start_time, tags, notes, billable, hourly_rate)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            paused.task_name,
            paused.project,
            new_start_str,
            paused.tags,
            paused.notes,
            paused.billable as i64,
            paused.hourly_rate
        ],
    )
    .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM paused_sessions WHERE id = 1", [])
        .map_err(|e| e.to_string())?;

    Ok(ActiveSession {
        task_name: paused.task_name,
        project: paused.project,
        start_time: new_start_str,
        tags: paused.tags,
        notes: paused.notes,
        billable: paused.billable,
        hourly_rate: paused.hourly_rate,
        user_id: None,
        elapsed_seconds: paused.elapsed_seconds,
    })
}

pub fn cancel_paused(conn: &Connection) -> Result<bool, String> {
    let rows = conn
        .execute("DELETE FROM paused_sessions WHERE id = 1", [])
        .map_err(|e| e.to_string())?;
    Ok(rows > 0)
}

/// Adopt a remote active session into the local DB.
/// Used by the poll command when the local device is idle but another
/// device has a running session.
pub fn adopt_remote_session(
    conn: &Connection,
    task_name: &str,
    project: Option<&str>,
    tags: Option<&str>,
    notes: Option<&str>,
    billable: bool,
    hourly_rate: f64,
    start_time: &str,
    user_id: Option<&str>,
) -> Result<(), String> {
    // Clear any stale local session first
    let _ = conn.execute("DELETE FROM active_session WHERE id = 1", []);
    let _ = conn.execute("DELETE FROM paused_sessions WHERE id = 1", []);

    conn.execute(
        "INSERT INTO active_session
            (id, task_name, project, start_time, tags, notes, billable, hourly_rate, user_id)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            task_name,
            project,
            start_time,
            tags,
            notes,
            billable as i64,
            hourly_rate,
            user_id,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn elapsed_since(start_time: &str) -> i64 {
    parse_dt(start_time)
        .signed_duration_since(parse_dt(&Local::now().format("%Y-%m-%dT%H:%M:%S%.3f").to_string()))
        .num_seconds()
        .abs()
}

fn parse_dt(s: &str) -> DateTime<Local> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Local))
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.3f")
                .map(|ndt| ndt.and_local_timezone(Local).unwrap())
        })
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S")
                .map(|ndt| ndt.and_local_timezone(Local).unwrap())
        })
        .unwrap_or_else(|_| Local::now())
}
