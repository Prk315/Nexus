export type GoalStatus = "active" | "completed" | "archived";
// `Priority` is the *importance* axis. It is deliberately not renamed — every
// consumer in this repo (Dashboard, Week, the command palette, the task-quick
// edge function, the iOS widgets) writes `priority`. `Urgency` is its new
// complement; together they place a task on the 3x3 matrix.
export type Priority = "high" | "medium" | "low";
export type Urgency = "high" | "medium" | "low";
// Quick-task kinds. `null` on a task means a regular project task — the three
// named categories are lightweight standing lists (surfaced by Nexus Local and
// the home-screen quick-task widget) that don't belong to any plan.
export type TaskCategory = "reminder" | "chore" | "shopping";
export type Frequency = "daily" | "weekly" | "monthly";
/**
 * A system's cadence. The calendar kinds recur on dates; `interval` recurs a
 * fixed number of days after the last completion, which is what a chore wants
 * ("wash the clothes weekly" should follow you, not the calendar).
 */
export type SystemFrequency = Frequency | "interval";

// ── The task ISA hierarchy ───────────────────────────────────────────────────
//
// `pf_tasks` is the supertype: everything that every kind of task has. Each kind
// then has its own subtype table, and they are deliberately unequal in size — a
// full task carries a whole planning relation, a shopping item carries two
// columns. Modelling them as one wide table is what this replaced.
//
//   task     -> pf_task_planning   (urgency, stage, completion_mode, target, notes)
//   reminder -> pf_task_reminders  (remind_at, lead_minutes)
//   chore    -> pf_task_chores     (area, rotation_days)
//   shopping -> pf_task_shopping   (quantity, store)
//
// `task_type` is the discriminator. In the database it is a generated column
// (`coalesce(category, 'task')`), so it can never drift from the `category` that
// existing writers — the task-quick edge function, the iOS widgets — already set.
export type TaskType = "task" | TaskCategory;

// The task lifecycle. A task is specified, then committed to the calendar, and
// only then worked on — `active` is gated on having scheduled minutes (enforced
// in api.ts `setTaskStage`, which is the only write path the UI uses).
//
// Only the 'task' subtype has one. A reminder has no lifecycle to gate.
export type TaskStage = "refine" | "schedule" | "active" | "done";

// What "complete" means for a full task.
//   binary   — the checkbox (every task that existed before the breakdown work).
//   sessions — N logged work sessions against `target_count`. This is what makes
//              a *recurring* subtask completable: it is never done in one sitting.
//   time     — logged minutes against `time_estimate`.
export type CompletionMode = "binary" | "sessions" | "time";

/** The `task` subtype: the heavy planning relation. Absent on sparse kinds. */
export interface TaskPlanning {
  urgency: Urgency;
  stage: TaskStage;
  completion_mode: CompletionMode;
  target_count: number | null;
  notes: string | null;
}

/** The `reminder` subtype. */
export interface TaskReminder {
  remind_at: string | null;
  lead_minutes: number | null;
}

/** The `chore` subtype. */
export interface TaskChore {
  area: string | null;
  rotation_days: number | null;
}

/** The `shopping` subtype. */
export interface TaskShopping {
  quantity: string | null;
  store: string | null;
}

export interface GoalGroup {
  id: number;
  name: string;
  color: string;
  sort_order: number;
}

export interface Goal {
  id: number;
  group_id: number | null;
  group_name: string | null;
  group_color: string | null;
  title: string;
  description: string | null;
  deadline: string | null;
  status: GoalStatus;
  priority: Priority;
  created_at: string;
  task_count: number;
  done_count: number;
}

export interface Plan {
  id: number;
  goal_id: number | null;
  parent_id: number | null;
  title: string;
  description: string | null;
  deadline: string | null;
  status: string;
  created_at: string;
  task_count: number;
  done_count: number;
  tags: string | null;
  is_course: boolean;
  is_lifestyle: boolean;
  is_schedule: boolean;
  lifestyle_area_id: number | null;
  purpose: string | null;
  problem: string | null;
  solution: string | null;
  /** Owning team, or null for a plan that belongs to one person. */
  team_id: string | null;
}

/**
 * Supertype fields — what every kind of task has, regardless of subtype.
 *
 * `priority`, `due_date` and `time_estimate` live here rather than in the
 * planning subtype because they are genuinely meaningful for a chore ("medium,
 * 15 min, by Friday") as much as for a project task.
 */
export interface TaskBase {
  id: number;
  plan_id: number | null;
  /** Parent task, for recursive breakdown. `null` = a top-level task. */
  parent_id: number | null;
  /**
   * Direct link to a goal, bypassing the plan level.
   *
   * PathFinder originally modelled goal -> plan -> task only, and that chain went
   * unused — no plan carried a goal, so no goal could ever show progress. A task
   * may now name its goal itself. Takes precedence over the goal reached through
   * `plan_id`; `null` means "inherit from the plan, if any".
   */
  goal_id: number | null;
  task_type: TaskType;
  title: string;
  done: boolean;
  sort_order: number;
  priority: Priority;
  due_date: string | null;
  created_at: string;
  /** What this task claims for *itself*. See `aggregate_estimate`. */
  time_estimate: number | null;
  /**
   * Rolled-up minutes for the whole subtree, maintained by a database trigger:
   * the sum of children's aggregates, or own `time_estimate` for a leaf.
   *
   * This is the number to show on a primary task — once it is broken down, its
   * own `time_estimate` is a stale standalone guess, not the total. Read-only:
   * writing it is overwritten on the next recompute.
   */
  aggregate_estimate: number;
  kanban_status: string;
  category: TaskCategory | null;
  /** Owning team, or null for a task that belongs to one person. */
  team_id: string | null;
  /**
   * Who a team task is for: null = unassigned, `"all"` = every member, else a
   * specific member's user id. Meaningless (and unused) when `team_id` is null.
   */
  assigned_to: string | null;
}

export interface Task extends TaskBase {
  /** The `task` subtype's row. `null` for every sparse kind. */
  planning: TaskPlanning | null;
}

export interface ProjectGoal {
  id: number;
  plan_id: number;
  title: string;
  done: boolean;
  sort_order: number;
}

export interface TaskWithContext extends TaskBase {
  plan_title: string | null;
  /** Resolved goal title, whether reached directly or through the plan. */
  goal_title: string | null;
  /** The `task` subtype's row. `null` for every sparse kind. */
  planning: TaskPlanning | null;
}

/** One chunk of work actually done on a task — the ledger behind sessions/time modes. */
export interface TaskSession {
  id: number;
  task_id: number;
  date: string;
  minutes: number;
  /**
   * The calendar occurrence this session ticks off, if any. May be the *negative*
   * virtual id of a recurring-block occurrence (see `expandRecurring`), so this
   * is deliberately not a foreign key.
   */
  cal_block_id: number | null;
  note: string | null;
  created_at: string;
}

/** How much calendar time a task has committed, and how much it still needs. */
export interface TaskCoverage {
  /** Minutes of calendar blocks pointing at this task (one-off + recurring occurrences). */
  scheduledMin: number;
  /** Number of distinct calendar commitments (occurrences, not series). */
  blockCount: number;
  /** Earliest committed date, or null when nothing is scheduled. */
  firstDate: string | null;
}

export interface SystemSubtask {
  id: number;
  system_id: number;
  title: string;
  sort_order: number;
  done: boolean;
}

export interface SubtaskToggleResult {
  subtasks: SystemSubtask[];
  system: SystemEntry;
}

export interface SystemEntry {
  id: number;
  title: string;
  description: string | null;
  frequency: SystemFrequency;
  /**
   * Days between completions when `frequency === "interval"`; NULL otherwise.
   * Interval recurrence floats with `last_done` rather than the calendar — see
   * lib/systems.ts.
   */
  interval_days: number | null;
  days_of_week: string | null;
  last_done: string | null;
  streak_count: number;
  streak_updated: string | null;
  created_at: string;
  start_time: string | null;
  end_time: string | null;
  is_lifestyle: boolean;
  lifestyle_area_id: number | null;
}

export interface RoutineItem {
  id: number;
  kind: "morning" | "evening";
  title: string;
  sort_order: number;
  done: boolean;
}

export interface Routines {
  morning: RoutineItem[];
  evening: RoutineItem[];
}

export interface TimeBlock {
  id: number;
  date: string;
  slot: string;
  label: string;
}

export interface WeekItems {
  tasks: TaskWithContext[];
  goals: Goal[];
  plans: Plan[];
  deadlines: Deadline[];
  course_assignments: CourseAssignment[];
  schedule_entries: ScheduleEntry[];
  training_sessions: TrainingSession[];
}

export interface ScheduleEntry {
  id: number;
  plan_id: number;
  plan_title: string;
  title: string;
  description: string | null;
  location: string | null;
  date: string | null;           // concrete date for one-off; null for raw recurring rows
  start_time: string | null;
  end_time: string | null;
  color: string;
  category: string;              // transport | medical | fitness | work | social | other
  is_recurring: boolean;
  recurring_id: number | null;   // original row id for expanded virtual instances
  recurrence: string | null;
  days_of_week: string | null;
  series_start_date: string | null;
  series_end_date: string | null;
  created_at: string;
}

export interface DailyItemWithStatus {
  id: number;
  section_id: number;
  title: string;
  sort_order: number;
  done: boolean;
}

export interface DailySection {
  id: number;
  title: string;
  color: string;
  sort_order: number;
  items: DailyItemWithStatus[];
}

export interface DailyPlan {
  date: string;
  sections: DailySection[];
  total_items: number;
  done_items: number;
}

export interface TodayFocus {
  tasks_due_today: TaskWithContext[];
  overdue_tasks: TaskWithContext[];
  systems_due: SystemEntry[];
}

export interface SearchResult {
  kind: "goal" | "plan" | "task" | "system";
  id: number;
  title: string;
  subtitle: string | null;
}

export interface DailySecGoal {
  id: number;
  date: string;
  text: string;
  sort_order: number;
  time_estimate_min: number | null;
}

export interface DailyPrimaryGoal {
  text: string;
  time_estimate_min: number | null;
}

export interface DailyGoals {
  primary: DailyPrimaryGoal | null;
  secondary: DailySecGoal[];
}

export interface QuickNote {
  id: number;
  title: string;
  body: string | null;
  created_at: string;
}

export interface BrainEntry {
  id: number;
  content: string;
  created_at: string;
}

export interface CalEvent {
  id: number;
  title: string;
  date: string;
  description: string | null;
  created_at: string;
}

export interface Deadline {
  id: number;
  title: string;
  due_date: string;
  done: boolean;
  created_at: string;
}

export interface CourseAssignment {
  id: number;
  plan_id: number;
  plan_title: string;
  title: string;
  assignment_type: string;
  due_date: string | null;
  status: string;       // pending | in_progress | done
  priority: string;
  book_title: string | null;
  chapter_start: string | null;
  chapter_end: string | null;
  page_start: number | null;
  page_end: number | null;
  page_current: number | null;
  notes: string | null;
  created_at: string;
  start_time: string | null;
  end_time: string | null;
  time_estimate: number | null;
}

export interface PipelineStepSubtask {
  id: number;
  run_id: number;
  step_id: number;
  title: string;
  done: boolean;
  sort_order: number;
}

export interface CaSubtask {
  id: number;
  assignment_id: number;
  title: string;
  done: boolean;
  sort_order: number;
}

export interface Agreement {
  id: number;
  title: string;
  notes: string | null;
  created_at: string;
}

export interface CalBlock {
  id: number;
  date: string;
  title: string;
  start_time: string;
  end_time: string;
  color: string;
  description: string | null;
  location: string | null;
  created_at: string;
  is_recurring: boolean;
  recurring_id: number | null;
  recurrence: string | null;
  days_of_week: string | null;
  series_start_date: string | null;
  series_end_date: string | null;
  task_id: number | null;
  /** Name of a `coverage_categories` row, matched by name (no FK). Null = uncategorized. */
  category: string | null;
  /**
   * Nested-block support: set when this block is a segment scheduled inside
   * another `pf_cal_blocks` row on the same date (Week view renders it as an
   * inset card inside its parent). `null` = top-level. `number`, not
   * `string` — matches `id`, since `pf_cal_blocks.id` is `bigint`, not
   * `uuid`. Always `null` on a virtual recurring occurrence (negative `id`):
   * recurring series never nest, see `expandRecurring`.
   */
  parent_block_id: number | null;
}

export interface PipelineStep {
  id: number;
  template_id: number;
  title: string;
  description: string | null;
  sort_order: number;
  time_estimate: number | null;
  step_type: string;
  attend_type: string | null;
}

export interface PipelineTemplate {
  id: number;
  plan_id: number;
  title: string;
  description: string | null;
  color: string;
  created_at: string;
  steps: PipelineStep[];
  run_count: number;
  done_run_count: number;
}

export interface PipelineRunStep {
  step_id: number;
  step_title: string;
  step_sort_order: number;
  step_type: string;
  done: boolean;
  done_at: string | null;
  notes: string | null;
  due_date: string | null;
  chapter_ref: string | null;
  page_start: number | null;
  page_end: number | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  time_estimate: number | null;
  assignment_id: number | null;
  due_date_2: string | null;
}

export interface PipelineRun {
  id: number;
  template_id: number;
  title: string;
  notes: string | null;
  scheduled_date: string | null;
  sort_order: number;
  created_at: string;
  steps: PipelineRunStep[];
}

export interface RecurringCalBlock {
  id: number;
  title: string;
  start_time: string;
  end_time: string;
  color: string;
  recurrence: string;
  days_of_week: string | null;
  start_date: string;
  end_date: string | null;
  description: string | null;
  location: string | null;
  created_at: string;
  /** Set when this series is a recurring commitment to a task/subtask. */
  task_id: number | null;
  /** Name of a `coverage_categories` row, matched by name (no FK). Null = uncategorized. */
  category: string | null;
}

export interface Game {
  id: number;
  title: string;
  genre: string | null;
  platform: string | null;
  engine: string | null;
  status: string;
  description: string | null;
  core_mechanic: string | null;
  target_audience: string | null;
  inspiration: string | null;
  color: string;
  created_at: string;
  feature_count: number;
  done_count: number;
}

export interface GameFeature {
  id: number;
  game_id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  sort_order: number;
  created_at: string;
}

export interface GameDevlogEntry {
  id: number;
  game_id: number;
  content: string;
  created_at: string;
}

export interface HabitStack {
  id: number;
  title: string;
  color: string;
  sort_order: number;
}

export interface HabitSubtask {
  id: number;
  habit_id: number;
  title: string;
  sort_order: number;
  done: boolean;
}

export interface HabitWithCompletion {
  id: number;
  title: string;
  color: string;
  sort_order: number;
  stack_id: number | null;
  done: boolean;
  streak: number;
  recent_dates: string[]; // YYYY-MM-DD strings for last 7 days where completed
  subtask_count: number;
  subtask_done_count: number;
}

export interface DailyHabit {
  id: number;
  title: string;
  color: string;
  sort_order: number;
  stack_id: number | null;
}

export interface RunLog {
  id: number;
  date: string;
  distance_km: number | null;
  duration_min: number | null;
  notes: string | null;
  created_at: string;
}

export interface WorkoutExercise {
  id: number;
  workout_id: number;
  name: string;
  sets: number | null;
  reps: number | null;
  weight_kg: number | null;
  notes: string | null;
  sort_order: number;
}

export interface WorkoutLog {
  id: number;
  date: string;
  name: string;
  notes: string | null;
  created_at: string;
  exercises: WorkoutExercise[];
}

export interface RoadmapItem {
  id: number;
  plan_id: number;
  title: string;
  description: string | null;
  due_date: string | null;
  status: string; // planned | in_progress | done
  sort_order: number;
  created_at: string;
}

export interface BookReadingLog {
  id: number;
  book_id: number;
  date: string;         // YYYY-MM-DD
  pages_read: number;
  chapters_read: number;
  note: string | null;
}

export interface BookSection {
  id: number;
  book_id: number;
  title: string;
  kind: string;         // 'chapter' | 'section' | 'page'
  sort_order: number;
  page_start: number | null;
  page_end: number | null;
  due_date: string | null;
  time_estimate: number | null;
  done: boolean;
  done_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface TrainingPlan {
  id: number;
  user_id: string;
  title: string;
  description: string | null;
  color: string;
  goal: string | null;
  days_per_week: number | null;
  plan_type: "running" | "strength" | "yoga" | "other";
  created_at: string;
}

export interface TrainingSession {
  id: number;
  user_id: string;
  plan_id: number | null;
  plan_title: string | null;
  plan_type: string | null;
  title: string;
  scheduled_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  notes: string | null;
  completed: boolean;
  created_at: string;
  // recurrence
  is_recurring: boolean;
  recurrence: string | null;       // "daily" | "weekly"
  days_of_week: string | null;     // comma-separated day ints, e.g. "1,3,5"
  series_start_date: string | null;
  series_end_date: string | null;
  recurring_id: number | null;     // original row id for virtual expanded instances
}

export interface SessionPerformance {
  id: number;
  user_id: string;
  session_id: number;
  metric_name: string;
  value: string;
  unit: string | null;
  created_at: string;
}

export interface CourseBook {
  id: number;
  plan_id: number;
  title: string;
  author: string | null;
  total_pages: number | null;
  total_chapters: number | null;
  current_page: number;
  current_chapter: number;
  daily_pages_goal: number;
  weekly_chapters_goal: number;
  created_at: string;
  sections: BookSection[];
  log: BookReadingLog[];
}
