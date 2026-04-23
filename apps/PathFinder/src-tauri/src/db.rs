use rusqlite::{Connection, Result};

pub fn init(conn: &Connection) -> Result<()> {
    // Base schema (runs on first launch only via IF NOT EXISTS)
    conn.execute_batch(
        "
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;

        CREATE TABLE IF NOT EXISTS goal_groups (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            color      TEXT    NOT NULL DEFAULT 'slate',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS goals (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id    INTEGER REFERENCES goal_groups(id) ON DELETE SET NULL,
            title       TEXT    NOT NULL,
            description TEXT,
            deadline    TEXT,
            status      TEXT    NOT NULL DEFAULT 'active',
            priority    TEXT    NOT NULL DEFAULT 'medium',
            created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS plans (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            goal_id     INTEGER REFERENCES goals(id) ON DELETE SET NULL,
            title       TEXT    NOT NULL,
            description TEXT,
            deadline    TEXT,
            status      TEXT    NOT NULL DEFAULT 'active',
            created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id     INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
            title       TEXT    NOT NULL,
            done        INTEGER NOT NULL DEFAULT 0,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            priority    TEXT    NOT NULL DEFAULT 'medium',
            due_date    TEXT,
            created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS systems (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            title           TEXT    NOT NULL,
            description     TEXT,
            frequency       TEXT    NOT NULL DEFAULT 'daily',
            last_done       TEXT,
            streak_count    INTEGER NOT NULL DEFAULT 0,
            streak_updated  TEXT,
            created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS daily_sections (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            title       TEXT    NOT NULL,
            color       TEXT    NOT NULL DEFAULT 'blue',
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS daily_items (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            section_id  INTEGER NOT NULL REFERENCES daily_sections(id) ON DELETE CASCADE,
            title       TEXT    NOT NULL,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS daily_completions (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL REFERENCES daily_items(id) ON DELETE CASCADE,
            date    TEXT    NOT NULL,
            UNIQUE(item_id, date)
        );

        CREATE TABLE IF NOT EXISTS routines (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            kind        TEXT    NOT NULL DEFAULT 'morning',
            title       TEXT    NOT NULL,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS routine_completions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
            date       TEXT    NOT NULL,
            UNIQUE(routine_id, date)
        );

        CREATE TABLE IF NOT EXISTS time_blocks (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            date    TEXT    NOT NULL,
            slot    TEXT    NOT NULL,
            label   TEXT    NOT NULL DEFAULT '',
            UNIQUE(date, slot)
        );

        CREATE TABLE IF NOT EXISTS system_subtasks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            system_id   INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
            title       TEXT    NOT NULL,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS system_subtask_completions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            subtask_id INTEGER NOT NULL REFERENCES system_subtasks(id) ON DELETE CASCADE,
            date       TEXT    NOT NULL,
            UNIQUE(subtask_id, date)
        );

        CREATE TABLE IF NOT EXISTS daily_primary_goal (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            date       TEXT    NOT NULL UNIQUE,
            text       TEXT    NOT NULL,
            created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS daily_secondary_goals (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            date       TEXT    NOT NULL,
            text       TEXT    NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS reminders (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            title      TEXT    NOT NULL,
            done       INTEGER NOT NULL DEFAULT 0,
            created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS quick_notes (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            title      TEXT    NOT NULL,
            body       TEXT,
            created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS brain_dump (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            content    TEXT    NOT NULL,
            created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            title       TEXT    NOT NULL,
            date        TEXT    NOT NULL,
            description TEXT,
            created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS deadlines (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            title      TEXT    NOT NULL,
            due_date   TEXT    NOT NULL,
            done       INTEGER NOT NULL DEFAULT 0,
            created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS agreements (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            title      TEXT    NOT NULL,
            notes      TEXT,
            created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS cal_blocks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            date        TEXT    NOT NULL,
            title       TEXT    NOT NULL,
            start_time  TEXT    NOT NULL,
            end_time    TEXT    NOT NULL,
            color       TEXT    NOT NULL DEFAULT 'blue',
            description TEXT,
            location    TEXT,
            created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS recurring_cal_blocks (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            title        TEXT    NOT NULL,
            start_time   TEXT    NOT NULL,
            end_time     TEXT    NOT NULL,
            color        TEXT    NOT NULL DEFAULT 'blue',
            recurrence   TEXT    NOT NULL DEFAULT 'weekly',
            days_of_week TEXT,
            start_date   TEXT    NOT NULL,
            end_date     TEXT,
            description  TEXT,
            location     TEXT,
            created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS journal_entries (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            date       TEXT    NOT NULL UNIQUE,
            content    TEXT    NOT NULL DEFAULT '',
            updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );
        ",
    )?;

    // Versioned migrations for existing databases
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;

    if version < 1 {
        let _ = conn.execute("ALTER TABLE goals ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'", []);
        let _ = conn.execute("ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'", []);
        let _ = conn.execute("ALTER TABLE tasks ADD COLUMN due_date TEXT", []);
        let _ = conn.execute("ALTER TABLE systems ADD COLUMN streak_count INTEGER NOT NULL DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE systems ADD COLUMN streak_updated TEXT", []);
        conn.execute_batch("PRAGMA user_version = 1")?;
    }

    if version < 2 {
        let _ = conn.execute("ALTER TABLE systems ADD COLUMN days_of_week TEXT", []);
        conn.execute_batch("PRAGMA user_version = 2")?;
    }

    if version < 3 {
        let _ = conn.execute("ALTER TABLE goals ADD COLUMN group_id INTEGER REFERENCES goal_groups(id) ON DELETE SET NULL", []);
        conn.execute_batch("PRAGMA user_version = 3")?;
    }

    if version < 4 {
        let _ = conn.execute("ALTER TABLE cal_blocks ADD COLUMN description TEXT", []);
        let _ = conn.execute("ALTER TABLE cal_blocks ADD COLUMN location TEXT", []);
        let _ = conn.execute("ALTER TABLE recurring_cal_blocks ADD COLUMN description TEXT", []);
        let _ = conn.execute("ALTER TABLE recurring_cal_blocks ADD COLUMN location TEXT", []);
        conn.execute_batch("PRAGMA user_version = 4")?;
    }

    if version < 5 {
        let _ = conn.execute("ALTER TABLE reminders ADD COLUMN due_date TEXT", []);
        conn.execute_batch("PRAGMA user_version = 5")?;
    }

    if version < 6 {
        let _ = conn.execute("ALTER TABLE systems ADD COLUMN start_time TEXT", []);
        let _ = conn.execute("ALTER TABLE systems ADD COLUMN end_time TEXT", []);
        conn.execute_batch("PRAGMA user_version = 6")?;
    }

    if version < 7 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS course_assignments (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_id         INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
                title           TEXT    NOT NULL,
                assignment_type TEXT    NOT NULL DEFAULT 'homework',
                due_date        TEXT,
                status          TEXT    NOT NULL DEFAULT 'pending',
                priority        TEXT    NOT NULL DEFAULT 'medium',
                book_title      TEXT,
                chapter_start   TEXT,
                chapter_end     TEXT,
                page_start      INTEGER,
                page_end        INTEGER,
                page_current    INTEGER,
                notes           TEXT,
                created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            );
            PRAGMA user_version = 7;",
        )?;
    }

    if version < 8 {
        let _ = conn.execute("ALTER TABLE plans ADD COLUMN tags TEXT", []);
        conn.execute_batch("PRAGMA user_version = 8")?;
    }

    if version < 9 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS ca_subtasks (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                assignment_id   INTEGER NOT NULL REFERENCES course_assignments(id) ON DELETE CASCADE,
                title           TEXT    NOT NULL,
                done            INTEGER NOT NULL DEFAULT 0,
                sort_order      INTEGER NOT NULL DEFAULT 0,
                created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            );
            PRAGMA user_version = 9;",
        )?;
    }

    if version < 10 {
        let _ = conn.execute("ALTER TABLE plans ADD COLUMN is_course INTEGER NOT NULL DEFAULT 0", []);
        // Copy is_course flag from 'course' tag
        conn.execute("UPDATE plans SET is_course = 1 WHERE tags LIKE '%course%'", [])?;
        // Strip 'course' from tags strings
        let mut stmt = conn.prepare("SELECT id, COALESCE(tags, '') FROM plans WHERE tags LIKE '%course%'")?;
        let ids_tags: Vec<(i64, String)> = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        for (id, tags_str) in ids_tags {
            let new_tags: Vec<&str> = tags_str
                .split(',')
                .map(|t| t.trim())
                .filter(|t| !t.is_empty() && *t != "course")
                .collect();
            let new_tags_opt: Option<String> = if new_tags.is_empty() { None } else { Some(new_tags.join(",")) };
            conn.execute("UPDATE plans SET tags = ?1 WHERE id = ?2", rusqlite::params![new_tags_opt, id])?;
        }
        conn.execute_batch("PRAGMA user_version = 10")?;
    }

    if version < 11 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS lifestyle_areas (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL,
                color      TEXT NOT NULL DEFAULT 'teal',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            );",
        )?;
        let _ = conn.execute("ALTER TABLE plans   ADD COLUMN is_lifestyle      INTEGER NOT NULL DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE plans   ADD COLUMN lifestyle_area_id INTEGER REFERENCES lifestyle_areas(id) ON DELETE SET NULL", []);
        let _ = conn.execute("ALTER TABLE systems ADD COLUMN is_lifestyle      INTEGER NOT NULL DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE systems ADD COLUMN lifestyle_area_id INTEGER REFERENCES lifestyle_areas(id) ON DELETE SET NULL", []);
        conn.execute_batch("PRAGMA user_version = 11")?;
    }

    if version < 12 {
        // Make tasks.plan_id nullable (SQLite requires table recreation to drop NOT NULL)
        conn.execute_batch(
            "PRAGMA foreign_keys=OFF;
             DROP TABLE IF EXISTS tasks_new;
             CREATE TABLE tasks_new (
                 id          INTEGER PRIMARY KEY AUTOINCREMENT,
                 plan_id     INTEGER REFERENCES plans(id) ON DELETE CASCADE,
                 title       TEXT    NOT NULL,
                 done        INTEGER NOT NULL DEFAULT 0,
                 sort_order  INTEGER NOT NULL DEFAULT 0,
                 priority    TEXT    NOT NULL DEFAULT 'medium',
                 due_date    TEXT,
                 created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
             );
             INSERT INTO tasks_new (id, plan_id, title, done, sort_order, priority, due_date, created_at)
             SELECT id, plan_id, title, done, sort_order, priority, due_date,
                    COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
             FROM tasks;
             DROP TABLE tasks;
             ALTER TABLE tasks_new RENAME TO tasks;
             PRAGMA foreign_keys=ON;
             PRAGMA user_version = 12;",
        )?;
    }

    if version < 13 {
        conn.execute_batch(
            "ALTER TABLE course_assignments ADD COLUMN start_time TEXT;
             ALTER TABLE course_assignments ADD COLUMN end_time   TEXT;
             PRAGMA user_version = 13;",
        )?;
    }

    if version < 14 {
        conn.execute_batch(
            "ALTER TABLE tasks               ADD COLUMN time_estimate INTEGER;
             ALTER TABLE course_assignments  ADD COLUMN time_estimate INTEGER;
             PRAGMA user_version = 14;",
        )?;
    }

    if version < 15 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS pipeline_templates (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_id     INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
                title       TEXT    NOT NULL,
                description TEXT,
                color       TEXT    NOT NULL DEFAULT 'violet',
                created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            );
            CREATE TABLE IF NOT EXISTS pipeline_steps (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                template_id   INTEGER NOT NULL REFERENCES pipeline_templates(id) ON DELETE CASCADE,
                title         TEXT    NOT NULL,
                description   TEXT,
                sort_order    INTEGER NOT NULL DEFAULT 0,
                time_estimate INTEGER,
                created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            );
            CREATE TABLE IF NOT EXISTS pipeline_runs (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                template_id    INTEGER NOT NULL REFERENCES pipeline_templates(id) ON DELETE CASCADE,
                title          TEXT    NOT NULL,
                notes          TEXT,
                scheduled_date TEXT,
                sort_order     INTEGER NOT NULL DEFAULT 0,
                created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            );
            CREATE TABLE IF NOT EXISTS pipeline_run_steps (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id  INTEGER NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
                step_id INTEGER NOT NULL REFERENCES pipeline_steps(id) ON DELETE CASCADE,
                done    INTEGER NOT NULL DEFAULT 0,
                done_at TEXT,
                UNIQUE(run_id, step_id)
            );
            PRAGMA user_version = 15;",
        )?;
    }

    if version < 16 {
        conn.execute_batch(
            "ALTER TABLE pipeline_run_steps ADD COLUMN notes TEXT;
             ALTER TABLE pipeline_run_steps ADD COLUMN due_date TEXT;
             PRAGMA user_version = 16;",
        )?;
    }

    if version < 17 {
        conn.execute_batch(
            "ALTER TABLE pipeline_steps     ADD COLUMN step_type TEXT NOT NULL DEFAULT 'generic';
             ALTER TABLE pipeline_run_steps ADD COLUMN chapter_ref TEXT;
             ALTER TABLE pipeline_run_steps ADD COLUMN page_start  INTEGER;
             ALTER TABLE pipeline_run_steps ADD COLUMN page_end    INTEGER;
             ALTER TABLE pipeline_run_steps ADD COLUMN start_time  TEXT;
             ALTER TABLE pipeline_run_steps ADD COLUMN end_time    TEXT;
             PRAGMA user_version = 17;",
        )?;
    }

    if version < 18 {
        conn.execute_batch(
            "ALTER TABLE pipeline_run_steps ADD COLUMN location TEXT;
             PRAGMA user_version = 18;",
        )?;
    }

    if version < 19 {
        conn.execute_batch(
            "ALTER TABLE pipeline_run_steps ADD COLUMN time_estimate INTEGER;
             PRAGMA user_version = 19;",
        )?;
    }

    if version < 20 {
        conn.execute_batch(
            "ALTER TABLE pipeline_run_steps ADD COLUMN assignment_id INTEGER REFERENCES course_assignments(id) ON DELETE SET NULL;
             PRAGMA user_version = 20;",
        )?;
    }

    if version < 21 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS pipeline_step_subtasks (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id   INTEGER NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
                step_id  INTEGER NOT NULL REFERENCES pipeline_steps(id) ON DELETE CASCADE,
                title    TEXT    NOT NULL,
                done     INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0
             );
             PRAGMA user_version = 21;",
        )?;
    }

    if version < 22 {
        conn.execute_batch(
            "ALTER TABLE pipeline_run_steps ADD COLUMN due_date_2 TEXT;
             PRAGMA user_version = 22;",
        )?;
    }

    if version < 23 {
        conn.execute_batch(
            "ALTER TABLE pipeline_steps ADD COLUMN attend_type TEXT;
             PRAGMA user_version = 23;",
        )?;
    }

    if version < 24 {
        conn.execute_batch(
            "ALTER TABLE plans ADD COLUMN purpose TEXT;
             ALTER TABLE plans ADD COLUMN problem TEXT;
             ALTER TABLE plans ADD COLUMN solution TEXT;
             ALTER TABLE tasks ADD COLUMN kanban_status TEXT NOT NULL DEFAULT 'backlog';
             CREATE TABLE IF NOT EXISTS project_goals (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
                 title TEXT NOT NULL,
                 done INTEGER NOT NULL DEFAULT 0,
                 sort_order INTEGER NOT NULL DEFAULT 0
             );
             PRAGMA user_version = 24;",
        )?;
    }

    if version < 25 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS games (
                 id              INTEGER PRIMARY KEY AUTOINCREMENT,
                 title           TEXT NOT NULL,
                 genre           TEXT,
                 platform        TEXT,
                 engine          TEXT,
                 status          TEXT NOT NULL DEFAULT 'concept',
                 description     TEXT,
                 core_mechanic   TEXT,
                 target_audience TEXT,
                 inspiration     TEXT,
                 color           TEXT NOT NULL DEFAULT 'violet',
                 created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
             );
             CREATE TABLE IF NOT EXISTS game_features (
                 id          INTEGER PRIMARY KEY AUTOINCREMENT,
                 game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                 title       TEXT NOT NULL,
                 description TEXT,
                 status      TEXT NOT NULL DEFAULT 'idea',
                 priority    TEXT NOT NULL DEFAULT 'medium',
                 sort_order  INTEGER NOT NULL DEFAULT 0,
                 created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
             );
             CREATE TABLE IF NOT EXISTS game_devlog (
                 id         INTEGER PRIMARY KEY AUTOINCREMENT,
                 game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                 content    TEXT NOT NULL,
                 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
             );
             PRAGMA user_version = 25;",
        )?;
    }

    if version < 26 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS daily_habits (
                 id         INTEGER PRIMARY KEY AUTOINCREMENT,
                 title      TEXT NOT NULL,
                 color      TEXT NOT NULL DEFAULT 'emerald',
                 sort_order INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS habit_completions (
                 id       INTEGER PRIMARY KEY AUTOINCREMENT,
                 habit_id INTEGER NOT NULL REFERENCES daily_habits(id) ON DELETE CASCADE,
                 date     TEXT NOT NULL,
                 UNIQUE(habit_id, date)
             );
             CREATE TABLE IF NOT EXISTS run_logs (
                 id           INTEGER PRIMARY KEY AUTOINCREMENT,
                 date         TEXT NOT NULL,
                 distance_km  REAL,
                 duration_min INTEGER,
                 notes        TEXT,
                 created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
             );
             CREATE TABLE IF NOT EXISTS workout_logs (
                 id         INTEGER PRIMARY KEY AUTOINCREMENT,
                 date       TEXT NOT NULL,
                 name       TEXT NOT NULL DEFAULT 'Workout',
                 notes      TEXT,
                 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
             );
             CREATE TABLE IF NOT EXISTS workout_exercises (
                 id         INTEGER PRIMARY KEY AUTOINCREMENT,
                 workout_id INTEGER NOT NULL REFERENCES workout_logs(id) ON DELETE CASCADE,
                 name       TEXT NOT NULL,
                 sets       INTEGER,
                 reps       INTEGER,
                 weight_kg  REAL,
                 notes      TEXT,
                 sort_order INTEGER NOT NULL DEFAULT 0
             );
             PRAGMA user_version = 26;",
        )?;
    }

    if version < 27 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS roadmap_items (
                 id          INTEGER PRIMARY KEY AUTOINCREMENT,
                 plan_id     INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
                 title       TEXT    NOT NULL,
                 description TEXT,
                 due_date    TEXT,
                 status      TEXT    NOT NULL DEFAULT 'planned',
                 sort_order  INTEGER NOT NULL DEFAULT 0,
                 created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
             );
             PRAGMA user_version = 27;",
        )?;
    }

    if version < 28 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS course_books (
                 id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                 plan_id               INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
                 title                 TEXT    NOT NULL,
                 author                TEXT,
                 total_pages           INTEGER,
                 total_chapters        INTEGER,
                 current_page          INTEGER NOT NULL DEFAULT 0,
                 current_chapter       INTEGER NOT NULL DEFAULT 0,
                 daily_pages_goal      INTEGER NOT NULL DEFAULT 0,
                 weekly_chapters_goal  INTEGER NOT NULL DEFAULT 0,
                 created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
             );
             CREATE TABLE IF NOT EXISTS book_reading_log (
                 id            INTEGER PRIMARY KEY AUTOINCREMENT,
                 book_id       INTEGER NOT NULL REFERENCES course_books(id) ON DELETE CASCADE,
                 date          TEXT    NOT NULL,
                 pages_read    INTEGER NOT NULL DEFAULT 0,
                 chapters_read REAL    NOT NULL DEFAULT 0,
                 note          TEXT,
                 created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
             );
             PRAGMA user_version = 28;",
        )?;
    }

    if version < 29 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS book_sections (
                 id            INTEGER PRIMARY KEY AUTOINCREMENT,
                 book_id       INTEGER NOT NULL REFERENCES course_books(id) ON DELETE CASCADE,
                 title         TEXT    NOT NULL,
                 kind          TEXT    NOT NULL DEFAULT 'chapter',
                 sort_order    INTEGER NOT NULL DEFAULT 0,
                 page_start    INTEGER,
                 page_end      INTEGER,
                 due_date      TEXT,
                 time_estimate INTEGER,
                 done          INTEGER NOT NULL DEFAULT 0,
                 done_at       TEXT,
                 notes         TEXT,
                 created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
             );
             PRAGMA user_version = 29;",
        )?;
    }

    Ok(())
}
