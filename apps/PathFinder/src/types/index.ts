export type GoalStatus = "active" | "completed" | "archived";
export type Priority = "high" | "medium" | "low";
export type Frequency = "daily" | "weekly" | "monthly";

export interface GoalGroup {
  id: number;
  name: string;
  color: string;
  sort_order: number;
}

export interface LifestyleArea {
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
}

export interface Task {
  id: number;
  plan_id: number | null;
  title: string;
  done: boolean;
  sort_order: number;
  priority: Priority;
  due_date: string | null;
  created_at: string;
  time_estimate: number | null;
  kanban_status: string;
}

export interface ProjectGoal {
  id: number;
  plan_id: number;
  title: string;
  done: boolean;
  sort_order: number;
}

export interface TaskWithContext {
  id: number;
  plan_id: number | null;
  plan_title: string | null;
  goal_id: number | null;
  goal_title: string | null;
  title: string;
  done: boolean;
  sort_order: number;
  priority: Priority;
  due_date: string | null;
  created_at: string;
  time_estimate: number | null;
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
  frequency: Frequency;
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
  reminders: Reminder[];
  course_assignments: CourseAssignment[];
  schedule_entries: ScheduleEntry[];
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
}

export interface DailyGoals {
  primary: string | null;
  secondary: DailySecGoal[];
}

export interface Reminder {
  id: number;
  title: string;
  done: boolean;
  due_date: string | null;
  created_at: string;
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

export interface HabitWithCompletion {
  id: number;
  title: string;
  color: string;
  sort_order: number;
  stack_id: number | null;
  done: boolean;
  streak: number;
  recent_dates: string[]; // YYYY-MM-DD strings for last 7 days where completed
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
  created_at: string;
}

export interface TrainingSession {
  id: number;
  user_id: string;
  plan_id: number | null;
  plan_title: string | null;
  title: string;
  scheduled_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  notes: string | null;
  completed: boolean;
  created_at: string;
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

export interface Rule {
  id: number;
  user_id: string;
  title: string;
  body: string | null;
  sort_order: number;
  updated_at: string;
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
