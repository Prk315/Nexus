// One small, deliberately awkward PathFinder snapshot, shared by the data tests
// and the render snapshots.
//
// It carries the shapes that actually break things: a container whose child does
// NOT repeat its parent's plan_id, a done leaf, an overdue task, a task due
// today, a plan with no goal, a task reaching no goal at all, and a sparse-kind
// task with no planning row. Nothing here touches a network.

import type { PfGoal, PfPlan, PfTask, Priority, TaskStage, Urgency } from "@nexus/core/pathfinder";
import type { BriefShape } from "./data.ts";

export const FIXTURE_TODAY = "2026-09-24";

interface TaskSpec {
  id: number;
  title: string;
  plan?: number | null;
  goal?: number | null;
  parent?: number | null;
  done?: boolean;
  due?: string | null;
  priority?: Priority;
  urgency?: Urgency;
  stage?: TaskStage;
  kanban?: string;
  /** A sparse kind has NO planning row — that is the ISA shape, not missing data. */
  sparse?: boolean;
  planTitle?: string | null;
}

function task(s: TaskSpec): PfTask {
  return {
    id: s.id,
    plan_id: s.plan ?? null,
    parent_id: s.parent ?? null,
    goal_id: s.goal ?? null,
    task_type: s.sparse ? "chore" : "task",
    title: s.title,
    done: s.done ?? false,
    sort_order: s.id,
    priority: s.priority ?? "medium",
    due_date: s.due ?? null,
    created_at: "2026-09-01T00:00:00Z",
    time_estimate: null,
    aggregate_estimate: 0,
    kanban_status: s.kanban ?? "backlog",
    category: s.sparse ? "chore" : null,
    team_id: null,
    assigned_to: null,
    plan_title: s.planTitle ?? null,
    goal_title: null,
    planning: s.sparse
      ? null
      : { urgency: s.urgency ?? "medium", stage: s.stage ?? "refine", completion_mode: "binary", target_count: null, notes: null },
  };
}

export const FIXTURE_GOALS: PfGoal[] = [
  { id: 1, title: "Ship the board", status: "active" },
  { id: 2, title: "Read more", status: "active" },
];

export const FIXTURE_PLANS: PfPlan[] = [
  { id: 10, goal_id: 1, title: "nexus-cli", status: "active", deadline: "2026-10-15", team_id: null },
  { id: 11, goal_id: 2, title: "Books", status: "active", deadline: null, team_id: null },
  { id: 12, goal_id: null, title: "Odd jobs", status: "active", deadline: null, team_id: null },
];

export const FIXTURE_TASKS: PfTask[] = [
  task({ id: 100, title: "Build the TUI", plan: 10, planTitle: "nexus-cli" }),
  // 101 and 102 carry NO plan_id: a step does not inherit its parent's plan, and
  // a plan read filtered on plan_id alone would miss this whole branch.
  task({ id: 101, title: "Data shaping", parent: 100, done: true }),
  task({ id: 102, title: "Ink panes", parent: 100, stage: "active", due: FIXTURE_TODAY, kanban: "doing", urgency: "high" }),
  task({ id: 110, title: "Write the README", plan: 10, planTitle: "nexus-cli", due: "2026-09-23", urgency: "high", kanban: "todo" }),
  task({ id: 200, title: "Book: The Selfish Gene", plan: 11, planTitle: "Books", due: "2026-09-27", priority: "high" }),
  task({ id: 201, title: "Book: Sapiens", plan: 11, planTitle: "Books", priority: "low" }),
  task({ id: 500, title: "Book: Dune", plan: 11, planTitle: "Books", done: true }),
  task({ id: 300, title: "Fix the sink", plan: 12, planTitle: "Odd jobs", due: "2026-10-24", sparse: true }),
  task({ id: 400, title: "Inbox: call the dentist" }),
];

export const FIXTURE_BRIEF: BriefShape = {
  counts: { open_tasks: 7, open_root_tasks: 5, active: 1, overdue: 1 },
  goals: [
    { id: 1, title: "Ship the board", status: "active", priority: "high", deadline: "2026-10-31" },
    { id: 2, title: "Read more", status: "active", priority: "low", deadline: null },
  ],
};
