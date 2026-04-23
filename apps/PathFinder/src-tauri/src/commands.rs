use crate::models::*;
use crate::AppState;
use rusqlite::params;

// ── Goal Groups ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_goal_groups(state: tauri::State<AppState>) -> Result<Vec<GoalGroup>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT id, name, color, sort_order FROM goal_groups ORDER BY sort_order, id",
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| Ok(GoalGroup {
        id:         row.get(0)?,
        name:       row.get(1)?,
        color:      row.get(2)?,
        sort_order: row.get(3)?,
    }))
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn create_goal_group(state: tauri::State<AppState>, name: String, color: String) -> Result<GoalGroup, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let sort_order: i64 = db
        .query_row("SELECT COALESCE(MAX(sort_order) + 1, 0) FROM goal_groups", [], |r| r.get(0))
        .unwrap_or(0);
    db.execute(
        "INSERT INTO goal_groups (name, color, sort_order) VALUES (?1, ?2, ?3)",
        params![name, color, sort_order],
    ).map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    db.query_row("SELECT id, name, color, sort_order FROM goal_groups WHERE id=?1", [id], |row| {
        Ok(GoalGroup { id: row.get(0)?, name: row.get(1)?, color: row.get(2)?, sort_order: row.get(3)? })
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_goal_group(state: tauri::State<AppState>, id: i64, name: String, color: String) -> Result<GoalGroup, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("UPDATE goal_groups SET name=?1, color=?2 WHERE id=?3", params![name, color, id])
        .map_err(|e| e.to_string())?;
    db.query_row("SELECT id, name, color, sort_order FROM goal_groups WHERE id=?1", [id], |row| {
        Ok(GoalGroup { id: row.get(0)?, name: row.get(1)?, color: row.get(2)?, sort_order: row.get(3)? })
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_goal_group(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM goal_groups WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Goals ─────────────────────────────────────────────────────────────────────

const GOAL_SELECT: &str =
    "SELECT g.id, g.group_id, gg.name, gg.color, g.title, g.description, g.deadline, g.status, g.priority, g.created_at,
            COUNT(t.id), SUM(CASE WHEN t.done=1 THEN 1 ELSE 0 END)
     FROM goals g
     LEFT JOIN goal_groups gg ON gg.id = g.group_id
     LEFT JOIN plans p ON p.goal_id = g.id
     LEFT JOIN tasks t ON t.plan_id = p.id";

#[tauri::command]
pub fn get_goals(state: tauri::State<AppState>) -> Result<Vec<Goal>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "{} GROUP BY g.id ORDER BY
           CASE g.status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,
           CASE g.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
           g.deadline ASC NULLS LAST, g.created_at DESC",
        GOAL_SELECT
    );
    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok(map_goal(row)?))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn create_goal(state: tauri::State<AppState>, payload: CreateGoal) -> Result<Goal, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let priority = payload.priority.unwrap_or_else(|| "medium".into());
    db.execute(
        "INSERT INTO goals (group_id, title, description, deadline, priority) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![payload.group_id, payload.title, payload.description, payload.deadline, priority],
    )
    .map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    fetch_goal(&db, id)
}

#[tauri::command]
pub fn update_goal(state: tauri::State<AppState>, id: i64, payload: UpdateGoal) -> Result<Goal, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE goals SET group_id=?1, title=?2, description=?3, deadline=?4, status=?5, priority=?6 WHERE id=?7",
        params![payload.group_id, payload.title, payload.description, payload.deadline, payload.status, payload.priority, id],
    )
    .map_err(|e| e.to_string())?;
    fetch_goal(&db, id)
}

#[tauri::command]
pub fn delete_goal(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM goals WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

fn fetch_goal(db: &rusqlite::Connection, id: i64) -> Result<Goal, String> {
    let sql = format!("{} WHERE g.id=?1 GROUP BY g.id", GOAL_SELECT);
    db.query_row(&sql, [id], |row| map_goal(row))
        .map_err(|e| e.to_string())
}

fn map_goal(row: &rusqlite::Row) -> rusqlite::Result<Goal> {
    Ok(Goal {
        id:          row.get(0)?,
        group_id:    row.get(1)?,
        group_name:  row.get(2)?,
        group_color: row.get(3)?,
        title:       row.get(4)?,
        description: row.get(5)?,
        deadline:    row.get(6)?,
        status:      row.get(7)?,
        priority:    row.get(8)?,
        created_at:  row.get(9)?,
        task_count:  row.get(10)?,
        done_count:  row.get(11)?,
    })
}

// ── Plans ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_plans(state: tauri::State<AppState>) -> Result<Vec<Plan>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare(
            "SELECT p.id, p.goal_id, p.title, p.description, p.deadline, p.status, p.created_at,
                    COUNT(t.id) as task_count,
                    SUM(CASE WHEN t.done = 1 THEN 1 ELSE 0 END) as done_count,
                    p.tags, p.is_course, p.is_lifestyle, p.lifestyle_area_id,
                    p.purpose, p.problem, p.solution
             FROM plans p
             LEFT JOIN tasks t ON t.plan_id = p.id
             WHERE p.is_lifestyle = 0
             GROUP BY p.id
             ORDER BY
               CASE p.status WHEN 'active' THEN 0 ELSE 1 END,
               p.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let plans = stmt
        .query_map([], |row| Ok(map_plan(row)?))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(plans)
}

#[tauri::command]
pub fn create_plan(state: tauri::State<AppState>, payload: CreatePlan) -> Result<Plan, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO plans (goal_id, title, description, deadline, tags, is_course, is_lifestyle, lifestyle_area_id, purpose, problem, solution) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![payload.goal_id, payload.title, payload.description, payload.deadline, payload.tags, payload.is_course.unwrap_or(false) as i64, payload.is_lifestyle.unwrap_or(false) as i64, payload.lifestyle_area_id, payload.purpose, payload.problem, payload.solution],
    )
    .map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    fetch_plan(&db, id)
}

#[tauri::command]
pub fn update_plan(
    state: tauri::State<AppState>,
    id: i64,
    payload: UpdatePlan,
) -> Result<Plan, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE plans SET goal_id=?1, title=?2, description=?3, deadline=?4, status=?5, tags=?6, is_course=?7, is_lifestyle=?8, lifestyle_area_id=?9, purpose=?10, problem=?11, solution=?12 WHERE id=?13",
        params![payload.goal_id, payload.title, payload.description, payload.deadline, payload.status, payload.tags, payload.is_course.unwrap_or(false) as i64, payload.is_lifestyle.unwrap_or(false) as i64, payload.lifestyle_area_id, payload.purpose, payload.problem, payload.solution, id],
    )
    .map_err(|e| e.to_string())?;
    fetch_plan(&db, id)
}

#[tauri::command]
pub fn delete_plan(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM plans WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn fetch_plan(db: &rusqlite::Connection, id: i64) -> Result<Plan, String> {
    db.query_row(
        "SELECT p.id, p.goal_id, p.title, p.description, p.deadline, p.status, p.created_at,
                COUNT(t.id), SUM(CASE WHEN t.done=1 THEN 1 ELSE 0 END),
                p.tags, p.is_course, p.is_lifestyle, p.lifestyle_area_id,
                p.purpose, p.problem, p.solution
         FROM plans p LEFT JOIN tasks t ON t.plan_id = p.id
         WHERE p.id=?1 GROUP BY p.id",
        [id],
        |row| map_plan(row),
    )
    .map_err(|e| e.to_string())
}

fn map_plan(row: &rusqlite::Row) -> rusqlite::Result<Plan> {
    Ok(Plan {
        id:                 row.get(0)?,
        goal_id:            row.get(1)?,
        title:              row.get(2)?,
        description:        row.get(3)?,
        deadline:           row.get(4)?,
        status:             row.get(5)?,
        created_at:         row.get(6)?,
        task_count:         row.get(7)?,
        done_count:         row.get(8)?,
        tags:               row.get(9)?,
        is_course:          row.get::<_, i64>(10)? != 0,
        is_lifestyle:       row.get::<_, i64>(11)? != 0,
        lifestyle_area_id:  row.get(12)?,
        purpose:            row.get(13)?,
        problem:            row.get(14)?,
        solution:           row.get(15)?,
    })
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_tasks(state: tauri::State<AppState>, plan_id: i64) -> Result<Vec<Task>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare(
            "SELECT id, plan_id, title, done, sort_order, priority, due_date, created_at, time_estimate, kanban_status
             FROM tasks WHERE plan_id=?1
             ORDER BY done ASC, sort_order, created_at",
        )
        .map_err(|e| e.to_string())?;

    let tasks = stmt
        .query_map([plan_id], |row| Ok(map_task(row)?))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(tasks)
}

#[tauri::command]
pub fn get_all_tasks(state: tauri::State<AppState>) -> Result<Vec<TaskWithContext>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare(
            "SELECT t.id, t.plan_id, p.title, p.goal_id, g.title,
                    t.title, t.done, t.sort_order, t.priority, t.due_date, t.created_at, t.time_estimate
             FROM tasks t
             LEFT JOIN plans p ON p.id = t.plan_id
             LEFT JOIN goals g ON g.id = p.goal_id
             ORDER BY
               t.done ASC,
               CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
               t.due_date ASC NULLS LAST,
               t.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let tasks = stmt
        .query_map([], |row| Ok(map_task_with_context(row)?))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(tasks)
}

#[tauri::command]
pub fn create_task(state: tauri::State<AppState>, payload: CreateTask) -> Result<Task, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let max_order: i64 = match payload.plan_id {
        Some(pid) => db.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM tasks WHERE plan_id=?1",
            [pid], |r| r.get(0),
        ).unwrap_or(-1),
        None => db.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM tasks WHERE plan_id IS NULL",
            [], |r| r.get(0),
        ).unwrap_or(-1),
    };

    let priority = payload.priority.unwrap_or_else(|| "medium".into());
    db.execute(
        "INSERT INTO tasks (plan_id, title, sort_order, priority, due_date, time_estimate) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![payload.plan_id, payload.title, max_order + 1, priority, payload.due_date, payload.time_estimate],
    )
    .map_err(|e| e.to_string())?;

    let id = db.last_insert_rowid();
    fetch_task(&db, id)
}

#[tauri::command]
pub fn update_task(
    state: tauri::State<AppState>,
    id: i64,
    payload: UpdateTask,
) -> Result<Task, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE tasks SET title=?1, priority=?2, due_date=?3, time_estimate=?4 WHERE id=?5",
        params![payload.title, payload.priority, payload.due_date, payload.time_estimate, id],
    )
    .map_err(|e| e.to_string())?;
    fetch_task(&db, id)
}

#[tauri::command]
pub fn toggle_task(state: tauri::State<AppState>, id: i64) -> Result<Task, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE tasks SET done = CASE WHEN done=1 THEN 0 ELSE 1 END WHERE id=?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    fetch_task(&db, id)
}

#[tauri::command]
pub fn delete_task(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM tasks WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_task_kanban_status(state: tauri::State<AppState>, id: i64, status: String) -> Result<Task, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE tasks SET kanban_status=?1 WHERE id=?2",
        params![status, id],
    )
    .map_err(|e| e.to_string())?;
    fetch_task(&db, id)
}

// ── Project Goals ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_project_goals(state: tauri::State<AppState>, plan_id: i64) -> Result<Vec<ProjectGoal>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT id, plan_id, title, done, sort_order FROM project_goals WHERE plan_id=?1 ORDER BY sort_order, id")
        .map_err(|e| e.to_string())?;
    let goals = stmt
        .query_map([plan_id], |row| Ok(ProjectGoal {
            id:         row.get(0)?,
            plan_id:    row.get(1)?,
            title:      row.get(2)?,
            done:       row.get::<_, i64>(3)? != 0,
            sort_order: row.get(4)?,
        }))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(goals)
}

#[tauri::command]
pub fn add_project_goal(state: tauri::State<AppState>, payload: AddProjectGoal) -> Result<ProjectGoal, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let max_order: i64 = db.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) FROM project_goals WHERE plan_id=?1",
        [payload.plan_id], |r| r.get(0),
    ).unwrap_or(-1);
    db.execute(
        "INSERT INTO project_goals (plan_id, title, sort_order) VALUES (?1, ?2, ?3)",
        params![payload.plan_id, payload.title, max_order + 1],
    ).map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    db.query_row(
        "SELECT id, plan_id, title, done, sort_order FROM project_goals WHERE id=?1",
        [id],
        |row| Ok(ProjectGoal {
            id: row.get(0)?, plan_id: row.get(1)?, title: row.get(2)?,
            done: row.get::<_, i64>(3)? != 0, sort_order: row.get(4)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_project_goal(state: tauri::State<AppState>, id: i64) -> Result<ProjectGoal, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE project_goals SET done = CASE WHEN done=1 THEN 0 ELSE 1 END WHERE id=?1",
        [id],
    ).map_err(|e| e.to_string())?;
    db.query_row(
        "SELECT id, plan_id, title, done, sort_order FROM project_goals WHERE id=?1",
        [id],
        |row| Ok(ProjectGoal {
            id: row.get(0)?, plan_id: row.get(1)?, title: row.get(2)?,
            done: row.get::<_, i64>(3)? != 0, sort_order: row.get(4)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_project_goal(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM project_goals WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn fetch_task(db: &rusqlite::Connection, id: i64) -> Result<Task, String> {
    db.query_row(
        "SELECT id, plan_id, title, done, sort_order, priority, due_date, created_at, time_estimate, kanban_status
         FROM tasks WHERE id=?1",
        [id],
        |row| map_task(row),
    )
    .map_err(|e| e.to_string())
}

fn map_task(row: &rusqlite::Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        plan_id: row.get(1)?,
        title: row.get(2)?,
        done: row.get::<_, i64>(3)? == 1,
        sort_order: row.get(4)?,
        priority: row.get(5)?,
        due_date: row.get(6)?,
        created_at: row.get(7)?,
        time_estimate: row.get(8)?,
        kanban_status: row.get::<_, Option<String>>(9)?.unwrap_or_else(|| "backlog".into()),
    })
}

fn map_task_with_context(row: &rusqlite::Row) -> rusqlite::Result<TaskWithContext> {
    Ok(TaskWithContext {
        id: row.get(0)?,
        plan_id: row.get(1)?,
        plan_title: row.get(2)?,
        goal_id: row.get(3)?,
        goal_title: row.get(4)?,
        title: row.get(5)?,
        done: row.get::<_, i64>(6)? == 1,
        sort_order: row.get(7)?,
        priority: row.get(8)?,
        due_date: row.get(9)?,
        created_at: row.get(10)?,
        time_estimate: row.get(11)?,
    })
}

// ── Systems ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_systems(state: tauri::State<AppState>) -> Result<Vec<SystemEntry>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare(
            "SELECT id, title, description, frequency, days_of_week, last_done, streak_count, streak_updated, created_at, start_time, end_time,
                    is_lifestyle, lifestyle_area_id
             FROM systems ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let systems = stmt
        .query_map([], |row| Ok(map_system(row)?))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(systems)
}

#[tauri::command]
pub fn create_system(
    state: tauri::State<AppState>,
    payload: CreateSystem,
) -> Result<SystemEntry, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO systems (title, description, frequency, days_of_week, start_time, end_time, is_lifestyle, lifestyle_area_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![payload.title, payload.description, payload.frequency, payload.days_of_week, payload.start_time, payload.end_time, payload.is_lifestyle.unwrap_or(false) as i64, payload.lifestyle_area_id],
    )
    .map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    fetch_system(&db, id)
}

#[tauri::command]
pub fn update_system(
    state: tauri::State<AppState>,
    id: i64,
    payload: UpdateSystem,
) -> Result<SystemEntry, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE systems SET title=?1, description=?2, frequency=?3, days_of_week=?4, start_time=?5, end_time=?6, is_lifestyle=?7, lifestyle_area_id=?8 WHERE id=?9",
        params![payload.title, payload.description, payload.frequency, payload.days_of_week, payload.start_time, payload.end_time, payload.is_lifestyle.unwrap_or(false) as i64, payload.lifestyle_area_id, id],
    )
    .map_err(|e| e.to_string())?;
    fetch_system(&db, id)
}

#[tauri::command]
pub fn delete_system(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM systems WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn mark_system_done_inner(db: &rusqlite::Connection, id: i64) -> Result<SystemEntry, String> {
    let (frequency, last_done, streak_count, streak_updated): (String, Option<String>, i64, Option<String>) = db
        .query_row(
            "SELECT frequency, last_done, streak_count, streak_updated FROM systems WHERE id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| e.to_string())?;

    let today: String = db
        .query_row("SELECT date('now')", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    if streak_updated.as_deref() == Some(&today) {
        db.execute(
            "UPDATE systems SET last_done = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id=?1",
            [id],
        )
        .map_err(|e| e.to_string())?;
        return fetch_system(db, id);
    }

    let window_days: i64 = match frequency.as_str() {
        "daily" => 1, "weekly" => 7, "monthly" => 30, _ => 1,
    };

    let new_streak = if let Some(last) = &last_done {
        let days_since: i64 = db
            .query_row(
                "SELECT CAST(julianday('now') - julianday(?1) AS INTEGER)",
                [last],
                |r| r.get(0),
            )
            .unwrap_or(999);
        if days_since <= window_days + 1 { streak_count + 1 } else { 1 }
    } else {
        1
    };

    db.execute(
        "UPDATE systems SET last_done = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
                            streak_count = ?2,
                            streak_updated = ?3
         WHERE id=?1",
        params![id, new_streak, today],
    )
    .map_err(|e| e.to_string())?;

    fetch_system(db, id)
}

fn unmark_system_done_inner(db: &rusqlite::Connection, id: i64) -> Result<SystemEntry, String> {
    db.execute(
        "UPDATE systems SET last_done = NULL, streak_count = MAX(0, streak_count - 1), streak_updated = NULL WHERE id=?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    fetch_system(db, id)
}

#[tauri::command]
pub fn mark_system_done(state: tauri::State<AppState>, id: i64) -> Result<SystemEntry, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    mark_system_done_inner(&db, id)
}

#[tauri::command]
pub fn unmark_system_done(state: tauri::State<AppState>, id: i64) -> Result<SystemEntry, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    unmark_system_done_inner(&db, id)
}

// ── System Subtasks ───────────────────────────────────────────────────────────

fn get_subtasks_inner(db: &rusqlite::Connection, system_id: i64, date: &str) -> Result<Vec<SystemSubtask>, String> {
    let mut stmt = db.prepare(
        "SELECT s.id, s.system_id, s.title, s.sort_order,
                (SELECT COUNT(*) FROM system_subtask_completions c WHERE c.subtask_id = s.id AND c.date = ?2) as done
         FROM system_subtasks s
         WHERE s.system_id = ?1
         ORDER BY s.sort_order, s.id",
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![system_id, date], |row| {
        Ok(SystemSubtask {
            id:         row.get(0)?,
            system_id:  row.get(1)?,
            title:      row.get(2)?,
            sort_order: row.get(3)?,
            done:       row.get::<_, i64>(4)? > 0,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn get_system_subtasks(state: tauri::State<AppState>, system_id: i64, date: String) -> Result<Vec<SystemSubtask>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    get_subtasks_inner(&db, system_id, &date)
}

#[tauri::command]
pub fn add_system_subtask(state: tauri::State<AppState>, system_id: i64, title: String) -> Result<Vec<SystemSubtask>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let sort_order: i64 = db
        .query_row("SELECT COALESCE(MAX(sort_order) + 1, 0) FROM system_subtasks WHERE system_id=?1", [system_id], |r| r.get(0))
        .unwrap_or(0);
    db.execute(
        "INSERT INTO system_subtasks (system_id, title, sort_order) VALUES (?1, ?2, ?3)",
        params![system_id, title, sort_order],
    )
    .map_err(|e| e.to_string())?;
    // Return subtasks without date context (all undone)
    get_subtasks_inner(&db, system_id, "")
}

#[tauri::command]
pub fn delete_system_subtask(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM system_subtasks WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn toggle_system_subtask(state: tauri::State<AppState>, subtask_id: i64, date: String) -> Result<SubtaskToggleResult, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let system_id: i64 = db
        .query_row("SELECT system_id FROM system_subtasks WHERE id=?1", [subtask_id], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    let already_done: bool = db
        .query_row(
            "SELECT COUNT(*) FROM system_subtask_completions WHERE subtask_id=?1 AND date=?2",
            params![subtask_id, date],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0) > 0;

    if already_done {
        db.execute(
            "DELETE FROM system_subtask_completions WHERE subtask_id=?1 AND date=?2",
            params![subtask_id, date],
        )
        .map_err(|e| e.to_string())?;

        // Only unmark the system if it was marked done today (by subtask auto-completion)
        let streak_updated: Option<String> = db
            .query_row("SELECT streak_updated FROM systems WHERE id=?1", [system_id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if streak_updated.as_deref() == Some(date.as_str()) {
            unmark_system_done_inner(&db, system_id)?;
        }
    } else {
        db.execute(
            "INSERT OR IGNORE INTO system_subtask_completions (subtask_id, date) VALUES (?1, ?2)",
            params![subtask_id, date],
        )
        .map_err(|e| e.to_string())?;

        // Check if all subtasks are now done for this date
        let total: i64 = db
            .query_row("SELECT COUNT(*) FROM system_subtasks WHERE system_id=?1", [system_id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let done_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM system_subtask_completions c
                  JOIN system_subtasks s ON s.id = c.subtask_id
                  WHERE s.system_id=?1 AND c.date=?2",
                params![system_id, date],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;

        if total > 0 && done_count == total {
            mark_system_done_inner(&db, system_id)?;
        }
    }

    let subtasks = get_subtasks_inner(&db, system_id, &date)?;
    let system   = fetch_system(&db, system_id)?;
    Ok(SubtaskToggleResult { subtasks, system })
}

fn fetch_system(db: &rusqlite::Connection, id: i64) -> Result<SystemEntry, String> {
    db.query_row(
        "SELECT id, title, description, frequency, days_of_week, last_done, streak_count, streak_updated, created_at, start_time, end_time,
                is_lifestyle, lifestyle_area_id
         FROM systems WHERE id=?1",
        [id],
        |row| map_system(row),
    )
    .map_err(|e| e.to_string())
}

fn map_system(row: &rusqlite::Row) -> rusqlite::Result<SystemEntry> {
    Ok(SystemEntry {
        id:                 row.get(0)?,
        title:              row.get(1)?,
        description:        row.get(2)?,
        frequency:          row.get(3)?,
        days_of_week:       row.get(4)?,
        last_done:          row.get(5)?,
        streak_count:       row.get(6)?,
        streak_updated:     row.get(7)?,
        created_at:         row.get(8)?,
        start_time:         row.get(9)?,
        end_time:           row.get(10)?,
        is_lifestyle:       row.get::<_, i64>(11)? != 0,
        lifestyle_area_id:  row.get(12)?,
    })
}

// ── Routines ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_routines(state: tauri::State<AppState>, date: String) -> Result<Routines, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare(
            "SELECT r.id, r.kind, r.title, r.sort_order,
                    CASE WHEN rc.id IS NOT NULL THEN 1 ELSE 0 END
             FROM routines r
             LEFT JOIN routine_completions rc ON rc.routine_id = r.id AND rc.date = ?1
             ORDER BY r.kind, r.sort_order, r.id",
        )
        .map_err(|e| e.to_string())?;

    let all: Vec<RoutineItem> = stmt
        .query_map([&date], |row| {
            Ok(RoutineItem {
                id:         row.get(0)?,
                kind:       row.get(1)?,
                title:      row.get(2)?,
                sort_order: row.get(3)?,
                done:       row.get::<_, i64>(4)? == 1,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    let morning = all.iter().filter(|r| r.kind == "morning").cloned().collect();
    let evening = all.iter().filter(|r| r.kind == "evening").cloned().collect();
    Ok(Routines { morning, evening })
}

#[tauri::command]
pub fn toggle_routine(
    state: tauri::State<AppState>,
    id: i64,
    date: String,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let exists: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM routine_completions WHERE routine_id=?1 AND date=?2",
            params![id, &date],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    if exists > 0 {
        db.execute(
            "DELETE FROM routine_completions WHERE routine_id=?1 AND date=?2",
            params![id, date],
        )
        .map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        db.execute(
            "INSERT INTO routine_completions (routine_id, date) VALUES (?1, ?2)",
            params![id, date],
        )
        .map_err(|e| e.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
pub fn add_routine_item(
    state: tauri::State<AppState>,
    kind: String,
    title: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let max_order: i64 = db
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM routines WHERE kind=?1",
            [&kind],
            |r| r.get(0),
        )
        .unwrap_or(-1);
    db.execute(
        "INSERT INTO routines (kind, title, sort_order) VALUES (?1, ?2, ?3)",
        params![kind, title.trim(), max_order + 1],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_routine_item(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM routines WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Time Blocks ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_time_blocks(state: tauri::State<AppState>, date: String) -> Result<Vec<TimeBlock>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT id, date, slot, label FROM time_blocks WHERE date=?1 ORDER BY slot")
        .map_err(|e| e.to_string())?;
    let blocks = stmt
        .query_map([&date], |row| {
            Ok(TimeBlock {
                id: row.get(0)?,
                date: row.get(1)?,
                slot: row.get(2)?,
                label: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(blocks)
}

#[tauri::command]
pub fn save_time_block(
    state: tauri::State<AppState>,
    date: String,
    slot: String,
    label: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if label.trim().is_empty() {
        db.execute(
            "DELETE FROM time_blocks WHERE date=?1 AND slot=?2",
            params![date, slot],
        )
        .map_err(|e| e.to_string())?;
    } else {
        db.execute(
            "INSERT INTO time_blocks (date, slot, label) VALUES (?1, ?2, ?3)
             ON CONFLICT(date, slot) DO UPDATE SET label=excluded.label",
            params![date, slot, label.trim()],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Daily Template ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_daily_plan(state: tauri::State<AppState>, date: String) -> Result<DailyPlan, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare("SELECT id, title, color, sort_order FROM daily_sections ORDER BY sort_order, id")
        .map_err(|e| e.to_string())?;

    let section_metas: Vec<(i64, String, String, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    let mut sections = Vec::new();
    let mut total_items: i64 = 0;
    let mut done_items: i64 = 0;

    for (section_id, title, color, sort_order) in section_metas {
        let mut item_stmt = db
            .prepare(
                "SELECT i.id, i.section_id, i.title, i.sort_order,
                        CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END
                 FROM daily_items i
                 LEFT JOIN daily_completions c ON c.item_id = i.id AND c.date = ?2
                 WHERE i.section_id = ?1
                 ORDER BY i.sort_order, i.id",
            )
            .map_err(|e| e.to_string())?;

        let items: Vec<DailyItemWithStatus> = item_stmt
            .query_map(params![section_id, &date], |row| {
                Ok(DailyItemWithStatus {
                    id: row.get(0)?,
                    section_id: row.get(1)?,
                    title: row.get(2)?,
                    sort_order: row.get(3)?,
                    done: row.get::<_, i64>(4)? == 1,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?;

        total_items += items.len() as i64;
        done_items += items.iter().filter(|i| i.done).count() as i64;
        sections.push(DailySection { id: section_id, title, color, sort_order, items });
    }

    Ok(DailyPlan { date, sections, total_items, done_items })
}

#[tauri::command]
pub fn toggle_daily_completion(
    state: tauri::State<AppState>,
    item_id: i64,
    date: String,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let exists: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM daily_completions WHERE item_id=?1 AND date=?2",
            params![item_id, &date],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    if exists > 0 {
        db.execute(
            "DELETE FROM daily_completions WHERE item_id=?1 AND date=?2",
            params![item_id, date],
        )
        .map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        db.execute(
            "INSERT INTO daily_completions (item_id, date) VALUES (?1, ?2)",
            params![item_id, date],
        )
        .map_err(|e| e.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
pub fn create_daily_section(
    state: tauri::State<AppState>,
    payload: CreateDailySection,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let color = payload.color.unwrap_or_else(|| "blue".into());
    let max_order: i64 = db
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM daily_sections",
            [],
            |r| r.get(0),
        )
        .unwrap_or(-1);
    db.execute(
        "INSERT INTO daily_sections (title, color, sort_order) VALUES (?1, ?2, ?3)",
        params![payload.title, color, max_order + 1],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_daily_section(
    state: tauri::State<AppState>,
    id: i64,
    payload: UpdateDailySection,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE daily_sections SET title=?1, color=?2, sort_order=?3 WHERE id=?4",
        params![payload.title, payload.color, payload.sort_order, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_daily_section(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM daily_sections WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn create_daily_item(
    state: tauri::State<AppState>,
    payload: CreateDailyItem,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let max_order: i64 = db
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM daily_items WHERE section_id=?1",
            [payload.section_id],
            |r| r.get(0),
        )
        .unwrap_or(-1);
    db.execute(
        "INSERT INTO daily_items (section_id, title, sort_order) VALUES (?1, ?2, ?3)",
        params![payload.section_id, payload.title, max_order + 1],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_daily_item(
    state: tauri::State<AppState>,
    id: i64,
    payload: UpdateDailyItem,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE daily_items SET title=?1, sort_order=?2 WHERE id=?3",
        params![payload.title, payload.sort_order, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_daily_item(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM daily_items WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Lifestyle Areas ───────────────────────────────────────────────────────────

fn fetch_lifestyle_area(db: &rusqlite::Connection, id: i64) -> Result<LifestyleArea, String> {
    db.query_row(
        "SELECT id, name, color, sort_order FROM lifestyle_areas WHERE id=?1",
        [id],
        |row| Ok(LifestyleArea { id: row.get(0)?, name: row.get(1)?, color: row.get(2)?, sort_order: row.get(3)? }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_lifestyle_areas(state: tauri::State<AppState>) -> Result<Vec<LifestyleArea>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT id, name, color, sort_order FROM lifestyle_areas ORDER BY sort_order, id"
    ).map_err(|e| e.to_string())?;
    let areas = stmt.query_map([], |row| Ok(LifestyleArea {
        id: row.get(0)?, name: row.get(1)?, color: row.get(2)?, sort_order: row.get(3)?,
    })).map_err(|e| e.to_string())?
    .collect::<rusqlite::Result<Vec<_>>>()
    .map_err(|e| e.to_string())?;
    Ok(areas)
}

#[tauri::command]
pub fn create_lifestyle_area(state: tauri::State<AppState>, name: String, color: String) -> Result<LifestyleArea, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let sort_order: i64 = db
        .query_row("SELECT COALESCE(MAX(sort_order) + 1, 0) FROM lifestyle_areas", [], |r| r.get(0))
        .unwrap_or(0);
    db.execute(
        "INSERT INTO lifestyle_areas (name, color, sort_order) VALUES (?1, ?2, ?3)",
        params![name, color, sort_order],
    ).map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    fetch_lifestyle_area(&db, id)
}

#[tauri::command]
pub fn update_lifestyle_area(state: tauri::State<AppState>, id: i64, name: String, color: String, sort_order: i64) -> Result<LifestyleArea, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE lifestyle_areas SET name=?1, color=?2, sort_order=?3 WHERE id=?4",
        params![name, color, sort_order, id],
    ).map_err(|e| e.to_string())?;
    fetch_lifestyle_area(&db, id)
}

#[tauri::command]
pub fn delete_lifestyle_area(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM lifestyle_areas WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_lifestyle_items(state: tauri::State<AppState>, area_id: Option<i64>) -> Result<LifestyleItems, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let mut sys_stmt = db.prepare(
        "SELECT id, title, description, frequency, days_of_week, last_done, streak_count, streak_updated,
                created_at, start_time, end_time, is_lifestyle, lifestyle_area_id
         FROM systems
         WHERE is_lifestyle = 1
           AND (?1 IS NULL OR lifestyle_area_id = ?1)
         ORDER BY lifestyle_area_id, created_at",
    ).map_err(|e| e.to_string())?;
    let systems = sys_stmt.query_map(params![area_id], |row| Ok(map_system(row)?))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    let mut plan_stmt = db.prepare(
        "SELECT p.id, p.goal_id, p.title, p.description, p.deadline, p.status, p.created_at,
                COUNT(t.id), SUM(CASE WHEN t.done=1 THEN 1 ELSE 0 END),
                p.tags, p.is_course, p.is_lifestyle, p.lifestyle_area_id
         FROM plans p
         LEFT JOIN tasks t ON t.plan_id = p.id
         WHERE p.is_lifestyle = 1
           AND (?1 IS NULL OR p.lifestyle_area_id = ?1)
         GROUP BY p.id
         ORDER BY p.created_at DESC",
    ).map_err(|e| e.to_string())?;
    let plans = plan_stmt.query_map(params![area_id], |row| Ok(map_plan(row)?))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    Ok(LifestyleItems { systems, plans })
}

// ── Week View ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_week_items(
    state: tauri::State<AppState>,
    start_date: String,
    end_date: String,
) -> Result<WeekItems, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare(
            "SELECT t.id, t.plan_id, p.title, p.goal_id, g.title,
                    t.title, t.done, t.sort_order, t.priority, t.due_date, t.created_at, t.time_estimate
             FROM tasks t
             LEFT JOIN plans p ON p.id = t.plan_id
             LEFT JOIN goals g ON g.id = p.goal_id
             WHERE t.due_date BETWEEN ?1 AND ?2
             ORDER BY t.due_date,
                      CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END",
        )
        .map_err(|e| e.to_string())?;
    let tasks = stmt
        .query_map(params![&start_date, &end_date], |row| {
            Ok(map_task_with_context(row)?)
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    let goals_sql = format!(
        "{} WHERE g.deadline BETWEEN ?1 AND ?2 GROUP BY g.id ORDER BY g.deadline, CASE g.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END",
        GOAL_SELECT
    );
    let mut stmt = db.prepare(&goals_sql).map_err(|e| e.to_string())?;
    let goals = stmt
        .query_map(params![&start_date, &end_date], |row| Ok(map_goal(row)?))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare(
            "SELECT p.id, p.goal_id, p.title, p.description, p.deadline, p.status, p.created_at,
                    COUNT(t.id), SUM(CASE WHEN t.done=1 THEN 1 ELSE 0 END),
                    p.tags, p.is_course, p.is_lifestyle, p.lifestyle_area_id
             FROM plans p
             LEFT JOIN tasks t ON t.plan_id = p.id
             WHERE p.deadline BETWEEN ?1 AND ?2
             GROUP BY p.id
             ORDER BY p.deadline",
        )
        .map_err(|e| e.to_string())?;
    let plans = stmt
        .query_map(params![&start_date, &end_date], |row| Ok(map_plan(row)?))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare(
            "SELECT id, title, due_date, done, created_at FROM deadlines
             WHERE due_date BETWEEN ?1 AND ?2
             ORDER BY due_date, done ASC",
        )
        .map_err(|e| e.to_string())?;
    let deadlines = stmt
        .query_map(params![&start_date, &end_date], map_deadline)
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare(
            "SELECT id, title, done, due_date, created_at FROM reminders
             WHERE due_date IS NOT NULL AND due_date BETWEEN ?1 AND ?2
             ORDER BY due_date, done ASC",
        )
        .map_err(|e| e.to_string())?;
    let reminders = stmt
        .query_map(params![&start_date, &end_date], map_reminder)
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare(
            "SELECT ca.id, ca.plan_id, p.title,
                    ca.title, ca.assignment_type, ca.due_date, ca.status, ca.priority,
                    ca.book_title, ca.chapter_start, ca.chapter_end,
                    ca.page_start, ca.page_end, ca.page_current,
                    ca.notes, ca.created_at, ca.start_time, ca.end_time, ca.time_estimate
             FROM course_assignments ca
             JOIN plans p ON p.id = ca.plan_id
             WHERE ca.due_date BETWEEN ?1 AND ?2
               AND p.is_course = 1
             ORDER BY ca.due_date,
                      CASE ca.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END",
        )
        .map_err(|e| e.to_string())?;
    let course_assignments = stmt
        .query_map(params![&start_date, &end_date], |row| {
            Ok(CourseAssignment {
                id:              row.get(0)?,
                plan_id:         row.get(1)?,
                plan_title:      row.get(2)?,
                title:           row.get(3)?,
                assignment_type: row.get(4)?,
                due_date:        row.get(5)?,
                status:          row.get(6)?,
                priority:        row.get(7)?,
                book_title:      row.get(8)?,
                chapter_start:   row.get(9)?,
                chapter_end:     row.get(10)?,
                page_start:      row.get(11)?,
                page_end:        row.get(12)?,
                page_current:    row.get(13)?,
                notes:           row.get(14)?,
                created_at:      row.get(15)?,
                start_time:      row.get(16)?,
                end_time:        row.get(17)?,
                time_estimate:   row.get(18)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    Ok(WeekItems { tasks, goals, plans, deadlines, reminders, course_assignments })
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_today_focus(state: tauri::State<AppState>) -> Result<TodayFocus, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let tasks_due_today = db
        .prepare(
            "SELECT t.id, t.plan_id, p.title, p.goal_id, g.title,
                    t.title, t.done, t.sort_order, t.priority, t.due_date, t.created_at, t.time_estimate
             FROM tasks t
             JOIN plans p ON p.id = t.plan_id
             LEFT JOIN goals g ON g.id = p.goal_id
             WHERE t.done=0 AND t.due_date = date('now')
             ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END",
        )
        .and_then(|mut s| {
            s.query_map([], |row| Ok(map_task_with_context(row)?))
                .and_then(|r| r.collect::<rusqlite::Result<Vec<_>>>())
        })
        .map_err(|e| e.to_string())?;

    let overdue_tasks = db
        .prepare(
            "SELECT t.id, t.plan_id, p.title, p.goal_id, g.title,
                    t.title, t.done, t.sort_order, t.priority, t.due_date, t.created_at, t.time_estimate
             FROM tasks t
             JOIN plans p ON p.id = t.plan_id
             LEFT JOIN goals g ON g.id = p.goal_id
             WHERE t.done=0 AND t.due_date < date('now')
             ORDER BY t.due_date ASC, CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END",
        )
        .and_then(|mut s| {
            s.query_map([], |row| Ok(map_task_with_context(row)?))
                .and_then(|r| r.collect::<rusqlite::Result<Vec<_>>>())
        })
        .map_err(|e| e.to_string())?;

    // Due systems: last_done is null OR enough time has passed for the frequency
    let systems_due = db
        .prepare(
            "SELECT id, title, description, frequency, days_of_week, last_done, streak_count, streak_updated, created_at, start_time, end_time,
                    is_lifestyle, lifestyle_area_id
             FROM systems
             WHERE last_done IS NULL
                OR (frequency='daily'   AND date(last_done) < date('now'))
                OR (frequency='weekly'  AND date(last_done) < date('now', '-7 days'))
                OR (frequency='monthly' AND date(last_done) < date('now', '-30 days'))
             ORDER BY created_at",
        )
        .and_then(|mut s| {
            s.query_map([], |row| Ok(map_system(row)?))
                .and_then(|r| r.collect::<rusqlite::Result<Vec<_>>>())
        })
        .map_err(|e| e.to_string())?;

    Ok(TodayFocus {
        tasks_due_today,
        overdue_tasks,
        systems_due,
    })
}

#[tauri::command]
pub fn search(state: tauri::State<AppState>, query: String) -> Result<Vec<SearchResult>, String> {
    if query.trim().len() < 2 {
        return Ok(vec![]);
    }
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let pattern = format!("%{}%", query.to_lowercase());
    let mut results = Vec::new();

    // Goals
    let mut stmt = db
        .prepare("SELECT id, title, status FROM goals WHERE lower(title) LIKE ?1 LIMIT 5")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&pattern], |r| {
            Ok(SearchResult {
                kind: "goal".into(),
                id: r.get(0)?,
                title: r.get(1)?,
                subtitle: r.get::<_, Option<String>>(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for r in rows { results.push(r.map_err(|e| e.to_string())?); }

    // Plans
    let mut stmt = db
        .prepare("SELECT id, title, status FROM plans WHERE lower(title) LIKE ?1 LIMIT 5")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&pattern], |r| {
            Ok(SearchResult {
                kind: "plan".into(),
                id: r.get(0)?,
                title: r.get(1)?,
                subtitle: r.get::<_, Option<String>>(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for r in rows { results.push(r.map_err(|e| e.to_string())?); }

    // Tasks (with plan context)
    let mut stmt = db
        .prepare(
            "SELECT t.id, t.title, p.title FROM tasks t
             JOIN plans p ON p.id = t.plan_id
             WHERE lower(t.title) LIKE ?1 LIMIT 5",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&pattern], |r| {
            Ok(SearchResult {
                kind: "task".into(),
                id: r.get(0)?,
                title: r.get(1)?,
                subtitle: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for r in rows { results.push(r.map_err(|e| e.to_string())?); }

    // Systems
    let mut stmt = db
        .prepare("SELECT id, title, frequency FROM systems WHERE lower(title) LIKE ?1 LIMIT 5")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&pattern], |r| {
            Ok(SearchResult {
                kind: "system".into(),
                id: r.get(0)?,
                title: r.get(1)?,
                subtitle: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for r in rows { results.push(r.map_err(|e| e.to_string())?); }

    Ok(results)
}

// ── Reminders ─────────────────────────────────────────────────────────────────

fn map_reminder(r: &rusqlite::Row) -> rusqlite::Result<Reminder> {
    Ok(Reminder {
        id:         r.get(0)?,
        title:      r.get(1)?,
        done:       r.get::<_, i64>(2)? != 0,
        due_date:   r.get(3)?,
        created_at: r.get(4)?,
    })
}

#[tauri::command]
pub fn get_reminders(state: tauri::State<AppState>) -> Result<Vec<Reminder>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT id, title, done, due_date, created_at FROM reminders ORDER BY done ASC, created_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_reminder)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn add_reminder(title: String, due_date: Option<String>, state: tauri::State<AppState>) -> Result<Reminder, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO reminders (title, due_date) VALUES (?1, ?2)",
        params![title, due_date],
    ).map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    db.query_row(
        "SELECT id, title, done, due_date, created_at FROM reminders WHERE id = ?1",
        [id],
        map_reminder,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_reminder(id: i64, state: tauri::State<AppState>) -> Result<Reminder, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("UPDATE reminders SET done = NOT done WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    db.query_row(
        "SELECT id, title, done, due_date, created_at FROM reminders WHERE id = ?1",
        [id],
        map_reminder,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_reminder(id: i64, state: tauri::State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM reminders WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Quick Notes ───────────────────────────────────────────────────────────────

fn map_quick_note(r: &rusqlite::Row) -> rusqlite::Result<QuickNote> {
    Ok(QuickNote { id: r.get(0)?, title: r.get(1)?, body: r.get(2)?, created_at: r.get(3)? })
}

#[tauri::command]
pub fn get_quick_notes(state: tauri::State<AppState>) -> Result<Vec<QuickNote>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare("SELECT id, title, body, created_at FROM quick_notes ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], map_quick_note)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn add_quick_note(title: String, body: Option<String>, state: tauri::State<AppState>) -> Result<QuickNote, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("INSERT INTO quick_notes (title, body) VALUES (?1, ?2)", params![title, body])
        .map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    db.query_row("SELECT id, title, body, created_at FROM quick_notes WHERE id = ?1", [id], map_quick_note)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_quick_note(id: i64, state: tauri::State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM quick_notes WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Brain Dump ────────────────────────────────────────────────────────────────

fn map_brain_entry(r: &rusqlite::Row) -> rusqlite::Result<BrainEntry> {
    Ok(BrainEntry { id: r.get(0)?, content: r.get(1)?, created_at: r.get(2)? })
}

#[tauri::command]
pub fn get_brain_dump(state: tauri::State<AppState>) -> Result<Vec<BrainEntry>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare("SELECT id, content, created_at FROM brain_dump ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], map_brain_entry)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn add_brain_entry(content: String, state: tauri::State<AppState>) -> Result<BrainEntry, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("INSERT INTO brain_dump (content) VALUES (?1)", [&content])
        .map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    db.query_row("SELECT id, content, created_at FROM brain_dump WHERE id = ?1", [id], map_brain_entry)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_brain_entry(id: i64, state: tauri::State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM brain_dump WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Events ────────────────────────────────────────────────────────────────────

fn map_event(r: &rusqlite::Row) -> rusqlite::Result<CalEvent> {
    Ok(CalEvent { id: r.get(0)?, title: r.get(1)?, date: r.get(2)?, description: r.get(3)?, created_at: r.get(4)? })
}

#[tauri::command]
pub fn get_events(state: tauri::State<AppState>) -> Result<Vec<CalEvent>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare("SELECT id, title, date, description, created_at FROM events ORDER BY date ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], map_event)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn add_event(title: String, date: String, description: Option<String>, state: tauri::State<AppState>) -> Result<CalEvent, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("INSERT INTO events (title, date, description) VALUES (?1, ?2, ?3)", params![title, date, description])
        .map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    db.query_row("SELECT id, title, date, description, created_at FROM events WHERE id = ?1", [id], map_event)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_event(id: i64, state: tauri::State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM events WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Deadlines ─────────────────────────────────────────────────────────────────

fn map_deadline(r: &rusqlite::Row) -> rusqlite::Result<Deadline> {
    Ok(Deadline { id: r.get(0)?, title: r.get(1)?, due_date: r.get(2)?, done: r.get::<_, i64>(3)? != 0, created_at: r.get(4)? })
}

#[tauri::command]
pub fn get_deadlines(state: tauri::State<AppState>) -> Result<Vec<Deadline>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare("SELECT id, title, due_date, done, created_at FROM deadlines ORDER BY done ASC, due_date ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], map_deadline)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn add_deadline(title: String, due_date: String, state: tauri::State<AppState>) -> Result<Deadline, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("INSERT INTO deadlines (title, due_date) VALUES (?1, ?2)", params![title, due_date])
        .map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    db.query_row("SELECT id, title, due_date, done, created_at FROM deadlines WHERE id = ?1", [id], map_deadline)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_deadline(id: i64, state: tauri::State<AppState>) -> Result<Deadline, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("UPDATE deadlines SET done = NOT done WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    db.query_row("SELECT id, title, due_date, done, created_at FROM deadlines WHERE id = ?1", [id], map_deadline)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_deadline(id: i64, state: tauri::State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM deadlines WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Agreements ────────────────────────────────────────────────────────────────

fn map_agreement(r: &rusqlite::Row) -> rusqlite::Result<Agreement> {
    Ok(Agreement { id: r.get(0)?, title: r.get(1)?, notes: r.get(2)?, created_at: r.get(3)? })
}

#[tauri::command]
pub fn get_agreements(state: tauri::State<AppState>) -> Result<Vec<Agreement>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare("SELECT id, title, notes, created_at FROM agreements ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], map_agreement)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn add_agreement(title: String, notes: Option<String>, state: tauri::State<AppState>) -> Result<Agreement, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("INSERT INTO agreements (title, notes) VALUES (?1, ?2)", params![title, notes])
        .map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    db.query_row("SELECT id, title, notes, created_at FROM agreements WHERE id = ?1", [id], map_agreement)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_agreement(id: i64, state: tauri::State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM agreements WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Calendar Blocks ───────────────────────────────────────────────────────────

fn map_cal_block(r: &rusqlite::Row) -> rusqlite::Result<CalBlock> {
    Ok(CalBlock {
        id:          r.get(0)?,
        date:        r.get(1)?,
        title:       r.get(2)?,
        start_time:  r.get(3)?,
        end_time:    r.get(4)?,
        color:       r.get(5)?,
        description: r.get(6)?,
        location:    r.get(7)?,
        created_at:  r.get(8)?,
        is_recurring: false,
        recurring_id: None,
        recurrence: None,
        days_of_week: None,
        series_start_date: None,
        series_end_date: None,
    })
}

// Date helpers for recurring expansion

fn is_leap_year(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn next_day(date: &str) -> String {
    let y: i32 = date[0..4].parse().unwrap_or(2024);
    let m: i32 = date[5..7].parse().unwrap_or(1);
    let d: i32 = date[8..10].parse().unwrap_or(1);
    let days_in_month = [0i32, 31, if is_leap_year(y) { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if d < days_in_month[m as usize] {
        format!("{:04}-{:02}-{:02}", y, m, d + 1)
    } else if m < 12 {
        format!("{:04}-{:02}-{:02}", y, m + 1, 1)
    } else {
        format!("{:04}-{:02}-{:02}", y + 1, 1, 1)
    }
}

fn day_of_week(date: &str) -> u32 {
    // Tomohiko Sakamoto's algorithm — 0=Sun, 1=Mon, ..., 6=Sat
    let t: [u32; 12] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let mut y: u32 = date[0..4].parse().unwrap_or(2024);
    let m: u32 = date[5..7].parse().unwrap_or(1);
    let d: u32 = date[8..10].parse().unwrap_or(1);
    if m < 3 { y -= 1; }
    (y + y/4 - y/100 + y/400 + t[(m - 1) as usize] + d) % 7
}

fn is_recurring_on_date(rec: &RecurringCalBlock, date: &str) -> bool {
    if date < rec.start_date.as_str() { return false; }
    if let Some(end) = &rec.end_date { if date > end.as_str() { return false; } }
    let dow = day_of_week(date);
    match rec.recurrence.as_str() {
        "daily"    => true,
        "weekdays" => dow >= 1 && dow <= 5,
        "monthly"  => &date[8..10] == &rec.start_date[8..10],
        "weekly"   => {
            let allowed: Vec<u32> = rec.days_of_week.as_deref().unwrap_or("")
                .split(',').filter_map(|s| s.trim().parse().ok()).collect();
            allowed.contains(&dow)
        }
        _ => false,
    }
}

#[tauri::command]
pub fn get_cal_blocks(start_date: String, end_date: String, state: tauri::State<AppState>) -> Result<Vec<CalBlock>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Regular one-off blocks
    let mut stmt = db
        .prepare("SELECT id, date, title, start_time, end_time, color, description, location, created_at FROM cal_blocks WHERE date >= ?1 AND date <= ?2 ORDER BY date ASC, start_time ASC")
        .map_err(|e| e.to_string())?;
    let mut blocks: Vec<CalBlock> = stmt
        .query_map(params![start_date, end_date], map_cal_block)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Recurring series that overlap the requested range
    let mut rstmt = db
        .prepare("SELECT id, title, start_time, end_time, color, recurrence, days_of_week, start_date, end_date, description, location, created_at FROM recurring_cal_blocks WHERE start_date <= ?2 AND (end_date IS NULL OR end_date >= ?1)")
        .map_err(|e| e.to_string())?;
    let recurring: Vec<RecurringCalBlock> = rstmt
        .query_map(params![start_date, end_date], |r| Ok(RecurringCalBlock {
            id:           r.get(0)?,
            title:        r.get(1)?,
            start_time:   r.get(2)?,
            end_time:     r.get(3)?,
            color:        r.get(4)?,
            recurrence:   r.get(5)?,
            days_of_week: r.get(6)?,
            start_date:   r.get(7)?,
            end_date:     r.get(8)?,
            description:  r.get(9)?,
            location:     r.get(10)?,
            created_at:   r.get(11)?,
        }))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Expand each recurring series into individual CalBlock instances
    let mut cur = start_date.clone();
    while cur.as_str() <= end_date.as_str() {
        for rec in &recurring {
            if is_recurring_on_date(rec, &cur) {
                blocks.push(CalBlock {
                    id: rec.id,
                    date: cur.clone(),
                    title: rec.title.clone(),
                    start_time: rec.start_time.clone(),
                    end_time: rec.end_time.clone(),
                    color: rec.color.clone(),
                    created_at: rec.created_at.clone(),
                    description: rec.description.clone(),
                    location: rec.location.clone(),
                    is_recurring: true,
                    recurring_id: Some(rec.id),
                    recurrence: Some(rec.recurrence.clone()),
                    days_of_week: rec.days_of_week.clone(),
                    series_start_date: Some(rec.start_date.clone()),
                    series_end_date: rec.end_date.clone(),
                });
            }
        }
        cur = next_day(&cur);
    }

    blocks.sort_by(|a, b| a.date.cmp(&b.date).then(a.start_time.cmp(&b.start_time)));
    Ok(blocks)
}

#[tauri::command]
pub fn create_cal_block(date: String, title: String, start_time: String, end_time: String, color: String, description: Option<String>, location: Option<String>, state: tauri::State<AppState>) -> Result<CalBlock, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO cal_blocks (date, title, start_time, end_time, color, description, location) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![date, title, start_time, end_time, color, description, location],
    ).map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    db.query_row(
        "SELECT id, date, title, start_time, end_time, color, description, location, created_at FROM cal_blocks WHERE id = ?1",
        [id], map_cal_block,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_cal_block(id: i64, title: String, start_time: String, end_time: String, color: String, description: Option<String>, location: Option<String>, state: tauri::State<AppState>) -> Result<CalBlock, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE cal_blocks SET title=?1, start_time=?2, end_time=?3, color=?4, description=?5, location=?6 WHERE id=?7",
        params![title, start_time, end_time, color, description, location, id],
    ).map_err(|e| e.to_string())?;
    db.query_row(
        "SELECT id, date, title, start_time, end_time, color, description, location, created_at FROM cal_blocks WHERE id = ?1",
        [id], map_cal_block,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_cal_block(id: i64, state: tauri::State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM cal_blocks WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn create_recurring_cal_block(
    title: String, start_time: String, end_time: String, color: String,
    recurrence: String, days_of_week: Option<String>, start_date: String, end_date: Option<String>,
    description: Option<String>, location: Option<String>,
    state: tauri::State<AppState>,
) -> Result<RecurringCalBlock, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO recurring_cal_blocks (title,start_time,end_time,color,recurrence,days_of_week,start_date,end_date,description,location) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![title, start_time, end_time, color, recurrence, days_of_week, start_date, end_date, description, location],
    ).map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    db.query_row(
        "SELECT id,title,start_time,end_time,color,recurrence,days_of_week,start_date,end_date,description,location,created_at FROM recurring_cal_blocks WHERE id=?1",
        [id],
        |r| Ok(RecurringCalBlock { id: r.get(0)?, title: r.get(1)?, start_time: r.get(2)?, end_time: r.get(3)?, color: r.get(4)?, recurrence: r.get(5)?, days_of_week: r.get(6)?, start_date: r.get(7)?, end_date: r.get(8)?, description: r.get(9)?, location: r.get(10)?, created_at: r.get(11)? }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_recurring_cal_block(
    id: i64, title: String, start_time: String, end_time: String, color: String,
    recurrence: String, days_of_week: Option<String>, end_date: Option<String>,
    description: Option<String>, location: Option<String>,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE recurring_cal_blocks SET title=?1,start_time=?2,end_time=?3,color=?4,recurrence=?5,days_of_week=?6,end_date=?7,description=?8,location=?9 WHERE id=?10",
        params![title, start_time, end_time, color, recurrence, days_of_week, end_date, description, location, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_recurring_cal_block(id: i64, state: tauri::State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM recurring_cal_blocks WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Daily Goals ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_daily_goals(date: String, state: tauri::State<AppState>) -> Result<DailyGoals, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let primary: Option<String> = db
        .query_row("SELECT text FROM daily_primary_goal WHERE date = ?1", [&date], |r| r.get(0))
        .ok();

    let mut stmt = db
        .prepare("SELECT id, date, text, sort_order FROM daily_secondary_goals WHERE date = ?1 ORDER BY sort_order ASC, id ASC")
        .map_err(|e| e.to_string())?;
    let secondary = stmt
        .query_map([&date], |r| Ok(DailySecGoal { id: r.get(0)?, date: r.get(1)?, text: r.get(2)?, sort_order: r.get(3)? }))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(DailyGoals { primary, secondary })
}

#[tauri::command]
pub fn set_daily_primary_goal(date: String, text: String, state: tauri::State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO daily_primary_goal (date, text) VALUES (?1, ?2)
         ON CONFLICT(date) DO UPDATE SET text = excluded.text",
        params![date, text],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clear_daily_primary_goal(date: String, state: tauri::State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM daily_primary_goal WHERE date = ?1", [&date])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn add_daily_secondary_goal(date: String, text: String, state: tauri::State<AppState>) -> Result<DailySecGoal, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let sort_order: i64 = db
        .query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM daily_secondary_goals WHERE date = ?1", [&date], |r| r.get(0))
        .unwrap_or(0);
    db.execute(
        "INSERT INTO daily_secondary_goals (date, text, sort_order) VALUES (?1, ?2, ?3)",
        params![date, text, sort_order],
    ).map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    db.query_row(
        "SELECT id, date, text, sort_order FROM daily_secondary_goals WHERE id = ?1",
        [id],
        |r| Ok(DailySecGoal { id: r.get(0)?, date: r.get(1)?, text: r.get(2)?, sort_order: r.get(3)? }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_daily_secondary_goal(id: i64, state: tauri::State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM daily_secondary_goals WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Course Assignments ────────────────────────────────────────────────────────

const CA_SELECT: &str =
    "SELECT ca.id, ca.plan_id, p.title, ca.title, ca.assignment_type, ca.due_date,
            ca.status, ca.priority, ca.book_title, ca.chapter_start, ca.chapter_end,
            ca.page_start, ca.page_end, ca.page_current, ca.notes, ca.created_at,
            ca.start_time, ca.end_time, ca.time_estimate
     FROM course_assignments ca
     JOIN plans p ON p.id = ca.plan_id";

fn map_ca(row: &rusqlite::Row) -> rusqlite::Result<CourseAssignment> {
    Ok(CourseAssignment {
        id:              row.get(0)?,
        plan_id:         row.get(1)?,
        plan_title:      row.get(2)?,
        title:           row.get(3)?,
        assignment_type: row.get(4)?,
        due_date:        row.get(5)?,
        status:          row.get(6)?,
        priority:        row.get(7)?,
        book_title:      row.get(8)?,
        chapter_start:   row.get(9)?,
        chapter_end:     row.get(10)?,
        page_start:      row.get(11)?,
        page_end:        row.get(12)?,
        page_current:    row.get(13)?,
        notes:           row.get(14)?,
        created_at:      row.get(15)?,
        start_time:      row.get(16)?,
        end_time:        row.get(17)?,
        time_estimate:   row.get(18)?,
    })
}

fn fetch_ca(db: &rusqlite::Connection, id: i64) -> Result<CourseAssignment, String> {
    db.query_row(
        "SELECT ca.id, ca.plan_id, p.title, ca.title, ca.assignment_type, ca.due_date,
                ca.status, ca.priority, ca.book_title, ca.chapter_start, ca.chapter_end,
                ca.page_start, ca.page_end, ca.page_current, ca.notes, ca.created_at,
                ca.start_time, ca.end_time, ca.time_estimate
         FROM course_assignments ca
         JOIN plans p ON p.id = ca.plan_id
         WHERE ca.id = ?1",
        [id],
        map_ca,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_course_assignments(state: tauri::State<AppState>) -> Result<Vec<CourseAssignment>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT ca.id, ca.plan_id, p.title, ca.title, ca.assignment_type, ca.due_date,
                ca.status, ca.priority, ca.book_title, ca.chapter_start, ca.chapter_end,
                ca.page_start, ca.page_end, ca.page_current, ca.notes, ca.created_at,
                ca.start_time, ca.end_time, ca.time_estimate
         FROM course_assignments ca
         JOIN plans p ON p.id = ca.plan_id
         ORDER BY CASE WHEN ca.due_date IS NULL THEN 1 ELSE 0 END, ca.due_date ASC, ca.created_at ASC",
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_ca)
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn create_course_assignment(
    state: tauri::State<AppState>,
    payload: CreateCourseAssignment,
) -> Result<CourseAssignment, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO course_assignments
         (plan_id, title, assignment_type, due_date, status, priority,
          book_title, chapter_start, chapter_end, page_start, page_end, page_current, notes,
          start_time, end_time, time_estimate)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
        params![
            payload.plan_id, payload.title, payload.assignment_type, payload.due_date,
            payload.status, payload.priority,
            payload.book_title, payload.chapter_start, payload.chapter_end,
            payload.page_start, payload.page_end, payload.page_current, payload.notes,
            payload.start_time, payload.end_time, payload.time_estimate
        ],
    ).map_err(|e| e.to_string())?;
    fetch_ca(&db, db.last_insert_rowid())
}

#[tauri::command]
pub fn update_course_assignment(
    state: tauri::State<AppState>,
    id: i64,
    payload: UpdateCourseAssignment,
) -> Result<CourseAssignment, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE course_assignments SET
         plan_id=?1, title=?2, assignment_type=?3, due_date=?4, status=?5, priority=?6,
         book_title=?7, chapter_start=?8, chapter_end=?9,
         page_start=?10, page_end=?11, page_current=?12, notes=?13,
         start_time=?14, end_time=?15, time_estimate=?16
         WHERE id=?17",
        params![
            payload.plan_id, payload.title, payload.assignment_type, payload.due_date,
            payload.status, payload.priority,
            payload.book_title, payload.chapter_start, payload.chapter_end,
            payload.page_start, payload.page_end, payload.page_current, payload.notes,
            payload.start_time, payload.end_time, payload.time_estimate,
            id
        ],
    ).map_err(|e| e.to_string())?;
    fetch_ca(&db, id)
}

#[tauri::command]
pub fn delete_course_assignment(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM course_assignments WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── CA Subtasks ───────────────────────────────────────────────────────────────

fn map_ca_subtask(row: &rusqlite::Row) -> rusqlite::Result<CaSubtask> {
    Ok(CaSubtask {
        id:            row.get(0)?,
        assignment_id: row.get(1)?,
        title:         row.get(2)?,
        done:          row.get::<_, i64>(3)? != 0,
        sort_order:    row.get(4)?,
    })
}

#[tauri::command]
pub fn get_ca_subtasks(state: tauri::State<AppState>, assignment_id: i64) -> Result<Vec<CaSubtask>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT id, assignment_id, title, done, sort_order FROM ca_subtasks WHERE assignment_id=?1 ORDER BY sort_order, id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([assignment_id], map_ca_subtask)
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn add_ca_subtask(state: tauri::State<AppState>, assignment_id: i64, title: String) -> Result<CaSubtask, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let sort_order: i64 = db
        .query_row("SELECT COALESCE(MAX(sort_order) + 1, 0) FROM ca_subtasks WHERE assignment_id=?1", [assignment_id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO ca_subtasks (assignment_id, title, sort_order) VALUES (?1, ?2, ?3)",
        params![assignment_id, title, sort_order],
    ).map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    db.query_row("SELECT id, assignment_id, title, done, sort_order FROM ca_subtasks WHERE id=?1", [id], map_ca_subtask)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_ca_subtask(state: tauri::State<AppState>, id: i64) -> Result<CaSubtask, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("UPDATE ca_subtasks SET done = NOT done WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    db.query_row("SELECT id, assignment_id, title, done, sort_order FROM ca_subtasks WHERE id=?1", [id], map_ca_subtask)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_ca_subtask(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM ca_subtasks WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Pipelines ─────────────────────────────────────────────────────────────────

fn load_pipeline_template(db: &rusqlite::Connection, id: i64) -> Result<PipelineTemplate, String> {
    let (plan_id, title, description, color, created_at): (i64, String, Option<String>, String, String) =
        db.query_row(
            "SELECT plan_id, title, description, color, created_at FROM pipeline_templates WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|e| e.to_string())?;

    let steps = load_pipeline_steps(db, id)?;

    let run_count: i64 = db
        .query_row("SELECT COUNT(*) FROM pipeline_runs WHERE template_id=?1", [id], |r| r.get(0))
        .unwrap_or(0);

    // A run is "done" if all its step slots are done (or it has no steps)
    let done_run_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM pipeline_runs pr
             WHERE pr.template_id=?1
               AND (
                 SELECT COUNT(*) FROM pipeline_steps ps WHERE ps.template_id=?1
               ) > 0
               AND (
                 SELECT COUNT(*) FROM pipeline_run_steps rs
                 WHERE rs.run_id=pr.id AND rs.done=0
               ) = 0",
            [id],
            |r| r.get(0),
        )
        .unwrap_or(0);

    Ok(PipelineTemplate { id, plan_id, title, description, color, created_at, steps, run_count, done_run_count })
}

fn load_pipeline_steps(db: &rusqlite::Connection, template_id: i64) -> Result<Vec<PipelineStep>, String> {
    let mut stmt = db.prepare(
        "SELECT id, template_id, title, description, sort_order, time_estimate, step_type, attend_type
         FROM pipeline_steps WHERE template_id=?1 ORDER BY sort_order, id",
    ).map_err(|e| e.to_string())?;
    let rows: Vec<PipelineStep> = stmt.query_map([template_id], |r| Ok(PipelineStep {
        id: r.get(0)?, template_id: r.get(1)?, title: r.get(2)?,
        description: r.get(3)?, sort_order: r.get(4)?, time_estimate: r.get(5)?,
        step_type: r.get::<_, Option<String>>(6)?.unwrap_or_else(|| "generic".to_string()),
        attend_type: r.get(7)?,
    }))
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn load_pipeline_run(db: &rusqlite::Connection, run_id: i64) -> Result<PipelineRun, String> {
    let (template_id, title, notes, scheduled_date, sort_order, created_at):
        (i64, String, Option<String>, Option<String>, i64, String) =
        db.query_row(
            "SELECT template_id, title, notes, scheduled_date, sort_order, created_at
             FROM pipeline_runs WHERE id=?1",
            [run_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .map_err(|e| e.to_string())?;

    let mut stmt = db.prepare(
        "SELECT ps.id, ps.title, ps.sort_order, ps.step_type,
                COALESCE(rs.done,0), rs.done_at,
                rs.notes, rs.due_date,
                rs.chapter_ref, rs.page_start, rs.page_end,
                rs.start_time, rs.end_time, rs.location, rs.time_estimate,
                rs.assignment_id, rs.due_date_2
         FROM pipeline_steps ps
         LEFT JOIN pipeline_run_steps rs ON rs.step_id=ps.id AND rs.run_id=?1
         WHERE ps.template_id=?2
         ORDER BY ps.sort_order, ps.id",
    ).map_err(|e| e.to_string())?;
    let steps = stmt.query_map(params![run_id, template_id], |r| Ok(PipelineRunStep {
        step_id:         r.get(0)?,
        step_title:      r.get(1)?,
        step_sort_order: r.get(2)?,
        step_type:       r.get::<_, Option<String>>(3)?.unwrap_or_else(|| "generic".to_string()),
        done:            r.get::<_, i64>(4)? != 0,
        done_at:         r.get(5)?,
        notes:           r.get(6)?,
        due_date:        r.get(7)?,
        chapter_ref:     r.get(8)?,
        page_start:      r.get(9)?,
        page_end:        r.get(10)?,
        start_time:      r.get(11)?,
        end_time:        r.get(12)?,
        location:        r.get(13)?,
        time_estimate:   r.get(14)?,
        assignment_id:   r.get(15)?,
        due_date_2:      r.get(16)?,
    }))
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    Ok(PipelineRun { id: run_id, template_id, title, notes, scheduled_date, sort_order, created_at, steps })
}

#[tauri::command]
pub fn get_pipeline_templates(state: tauri::State<AppState>, plan_id: i64) -> Result<Vec<PipelineTemplate>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let ids: Vec<i64> = {
        let mut stmt = db.prepare(
            "SELECT id FROM pipeline_templates WHERE plan_id=?1 ORDER BY created_at, id",
        ).map_err(|e| e.to_string())?;
        let result: Vec<i64> = stmt.query_map([plan_id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        result
    };
    ids.iter().map(|&id| load_pipeline_template(&db, id)).collect()
}

#[tauri::command]
pub fn create_pipeline_template(state: tauri::State<AppState>, payload: CreatePipelineTemplate) -> Result<PipelineTemplate, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let color = payload.color.unwrap_or_else(|| "violet".to_string());
    db.execute(
        "INSERT INTO pipeline_templates (plan_id, title, description, color) VALUES (?1,?2,?3,?4)",
        params![payload.plan_id, payload.title, payload.description, color],
    ).map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    load_pipeline_template(&db, id)
}

#[tauri::command]
pub fn update_pipeline_template(state: tauri::State<AppState>, id: i64, payload: UpdatePipelineTemplate) -> Result<PipelineTemplate, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE pipeline_templates SET title=?1, description=?2, color=?3 WHERE id=?4",
        params![payload.title, payload.description, payload.color, id],
    ).map_err(|e| e.to_string())?;
    load_pipeline_template(&db, id)
}

#[tauri::command]
pub fn delete_pipeline_template(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    // Delete all assignments linked to any run_step of any run under this template
    let assignment_ids: Vec<i64> = {
        let mut stmt = db.prepare(
            "SELECT rs.assignment_id
             FROM pipeline_run_steps rs
             JOIN pipeline_runs pr ON pr.id = rs.run_id
             WHERE pr.template_id=?1 AND rs.assignment_id IS NOT NULL",
        ).map_err(|e| e.to_string())?;
        let result: Vec<i64> = stmt.query_map([id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        result
    };
    for aid in assignment_ids {
        db.execute("DELETE FROM course_assignments WHERE id=?1", [aid]).map_err(|e| e.to_string())?;
    }
    db.execute("DELETE FROM pipeline_templates WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn upsert_pipeline_steps(
    state: tauri::State<AppState>,
    template_id: i64,
    steps: Vec<PipelineStepInput>,
) -> Result<Vec<PipelineStep>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Collect incoming ids that already exist
    let incoming_ids: Vec<i64> = steps.iter().filter_map(|s| s.id).collect();

    // Delete steps no longer in the list (cascades pipeline_run_steps)
    if incoming_ids.is_empty() {
        db.execute("DELETE FROM pipeline_steps WHERE template_id=?1", [template_id])
            .map_err(|e| e.to_string())?;
    } else {
        // Build a NOT IN clause dynamically
        let placeholders = incoming_ids.iter().enumerate()
            .map(|(i, _)| format!("?{}", i + 2))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "DELETE FROM pipeline_steps WHERE template_id=?1 AND id NOT IN ({})",
            placeholders
        );
        let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(template_id)];
        for id in &incoming_ids {
            params_vec.push(Box::new(*id));
        }
        stmt.execute(rusqlite::params_from_iter(params_vec.iter().map(|p| p.as_ref())))
            .map_err(|e| e.to_string())?;
    }

    // Upsert each step
    for step in &steps {
        match step.id {
            Some(sid) => {
                let st = step.step_type.as_deref().unwrap_or("generic");
                db.execute(
                    "UPDATE pipeline_steps SET title=?1, description=?2, sort_order=?3, time_estimate=?4, step_type=?5, attend_type=?6 WHERE id=?7",
                    params![step.title, step.description, step.sort_order, step.time_estimate, st, step.attend_type, sid],
                ).map_err(|e| e.to_string())?;
            }
            None => {
                let st = step.step_type.as_deref().unwrap_or("generic");
                db.execute(
                    "INSERT INTO pipeline_steps (template_id, title, description, sort_order, time_estimate, step_type, attend_type) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                    params![template_id, step.title, step.description, step.sort_order, step.time_estimate, st, step.attend_type],
                ).map_err(|e| e.to_string())?;
                // Backfill run_steps for all existing runs
                let new_step_id = db.last_insert_rowid();
                let run_ids: Vec<i64> = {
                    let mut s = db.prepare("SELECT id FROM pipeline_runs WHERE template_id=?1").map_err(|e| e.to_string())?;
                    let result: Vec<i64> = s.query_map([template_id], |r| r.get(0))
                        .map_err(|e| e.to_string())?
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(|e| e.to_string())?;
                    result
                };
                for rid in run_ids {
                    db.execute(
                        "INSERT OR IGNORE INTO pipeline_run_steps (run_id, step_id, done) VALUES (?1,?2,0)",
                        params![rid, new_step_id],
                    ).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    load_pipeline_steps(&db, template_id)
}

#[tauri::command]
pub fn get_pipeline_runs(state: tauri::State<AppState>, template_id: i64) -> Result<Vec<PipelineRun>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let run_ids: Vec<i64> = {
        let mut stmt = db.prepare(
            "SELECT id FROM pipeline_runs WHERE template_id=?1 ORDER BY sort_order, id",
        ).map_err(|e| e.to_string())?;
        let result: Vec<i64> = stmt.query_map([template_id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        result
    };
    run_ids.iter().map(|&rid| load_pipeline_run(&db, rid)).collect()
}

#[tauri::command]
pub fn create_pipeline_run(state: tauri::State<AppState>, payload: CreatePipelineRun) -> Result<PipelineRun, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let sort_order: i64 = db
        .query_row(
            "SELECT COALESCE(MAX(sort_order)+1,0) FROM pipeline_runs WHERE template_id=?1",
            [payload.template_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    db.execute(
        "INSERT INTO pipeline_runs (template_id, title, notes, scheduled_date, sort_order) VALUES (?1,?2,?3,?4,?5)",
        params![payload.template_id, payload.title, payload.notes, payload.scheduled_date, sort_order],
    ).map_err(|e| e.to_string())?;
    let run_id = db.last_insert_rowid();

    // Auto-create run_steps (assignments are created later when details are filled in)
    let step_ids: Vec<i64> = {
        let mut stmt = db.prepare(
            "SELECT id FROM pipeline_steps WHERE template_id=?1 ORDER BY sort_order, id",
        ).map_err(|e| e.to_string())?;
        let result: Vec<i64> = stmt.query_map([payload.template_id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        result
    };
    for sid in step_ids {
        db.execute(
            "INSERT OR IGNORE INTO pipeline_run_steps (run_id, step_id, done) VALUES (?1,?2,0)",
            params![run_id, sid],
        ).map_err(|e| e.to_string())?;
    }

    load_pipeline_run(&db, run_id)
}

#[tauri::command]
pub fn update_pipeline_run(state: tauri::State<AppState>, id: i64, payload: UpdatePipelineRun) -> Result<PipelineRun, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE pipeline_runs SET title=?1, notes=?2, scheduled_date=?3 WHERE id=?4",
        params![payload.title, payload.notes, payload.scheduled_date, id],
    ).map_err(|e| e.to_string())?;
    // Sync titles of linked assignments
    let linked: Vec<(i64, String)> = {
        let mut stmt = db.prepare(
            "SELECT rs.assignment_id, COALESCE(ps.step_type, 'generic')
             FROM pipeline_run_steps rs
             JOIN pipeline_steps ps ON ps.id = rs.step_id
             WHERE rs.run_id=?1 AND rs.assignment_id IS NOT NULL",
        ).map_err(|e| e.to_string())?;
        let result: Vec<(i64, String)> = stmt.query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        result
    };
    for (aid, step_type) in linked {
        let new_title = match step_type.as_str() {
            "read" => format!("Read: {}", payload.title),
            _      => payload.title.clone(),
        };
        db.execute("UPDATE course_assignments SET title=?1 WHERE id=?2", params![new_title, aid])
            .map_err(|e| e.to_string())?;
    }
    load_pipeline_run(&db, id)
}

#[tauri::command]
pub fn delete_pipeline_run(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    // Delete linked assignments first
    let assignment_ids: Vec<i64> = {
        let mut stmt = db.prepare(
            "SELECT assignment_id FROM pipeline_run_steps WHERE run_id=?1 AND assignment_id IS NOT NULL",
        ).map_err(|e| e.to_string())?;
        let result: Vec<i64> = stmt.query_map([id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        result
    };
    for aid in assignment_ids {
        db.execute("DELETE FROM course_assignments WHERE id=?1", [aid]).map_err(|e| e.to_string())?;
    }
    db.execute("DELETE FROM pipeline_runs WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn toggle_pipeline_run_step(state: tauri::State<AppState>, run_id: i64, step_id: i64) -> Result<PipelineRun, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    // Ensure the row exists
    db.execute(
        "INSERT OR IGNORE INTO pipeline_run_steps (run_id, step_id, done) VALUES (?1,?2,0)",
        params![run_id, step_id],
    ).map_err(|e| e.to_string())?;
    // Flip
    db.execute(
        "UPDATE pipeline_run_steps
         SET done = CASE WHEN done=1 THEN 0 ELSE 1 END,
             done_at = CASE WHEN done=0 THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') ELSE NULL END
         WHERE run_id=?1 AND step_id=?2",
        params![run_id, step_id],
    ).map_err(|e| e.to_string())?;
    // Sync linked assignment status
    let (new_done, assignment_id): (bool, Option<i64>) = db.query_row(
        "SELECT done, assignment_id FROM pipeline_run_steps WHERE run_id=?1 AND step_id=?2",
        params![run_id, step_id],
        |r| Ok((r.get::<_, i64>(0)? != 0, r.get(1)?)),
    ).map_err(|e| e.to_string())?;
    if let Some(aid) = assignment_id {
        let status = if new_done { "done" } else { "pending" };
        db.execute("UPDATE course_assignments SET status=?1 WHERE id=?2", params![status, aid])
            .map_err(|e| e.to_string())?;
    }
    load_pipeline_run(&db, run_id)
}

#[tauri::command]
pub fn update_pipeline_run_step(
    state: tauri::State<AppState>,
    run_id: i64,
    step_id: i64,
    payload: UpdatePipelineRunStep,
) -> Result<PipelineRun, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    // Fetch current assignment_id, step_type, and attend_type before upsert
    let current: Option<(Option<i64>, String, Option<String>)> = db.query_row(
        "SELECT rs.assignment_id, COALESCE(ps.step_type,'generic'), ps.attend_type
         FROM pipeline_run_steps rs
         JOIN pipeline_steps ps ON ps.id = rs.step_id
         WHERE rs.run_id=?1 AND rs.step_id=?2",
        params![run_id, step_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).ok();
    db.execute(
        "INSERT INTO pipeline_run_steps (run_id, step_id, done, notes, due_date, chapter_ref, page_start, page_end, start_time, end_time, location, time_estimate, due_date_2)
         VALUES (?1,?2,0,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
         ON CONFLICT(run_id,step_id) DO UPDATE SET
             notes=excluded.notes, due_date=excluded.due_date,
             chapter_ref=excluded.chapter_ref, page_start=excluded.page_start, page_end=excluded.page_end,
             start_time=excluded.start_time, end_time=excluded.end_time,
             location=excluded.location, time_estimate=excluded.time_estimate,
             due_date_2=excluded.due_date_2",
        params![run_id, step_id, payload.notes, payload.due_date,
                payload.chapter_ref, payload.page_start, payload.page_end,
                payload.start_time, payload.end_time, payload.location, payload.time_estimate,
                payload.due_date_2],
    ).map_err(|e| e.to_string())?;
    // When the attend step's due_date is set, auto-sync all read steps in this run:
    //   read.due_date   = attend_date - 1 day  (pre-read deadline)
    //   read.due_date_2 = attend_date           (review on day of lecture)
    if let Some((_, ref stype, _)) = current {
        if stype == "attend" {
            if let Some(ref attend_date) = payload.due_date {
                db.execute(
                    "UPDATE pipeline_run_steps
                     SET due_date   = date(?1, '-1 day'),
                         due_date_2 = ?1
                     WHERE run_id = ?2
                       AND step_id IN (
                         SELECT ps.id FROM pipeline_steps ps
                         WHERE ps.template_id = (SELECT template_id FROM pipeline_runs WHERE id = ?2)
                           AND ps.step_type = 'read'
                       )",
                    params![attend_date, run_id],
                ).map_err(|e| e.to_string())?;
            }
        }
    }
    // Lazy assignment creation / sync
    if let Some((maybe_aid, step_type, attend_type_override)) = current {
        let has_data = match step_type.as_str() {
            "read"   => payload.chapter_ref.is_some() || payload.page_start.is_some() || payload.due_date.is_some(),
            "attend" => payload.start_time.is_some() || payload.due_date.is_some(),
            _ => false,
        };
        if has_data {
            // For "attend" steps, use the step's attend_type if set, otherwise "lecture"
            let effective_attend_type = attend_type_override.as_deref().unwrap_or("lecture");
            match maybe_aid {
                Some(aid) => {
                    // Update existing assignment
                    match step_type.as_str() {
                        "read" => {
                            db.execute(
                                "UPDATE course_assignments SET chapter_start=?1, page_start=?2, page_end=?3, due_date=?4, time_estimate=?5 WHERE id=?6",
                                params![payload.chapter_ref, payload.page_start, payload.page_end, payload.due_date, payload.time_estimate, aid],
                            ).map_err(|e| e.to_string())?;
                        }
                        "attend" => {
                            db.execute(
                                "UPDATE course_assignments SET start_time=?1, end_time=?2, due_date=?3, time_estimate=?4 WHERE id=?5",
                                params![payload.start_time, payload.end_time, payload.due_date, payload.time_estimate, aid],
                            ).map_err(|e| e.to_string())?;
                        }
                        _ => {}
                    }
                }
                None => {
                    // Lazy-create: look up run title + plan_id
                    let (run_title, plan_id): (String, i64) = db.query_row(
                        "SELECT pr.title, pt.plan_id FROM pipeline_runs pr JOIN pipeline_templates pt ON pt.id = pr.template_id WHERE pr.id=?1",
                        [run_id],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    ).map_err(|e| e.to_string())?;
                    let (assignment_type, title) = match step_type.as_str() {
                        "read"   => ("reading".to_string(), format!("Read: {}", run_title)),
                        "attend" => (effective_attend_type.to_string(), format!("{}: {}", run_title, effective_attend_type)),
                        _        => ("other".to_string(), run_title.clone()),
                    };
                    db.execute(
                        "INSERT INTO course_assignments (plan_id, title, assignment_type, due_date, status, priority, chapter_start, page_start, page_end, start_time, end_time, time_estimate) VALUES (?1,?2,?3,?4,'pending','medium',?5,?6,?7,?8,?9,?10)",
                        params![
                            plan_id, title, assignment_type, payload.due_date,
                            payload.chapter_ref, payload.page_start, payload.page_end,
                            payload.start_time, payload.end_time, payload.time_estimate,
                        ],
                    ).map_err(|e| e.to_string())?;
                    let new_aid = db.last_insert_rowid();
                    db.execute(
                        "UPDATE pipeline_run_steps SET assignment_id=?1 WHERE run_id=?2 AND step_id=?3",
                        params![new_aid, run_id, step_id],
                    ).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    load_pipeline_run(&db, run_id)
}

// ── Pipeline Step Subtasks ────────────────────────────────────────────────────

fn map_pipeline_step_subtask(row: &rusqlite::Row) -> rusqlite::Result<PipelineStepSubtask> {
    Ok(PipelineStepSubtask {
        id:         row.get(0)?,
        run_id:     row.get(1)?,
        step_id:    row.get(2)?,
        title:      row.get(3)?,
        done:       row.get::<_, i64>(4)? != 0,
        sort_order: row.get(5)?,
    })
}

#[tauri::command]
pub fn get_pipeline_step_subtasks(state: tauri::State<AppState>, run_id: i64, step_id: i64) -> Result<Vec<PipelineStepSubtask>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT id, run_id, step_id, title, done, sort_order FROM pipeline_step_subtasks WHERE run_id=?1 AND step_id=?2 ORDER BY sort_order, id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![run_id, step_id], map_pipeline_step_subtask)
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn add_pipeline_step_subtask(state: tauri::State<AppState>, run_id: i64, step_id: i64, title: String) -> Result<PipelineStepSubtask, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let sort_order: i64 = db
        .query_row("SELECT COALESCE(MAX(sort_order) + 1, 0) FROM pipeline_step_subtasks WHERE run_id=?1 AND step_id=?2", params![run_id, step_id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO pipeline_step_subtasks (run_id, step_id, title, sort_order) VALUES (?1, ?2, ?3, ?4)",
        params![run_id, step_id, title, sort_order],
    ).map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    db.query_row("SELECT id, run_id, step_id, title, done, sort_order FROM pipeline_step_subtasks WHERE id=?1", [id], map_pipeline_step_subtask)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_pipeline_step_subtask(state: tauri::State<AppState>, id: i64) -> Result<PipelineStepSubtask, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("UPDATE pipeline_step_subtasks SET done = NOT done WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    db.query_row("SELECT id, run_id, step_id, title, done, sort_order FROM pipeline_step_subtasks WHERE id=?1", [id], map_pipeline_step_subtask)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_pipeline_step_subtask(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM pipeline_step_subtasks WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Journal ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_journal_entry(date: String, state: tauri::State<AppState>) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let content: String = db
        .query_row(
            "SELECT content FROM journal_entries WHERE date = ?1",
            [&date],
            |r| r.get(0),
        )
        .unwrap_or_default();
    Ok(content)
}

#[tauri::command]
pub fn save_journal_entry(date: String, content: String, state: tauri::State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO journal_entries (date, content, updated_at)
         VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
         ON CONFLICT(date) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at",
        params![date, content],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Export / Backup ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_db_path(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("pathfinder.db").to_string_lossy().into_owned())
}

#[tauri::command]
pub fn export_data(state: tauri::State<AppState>) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    fn rows(db: &rusqlite::Connection, sql: &str) -> rusqlite::Result<Vec<serde_json::Value>> {
        let mut stmt = db.prepare(sql)?;
        let col_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let rows = stmt.query_map([], |row| {
            let mut map = serde_json::Map::new();
            for (i, name) in col_names.iter().enumerate() {
                let val: serde_json::Value = match row.get_ref(i)? {
                    rusqlite::types::ValueRef::Null    => serde_json::Value::Null,
                    rusqlite::types::ValueRef::Integer(n) => serde_json::Value::Number(n.into()),
                    rusqlite::types::ValueRef::Real(f)    => {
                        serde_json::Number::from_f64(f)
                            .map(serde_json::Value::Number)
                            .unwrap_or(serde_json::Value::Null)
                    }
                    rusqlite::types::ValueRef::Text(b) => {
                        serde_json::Value::String(String::from_utf8_lossy(b).into_owned())
                    }
                    rusqlite::types::ValueRef::Blob(b) => {
                        serde_json::Value::String(base64_simple(b))
                    }
                };
                map.insert(name.clone(), val);
            }
            Ok(serde_json::Value::Object(map))
        })?;
        rows.collect()
    }

    // tiny base64 encoder (no external dep needed)
    fn base64_simple(data: &[u8]) -> String {
        const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in data.chunks(3) {
            let b0 = chunk[0] as usize;
            let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
            let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };
            out.push(TABLE[(b0 >> 2)] as char);
            out.push(TABLE[((b0 & 3) << 4) | (b1 >> 4)] as char);
            out.push(if chunk.len() > 1 { TABLE[((b1 & 0xf) << 2) | (b2 >> 6)] as char } else { '=' });
            out.push(if chunk.len() > 2 { TABLE[b2 & 0x3f] as char } else { '=' });
        }
        out
    }

    let export = serde_json::json!({
        "version": 1,
        "exported_at": chrono_now(),
        "goal_groups":          rows(&db, "SELECT * FROM goal_groups ORDER BY sort_order, id").map_err(|e| e.to_string())?,
        "goals":                rows(&db, "SELECT * FROM goals ORDER BY id").map_err(|e| e.to_string())?,
        "plans":                rows(&db, "SELECT * FROM plans ORDER BY id").map_err(|e| e.to_string())?,
        "tasks":                rows(&db, "SELECT * FROM tasks ORDER BY plan_id, sort_order").map_err(|e| e.to_string())?,
        "systems":              rows(&db, "SELECT * FROM systems ORDER BY id").map_err(|e| e.to_string())?,
        "system_subtasks":      rows(&db, "SELECT * FROM system_subtasks ORDER BY system_id, sort_order").map_err(|e| e.to_string())?,
        "reminders":            rows(&db, "SELECT * FROM reminders ORDER BY id").map_err(|e| e.to_string())?,
        "deadlines":            rows(&db, "SELECT * FROM deadlines ORDER BY due_date").map_err(|e| e.to_string())?,
        "events":               rows(&db, "SELECT * FROM events ORDER BY date").map_err(|e| e.to_string())?,
        "agreements":           rows(&db, "SELECT * FROM agreements ORDER BY id").map_err(|e| e.to_string())?,
        "quick_notes":          rows(&db, "SELECT * FROM quick_notes ORDER BY id").map_err(|e| e.to_string())?,
        "brain_dump":           rows(&db, "SELECT * FROM brain_dump ORDER BY id").map_err(|e| e.to_string())?,
        "course_assignments":   rows(&db, "SELECT * FROM course_assignments ORDER BY id").map_err(|e| e.to_string())?,
        "ca_subtasks":          rows(&db, "SELECT * FROM ca_subtasks ORDER BY assignment_id, sort_order").map_err(|e| e.to_string())?,
        "journal_entries":      rows(&db, "SELECT * FROM journal_entries ORDER BY date").map_err(|e| e.to_string())?,
        "daily_sections":       rows(&db, "SELECT * FROM daily_sections ORDER BY sort_order").map_err(|e| e.to_string())?,
        "daily_items":          rows(&db, "SELECT * FROM daily_items ORDER BY section_id, sort_order").map_err(|e| e.to_string())?,
        "daily_goals":          rows(&db, "SELECT * FROM daily_goals ORDER BY date").map_err(|e| e.to_string())?,
        "daily_sec_goals":      rows(&db, "SELECT * FROM daily_sec_goals ORDER BY date, sort_order").map_err(|e| e.to_string())?,
        "routine_items":        rows(&db, "SELECT * FROM routine_items ORDER BY kind, sort_order").map_err(|e| e.to_string())?,
        "cal_blocks":           rows(&db, "SELECT * FROM cal_blocks ORDER BY date, start_time").map_err(|e| e.to_string())?,
        "recurring_cal_blocks": rows(&db, "SELECT * FROM recurring_cal_blocks ORDER BY id").map_err(|e| e.to_string())?,
        "time_blocks":          rows(&db, "SELECT * FROM time_blocks ORDER BY date, slot").map_err(|e| e.to_string())?,
        "pipeline_templates":   rows(&db, "SELECT * FROM pipeline_templates ORDER BY id").map_err(|e| e.to_string())?,
        "pipeline_steps":       rows(&db, "SELECT * FROM pipeline_steps ORDER BY template_id, sort_order").map_err(|e| e.to_string())?,
        "pipeline_runs":        rows(&db, "SELECT * FROM pipeline_runs ORDER BY template_id, sort_order").map_err(|e| e.to_string())?,
        "pipeline_run_steps":   rows(&db, "SELECT * FROM pipeline_run_steps ORDER BY run_id, step_id").map_err(|e| e.to_string())?,
        "project_goals":        rows(&db, "SELECT * FROM project_goals ORDER BY plan_id, sort_order").map_err(|e| e.to_string())?,
    });

    serde_json::to_string_pretty(&export).map_err(|e| e.to_string())
}

fn chrono_now() -> String {
    // Simple ISO timestamp without chrono crate
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let days = secs / 86400; // days since epoch
    // rough date calculation
    let mut y = 1970u64;
    let mut d = days;
    loop {
        let dy = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
        if d < dy { break; }
        d -= dy;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let months = [31u64, if leap { 29 } else { 28 }, 31,30,31,30,31,31,30,31,30,31];
    let mut mo = 1u64;
    for &days_in_month in &months {
        if d < days_in_month { break; }
        d -= days_in_month;
        mo += 1;
    }
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, d + 1, h, m, s)
}

// ── Games ─────────────────────────────────────────────────────────────────────

fn fetch_game(db: &rusqlite::Connection, id: i64) -> Result<Game, String> {
    db.query_row(
        "SELECT g.id, g.title, g.genre, g.platform, g.engine, g.status, g.description,
                g.core_mechanic, g.target_audience, g.inspiration, g.color, g.created_at,
                COUNT(f.id), SUM(CASE WHEN f.status='done' THEN 1 ELSE 0 END)
         FROM games g LEFT JOIN game_features f ON f.game_id = g.id
         WHERE g.id=?1 GROUP BY g.id",
        [id],
        |row| map_game(row),
    ).map_err(|e| e.to_string())
}

fn map_game(row: &rusqlite::Row) -> rusqlite::Result<Game> {
    Ok(Game {
        id:              row.get(0)?,
        title:           row.get(1)?,
        genre:           row.get(2)?,
        platform:        row.get(3)?,
        engine:          row.get(4)?,
        status:          row.get(5)?,
        description:     row.get(6)?,
        core_mechanic:   row.get(7)?,
        target_audience: row.get(8)?,
        inspiration:     row.get(9)?,
        color:           row.get(10)?,
        created_at:      row.get(11)?,
        feature_count:   row.get::<_, Option<i64>>(12)?.unwrap_or(0),
        done_count:      row.get::<_, Option<i64>>(13)?.unwrap_or(0),
    })
}

#[tauri::command]
pub fn get_games(state: tauri::State<AppState>) -> Result<Vec<Game>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT g.id, g.title, g.genre, g.platform, g.engine, g.status, g.description,
                g.core_mechanic, g.target_audience, g.inspiration, g.color, g.created_at,
                COUNT(f.id), SUM(CASE WHEN f.status='done' THEN 1 ELSE 0 END)
         FROM games g LEFT JOIN game_features f ON f.game_id = g.id
         GROUP BY g.id ORDER BY g.created_at DESC",
    ).map_err(|e| e.to_string())?;
    let games = stmt.query_map([], |row| Ok(map_game(row)?))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(games)
}

#[tauri::command]
pub fn create_game(state: tauri::State<AppState>, payload: CreateGame) -> Result<Game, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO games (title, genre, platform, engine, status, description, core_mechanic, target_audience, inspiration, color)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            payload.title, payload.genre, payload.platform, payload.engine,
            payload.status.unwrap_or_else(|| "concept".into()),
            payload.description, payload.core_mechanic, payload.target_audience,
            payload.inspiration, payload.color.unwrap_or_else(|| "violet".into()),
        ],
    ).map_err(|e| e.to_string())?;
    fetch_game(&db, db.last_insert_rowid())
}

#[tauri::command]
pub fn update_game(state: tauri::State<AppState>, id: i64, payload: UpdateGame) -> Result<Game, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE games SET title=?1, genre=?2, platform=?3, engine=?4, status=?5, description=?6,
                          core_mechanic=?7, target_audience=?8, inspiration=?9, color=?10
         WHERE id=?11",
        params![
            payload.title, payload.genre, payload.platform, payload.engine, payload.status,
            payload.description, payload.core_mechanic, payload.target_audience,
            payload.inspiration, payload.color, id,
        ],
    ).map_err(|e| e.to_string())?;
    fetch_game(&db, id)
}

#[tauri::command]
pub fn delete_game(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM games WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Game Features ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_game_features(state: tauri::State<AppState>, game_id: i64) -> Result<Vec<GameFeature>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT id, game_id, title, description, status, priority, sort_order, created_at
         FROM game_features WHERE game_id=?1 ORDER BY sort_order, created_at",
    ).map_err(|e| e.to_string())?;
    let features = stmt.query_map([game_id], |row| Ok(GameFeature {
        id: row.get(0)?, game_id: row.get(1)?, title: row.get(2)?,
        description: row.get(3)?, status: row.get(4)?, priority: row.get(5)?,
        sort_order: row.get(6)?, created_at: row.get(7)?,
    }))
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(features)
}

#[tauri::command]
pub fn create_game_feature(state: tauri::State<AppState>, payload: CreateGameFeature) -> Result<GameFeature, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let max_order: i64 = db.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) FROM game_features WHERE game_id=?1",
        [payload.game_id], |r| r.get(0),
    ).unwrap_or(-1);
    db.execute(
        "INSERT INTO game_features (game_id, title, description, status, priority, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            payload.game_id, payload.title, payload.description,
            payload.status.unwrap_or_else(|| "idea".into()),
            payload.priority.unwrap_or_else(|| "medium".into()),
            max_order + 1,
        ],
    ).map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    db.query_row(
        "SELECT id, game_id, title, description, status, priority, sort_order, created_at FROM game_features WHERE id=?1",
        [id], |row| Ok(GameFeature {
            id: row.get(0)?, game_id: row.get(1)?, title: row.get(2)?,
            description: row.get(3)?, status: row.get(4)?, priority: row.get(5)?,
            sort_order: row.get(6)?, created_at: row.get(7)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_game_feature(state: tauri::State<AppState>, id: i64, payload: UpdateGameFeature) -> Result<GameFeature, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE game_features SET title=?1, description=?2, status=?3, priority=?4 WHERE id=?5",
        params![payload.title, payload.description, payload.status, payload.priority, id],
    ).map_err(|e| e.to_string())?;
    db.query_row(
        "SELECT id, game_id, title, description, status, priority, sort_order, created_at FROM game_features WHERE id=?1",
        [id], |row| Ok(GameFeature {
            id: row.get(0)?, game_id: row.get(1)?, title: row.get(2)?,
            description: row.get(3)?, status: row.get(4)?, priority: row.get(5)?,
            sort_order: row.get(6)?, created_at: row.get(7)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_game_feature_status(state: tauri::State<AppState>, id: i64, status: String) -> Result<GameFeature, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("UPDATE game_features SET status=?1 WHERE id=?2", params![status, id])
        .map_err(|e| e.to_string())?;
    db.query_row(
        "SELECT id, game_id, title, description, status, priority, sort_order, created_at FROM game_features WHERE id=?1",
        [id], |row| Ok(GameFeature {
            id: row.get(0)?, game_id: row.get(1)?, title: row.get(2)?,
            description: row.get(3)?, status: row.get(4)?, priority: row.get(5)?,
            sort_order: row.get(6)?, created_at: row.get(7)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_game_feature(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM game_features WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Game Devlog ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_game_devlog(state: tauri::State<AppState>, game_id: i64) -> Result<Vec<GameDevlogEntry>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT id, game_id, content, created_at FROM game_devlog WHERE game_id=?1 ORDER BY created_at DESC",
    ).map_err(|e| e.to_string())?;
    let entries = stmt.query_map([game_id], |row| Ok(GameDevlogEntry {
        id: row.get(0)?, game_id: row.get(1)?, content: row.get(2)?, created_at: row.get(3)?,
    }))
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(entries)
}

#[tauri::command]
pub fn add_game_devlog_entry(state: tauri::State<AppState>, payload: AddGameDevlogEntry) -> Result<GameDevlogEntry, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO game_devlog (game_id, content) VALUES (?1, ?2)",
        params![payload.game_id, payload.content],
    ).map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    db.query_row(
        "SELECT id, game_id, content, created_at FROM game_devlog WHERE id=?1",
        [id], |row| Ok(GameDevlogEntry {
            id: row.get(0)?, game_id: row.get(1)?, content: row.get(2)?, created_at: row.get(3)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_game_devlog_entry(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM game_devlog WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Daily Habits ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_habits_for_date(state: tauri::State<AppState>, date: String) -> Result<Vec<HabitWithCompletion>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Phase 1: basic info + done flag for the requested date
    let basic: Vec<(i64, String, String, i64, bool)> = {
        let mut stmt = db.prepare(
            "SELECT h.id, h.title, h.color, h.sort_order,
                    CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END as done
             FROM daily_habits h
             LEFT JOIN habit_completions c ON c.habit_id = h.id AND c.date = ?1
             ORDER BY h.sort_order, h.id",
        ).map_err(|e| e.to_string())?;
        let rows: Vec<Result<_, _>> = stmt.query_map([&date], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get::<_, i64>(4)? != 0))
        }).map_err(|e| e.to_string())?.collect();
        rows.into_iter().collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };

    // Phase 2: streak + recent dates per habit
    let mut habits = Vec::new();
    for (id, title, color, sort_order, done) in basic {
        // Streak: consecutive days ending today (if done today) or yesterday (if not done today)
        // Gap-and-island: date shifted by row-number should equal the anchor date for consecutive rows
        let streak: i64 = db.query_row(
            "SELECT COUNT(*) FROM (
               SELECT date(date, '+' || (ROW_NUMBER() OVER (ORDER BY date DESC) - 1) || ' days') AS grp
               FROM habit_completions WHERE habit_id=?1 AND date <= ?2
             ) WHERE grp = CASE
               WHEN EXISTS(SELECT 1 FROM habit_completions WHERE habit_id=?1 AND date=?2)
               THEN ?2
               ELSE date(?2, '-1 day')
             END",
            params![id, &date],
            |r| r.get(0),
        ).unwrap_or(0);

        // Dates completed in last 7 days (for the week-dot display)
        let recent_dates: Vec<String> = {
            let mut s = db.prepare(
                "SELECT date FROM habit_completions
                 WHERE habit_id=?1 AND date >= date(?2, '-6 days') AND date <= ?2
                 ORDER BY date DESC",
            ).map_err(|e| e.to_string())?;
            let rows: Vec<Result<String, _>> = s.query_map(params![id, &date], |r| r.get(0))
             .map_err(|e| e.to_string())?
             .collect();
            rows.into_iter().filter_map(|r| r.ok()).collect()
        };

        habits.push(HabitWithCompletion { id, title, color, sort_order, done, streak, recent_dates });
    }
    Ok(habits)
}

#[tauri::command]
pub fn create_daily_habit(state: tauri::State<AppState>, payload: CreateDailyHabit) -> Result<DailyHabit, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let max_order: i64 = db.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) FROM daily_habits", [], |r| r.get(0),
    ).unwrap_or(-1);
    db.execute(
        "INSERT INTO daily_habits (title, color, sort_order) VALUES (?1, ?2, ?3)",
        params![payload.title, payload.color.unwrap_or_else(|| "emerald".into()), max_order + 1],
    ).map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    db.query_row(
        "SELECT id, title, color, sort_order FROM daily_habits WHERE id=?1",
        [id], |row| Ok(DailyHabit { id: row.get(0)?, title: row.get(1)?, color: row.get(2)?, sort_order: row.get(3)? }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_daily_habit(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM daily_habits WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn toggle_habit_completion(state: tauri::State<AppState>, habit_id: i64, date: String) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let exists: bool = db.query_row(
        "SELECT COUNT(*) FROM habit_completions WHERE habit_id=?1 AND date=?2",
        params![habit_id, &date], |r| r.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    if exists {
        db.execute("DELETE FROM habit_completions WHERE habit_id=?1 AND date=?2", params![habit_id, &date])
            .map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        db.execute("INSERT INTO habit_completions (habit_id, date) VALUES (?1, ?2)", params![habit_id, &date])
            .map_err(|e| e.to_string())?;
        Ok(true)
    }
}

// ── Run Logs ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_run_logs(state: tauri::State<AppState>) -> Result<Vec<RunLog>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT id, date, distance_km, duration_min, notes, created_at FROM run_logs ORDER BY date DESC, created_at DESC",
    ).map_err(|e| e.to_string())?;
    let logs = stmt.query_map([], |row| Ok(RunLog {
        id: row.get(0)?, date: row.get(1)?, distance_km: row.get(2)?,
        duration_min: row.get(3)?, notes: row.get(4)?, created_at: row.get(5)?,
    }))
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(logs)
}

#[tauri::command]
pub fn create_run_log(state: tauri::State<AppState>, payload: CreateRunLog) -> Result<RunLog, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO run_logs (date, distance_km, duration_min, notes) VALUES (?1, ?2, ?3, ?4)",
        params![payload.date, payload.distance_km, payload.duration_min, payload.notes],
    ).map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    db.query_row(
        "SELECT id, date, distance_km, duration_min, notes, created_at FROM run_logs WHERE id=?1",
        [id], |row| Ok(RunLog {
            id: row.get(0)?, date: row.get(1)?, distance_km: row.get(2)?,
            duration_min: row.get(3)?, notes: row.get(4)?, created_at: row.get(5)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_run_log(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM run_logs WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Workout Logs ──────────────────────────────────────────────────────────────

fn fetch_workout(db: &rusqlite::Connection, id: i64) -> Result<WorkoutLog, String> {
    let w = db.query_row(
        "SELECT id, date, name, notes, created_at FROM workout_logs WHERE id=?1",
        [id], |row| Ok(WorkoutLog {
            id: row.get(0)?, date: row.get(1)?, name: row.get(2)?,
            notes: row.get(3)?, created_at: row.get(4)?, exercises: vec![],
        }),
    ).map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT id, workout_id, name, sets, reps, weight_kg, notes, sort_order FROM workout_exercises WHERE workout_id=?1 ORDER BY sort_order, id",
    ).map_err(|e| e.to_string())?;
    let exercises = stmt.query_map([id], |row| Ok(WorkoutExercise {
        id: row.get(0)?, workout_id: row.get(1)?, name: row.get(2)?,
        sets: row.get(3)?, reps: row.get(4)?, weight_kg: row.get(5)?,
        notes: row.get(6)?, sort_order: row.get(7)?,
    }))
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(WorkoutLog { exercises, ..w })
}

#[tauri::command]
pub fn get_workout_logs(state: tauri::State<AppState>) -> Result<Vec<WorkoutLog>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let ids: Vec<i64> = {
        let mut stmt = db.prepare("SELECT id FROM workout_logs ORDER BY date DESC, created_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    ids.into_iter().map(|id| fetch_workout(&db, id)).collect()
}

#[tauri::command]
pub fn create_workout_log(state: tauri::State<AppState>, payload: CreateWorkoutLog) -> Result<WorkoutLog, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO workout_logs (date, name, notes) VALUES (?1, ?2, ?3)",
        params![payload.date, payload.name, payload.notes],
    ).map_err(|e| e.to_string())?;
    fetch_workout(&db, db.last_insert_rowid())
}

#[tauri::command]
pub fn delete_workout_log(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM workout_logs WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn add_workout_exercise(state: tauri::State<AppState>, payload: AddWorkoutExercise) -> Result<WorkoutLog, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let max_order: i64 = db.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) FROM workout_exercises WHERE workout_id=?1",
        [payload.workout_id], |r| r.get(0),
    ).unwrap_or(-1);
    db.execute(
        "INSERT INTO workout_exercises (workout_id, name, sets, reps, weight_kg, notes, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![payload.workout_id, payload.name, payload.sets, payload.reps, payload.weight_kg, payload.notes, max_order + 1],
    ).map_err(|e| e.to_string())?;
    fetch_workout(&db, payload.workout_id)
}

#[tauri::command]
pub fn delete_workout_exercise(state: tauri::State<AppState>, id: i64, workout_id: i64) -> Result<WorkoutLog, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM workout_exercises WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    fetch_workout(&db, workout_id)
}

// ── Roadmap ───────────────────────────────────────────────────────────────────

fn map_roadmap_item(row: &rusqlite::Row) -> rusqlite::Result<RoadmapItem> {
    Ok(RoadmapItem {
        id: row.get(0)?, plan_id: row.get(1)?, title: row.get(2)?,
        description: row.get(3)?, due_date: row.get(4)?, status: row.get(5)?,
        sort_order: row.get(6)?, created_at: row.get(7)?,
    })
}

const ROADMAP_SELECT: &str =
    "SELECT id, plan_id, title, description, due_date, status, sort_order, created_at FROM roadmap_items";

#[tauri::command]
pub fn get_roadmap_items(state: tauri::State<AppState>, plan_id: i64) -> Result<Vec<RoadmapItem>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        &format!("{} WHERE plan_id=?1 ORDER BY sort_order, due_date, id", ROADMAP_SELECT)
    ).map_err(|e| e.to_string())?;
    let rows: Vec<Result<_, _>> = stmt.query_map([plan_id], |row| map_roadmap_item(row))
        .map_err(|e| e.to_string())?.collect();
    rows.into_iter().collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_roadmap_item(state: tauri::State<AppState>, payload: CreateRoadmapItem) -> Result<RoadmapItem, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let max_order: i64 = db.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) FROM roadmap_items WHERE plan_id=?1",
        [payload.plan_id], |r| r.get(0),
    ).unwrap_or(-1);
    db.execute(
        "INSERT INTO roadmap_items (plan_id, title, description, due_date, sort_order) VALUES (?1,?2,?3,?4,?5)",
        params![payload.plan_id, payload.title, payload.description, payload.due_date, max_order + 1],
    ).map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    db.query_row(&format!("{} WHERE id=?1", ROADMAP_SELECT), [id], |row| map_roadmap_item(row))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_roadmap_item(state: tauri::State<AppState>, id: i64, payload: UpdateRoadmapItem) -> Result<RoadmapItem, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE roadmap_items SET title=?1, description=?2, due_date=?3, status=?4 WHERE id=?5",
        params![payload.title, payload.description, payload.due_date, payload.status, id],
    ).map_err(|e| e.to_string())?;
    db.query_row(&format!("{} WHERE id=?1", ROADMAP_SELECT), [id], |row| map_roadmap_item(row))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_roadmap_item(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM roadmap_items WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_roadmap_item_status(state: tauri::State<AppState>, id: i64, status: String) -> Result<RoadmapItem, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("UPDATE roadmap_items SET status=?1 WHERE id=?2", params![status, id])
        .map_err(|e| e.to_string())?;
    db.query_row(&format!("{} WHERE id=?1", ROADMAP_SELECT), [id], |row| map_roadmap_item(row))
        .map_err(|e| e.to_string())
}

// ── Course Books ──────────────────────────────────────────────────────────────

fn load_book_sections(db: &rusqlite::Connection, book_id: i64) -> Result<Vec<BookSection>, String> {
    let mut stmt = db.prepare(
        "SELECT id, book_id, title, kind, sort_order, page_start, page_end, due_date, time_estimate, done, done_at, notes, created_at
         FROM book_sections WHERE book_id=?1 ORDER BY sort_order, id",
    ).map_err(|e| e.to_string())?;
    let rows: Vec<BookSection> = stmt.query_map([book_id], |r| Ok(BookSection {
        id:            r.get(0)?,
        book_id:       r.get(1)?,
        title:         r.get(2)?,
        kind:          r.get::<_, Option<String>>(3)?.unwrap_or_else(|| "chapter".into()),
        sort_order:    r.get(4)?,
        page_start:    r.get(5)?,
        page_end:      r.get(6)?,
        due_date:      r.get(7)?,
        time_estimate: r.get(8)?,
        done:          r.get::<_, i64>(9)? != 0,
        done_at:       r.get(10)?,
        notes:         r.get(11)?,
        created_at:    r.get(12)?,
    }))
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn load_book_log(db: &rusqlite::Connection, book_id: i64) -> Result<Vec<BookReadingLog>, String> {
    let mut stmt = db.prepare(
        "SELECT id, book_id, date, pages_read, chapters_read, note FROM book_reading_log WHERE book_id=?1 ORDER BY date, id"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([book_id], |row| Ok(BookReadingLog {
        id: row.get(0)?,
        book_id: row.get(1)?,
        date: row.get(2)?,
        pages_read: row.get(3)?,
        chapters_read: row.get(4)?,
        note: row.get(5)?,
    })).map_err(|e| e.to_string())?;
    rows.map(|r| r.map_err(|e| e.to_string())).collect()
}

fn load_course_book(db: &rusqlite::Connection, id: i64) -> Result<CourseBook, String> {
    let book = db.query_row(
        "SELECT id, plan_id, title, author, total_pages, total_chapters, current_page, current_chapter, daily_pages_goal, weekly_chapters_goal, created_at FROM course_books WHERE id=?1",
        [id],
        |row| Ok(CourseBook {
            id: row.get(0)?,
            plan_id: row.get(1)?,
            title: row.get(2)?,
            author: row.get(3)?,
            total_pages: row.get(4)?,
            total_chapters: row.get(5)?,
            current_page: row.get(6)?,
            current_chapter: row.get(7)?,
            daily_pages_goal: row.get(8)?,
            weekly_chapters_goal: row.get(9)?,
            created_at: row.get(10)?,
            sections: vec![],
            log: vec![],
        }),
    ).map_err(|e| e.to_string())?;
    let sections = load_book_sections(db, id)?;
    let log = load_book_log(db, id)?;
    Ok(CourseBook { sections, log, ..book })
}

fn sync_book_progress(db: &rusqlite::Connection, book_id: i64) -> Result<(), String> {
    db.execute(
        "UPDATE course_books SET
           current_page    = COALESCE((SELECT MAX(page_end)  FROM book_sections WHERE book_id=?1 AND done=1 AND page_end IS NOT NULL), 0),
           current_chapter = (SELECT COUNT(*) FROM book_sections WHERE book_id=?1 AND done=1 AND kind='chapter')
         WHERE id=?1",
        [book_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_course_books(state: tauri::State<AppState>, plan_id: i64) -> Result<Vec<CourseBook>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let ids: Vec<i64> = {
        let mut stmt = db.prepare("SELECT id FROM course_books WHERE plan_id=?1 ORDER BY created_at, id")
            .map_err(|e| e.to_string())?;
        let x: Vec<i64> = stmt.query_map([plan_id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        x
    };
    ids.iter().map(|&id| load_course_book(&db, id)).collect()
}

#[tauri::command]
pub fn create_course_book(state: tauri::State<AppState>, payload: CreateCourseBook) -> Result<CourseBook, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO course_books (plan_id, title, author, total_pages, total_chapters, daily_pages_goal, weekly_chapters_goal) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![payload.plan_id, payload.title, payload.author, payload.total_pages, payload.total_chapters, payload.daily_pages_goal.unwrap_or(0), payload.weekly_chapters_goal.unwrap_or(0)],
    ).map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    load_course_book(&db, id)
}

#[tauri::command]
pub fn update_course_book(state: tauri::State<AppState>, id: i64, payload: UpdateCourseBook) -> Result<CourseBook, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE course_books SET title=?1, author=?2, total_pages=?3, total_chapters=?4, current_page=?5, current_chapter=?6, daily_pages_goal=?7, weekly_chapters_goal=?8 WHERE id=?9",
        params![payload.title, payload.author, payload.total_pages, payload.total_chapters, payload.current_page, payload.current_chapter, payload.daily_pages_goal, payload.weekly_chapters_goal, id],
    ).map_err(|e| e.to_string())?;
    load_course_book(&db, id)
}

#[tauri::command]
pub fn delete_course_book(state: tauri::State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM course_books WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn add_book_reading_log(state: tauri::State<AppState>, payload: CreateBookReadingLog) -> Result<CourseBook, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO book_reading_log (book_id, date, pages_read, chapters_read, note) VALUES (?1,?2,?3,?4,?5)",
        params![payload.book_id, payload.date, payload.pages_read, payload.chapters_read, payload.note],
    ).map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE course_books SET current_page = MIN(COALESCE(total_pages, 999999), current_page + ?1), current_chapter = MIN(COALESCE(total_chapters, 999999), CAST(current_chapter + ?2 AS INTEGER)) WHERE id=?3",
        params![payload.pages_read, payload.chapters_read, payload.book_id],
    ).map_err(|e| e.to_string())?;
    load_course_book(&db, payload.book_id)
}

#[tauri::command]
pub fn delete_book_reading_log(state: tauri::State<AppState>, log_id: i64, book_id: i64) -> Result<CourseBook, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let (pages, chapters): (i64, f64) = db.query_row(
        "SELECT pages_read, chapters_read FROM book_reading_log WHERE id=?1",
        [log_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM book_reading_log WHERE id=?1", [log_id]).map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE course_books SET current_page = MAX(0, current_page - ?1), current_chapter = MAX(0, CAST(current_chapter - ?2 AS INTEGER)) WHERE id=?3",
        params![pages, chapters, book_id],
    ).map_err(|e| e.to_string())?;
    load_course_book(&db, book_id)
}

// ── Book Sections ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn upsert_book_sections(
    state: tauri::State<AppState>,
    book_id: i64,
    sections: Vec<BookSectionInput>,
) -> Result<CourseBook, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let incoming_ids: Vec<i64> = sections.iter().filter_map(|s| s.id).collect();
    if incoming_ids.is_empty() {
        db.execute("DELETE FROM book_sections WHERE book_id=?1", [book_id])
            .map_err(|e| e.to_string())?;
    } else {
        let placeholders = incoming_ids.iter().enumerate()
            .map(|(i, _)| format!("?{}", i + 2))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "DELETE FROM book_sections WHERE book_id=?1 AND id NOT IN ({})",
            placeholders
        );
        let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
        let mut bind_vals: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(book_id)];
        for id in &incoming_ids { bind_vals.push(Box::new(*id)); }
        let refs: Vec<&dyn rusqlite::ToSql> = bind_vals.iter().map(|b| b.as_ref()).collect();
        stmt.execute(refs.as_slice()).map_err(|e| e.to_string())?;
    }

    for s in &sections {
        if let Some(id) = s.id {
            db.execute(
                "UPDATE book_sections SET title=?1, kind=?2, sort_order=?3, page_start=?4, page_end=?5, due_date=?6, time_estimate=?7 WHERE id=?8",
                params![s.title, s.kind, s.sort_order, s.page_start, s.page_end, s.due_date, s.time_estimate, id],
            ).map_err(|e| e.to_string())?;
        } else {
            db.execute(
                "INSERT INTO book_sections (book_id, title, kind, sort_order, page_start, page_end, due_date, time_estimate) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![book_id, s.title, s.kind, s.sort_order, s.page_start, s.page_end, s.due_date, s.time_estimate],
            ).map_err(|e| e.to_string())?;
        }
    }

    load_course_book(&db, book_id)
}

#[tauri::command]
pub fn toggle_book_section(state: tauri::State<AppState>, book_id: i64, section_id: i64) -> Result<CourseBook, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE book_sections SET
           done   = CASE WHEN done=0 THEN 1 ELSE 0 END,
           done_at = CASE WHEN done=0 THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') ELSE NULL END
         WHERE id=?1",
        [section_id],
    ).map_err(|e| e.to_string())?;
    sync_book_progress(&db, book_id)?;
    load_course_book(&db, book_id)
}

#[tauri::command]
pub fn update_book_section(
    state: tauri::State<AppState>,
    section_id: i64,
    notes: Option<String>,
    due_date: Option<String>,
) -> Result<BookSection, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE book_sections SET notes=?1, due_date=?2 WHERE id=?3",
        params![notes, due_date, section_id],
    ).map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT id, book_id, title, kind, sort_order, page_start, page_end, due_date, time_estimate, done, done_at, notes, created_at FROM book_sections WHERE id=?1",
    ).map_err(|e| e.to_string())?;
    stmt.query_row([section_id], |r| Ok(BookSection {
        id:            r.get(0)?,
        book_id:       r.get(1)?,
        title:         r.get(2)?,
        kind:          r.get::<_, Option<String>>(3)?.unwrap_or_else(|| "chapter".into()),
        sort_order:    r.get(4)?,
        page_start:    r.get(5)?,
        page_end:      r.get(6)?,
        due_date:      r.get(7)?,
        time_estimate: r.get(8)?,
        done:          r.get::<_, i64>(9)? != 0,
        done_at:       r.get(10)?,
        notes:         r.get(11)?,
        created_at:    r.get(12)?,
    })).map_err(|e| e.to_string())
}
