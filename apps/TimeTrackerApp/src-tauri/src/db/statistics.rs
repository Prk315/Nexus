use crate::models::{ProjectStat, Statistics, TaskStat};
use rusqlite::Connection;

pub fn get(
    conn: &Connection,
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<Statistics, String> {
    let mut base = "FROM time_entries WHERE 1=1".to_string();
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = vec![];

    if let Some(s) = start_date {
        base.push_str(" AND date(start_time) >= ?");
        values.push(Box::new(s.to_string()));
    }
    if let Some(e) = end_date {
        base.push_str(" AND date(start_time) <= ?");
        values.push(Box::new(e.to_string()));
    }

    let params_refs: Vec<&dyn rusqlite::ToSql> = values.iter().map(|v| v.as_ref()).collect();

    // Total
    let total: i64 = conn
        .query_row(
            &format!("SELECT COALESCE(SUM(duration_seconds), 0) {base}"),
            params_refs.as_slice(),
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    // By project
    let mut stmt = conn
        .prepare(&format!(
            "SELECT project, COALESCE(SUM(duration_seconds), 0) as total, COUNT(*) as cnt
             {base}
             GROUP BY project ORDER BY total DESC"
        ))
        .map_err(|e| e.to_string())?;
    let by_project: Vec<ProjectStat> = stmt
        .query_map(params_refs.as_slice(), |row| {
            Ok(ProjectStat {
                project: row.get(0)?,
                total: row.get(1)?,
                count: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // By task (top 10)
    let mut stmt2 = conn
        .prepare(&format!(
            "SELECT task_name, COALESCE(SUM(duration_seconds), 0) as total, COUNT(*) as cnt
             {base}
             GROUP BY task_name ORDER BY total DESC LIMIT 10"
        ))
        .map_err(|e| e.to_string())?;
    let by_task: Vec<TaskStat> = stmt2
        .query_map(params_refs.as_slice(), |row| {
            Ok(TaskStat {
                task_name: row.get(0)?,
                total: row.get(1)?,
                count: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(Statistics {
        total_seconds: total,
        by_project,
        by_task,
    })
}
