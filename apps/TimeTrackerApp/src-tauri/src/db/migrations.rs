use rusqlite::{Connection, Result};

pub fn run(conn: &Connection) -> Result<()> {
    // Create tables if they don't exist (same schema as Python)
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS time_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_name TEXT NOT NULL,
            project TEXT,
            start_time TEXT NOT NULL,
            end_time TEXT,
            duration_seconds INTEGER,
            tags TEXT,
            notes TEXT,
            billable INTEGER DEFAULT 0,
            hourly_rate REAL DEFAULT 0.0,
            synced INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS active_session (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            task_name TEXT NOT NULL,
            project TEXT,
            start_time TEXT NOT NULL,
            tags TEXT,
            notes TEXT,
            billable INTEGER DEFAULT 0,
            hourly_rate REAL DEFAULT 0.0
        );

        CREATE TABLE IF NOT EXISTS paused_sessions (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            task_name TEXT NOT NULL,
            project TEXT,
            start_time TEXT NOT NULL,
            paused_at TEXT NOT NULL,
            elapsed_seconds INTEGER DEFAULT 0,
            tags TEXT,
            notes TEXT,
            billable INTEGER DEFAULT 0,
            hourly_rate REAL DEFAULT 0.0
        );

        CREATE TABLE IF NOT EXISTS templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            task_name TEXT NOT NULL,
            project TEXT,
            tags TEXT,
            notes TEXT,
            billable INTEGER DEFAULT 0,
            hourly_rate REAL DEFAULT 0.0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project TEXT,
            target_hours REAL NOT NULL,
            period TEXT NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS local_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS blocked_apps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            display_name TEXT NOT NULL,
            process_name TEXT NOT NULL UNIQUE,
            block_mode TEXT NOT NULL DEFAULT 'always',
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS blocker_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            enabled INTEGER NOT NULL DEFAULT 0
        );

        INSERT OR IGNORE INTO blocker_settings (id, enabled) VALUES (1, 0);

        CREATE TABLE IF NOT EXISTS blocked_sites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            domain TEXT NOT NULL UNIQUE,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS focus_schedule_blocks (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT    NOT NULL DEFAULT 'Focus Block',
            start_time   TEXT    NOT NULL DEFAULT '09:00',
            end_time     TEXT    NOT NULL DEFAULT '17:00',
            days_of_week TEXT    NOT NULL DEFAULT '1,2,3,4,5',
            color        TEXT    NOT NULL DEFAULT '#4f46e5',
            enabled      INTEGER NOT NULL DEFAULT 1,
            created_at   TEXT    DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS schedule_block_apps (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            block_id     INTEGER NOT NULL REFERENCES focus_schedule_blocks(id) ON DELETE CASCADE,
            process_name TEXT    NOT NULL,
            UNIQUE(block_id, process_name)
        );

        CREATE TABLE IF NOT EXISTS schedule_block_sites (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            block_id INTEGER NOT NULL REFERENCES focus_schedule_blocks(id) ON DELETE CASCADE,
            domain   TEXT    NOT NULL,
            UNIQUE(block_id, domain)
        );

        CREATE TABLE IF NOT EXISTS time_unlock_rules (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            process_name     TEXT,
            domain           TEXT,
            required_minutes INTEGER NOT NULL DEFAULT 60,
            enabled          INTEGER NOT NULL DEFAULT 1,
            created_at       TEXT    DEFAULT CURRENT_TIMESTAMP
        );
        ",
    )?;

    // Idempotent column additions (mirrors Python's _add_column_if_not_exists)
    add_column_if_missing(conn, "time_entries", "billable", "INTEGER DEFAULT 0")?;
    add_column_if_missing(conn, "time_entries", "hourly_rate", "REAL DEFAULT 0.0")?;
    add_column_if_missing(conn, "time_entries", "synced", "INTEGER DEFAULT 0")?;
    add_column_if_missing(conn, "time_entries", "user_id", "TEXT")?;
    add_column_if_missing(conn, "active_session", "billable", "INTEGER DEFAULT 0")?;
    add_column_if_missing(conn, "active_session", "hourly_rate", "REAL DEFAULT 0.0")?;
    add_column_if_missing(conn, "active_session", "user_id", "TEXT")?;

    Ok(())
}

fn add_column_if_missing(conn: &Connection, table: &str, column: &str, col_type: &str) -> Result<()> {
    let exists: bool = conn
        .prepare(&format!("PRAGMA table_info({table})"))?
        .query_map([], |row| row.get::<_, String>(1))?
        .any(|name| name.as_deref() == Ok(column));

    if !exists {
        conn.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {col_type};"
        ))?;
    }
    Ok(())
}
