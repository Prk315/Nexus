use crate::models::{Goal, GoalProgress};
use rusqlite::{params, Connection, Result};

pub fn get_active(conn: &Connection, project: Option<&str>) -> Result<Vec<GoalProgress>> {
    let mut query = "SELECT id, project, target_hours, period, start_date, end_date, active, created_at
                     FROM goals WHERE active = 1"
        .to_string();
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = vec![];

    if let Some(p) = project {
        query.push_str(" AND project = ?");
        values.push(Box::new(p.to_string()));
    }
    query.push_str(" ORDER BY end_date ASC");

    let params_refs: Vec<&dyn rusqlite::ToSql> = values.iter().map(|v| v.as_ref()).collect();
    let mut stmt = conn.prepare(&query)?;
    let goals: Vec<Goal> = stmt
        .query_map(params_refs.as_slice(), row_to_goal)?
        .filter_map(|r| r.ok())
        .collect();

    goals
        .into_iter()
        .map(|g| compute_progress(conn, g))
        .collect()
}

pub fn add(
    conn: &Connection,
    target_hours: f64,
    period: &str,
    start_date: &str,
    end_date: &str,
    project: Option<&str>,
) -> Result<i64, String> {
    if target_hours <= 0.0 {
        return Err("Target hours must be positive".into());
    }
    if !["day", "week", "month", "custom"].contains(&period) {
        return Err("Period must be one of: day, week, month, custom".into());
    }
    conn.execute(
        "INSERT INTO goals (project, target_hours, period, start_date, end_date)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![project, target_hours, period, start_date, end_date],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

pub fn deactivate(conn: &Connection, goal_id: i64) -> Result<bool, String> {
    let rows = conn
        .execute(
            "UPDATE goals SET active = 0 WHERE id = ?",
            params![goal_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(rows > 0)
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn compute_progress(conn: &Connection, goal: Goal) -> Result<GoalProgress> {
    let mut query =
        "SELECT SUM(duration_seconds) FROM time_entries WHERE date(start_time) >= ? AND date(start_time) <= ?"
            .to_string();
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = vec![
        Box::new(goal.start_date.clone()),
        Box::new(goal.end_date.clone()),
    ];

    if let Some(ref p) = goal.project {
        query.push_str(" AND project = ?");
        values.push(Box::new(p.clone()));
    }

    let params_refs: Vec<&dyn rusqlite::ToSql> = values.iter().map(|v| v.as_ref()).collect();
    let actual_seconds: i64 = conn
        .query_row(&query, params_refs.as_slice(), |r| {
            r.get::<_, Option<i64>>(0)
        })?
        .unwrap_or(0);

    let target_seconds = goal.target_hours * 3600.0;
    let actual_hours = actual_seconds as f64 / 3600.0;
    let progress_percent = if target_seconds > 0.0 {
        (actual_seconds as f64 / target_seconds * 100.0).min(100.0)
    } else {
        0.0
    };
    let remaining = (goal.target_hours - actual_hours).max(0.0);

    Ok(GoalProgress {
        target_hours: goal.target_hours,
        actual_hours,
        progress_percent,
        remaining_hours: remaining,
        goal,
    })
}

fn row_to_goal(row: &rusqlite::Row<'_>) -> rusqlite::Result<Goal> {
    Ok(Goal {
        id: row.get(0)?,
        project: row.get(1)?,
        target_hours: row.get(2)?,
        period: row.get(3)?,
        start_date: row.get(4)?,
        end_date: row.get(5)?,
        active: row.get::<_, i64>(6)? != 0,
        created_at: row.get(7)?,
    })
}
