// PathFinder's task/plan shapes, shared with any app that wants to render them.
//
// These mirror `apps/PathFinder/src/types/index.ts`. Duplicating the *types* is
// cheap and safe — every consumer type-checks against them, so drift surfaces at
// build time. Duplicating the *queries* is what is dangerous, and that is why
// ./api.ts exists: three hand-written copies of the pf_tasks read already exist
// in this repo (PathFinder's own, Vault's pathfinderCalendar.ts, NexusLocal's
// lib/pathfinder/api.ts) and the third one already omits the planning embed,
// which is the exact silent-wrong-data bug `_shared.ts` warns about.

export type Priority = "high" | "medium" | "low";
export type Urgency = "high" | "medium" | "low";
export type TaskCategory = "reminder" | "chore" | "shopping";
export type TaskType = "task" | TaskCategory;
export type TaskStage = "refine" | "schedule" | "active" | "done";
export type CompletionMode = "binary" | "sessions" | "time";

/** The `task` subtype's row. `null` for every sparse kind — that IS the ISA shape. */
export interface TaskPlanning {
  urgency: Urgency;
  stage: TaskStage;
  completion_mode: CompletionMode;
  target_count: number | null;
  notes: string | null;
}

export interface PfTask {
  id: number;
  plan_id: number | null;
  parent_id: number | null;
  goal_id: number | null;
  task_type: TaskType;
  title: string;
  done: boolean;
  sort_order: number;
  priority: Priority;
  due_date: string | null;
  created_at: string;
  time_estimate: number | null;
  /** Trigger-maintained subtree roll-up. Read-only — writing it is overwritten. */
  aggregate_estimate: number;
  kanban_status: string;
  category: TaskCategory | null;
  team_id: string | null;
  assigned_to: string | null;
  planning: TaskPlanning | null;
  plan_title: string | null;
  goal_title: string | null;
}

export interface PfPlan {
  id: number;
  goal_id: number | null;
  title: string;
  status: string;
  deadline: string | null;
  team_id: string | null;
}

export interface PfGoal {
  id: number;
  title: string;
  status: string;
}

/**
 * The embed every task read needs.
 *
 * Omitting `pf_task_planning(*)` does not fail — PostgREST returns 200 and every
 * task reads as default urgency and stage. `pf_goals!pf_tasks_goal_id_fkey`
 * disambiguates the two paths from pf_tasks to pf_goals (direct, and via
 * pf_plans), which PostgREST otherwise refuses as ambiguous.
 */
export const TASK_SELECT_CTX =
  "*, pf_task_planning(*), pf_goals!pf_tasks_goal_id_fkey(id, title), pf_plans(id, title, goal_id, pf_goals(id, title))";

export const TASKS_TABLE = "pf_tasks";
export const TASK_PLANNING_TABLE = "pf_task_planning";
export const PLANS_TABLE = "pf_plans";
export const GOALS_TABLE = "pf_goals";
export const TEAMS_TABLE = "pf_teams";
export const TEAM_MEMBERS_TABLE = "pf_team_members";

export interface PfTeam {
  id: string;
  name: string;
  created_by: string;
}

export interface PfTeamMember {
  team_id: string;
  user_id: string;
  display_name: string;
}

/**
 * `assigned_to` sentinel meaning "everyone on the team", as distinct from
 * `null`, which means "nobody has claimed it". Both are relevant to every
 * member — see `isTaskRelevantToMe`.
 */
export const ASSIGNED_ALL = "all";

/**
 * There is no profiles table and `auth.users` is unreadable client-side, so the
 * seeded members' names are hardcoded — copied from PathFinder's `teams.ts`,
 * which does the same. Anyone not listed falls back to a uid prefix.
 */
const KNOWN_MEMBERS: Record<string, string> = {
  "a33625c2-4dd2-44fa-b2e5-4d455eeac59d": "Bastian",
  "870ca14b-2a8a-4634-9c08-2eb2d67207b0": "Josefine",
};

export function memberName(userId: string): string {
  return KNOWN_MEMBERS[userId] ?? userId.slice(0, 8);
}

/** Kanban columns PathFinder's own board uses. `kanban_status` is free text, so this is a default, not a constraint. */
export const KANBAN_STATUSES = ["backlog", "todo", "doing", "done"] as const;

export const STAGES: TaskStage[] = ["refine", "schedule", "active", "done"];
export const PRIORITIES: Priority[] = ["high", "medium", "low"];
export const URGENCIES: Urgency[] = ["high", "medium", "low"];
export const TASK_TYPES: TaskType[] = ["task", "reminder", "chore", "shopping"];

export const STAGE_LABELS: Record<TaskStage, string> = {
  refine: "Refine",
  schedule: "Schedule",
  active: "Active",
  done: "Done",
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  task: "Task",
  reminder: "Reminder",
  chore: "Chore",
  shopping: "Shopping",
};
