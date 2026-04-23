use serde::{Deserialize, Serialize};

// ── Goal Groups ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoalGroup {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
}

// ── Goals ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Goal {
    pub id: i64,
    pub group_id: Option<i64>,
    pub group_name: Option<String>,
    pub group_color: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub deadline: Option<String>,
    pub status: String,
    pub priority: String,
    pub created_at: String,
    pub task_count: i64,
    pub done_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateGoal {
    pub title: String,
    pub description: Option<String>,
    pub deadline: Option<String>,
    pub priority: Option<String>,
    pub group_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateGoal {
    pub title: String,
    pub description: Option<String>,
    pub deadline: Option<String>,
    pub status: String,
    pub priority: String,
    pub group_id: Option<i64>,
}

// ── Lifestyle Areas ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LifestyleArea {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateLifestyleArea {
    pub name: String,
    pub color: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateLifestyleArea {
    pub name: String,
    pub color: String,
    pub sort_order: i64,
}

// ── Plans ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Plan {
    pub id: i64,
    pub goal_id: Option<i64>,
    pub title: String,
    pub description: Option<String>,
    pub deadline: Option<String>,
    pub status: String,
    pub created_at: String,
    pub task_count: i64,
    pub done_count: i64,
    pub tags: Option<String>,
    pub is_course: bool,
    pub is_lifestyle: bool,
    pub lifestyle_area_id: Option<i64>,
    pub purpose: Option<String>,
    pub problem: Option<String>,
    pub solution: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreatePlan {
    pub goal_id: Option<i64>,
    pub title: String,
    pub description: Option<String>,
    pub deadline: Option<String>,
    pub tags: Option<String>,
    pub is_course: Option<bool>,
    pub is_lifestyle: Option<bool>,
    pub lifestyle_area_id: Option<i64>,
    pub purpose: Option<String>,
    pub problem: Option<String>,
    pub solution: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePlan {
    pub goal_id: Option<i64>,
    pub title: String,
    pub description: Option<String>,
    pub deadline: Option<String>,
    pub status: String,
    pub tags: Option<String>,
    pub is_course: Option<bool>,
    pub is_lifestyle: Option<bool>,
    pub lifestyle_area_id: Option<i64>,
    pub purpose: Option<String>,
    pub problem: Option<String>,
    pub solution: Option<String>,
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Task {
    pub id: i64,
    pub plan_id: Option<i64>,
    pub title: String,
    pub done: bool,
    pub sort_order: i64,
    pub priority: String,
    pub due_date: Option<String>,
    pub created_at: String,
    pub time_estimate: Option<i64>,
    pub kanban_status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TaskWithContext {
    pub id: i64,
    pub plan_id: Option<i64>,
    pub plan_title: Option<String>,
    pub goal_id: Option<i64>,
    pub goal_title: Option<String>,
    pub title: String,
    pub done: bool,
    pub sort_order: i64,
    pub priority: String,
    pub due_date: Option<String>,
    pub created_at: String,
    pub time_estimate: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTask {
    pub plan_id: Option<i64>,
    pub title: String,
    pub priority: Option<String>,
    pub due_date: Option<String>,
    pub time_estimate: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTask {
    pub title: String,
    pub priority: String,
    pub due_date: Option<String>,
    pub time_estimate: Option<i64>,
    pub kanban_status: Option<String>,
}

// ── Project Goals ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectGoal {
    pub id: i64,
    pub plan_id: i64,
    pub title: String,
    pub done: bool,
    pub sort_order: i64,
}

#[derive(Debug, Deserialize)]
pub struct AddProjectGoal {
    pub plan_id: i64,
    pub title: String,
}

// ── Systems ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SystemEntry {
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    pub frequency: String,
    pub days_of_week: Option<String>,
    pub last_done: Option<String>,
    pub streak_count: i64,
    pub streak_updated: Option<String>,
    pub created_at: String,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub is_lifestyle: bool,
    pub lifestyle_area_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSystem {
    pub title: String,
    pub description: Option<String>,
    pub frequency: String,
    pub days_of_week: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub is_lifestyle: Option<bool>,
    pub lifestyle_area_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSystem {
    pub title: String,
    pub description: Option<String>,
    pub frequency: String,
    pub days_of_week: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub is_lifestyle: Option<bool>,
    pub lifestyle_area_id: Option<i64>,
}

// ── System Subtasks ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SystemSubtask {
    pub id: i64,
    pub system_id: i64,
    pub title: String,
    pub sort_order: i64,
    pub done: bool,
}

#[derive(Debug, Serialize)]
pub struct SubtaskToggleResult {
    pub subtasks: Vec<SystemSubtask>,
    pub system: SystemEntry,
}

// ── Routines ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RoutineItem {
    pub id: i64,
    pub kind: String,       // "morning" | "evening"
    pub title: String,
    pub sort_order: i64,
    pub done: bool,
}

#[derive(Debug, Serialize)]
pub struct Routines {
    pub morning: Vec<RoutineItem>,
    pub evening: Vec<RoutineItem>,
}

// ── Time Blocks ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TimeBlock {
    pub id: i64,
    pub date: String,
    pub slot: String,
    pub label: String,
}

// ── Daily Template ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyItemWithStatus {
    pub id: i64,
    pub section_id: i64,
    pub title: String,
    pub sort_order: i64,
    pub done: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailySection {
    pub id: i64,
    pub title: String,
    pub color: String,
    pub sort_order: i64,
    pub items: Vec<DailyItemWithStatus>,
}

#[derive(Debug, Serialize)]
pub struct DailyPlan {
    pub date: String,
    pub sections: Vec<DailySection>,
    pub total_items: i64,
    pub done_items: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateDailySection {
    pub title: String,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateDailySection {
    pub title: String,
    pub color: String,
    pub sort_order: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateDailyItem {
    pub section_id: i64,
    pub title: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateDailyItem {
    pub title: String,
    pub sort_order: i64,
}

// ── Daily Goals ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailySecGoal {
    pub id: i64,
    pub date: String,
    pub text: String,
    pub sort_order: i64,
}

#[derive(Debug, Serialize)]
pub struct DailyGoals {
    pub primary: Option<String>,
    pub secondary: Vec<DailySecGoal>,
}

// ── Reminders ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Reminder {
    pub id: i64,
    pub title: String,
    pub done: bool,
    pub due_date: Option<String>,
    pub created_at: String,
}

// ── Quick Notes ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QuickNote {
    pub id: i64,
    pub title: String,
    pub body: Option<String>,
    pub created_at: String,
}

// ── Brain Dump ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BrainEntry {
    pub id: i64,
    pub content: String,
    pub created_at: String,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CalEvent {
    pub id: i64,
    pub title: String,
    pub date: String,
    pub description: Option<String>,
    pub created_at: String,
}

// ── Deadlines ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Deadline {
    pub id: i64,
    pub title: String,
    pub due_date: String,
    pub done: bool,
    pub created_at: String,
}

// ── Agreements ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Agreement {
    pub id: i64,
    pub title: String,
    pub notes: Option<String>,
    pub created_at: String,
}

// ── Week View ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct WeekItems {
    pub tasks: Vec<TaskWithContext>,
    pub goals: Vec<Goal>,
    pub plans: Vec<Plan>,
    pub deadlines: Vec<Deadline>,
    pub reminders: Vec<Reminder>,
    pub course_assignments: Vec<CourseAssignment>,
}

// ── Lifestyle View ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct LifestyleItems {
    pub systems: Vec<SystemEntry>,
    pub plans: Vec<Plan>,
}

// ── Calendar Blocks ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CalBlock {
    pub id: i64,
    pub date: String,
    pub title: String,
    pub start_time: String,
    pub end_time: String,
    pub color: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub created_at: String,
    pub is_recurring: bool,
    pub recurring_id: Option<i64>,
    pub recurrence: Option<String>,
    pub days_of_week: Option<String>,
    pub series_start_date: Option<String>,
    pub series_end_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecurringCalBlock {
    pub id: i64,
    pub title: String,
    pub start_time: String,
    pub end_time: String,
    pub color: String,
    pub recurrence: String,
    pub days_of_week: Option<String>,
    pub start_date: String,
    pub end_date: Option<String>,
    pub description: Option<String>,
    pub location: Option<String>,
    pub created_at: String,
}

// ── Course Assignments ────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CourseAssignment {
    pub id:              i64,
    pub plan_id:         i64,
    pub plan_title:      String,
    pub title:           String,
    pub assignment_type: String,
    pub due_date:        Option<String>,
    pub status:          String,
    pub priority:        String,
    pub book_title:      Option<String>,
    pub chapter_start:   Option<String>,
    pub chapter_end:     Option<String>,
    pub page_start:      Option<i64>,
    pub page_end:        Option<i64>,
    pub page_current:    Option<i64>,
    pub notes:           Option<String>,
    pub created_at:      String,
    pub start_time:      Option<String>,
    pub end_time:        Option<String>,
    pub time_estimate:   Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCourseAssignment {
    pub plan_id:         i64,
    pub title:           String,
    pub assignment_type: String,
    pub due_date:        Option<String>,
    pub status:          String,
    pub priority:        String,
    pub book_title:      Option<String>,
    pub chapter_start:   Option<String>,
    pub chapter_end:     Option<String>,
    pub page_start:      Option<i64>,
    pub page_end:        Option<i64>,
    pub page_current:    Option<i64>,
    pub notes:           Option<String>,
    pub start_time:      Option<String>,
    pub end_time:        Option<String>,
    pub time_estimate:   Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCourseAssignment {
    pub plan_id:         i64,
    pub title:           String,
    pub assignment_type: String,
    pub due_date:        Option<String>,
    pub status:          String,
    pub priority:        String,
    pub book_title:      Option<String>,
    pub chapter_start:   Option<String>,
    pub chapter_end:     Option<String>,
    pub page_start:      Option<i64>,
    pub page_end:        Option<i64>,
    pub page_current:    Option<i64>,
    pub notes:           Option<String>,
    pub start_time:      Option<String>,
    pub end_time:        Option<String>,
    pub time_estimate:   Option<i64>,
}

// ── Pipelines ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PipelineStep {
    pub id:            i64,
    pub template_id:   i64,
    pub title:         String,
    pub description:   Option<String>,
    pub sort_order:    i64,
    pub time_estimate: Option<i64>,
    pub step_type:     String,
    pub attend_type:   Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PipelineTemplate {
    pub id:             i64,
    pub plan_id:        i64,
    pub title:          String,
    pub description:    Option<String>,
    pub color:          String,
    pub created_at:     String,
    pub steps:          Vec<PipelineStep>,
    pub run_count:      i64,
    pub done_run_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PipelineRunStep {
    pub step_id:         i64,
    pub step_title:      String,
    pub step_sort_order: i64,
    pub step_type:       String,
    pub done:            bool,
    pub done_at:         Option<String>,
    pub notes:           Option<String>,
    pub due_date:        Option<String>,
    pub chapter_ref:     Option<String>,
    pub page_start:      Option<i64>,
    pub page_end:        Option<i64>,
    pub start_time:      Option<String>,
    pub end_time:        Option<String>,
    pub location:        Option<String>,
    pub time_estimate:   Option<i64>,
    pub assignment_id:   Option<i64>,
    pub due_date_2:      Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PipelineRun {
    pub id:             i64,
    pub template_id:    i64,
    pub title:          String,
    pub notes:          Option<String>,
    pub scheduled_date: Option<String>,
    pub sort_order:     i64,
    pub created_at:     String,
    pub steps:          Vec<PipelineRunStep>,
}

#[derive(Debug, Deserialize)]
pub struct CreatePipelineTemplate {
    pub plan_id:     i64,
    pub title:       String,
    pub description: Option<String>,
    pub color:       Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePipelineTemplate {
    pub title:       String,
    pub description: Option<String>,
    pub color:       String,
}

#[derive(Debug, Deserialize)]
pub struct PipelineStepInput {
    pub id:            Option<i64>,
    pub title:         String,
    pub description:   Option<String>,
    pub sort_order:    i64,
    pub time_estimate: Option<i64>,
    pub step_type:     Option<String>,
    pub attend_type:   Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreatePipelineRun {
    pub template_id:    i64,
    pub title:          String,
    pub notes:          Option<String>,
    pub scheduled_date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePipelineRun {
    pub title:          String,
    pub notes:          Option<String>,
    pub scheduled_date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePipelineRunStep {
    pub notes:       Option<String>,
    pub due_date:    Option<String>,
    pub chapter_ref: Option<String>,
    pub page_start:  Option<i64>,
    pub page_end:    Option<i64>,
    pub start_time:    Option<String>,
    pub end_time:      Option<String>,
    pub location:      Option<String>,
    pub time_estimate: Option<i64>,
    pub due_date_2:    Option<String>,
}

// ── Pipeline Step Subtasks ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PipelineStepSubtask {
    pub id:         i64,
    pub run_id:     i64,
    pub step_id:    i64,
    pub title:      String,
    pub done:       bool,
    pub sort_order: i64,
}

// ── CA Subtasks ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CaSubtask {
    pub id:            i64,
    pub assignment_id: i64,
    pub title:         String,
    pub done:          bool,
    pub sort_order:    i64,
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct TodayFocus {
    pub tasks_due_today: Vec<TaskWithContext>,
    pub overdue_tasks: Vec<TaskWithContext>,
    pub systems_due: Vec<SystemEntry>,
}

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub kind: String,
    pub id: i64,
    pub title: String,
    pub subtitle: Option<String>,
}

// ── Games ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Game {
    pub id:              i64,
    pub title:           String,
    pub genre:           Option<String>,
    pub platform:        Option<String>,
    pub engine:          Option<String>,
    pub status:          String,
    pub description:     Option<String>,
    pub core_mechanic:   Option<String>,
    pub target_audience: Option<String>,
    pub inspiration:     Option<String>,
    pub color:           String,
    pub created_at:      String,
    pub feature_count:   i64,
    pub done_count:      i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateGame {
    pub title:           String,
    pub genre:           Option<String>,
    pub platform:        Option<String>,
    pub engine:          Option<String>,
    pub status:          Option<String>,
    pub description:     Option<String>,
    pub core_mechanic:   Option<String>,
    pub target_audience: Option<String>,
    pub inspiration:     Option<String>,
    pub color:           Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateGame {
    pub title:           String,
    pub genre:           Option<String>,
    pub platform:        Option<String>,
    pub engine:          Option<String>,
    pub status:          String,
    pub description:     Option<String>,
    pub core_mechanic:   Option<String>,
    pub target_audience: Option<String>,
    pub inspiration:     Option<String>,
    pub color:           String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GameFeature {
    pub id:          i64,
    pub game_id:     i64,
    pub title:       String,
    pub description: Option<String>,
    pub status:      String,
    pub priority:    String,
    pub sort_order:  i64,
    pub created_at:  String,
}

#[derive(Debug, Deserialize)]
pub struct CreateGameFeature {
    pub game_id:     i64,
    pub title:       String,
    pub description: Option<String>,
    pub status:      Option<String>,
    pub priority:    Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateGameFeature {
    pub title:       String,
    pub description: Option<String>,
    pub status:      String,
    pub priority:    String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GameDevlogEntry {
    pub id:         i64,
    pub game_id:    i64,
    pub content:    String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct AddGameDevlogEntry {
    pub game_id: i64,
    pub content: String,
}

// ── Lifestyle Fitness ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyHabit {
    pub id: i64,
    pub title: String,
    pub color: String,
    pub sort_order: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateDailyHabit {
    pub title: String,
    pub color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HabitWithCompletion {
    pub id: i64,
    pub title: String,
    pub color: String,
    pub sort_order: i64,
    pub done: bool,
    pub streak: i64,
    pub recent_dates: Vec<String>, // completed dates in last 7 days (YYYY-MM-DD)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RunLog {
    pub id: i64,
    pub date: String,
    pub distance_km: Option<f64>,
    pub duration_min: Option<i64>,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateRunLog {
    pub date: String,
    pub distance_km: Option<f64>,
    pub duration_min: Option<i64>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkoutExercise {
    pub id: i64,
    pub workout_id: i64,
    pub name: String,
    pub sets: Option<i64>,
    pub reps: Option<i64>,
    pub weight_kg: Option<f64>,
    pub notes: Option<String>,
    pub sort_order: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkoutLog {
    pub id: i64,
    pub date: String,
    pub name: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub exercises: Vec<WorkoutExercise>,
}

#[derive(Debug, Deserialize)]
pub struct CreateWorkoutLog {
    pub date: String,
    pub name: String,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddWorkoutExercise {
    pub workout_id: i64,
    pub name: String,
    pub sets: Option<i64>,
    pub reps: Option<i64>,
    pub weight_kg: Option<f64>,
    pub notes: Option<String>,
}

// ── Roadmap ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RoadmapItem {
    pub id: i64,
    pub plan_id: i64,
    pub title: String,
    pub description: Option<String>,
    pub due_date: Option<String>,
    pub status: String,
    pub sort_order: i64,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateRoadmapItem {
    pub plan_id: i64,
    pub title: String,
    pub description: Option<String>,
    pub due_date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRoadmapItem {
    pub title: String,
    pub description: Option<String>,
    pub due_date: Option<String>,
    pub status: String,
}

// ── Course Books ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CourseBook {
    pub id: i64,
    pub plan_id: i64,
    pub title: String,
    pub author: Option<String>,
    pub total_pages: Option<i64>,
    pub total_chapters: Option<i64>,
    pub current_page: i64,
    pub current_chapter: i64,
    pub daily_pages_goal: i64,
    pub weekly_chapters_goal: i64,
    pub created_at: String,
    pub sections: Vec<BookSection>,
    pub log: Vec<BookReadingLog>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BookSection {
    pub id: i64,
    pub book_id: i64,
    pub title: String,
    pub kind: String,
    pub sort_order: i64,
    pub page_start: Option<i64>,
    pub page_end: Option<i64>,
    pub due_date: Option<String>,
    pub time_estimate: Option<i64>,
    pub done: bool,
    pub done_at: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct BookSectionInput {
    pub id: Option<i64>,
    pub title: String,
    pub kind: String,
    pub sort_order: i64,
    pub page_start: Option<i64>,
    pub page_end: Option<i64>,
    pub due_date: Option<String>,
    pub time_estimate: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BookReadingLog {
    pub id: i64,
    pub book_id: i64,
    pub date: String,
    pub pages_read: i64,
    pub chapters_read: f64,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCourseBook {
    pub plan_id: i64,
    pub title: String,
    pub author: Option<String>,
    pub total_pages: Option<i64>,
    pub total_chapters: Option<i64>,
    pub daily_pages_goal: Option<i64>,
    pub weekly_chapters_goal: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCourseBook {
    pub title: String,
    pub author: Option<String>,
    pub total_pages: Option<i64>,
    pub total_chapters: Option<i64>,
    pub current_page: i64,
    pub current_chapter: i64,
    pub daily_pages_goal: i64,
    pub weekly_chapters_goal: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateBookReadingLog {
    pub book_id: i64,
    pub date: String,
    pub pages_read: i64,
    pub chapters_read: f64,
    pub note: Option<String>,
}
