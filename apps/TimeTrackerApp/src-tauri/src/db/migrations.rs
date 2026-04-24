use rusqlite::{Connection, Result};

/// Run all migrations.  Every statement is individually non-fatal: errors are
/// logged but never propagate.  This is intentional — on iOS (especially
/// pre-release simulator SDKs) `CREATE TABLE IF NOT EXISTS` can fail for
/// tables that already exist when the schema contains UNIQUE or CHECK
/// constraints, and we must not crash the app over that.
pub fn run(conn: &Connection) -> Result<()> {
    let tables: &[&str] = &[
        "CREATE TABLE IF NOT EXISTS time_entries (
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
            user_id TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );",
        "CREATE TABLE IF NOT EXISTS active_session (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            task_name TEXT NOT NULL,
            project TEXT,
            start_time TEXT NOT NULL,
            tags TEXT,
            notes TEXT,
            billable INTEGER DEFAULT 0,
            hourly_rate REAL DEFAULT 0.0,
            user_id TEXT
        );",
        "CREATE TABLE IF NOT EXISTS paused_sessions (
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
        );",
        "CREATE TABLE IF NOT EXISTS templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            task_name TEXT NOT NULL,
            project TEXT,
            tags TEXT,
            notes TEXT,
            billable INTEGER DEFAULT 0,
            hourly_rate REAL DEFAULT 0.0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );",
        "CREATE TABLE IF NOT EXISTS goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project TEXT,
            target_hours REAL NOT NULL,
            period TEXT NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );",
        "CREATE TABLE IF NOT EXISTS local_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );",
        "CREATE TABLE IF NOT EXISTS blocked_apps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            display_name TEXT NOT NULL,
            process_name TEXT NOT NULL,
            block_mode TEXT NOT NULL DEFAULT 'always',
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );",
        "CREATE TABLE IF NOT EXISTS blocker_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            enabled INTEGER NOT NULL DEFAULT 0
        );",
        "INSERT OR IGNORE INTO blocker_settings (id, enabled) VALUES (1, 0);",
        "CREATE TABLE IF NOT EXISTS blocked_sites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            domain TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );",
        "CREATE TABLE IF NOT EXISTS focus_schedule_blocks (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT    NOT NULL DEFAULT 'Focus Block',
            start_time   TEXT    NOT NULL DEFAULT '09:00',
            end_time     TEXT    NOT NULL DEFAULT '17:00',
            days_of_week TEXT    NOT NULL DEFAULT '1,2,3,4,5',
            color        TEXT    NOT NULL DEFAULT '#4f46e5',
            enabled      INTEGER NOT NULL DEFAULT 1,
            created_at   TEXT    DEFAULT CURRENT_TIMESTAMP
        );",
        "CREATE TABLE IF NOT EXISTS schedule_block_apps (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            block_id     INTEGER NOT NULL REFERENCES focus_schedule_blocks(id) ON DELETE CASCADE,
            process_name TEXT    NOT NULL
        );",
        "CREATE TABLE IF NOT EXISTS schedule_block_sites (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            block_id INTEGER NOT NULL REFERENCES focus_schedule_blocks(id) ON DELETE CASCADE,
            domain   TEXT    NOT NULL
        );",
        "CREATE TABLE IF NOT EXISTS time_unlock_rules (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            process_name     TEXT,
            domain           TEXT,
            required_minutes INTEGER NOT NULL DEFAULT 60,
            enabled          INTEGER NOT NULL DEFAULT 1,
            created_at       TEXT    DEFAULT CURRENT_TIMESTAMP
        );",
    ];

    for sql in tables {
        let label = sql.trim().get(..60).unwrap_or(sql.trim());
        match conn.execute_batch(sql) {
            Ok(_) => eprintln!("[migrations] ok: {label}..."),
            Err(e) => eprintln!("[migrations] warning (skipping): {label}... -> {e}"),
        }
    }

    let compat_columns: &[(&str, &str, &str)] = &[
        // time_entries
        ("time_entries",          "billable",    "INTEGER DEFAULT 0"),
        ("time_entries",          "hourly_rate", "REAL DEFAULT 0.0"),
        ("time_entries",          "synced",      "INTEGER DEFAULT 0"),
        ("time_entries",          "user_id",     "TEXT"),
        // active_session
        ("active_session",        "billable",    "INTEGER DEFAULT 0"),
        ("active_session",        "hourly_rate", "REAL DEFAULT 0.0"),
        ("active_session",        "user_id",     "TEXT"),
        // blocking tables — sync tracking columns
        ("blocked_sites",         "synced",      "INTEGER DEFAULT 0"),
        ("blocked_sites",         "user_id",     "TEXT DEFAULT 'default'"),
        ("blocked_sites",         "updated_at",  "TEXT DEFAULT CURRENT_TIMESTAMP"),
        ("blocked_apps",          "synced",      "INTEGER DEFAULT 0"),
        ("blocked_apps",          "user_id",     "TEXT DEFAULT 'default'"),
        ("blocked_apps",          "updated_at",  "TEXT DEFAULT CURRENT_TIMESTAMP"),
        ("focus_schedule_blocks", "synced",      "INTEGER DEFAULT 0"),
        ("focus_schedule_blocks", "user_id",     "TEXT DEFAULT 'default'"),
        ("focus_schedule_blocks", "updated_at",  "TEXT DEFAULT CURRENT_TIMESTAMP"),
        ("focus_schedule_blocks", "remote_id",   "TEXT"),
        ("time_unlock_rules",     "synced",      "INTEGER DEFAULT 0"),
        ("time_unlock_rules",     "user_id",     "TEXT DEFAULT 'default'"),
        ("time_unlock_rules",     "updated_at",  "TEXT DEFAULT CURRENT_TIMESTAMP"),
        ("time_unlock_rules",     "remote_id",   "TEXT"),
    ];

    for (table, column, col_type) in compat_columns {
        let sql = format!("ALTER TABLE {table} ADD COLUMN {column} {col_type};");
        match conn.execute_batch(&sql) {
            Ok(_) => eprintln!("[migrations] added column {column} to {table}"),
            Err(e) => eprintln!("[migrations] skip column {column} on {table}: {e}"),
        }
    }

    eprintln!("[migrations] complete");
    Ok(())
}
