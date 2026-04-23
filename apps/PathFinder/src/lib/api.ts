import { invoke } from "@tauri-apps/api/core";
import type { Goal, Plan, Task, TaskWithContext, SystemEntry, TodayFocus, SearchResult, DailyPlan, TimeBlock, Routines, WeekItems, Reminder, QuickNote, BrainEntry, CalEvent, Deadline, Agreement, DailyGoals, DailySecGoal, CalBlock, RecurringCalBlock, CourseAssignment, CaSubtask, LifestyleArea, PipelineTemplate, PipelineStep, PipelineRun, PipelineStepSubtask, ProjectGoal, Game, GameFeature, GameDevlogEntry, RoadmapItem } from "../types";

// Goal Groups
export const getGoalGroups    = () => invoke<import("../types").GoalGroup[]>("get_goal_groups");
export const createGoalGroup  = (name: string, color: string) => invoke<import("../types").GoalGroup>("create_goal_group", { name, color });
export const updateGoalGroup  = (id: number, name: string, color: string) => invoke<import("../types").GoalGroup>("update_goal_group", { id, name, color });
export const deleteGoalGroup  = (id: number) => invoke<void>("delete_goal_group", { id });

// Goals
export const getGoals = () => invoke<Goal[]>("get_goals");
export const createGoal = (payload: { title: string; description?: string | null; deadline?: string | null; priority?: string; group_id?: number | null }) =>
  invoke<Goal>("create_goal", { payload });
export const updateGoal = (id: number, payload: { title: string; description?: string | null; deadline?: string | null; status: string; priority: string; group_id?: number | null }) =>
  invoke<Goal>("update_goal", { id, payload });
export const deleteGoal = (id: number) => invoke<void>("delete_goal", { id });

// Plans
export const getPlans = () => invoke<Plan[]>("get_plans");
export const createPlan = (payload: { goal_id?: number | null; title: string; description?: string | null; deadline?: string | null; tags?: string | null; is_course?: boolean; is_lifestyle?: boolean; lifestyle_area_id?: number | null; purpose?: string | null; problem?: string | null; solution?: string | null }) =>
  invoke<Plan>("create_plan", { payload });
export const updatePlan = (id: number, payload: { goal_id?: number | null; title: string; description?: string | null; deadline?: string | null; status: string; tags?: string | null; is_course?: boolean; is_lifestyle?: boolean; lifestyle_area_id?: number | null; purpose?: string | null; problem?: string | null; solution?: string | null }) =>
  invoke<Plan>("update_plan", { id, payload });
export const deletePlan = (id: number) => invoke<void>("delete_plan", { id });

// Tasks
export const getTasks = (planId: number) => invoke<Task[]>("get_tasks", { planId });
export const getAllTasks = () => invoke<TaskWithContext[]>("get_all_tasks");
export const createTask = (payload: { plan_id?: number | null; title: string; priority?: string; due_date?: string | null; time_estimate?: number | null }) =>
  invoke<Task>("create_task", { payload });
export const updateTask = (id: number, payload: { title: string; priority: string; due_date?: string | null; time_estimate?: number | null }) =>
  invoke<Task>("update_task", { id, payload });
export const toggleTask = (id: number) => invoke<Task>("toggle_task", { id });
export const deleteTask = (id: number) => invoke<void>("delete_task", { id });
export const setTaskKanbanStatus = (id: number, status: string) => invoke<Task>("set_task_kanban_status", { id, status });

// Project Goals
export const getProjectGoals   = (planId: number) => invoke<ProjectGoal[]>("get_project_goals", { planId });
export const addProjectGoal    = (payload: { plan_id: number; title: string }) => invoke<ProjectGoal>("add_project_goal", { payload });
export const toggleProjectGoal = (id: number) => invoke<ProjectGoal>("toggle_project_goal", { id });
export const deleteProjectGoal = (id: number) => invoke<void>("delete_project_goal", { id });

// Systems
export const getSystems = () => invoke<SystemEntry[]>("get_systems");
export const createSystem = (payload: { title: string; description?: string | null; frequency: string; days_of_week?: string | null; start_time?: string | null; end_time?: string | null; is_lifestyle?: boolean; lifestyle_area_id?: number | null }) =>
  invoke<SystemEntry>("create_system", { payload });
export const updateSystem = (id: number, payload: { title: string; description?: string | null; frequency: string; days_of_week?: string | null; start_time?: string | null; end_time?: string | null; is_lifestyle?: boolean; lifestyle_area_id?: number | null }) =>
  invoke<SystemEntry>("update_system", { id, payload });
export const deleteSystem = (id: number) => invoke<void>("delete_system", { id });
export const markSystemDone     = (id: number) => invoke<SystemEntry>("mark_system_done",     { id });
export const unmarkSystemDone   = (id: number) => invoke<SystemEntry>("unmark_system_done",   { id });
export const getSystemSubtasks  = (systemId: number, date: string) => invoke<import("../types").SystemSubtask[]>("get_system_subtasks", { systemId, date });
export const addSystemSubtask   = (systemId: number, title: string) => invoke<import("../types").SystemSubtask[]>("add_system_subtask", { systemId, title });
export const deleteSystemSubtask = (id: number) => invoke<void>("delete_system_subtask", { id });
export const toggleSystemSubtask = (subtaskId: number, date: string) => invoke<import("../types").SubtaskToggleResult>("toggle_system_subtask", { subtaskId, date });

// Dashboard
export const getTodayFocus = () => invoke<TodayFocus>("get_today_focus");

// Search
export const search = (query: string) => invoke<SearchResult[]>("search", { query });

// Week view
export const getWeekItems = (startDate: string, endDate: string) =>
  invoke<WeekItems>("get_week_items", { startDate, endDate });

// Routines
export const getRoutines       = (date: string) => invoke<Routines>("get_routines", { date });
export const toggleRoutine     = (id: number, date: string) => invoke<boolean>("toggle_routine", { id, date });
export const addRoutineItem    = (kind: string, title: string) => invoke<void>("add_routine_item", { kind, title });
export const deleteRoutineItem = (id: number) => invoke<void>("delete_routine_item", { id });

// Time Blocks
export const getTimeBlocks = (date: string) => invoke<TimeBlock[]>("get_time_blocks", { date });
export const saveTimeBlock = (date: string, slot: string, label: string) =>
  invoke<void>("save_time_block", { date, slot, label });

// Daily Template
export const getDailyPlan = (date: string) => invoke<DailyPlan>("get_daily_plan", { date });
export const toggleDailyCompletion = (itemId: number, date: string) =>
  invoke<boolean>("toggle_daily_completion", { itemId, date });
export const createDailySection = (payload: { title: string; color?: string | null }) =>
  invoke<void>("create_daily_section", { payload });
export const updateDailySection = (id: number, payload: { title: string; color: string; sort_order: number }) =>
  invoke<void>("update_daily_section", { id, payload });
export const deleteDailySection = (id: number) => invoke<void>("delete_daily_section", { id });
export const createDailyItem = (payload: { section_id: number; title: string }) =>
  invoke<void>("create_daily_item", { payload });
export const updateDailyItem = (id: number, payload: { title: string; sort_order: number }) =>
  invoke<void>("update_daily_item", { id, payload });
export const deleteDailyItem = (id: number) => invoke<void>("delete_daily_item", { id });

// Daily Goals
export const getDailyGoals             = (date: string) => invoke<DailyGoals>("get_daily_goals", { date });
export const setDailyPrimaryGoal       = (date: string, text: string) => invoke<void>("set_daily_primary_goal", { date, text });
export const clearDailyPrimaryGoal     = (date: string) => invoke<void>("clear_daily_primary_goal", { date });
export const addDailySecondaryGoal     = (date: string, text: string) => invoke<DailySecGoal>("add_daily_secondary_goal", { date, text });
export const deleteDailySecondaryGoal  = (id: number) => invoke<void>("delete_daily_secondary_goal", { id });

// Reminders
export const getReminders    = () => invoke<Reminder[]>("get_reminders");
export const addReminder     = (title: string, dueDate?: string | null) => invoke<Reminder>("add_reminder", { title, dueDate: dueDate ?? null });
export const toggleReminder  = (id: number) => invoke<Reminder>("toggle_reminder", { id });
export const deleteReminder  = (id: number) => invoke<void>("delete_reminder", { id });

// Quick Notes
export const getQuickNotes   = () => invoke<QuickNote[]>("get_quick_notes");
export const addQuickNote    = (title: string, body?: string | null) => invoke<QuickNote>("add_quick_note", { title, body: body ?? null });
export const deleteQuickNote = (id: number) => invoke<void>("delete_quick_note", { id });

// Brain Dump
export const getBrainDump    = () => invoke<BrainEntry[]>("get_brain_dump");
export const addBrainEntry   = (content: string) => invoke<BrainEntry>("add_brain_entry", { content });
export const deleteBrainEntry= (id: number) => invoke<void>("delete_brain_entry", { id });

// Events
export const getEvents       = () => invoke<CalEvent[]>("get_events");
export const addEvent        = (title: string, date: string, description?: string | null) => invoke<CalEvent>("add_event", { title, date, description: description ?? null });
export const deleteEvent     = (id: number) => invoke<void>("delete_event", { id });

// Deadlines
export const getDeadlines    = () => invoke<Deadline[]>("get_deadlines");
export const addDeadline     = (title: string, due_date: string) => invoke<Deadline>("add_deadline", { title, dueDate: due_date });
export const toggleDeadline  = (id: number) => invoke<Deadline>("toggle_deadline", { id });
export const deleteDeadline  = (id: number) => invoke<void>("delete_deadline", { id });

// Agreements
export const getAgreements   = () => invoke<Agreement[]>("get_agreements");
export const addAgreement    = (title: string, notes?: string | null) => invoke<Agreement>("add_agreement", { title, notes: notes ?? null });
export const deleteAgreement = (id: number) => invoke<void>("delete_agreement", { id });

// Course Assignments
type CAPayload = { plan_id: number; title: string; assignment_type: string; due_date?: string | null; status: string; priority: string; book_title?: string | null; chapter_start?: string | null; chapter_end?: string | null; page_start?: number | null; page_end?: number | null; page_current?: number | null; notes?: string | null; start_time?: string | null; end_time?: string | null; time_estimate?: number | null };
export const getCourseAssignments      = () => invoke<CourseAssignment[]>("get_course_assignments");
export const createCourseAssignment    = (payload: CAPayload) => invoke<CourseAssignment>("create_course_assignment", { payload });
export const updateCourseAssignment    = (id: number, payload: CAPayload) => invoke<CourseAssignment>("update_course_assignment", { id, payload });
export const deleteCourseAssignment    = (id: number) => invoke<void>("delete_course_assignment", { id });

// CA Subtasks
export const getCaSubtasks    = (assignmentId: number) => invoke<CaSubtask[]>("get_ca_subtasks", { assignmentId });
export const addCaSubtask     = (assignmentId: number, title: string) => invoke<CaSubtask>("add_ca_subtask", { assignmentId, title });
export const toggleCaSubtask  = (id: number) => invoke<CaSubtask>("toggle_ca_subtask", { id });
export const deleteCaSubtask  = (id: number) => invoke<void>("delete_ca_subtask", { id });

// Pipelines
type PipelineTemplatePayload = { plan_id: number; title: string; description?: string | null; color?: string };
type PipelineStepInput = { id?: number | null; title: string; description?: string | null; sort_order: number; time_estimate?: number | null; step_type?: string | null; attend_type?: string | null };
type PipelineRunPayload = { template_id: number; title: string; notes?: string | null; scheduled_date?: string | null };
type PipelineRunUpdatePayload = { title: string; notes?: string | null; scheduled_date?: string | null };

export const getPipelineTemplates    = (planId: number) => invoke<PipelineTemplate[]>("get_pipeline_templates", { planId });
export const createPipelineTemplate  = (payload: PipelineTemplatePayload) => invoke<PipelineTemplate>("create_pipeline_template", { payload });
export const updatePipelineTemplate  = (id: number, payload: { title: string; description?: string | null; color: string }) => invoke<PipelineTemplate>("update_pipeline_template", { id, payload });
export const deletePipelineTemplate  = (id: number) => invoke<void>("delete_pipeline_template", { id });
export const upsertPipelineSteps     = (templateId: number, steps: PipelineStepInput[]) => invoke<PipelineStep[]>("upsert_pipeline_steps", { templateId, steps });
export const getPipelineRuns         = (templateId: number) => invoke<PipelineRun[]>("get_pipeline_runs", { templateId });
export const createPipelineRun       = (payload: PipelineRunPayload) => invoke<PipelineRun>("create_pipeline_run", { payload });
export const updatePipelineRun       = (id: number, payload: PipelineRunUpdatePayload) => invoke<PipelineRun>("update_pipeline_run", { id, payload });
export const deletePipelineRun       = (id: number) => invoke<void>("delete_pipeline_run", { id });
export const togglePipelineRunStep   = (runId: number, stepId: number) => invoke<PipelineRun>("toggle_pipeline_run_step", { runId, stepId });
export const updatePipelineRunStep   = (runId: number, stepId: number, payload: { notes: string | null; due_date: string | null; due_date_2: string | null; chapter_ref: string | null; page_start: number | null; page_end: number | null; start_time: string | null; end_time: string | null; location: string | null; time_estimate: number | null }) => invoke<PipelineRun>("update_pipeline_run_step", { runId, stepId, payload });

// Pipeline Step Subtasks
export const getPipelineStepSubtasks    = (runId: number, stepId: number) => invoke<PipelineStepSubtask[]>("get_pipeline_step_subtasks", { runId, stepId });
export const addPipelineStepSubtask     = (runId: number, stepId: number, title: string) => invoke<PipelineStepSubtask>("add_pipeline_step_subtask", { runId, stepId, title });
export const togglePipelineStepSubtask  = (id: number) => invoke<PipelineStepSubtask>("toggle_pipeline_step_subtask", { id });
export const deletePipelineStepSubtask  = (id: number) => invoke<void>("delete_pipeline_step_subtask", { id });

// Course Books
type CreateCourseBookPayload = { plan_id: number; title: string; author?: string | null; total_pages?: number | null; total_chapters?: number | null; daily_pages_goal?: number; weekly_chapters_goal?: number };
type UpdateCourseBookPayload = { title: string; author?: string | null; total_pages?: number | null; total_chapters?: number | null; current_page: number; current_chapter: number; daily_pages_goal: number; weekly_chapters_goal: number };
type CreateBookReadingLogPayload = { book_id: number; date: string; pages_read: number; chapters_read: number; note?: string | null };

export const getCourseBooks        = (planId: number) => invoke<import("../types").CourseBook[]>("get_course_books", { planId });
export const createCourseBook      = (payload: CreateCourseBookPayload) => invoke<import("../types").CourseBook>("create_course_book", { payload });
export const updateCourseBook      = (id: number, payload: UpdateCourseBookPayload) => invoke<import("../types").CourseBook>("update_course_book", { id, payload });
export const deleteCourseBook      = (id: number) => invoke<void>("delete_course_book", { id });
export const addBookReadingLog     = (payload: CreateBookReadingLogPayload) => invoke<import("../types").CourseBook>("add_book_reading_log", { payload });
export const deleteBookReadingLog  = (logId: number, bookId: number) => invoke<import("../types").CourseBook>("delete_book_reading_log", { logId, bookId });

// Book Sections
type BookSectionInput = { id?: number | null; title: string; kind: string; sort_order: number; page_start?: number | null; page_end?: number | null; due_date?: string | null; time_estimate?: number | null };
export const upsertBookSections  = (bookId: number, sections: BookSectionInput[]) => invoke<import("../types").CourseBook>("upsert_book_sections", { bookId, sections });
export const toggleBookSection   = (bookId: number, sectionId: number) => invoke<import("../types").CourseBook>("toggle_book_section", { bookId, sectionId });
export const updateBookSection   = (sectionId: number, notes: string | null, dueDate: string | null) => invoke<import("../types").BookSection>("update_book_section", { sectionId, notes, dueDate });

// Export / Backup
export const exportData = () => invoke<string>("export_data");
export const getDbPath  = () => invoke<string>("get_db_path");

// Lifestyle Areas
export const getLifestyleAreas   = () => invoke<LifestyleArea[]>("get_lifestyle_areas");
export const createLifestyleArea = (name: string, color: string) => invoke<LifestyleArea>("create_lifestyle_area", { name, color });
export const updateLifestyleArea = (id: number, name: string, color: string, sortOrder: number) => invoke<LifestyleArea>("update_lifestyle_area", { id, name, color, sortOrder });
export const deleteLifestyleArea = (id: number) => invoke<void>("delete_lifestyle_area", { id });
export const getLifestyleItems   = (areaId: number | null) => invoke<{ systems: SystemEntry[]; plans: Plan[] }>("get_lifestyle_items", { areaId });

// Journal
export const getJournalEntry  = (date: string) => invoke<string>("get_journal_entry", { date });
export const saveJournalEntry = (date: string, content: string) => invoke<void>("save_journal_entry", { date, content });

// Calendar Blocks
export const getCalBlocks    = (startDate: string, endDate: string) => invoke<CalBlock[]>("get_cal_blocks", { startDate, endDate });
export const createCalBlock  = (date: string, title: string, startTime: string, endTime: string, color: string, description: string | null, location: string | null) => invoke<CalBlock>("create_cal_block", { date, title, startTime, endTime, color, description, location });
export const updateCalBlock  = (id: number, title: string, startTime: string, endTime: string, color: string, description: string | null, location: string | null) => invoke<CalBlock>("update_cal_block", { id, title, startTime, endTime, color, description, location });
export const deleteCalBlock  = (id: number) => invoke<void>("delete_cal_block", { id });

// Recurring Calendar Blocks
export const createRecurringCalBlock = (title: string, startTime: string, endTime: string, color: string, recurrence: string, daysOfWeek: string | null, startDate: string, endDate: string | null, description: string | null, location: string | null) =>
  invoke<RecurringCalBlock>("create_recurring_cal_block", { title, startTime, endTime, color, recurrence, daysOfWeek, startDate, endDate, description, location });
export const updateRecurringCalBlock = (id: number, title: string, startTime: string, endTime: string, color: string, recurrence: string, daysOfWeek: string | null, endDate: string | null, description: string | null, location: string | null) =>
  invoke<void>("update_recurring_cal_block", { id, title, startTime, endTime, color, recurrence, daysOfWeek, endDate, description, location });
export const deleteRecurringCalBlock = (id: number) => invoke<void>("delete_recurring_cal_block", { id });

// Games
export const getGames      = () => invoke<Game[]>("get_games");
export const createGame    = (payload: { title: string; genre?: string | null; platform?: string | null; engine?: string | null; status?: string; description?: string | null; core_mechanic?: string | null; target_audience?: string | null; inspiration?: string | null; color?: string }) => invoke<Game>("create_game", { payload });
export const updateGame    = (id: number, payload: { title: string; genre?: string | null; platform?: string | null; engine?: string | null; status: string; description?: string | null; core_mechanic?: string | null; target_audience?: string | null; inspiration?: string | null; color: string }) => invoke<Game>("update_game", { id, payload });
export const deleteGame    = (id: number) => invoke<void>("delete_game", { id });

// Game Features
export const getGameFeatures       = (gameId: number) => invoke<GameFeature[]>("get_game_features", { gameId });
export const createGameFeature     = (payload: { game_id: number; title: string; description?: string | null; status?: string; priority?: string }) => invoke<GameFeature>("create_game_feature", { payload });
export const updateGameFeature     = (id: number, payload: { title: string; description?: string | null; status: string; priority: string }) => invoke<GameFeature>("update_game_feature", { id, payload });
export const setGameFeatureStatus  = (id: number, status: string) => invoke<GameFeature>("set_game_feature_status", { id, status });
export const deleteGameFeature     = (id: number) => invoke<void>("delete_game_feature", { id });

// Game Devlog
export const getGameDevlog         = (gameId: number) => invoke<GameDevlogEntry[]>("get_game_devlog", { gameId });
export const addGameDevlogEntry    = (payload: { game_id: number; content: string }) => invoke<GameDevlogEntry>("add_game_devlog_entry", { payload });
export const deleteGameDevlogEntry = (id: number) => invoke<void>("delete_game_devlog_entry", { id });

// Daily Habits
export const getHabitsForDate    = (date: string) => invoke<import("../types").HabitWithCompletion[]>("get_habits_for_date", { date });
export const createDailyHabit    = (payload: { title: string; color?: string }) => invoke<import("../types").DailyHabit>("create_daily_habit", { payload });
export const deleteDailyHabit    = (id: number) => invoke<void>("delete_daily_habit", { id });
export const toggleHabitCompletion = (habitId: number, date: string) => invoke<boolean>("toggle_habit_completion", { habitId, date });

// Run Logs
export const getRunLogs    = () => invoke<import("../types").RunLog[]>("get_run_logs");
export const createRunLog  = (payload: { date: string; distance_km?: number | null; duration_min?: number | null; notes?: string | null }) => invoke<import("../types").RunLog>("create_run_log", { payload });
export const deleteRunLog  = (id: number) => invoke<void>("delete_run_log", { id });

// Workout Logs
export const getWorkoutLogs       = () => invoke<import("../types").WorkoutLog[]>("get_workout_logs");
export const createWorkoutLog     = (payload: { date: string; name: string; notes?: string | null }) => invoke<import("../types").WorkoutLog>("create_workout_log", { payload });
export const deleteWorkoutLog     = (id: number) => invoke<void>("delete_workout_log", { id });
export const addWorkoutExercise   = (payload: { workout_id: number; name: string; sets?: number | null; reps?: number | null; weight_kg?: number | null; notes?: string | null }) => invoke<import("../types").WorkoutLog>("add_workout_exercise", { payload });
export const deleteWorkoutExercise = (id: number, workoutId: number) => invoke<import("../types").WorkoutLog>("delete_workout_exercise", { id, workoutId });

// Roadmap
export const getRoadmapItems = (planId: number) => invoke<RoadmapItem[]>("get_roadmap_items", { planId });
export const createRoadmapItem = (payload: { plan_id: number; title: string; description?: string | null; due_date?: string | null }) =>
  invoke<RoadmapItem>("create_roadmap_item", { payload });
export const updateRoadmapItem = (id: number, payload: { title: string; description?: string | null; due_date?: string | null; status: string }) =>
  invoke<RoadmapItem>("update_roadmap_item", { id, payload });
export const deleteRoadmapItem = (id: number) => invoke<void>("delete_roadmap_item", { id });
export const setRoadmapItemStatus = (id: number, status: string) =>
  invoke<RoadmapItem>("set_roadmap_item_status", { id, status });
