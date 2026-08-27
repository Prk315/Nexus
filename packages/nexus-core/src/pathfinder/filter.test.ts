import { describe, it, expect } from "vitest";
import {
  DEFAULT_FILTER,
  activeFilterCount,
  axisValue,
  creationDefaults,
  groupTasks,
  isTaskRelevantToMe,
  isUnfiltered,
  matchesDue,
  matchesFilter,
  runQuery,
  sortTasks,
  type TaskFilter,
} from "./filter";
import type { PfTask } from "./types";

const TODAY = "2026-08-27";

function task(over: Partial<PfTask> = {}): PfTask {
  return {
    id: 1,
    plan_id: null,
    parent_id: null,
    goal_id: null,
    task_type: "task",
    title: "Write the thing",
    done: false,
    sort_order: 0,
    priority: "medium",
    due_date: null,
    created_at: "2026-01-01T00:00:00Z",
    time_estimate: null,
    aggregate_estimate: 0,
    kanban_status: "backlog",
    category: null,
    team_id: null,
    assigned_to: null,
    planning: { urgency: "medium", stage: "refine", completion_mode: "binary", target_count: null, notes: null },
    plan_title: null,
    goal_title: null,
    ...over,
  };
}

const filter = (over: Partial<TaskFilter> = {}): TaskFilter => ({ ...DEFAULT_FILTER, ...over });

describe("matchesDue", () => {
  it("treats a missing due date as matching only 'any' and 'none'", () => {
    expect(matchesDue(null, "any", TODAY)).toBe(true);
    expect(matchesDue(null, "none", TODAY)).toBe(true);
    expect(matchesDue(null, "today", TODAY)).toBe(false);
    expect(matchesDue(null, "overdue", TODAY)).toBe(false);
    expect(matchesDue(null, "week", TODAY)).toBe(false);
  });

  it("excludes a dated task from 'none'", () => {
    expect(matchesDue(TODAY, "none", TODAY)).toBe(false);
  });

  it("counts yesterday as overdue and today as not", () => {
    expect(matchesDue("2026-08-26", "overdue", TODAY)).toBe(true);
    expect(matchesDue(TODAY, "overdue", TODAY)).toBe(false);
  });

  // The bug this pins: a "due this week" list that hides last week's misses is
  // how work gets quietly dropped. Overdue is MORE urgent, so it stays in.
  it("includes overdue work in a forward window", () => {
    expect(matchesDue("2026-08-20", "week", TODAY)).toBe(true);
    expect(matchesDue("2026-09-02", "week", TODAY)).toBe(true);
    expect(matchesDue("2026-09-15", "week", TODAY)).toBe(false);
    expect(matchesDue("2026-09-15", "month", TODAY)).toBe(true);
  });
});

describe("matchesFilter", () => {
  it("defaults to open tasks only", () => {
    expect(matchesFilter(task({ done: false }), DEFAULT_FILTER, TODAY)).toBe(true);
    expect(matchesFilter(task({ done: true }), DEFAULT_FILTER, TODAY)).toBe(false);
  });

  it("an empty axis constrains nothing", () => {
    expect(matchesFilter(task({ priority: "low" }), filter({ priorities: [] }), TODAY)).toBe(true);
    expect(matchesFilter(task({ priority: "low" }), filter({ priorities: ["high"] }), TODAY)).toBe(false);
  });

  // The ISA shape, asserted: a reminder has no planning row, so it cannot
  // satisfy a constraint on a planning column. Excluding it is the honest
  // answer — "urgency = high" cannot describe a thing that has no urgency.
  it("excludes sparse kinds when a planning axis is constrained", () => {
    const reminder = task({ task_type: "reminder", category: "reminder", planning: null });
    expect(matchesFilter(reminder, DEFAULT_FILTER, TODAY)).toBe(true);
    expect(matchesFilter(reminder, filter({ urgencies: ["high"] }), TODAY)).toBe(false);
    expect(matchesFilter(reminder, filter({ stages: ["refine"] }), TODAY)).toBe(false);
  });

  it("reads urgency and stage off the planning relation", () => {
    const t = task({ planning: { urgency: "high", stage: "active", completion_mode: "binary", target_count: null, notes: null } });
    expect(matchesFilter(t, filter({ urgencies: ["high"] }), TODAY)).toBe(true);
    expect(matchesFilter(t, filter({ urgencies: ["low"] }), TODAY)).toBe(false);
    expect(matchesFilter(t, filter({ stages: ["active"] }), TODAY)).toBe(true);
  });

  it("filters by plan and treats an unassigned task as not matching", () => {
    expect(matchesFilter(task({ plan_id: 7 }), filter({ planIds: [7] }), TODAY)).toBe(true);
    expect(matchesFilter(task({ plan_id: null }), filter({ planIds: [7] }), TODAY)).toBe(false);
  });

  it("rootsOnly drops subtasks", () => {
    expect(matchesFilter(task({ parent_id: 3 }), filter({ rootsOnly: true }), TODAY)).toBe(false);
    expect(matchesFilter(task({ parent_id: null }), filter({ rootsOnly: true }), TODAY)).toBe(true);
  });

  it("excludeQuick drops the three quick-task kinds", () => {
    expect(matchesFilter(task({ category: "chore" }), filter({ excludeQuick: true }), TODAY)).toBe(false);
    expect(matchesFilter(task({ category: null }), filter({ excludeQuick: true }), TODAY)).toBe(true);
  });

  it("searches title, plan and goal", () => {
    const t = task({ title: "Draft", plan_title: "Thesis", goal_title: "Graduate" });
    expect(matchesFilter(t, filter({ search: "thes" }), TODAY)).toBe(true);
    expect(matchesFilter(t, filter({ search: "GRAD" }), TODAY)).toBe(true);
    expect(matchesFilter(t, filter({ search: "nope" }), TODAY)).toBe(false);
  });
});

describe("sortTasks", () => {
  // Nulls last in BOTH directions: a task with no due date is not "due first",
  // and flipping direction should reorder the dated ones without dragging the
  // undated pile to the top.
  it("keeps undated tasks last whichever way the sort points", () => {
    const rows = [task({ id: 1, due_date: null }), task({ id: 2, due_date: "2026-09-01" }), task({ id: 3, due_date: "2026-08-01" })];
    expect(sortTasks(rows, "due", "asc").map((t) => t.id)).toEqual([3, 2, 1]);
    expect(sortTasks(rows, "due", "desc").map((t) => t.id)).toEqual([2, 3, 1]);
  });

  it("orders priority high → low ascending", () => {
    const rows = [task({ id: 1, priority: "low" }), task({ id: 2, priority: "high" }), task({ id: 3, priority: "medium" })];
    expect(sortTasks(rows, "priority", "asc").map((t) => t.id)).toEqual([2, 3, 1]);
  });

  // Without a final tiebreak, equal rows can swap on every refetch and the list
  // visibly shuffles under the cursor.
  it("is stable for equal keys", () => {
    const rows = [task({ id: 9, priority: "high" }), task({ id: 4, priority: "high" })];
    expect(sortTasks(rows, "priority", "asc").map((t) => t.id)).toEqual([4, 9]);
    expect(sortTasks(rows, "priority", "desc").map((t) => t.id)).toEqual([4, 9]);
  });

  it("manual sort follows sort_order", () => {
    const rows = [task({ id: 1, sort_order: 5 }), task({ id: 2, sort_order: 1 })];
    expect(sortTasks(rows, "manual", "asc").map((t) => t.id)).toEqual([2, 1]);
  });

  it("does not mutate its input", () => {
    const rows = [task({ id: 1, priority: "low" }), task({ id: 2, priority: "high" })];
    sortTasks(rows, "priority", "asc");
    expect(rows.map((t) => t.id)).toEqual([1, 2]);
  });
});

describe("groupTasks", () => {
  const COLS = [
    { key: "backlog", label: "Backlog" },
    { key: "doing", label: "Doing" },
  ];

  // An empty column still has to render: it is the drop target for the state you
  // are trying to move a card INTO. Hiding it makes the board unusable exactly
  // when it matters.
  it("keeps empty columns", () => {
    const groups = groupTasks([task({ kanban_status: "backlog" })], "kanban_status", COLS);
    expect(groups.map((g) => g.key)).toEqual(["backlog", "doing"]);
    expect(groups[1].tasks).toEqual([]);
  });

  it("puts unmatched values in a trailing bucket rather than dropping them", () => {
    const groups = groupTasks([task({ kanban_status: "weird" })], "kanban_status", COLS);
    const last = groups[groups.length - 1];
    expect(last.key).toBe("__other__");
    expect(last.tasks).toHaveLength(1);
  });

  it("buckets sparse kinds under Other on a planning axis", () => {
    const reminder = task({ task_type: "reminder", planning: null });
    const groups = groupTasks([reminder], "stage", [{ key: "refine", label: "Refine" }]);
    expect(groups[groups.length - 1].key).toBe("__other__");
  });

  it("axisValue defaults a blank kanban_status to backlog", () => {
    expect(axisValue(task({ kanban_status: "" }), "kanban_status")).toBe("backlog");
    expect(axisValue(task({ planning: null }), "stage")).toBeNull();
    expect(axisValue(task({ plan_id: 12 }), "plan")).toBe("12");
  });
});

describe("runQuery", () => {
  it("reports the pre-limit count so a capped list is never shown as the whole list", () => {
    const rows = Array.from({ length: 10 }, (_, i) => task({ id: i + 1 }));
    const r = runQuery(rows, DEFAULT_FILTER, { key: "manual", dir: "asc" }, 3, TODAY);
    expect(r.tasks).toHaveLength(3);
    expect(r.matched).toBe(10);
    expect(r.truncated).toBe(true);
  });

  it("is not truncated when everything fits", () => {
    const r = runQuery([task()], DEFAULT_FILTER, { key: "manual", dir: "asc" }, 50, TODAY);
    expect(r.truncated).toBe(false);
    expect(r.matched).toBe(1);
  });

  it("a limit of 0 means no cap", () => {
    const rows = Array.from({ length: 5 }, (_, i) => task({ id: i + 1 }));
    expect(runQuery(rows, DEFAULT_FILTER, { key: "manual", dir: "asc" }, 0, TODAY).tasks).toHaveLength(5);
  });
});

describe("creationDefaults", () => {
  // ⚠️ The guard for a deliberate GAP, which is harder to protect than a
  // behaviour: `stages` is the one single-valued axis that must NOT be
  // inherited. It is gated — the "no calendar minutes, no 'active'" rule lives
  // only in setStage — and createTask writes pf_task_planning directly through
  // patchTask. Inheriting it would mint tasks into 'active' with nothing
  // scheduled and defeat the only check that enforces it.
  //
  // Without this test, "stages is in isUnfiltered but not here" reads as an
  // oversight and gets tidied up.
  it("never inherits stage, however unambiguous the filter is", () => {
    const d = creationDefaults(filter({ stages: ["active"] }));
    expect(d.stage).toBeUndefined();
    expect(Object.keys(d)).not.toContain("stage");
    // Not merely absent because the filter was empty — a sibling axis in the
    // same filter still comes through.
    const both = creationDefaults(filter({ stages: ["active"], planIds: [7] }));
    expect(both.plan_id).toBe(7);
    expect(both.stage).toBeUndefined();
  });

  // A filter listing three plans says nothing about which one a new task belongs
  // to, so it must contribute nothing rather than guessing the first.
  it("inherits only unambiguous single-value constraints", () => {
    expect(creationDefaults(filter({ planIds: [4] })).plan_id).toBe(4);
    expect(creationDefaults(filter({ planIds: [4, 5] })).plan_id).toBeUndefined();
  });

  it("maps a task type back to the writable category column", () => {
    expect(creationDefaults(filter({ taskTypes: ["chore"] })).category).toBe("chore");
    // `task` is the absence of a category, not the string "task" — task_type is
    // generated as coalesce(category, 'task').
    expect(creationDefaults(filter({ taskTypes: ["task"] })).category).toBeNull();
  });
});

describe("teams", () => {
  const ME = "uid-me";
  const THEM = "uid-them";
  const TEAM = "team-1";

  const shared = (over: Partial<PfTask> = {}) => task({ team_id: TEAM, assigned_to: null, ...over });

  // This rule is copied from PathFinder's lib/team.ts and must not drift: if it
  // does, a Vault block and PathFinder's own dashboard disagree about whose work
  // something is.
  describe("isTaskRelevantToMe", () => {
    it("counts every personal task as mine, whoever I am", () => {
      expect(isTaskRelevantToMe(task({ team_id: null, assigned_to: null }), ME)).toBe(true);
      expect(isTaskRelevantToMe(task({ team_id: null, assigned_to: THEM }), ME)).toBe(true);
    });

    it("counts unclaimed and everyone-assigned team work as mine", () => {
      expect(isTaskRelevantToMe(shared({ assigned_to: null }), ME)).toBe(true);
      expect(isTaskRelevantToMe(shared({ assigned_to: "all" }), ME)).toBe(true);
    });

    it("excludes team work claimed by someone else", () => {
      expect(isTaskRelevantToMe(shared({ assigned_to: THEM }), ME)).toBe(false);
      expect(isTaskRelevantToMe(shared({ assigned_to: ME }), ME)).toBe(true);
    });

    it("cannot claim team work for a signed-out reader", () => {
      expect(isTaskRelevantToMe(shared({ assigned_to: THEM }), null)).toBe(false);
    });
  });

  it("scope separates personal from shared", () => {
    expect(matchesFilter(shared(), filter({ scope: "personal" }), TODAY, ME)).toBe(false);
    expect(matchesFilter(shared(), filter({ scope: "team" }), TODAY, ME)).toBe(true);
    expect(matchesFilter(task(), filter({ scope: "team" }), TODAY, ME)).toBe(false);
    expect(matchesFilter(task(), filter({ scope: "personal" }), TODAY, ME)).toBe(true);
  });

  it("teamIds narrows to named teams and never matches a personal task", () => {
    expect(matchesFilter(shared(), filter({ teamIds: [TEAM] }), TODAY, ME)).toBe(true);
    expect(matchesFilter(shared(), filter({ teamIds: ["other"] }), TODAY, ME)).toBe(false);
    expect(matchesFilter(task(), filter({ teamIds: [TEAM] }), TODAY, ME)).toBe(false);
  });

  it("assignee 'me' uses the relevance rule, not equality", () => {
    const f = filter({ assignee: "me" });
    expect(matchesFilter(shared({ assigned_to: null }), f, TODAY, ME)).toBe(true);
    expect(matchesFilter(shared({ assigned_to: "all" }), f, TODAY, ME)).toBe(true);
    expect(matchesFilter(shared({ assigned_to: ME }), f, TODAY, ME)).toBe(true);
    expect(matchesFilter(shared({ assigned_to: THEM }), f, TODAY, ME)).toBe(false);
    expect(matchesFilter(task(), f, TODAY, ME)).toBe(true);
  });

  it("assignee 'unassigned' means unclaimed TEAM work only", () => {
    const f = filter({ assignee: "unassigned" });
    expect(matchesFilter(shared({ assigned_to: null }), f, TODAY, ME)).toBe(true);
    expect(matchesFilter(shared({ assigned_to: "all" }), f, TODAY, ME)).toBe(true);
    expect(matchesFilter(shared({ assigned_to: THEM }), f, TODAY, ME)).toBe(false);
    // A personal task is not "unassigned" — it has nobody to assign it to.
    expect(matchesFilter(task(), f, TODAY, ME)).toBe(false);
  });

  it("a specific assignee matches exactly", () => {
    expect(matchesFilter(shared({ assigned_to: THEM }), filter({ assignee: THEM }), TODAY, ME)).toBe(true);
    expect(matchesFilter(shared({ assigned_to: null }), filter({ assignee: THEM }), TODAY, ME)).toBe(false);
  });

  it("groups a personal task outside the assignee columns", () => {
    const cols = [{ key: "__unassigned__", label: "Unassigned" }, { key: THEM, label: "Them" }];
    const groups = groupTasks([task(), shared({ assigned_to: THEM })], "assignee", cols, "Personal");
    expect(groups.find((g) => g.key === THEM)!.tasks).toHaveLength(1);
    const last = groups[groups.length - 1];
    expect(last.label).toBe("Personal");
    expect(last.tasks).toHaveLength(1);
  });

  it("axisValue files unclaimed team work under the unassigned column", () => {
    expect(axisValue(shared({ assigned_to: null }), "assignee")).toBe("__unassigned__");
    expect(axisValue(shared({ assigned_to: "all" }), "assignee")).toBe("all");
    expect(axisValue(task(), "assignee")).toBeNull();
  });

  it("creation inherits a single team but never claims work for a person", () => {
    expect(creationDefaults(filter({ teamIds: [TEAM] })).team_id).toBe(TEAM);
    expect(creationDefaults(filter({ teamIds: [TEAM, "t2"] })).team_id).toBeUndefined();
    expect(creationDefaults(filter({ assignee: THEM })).assigned_to).toBe(THEM);
    // "me" spans unclaimed team work, so honouring it as an assignment would
    // claim a task nobody asked to claim.
    expect(creationDefaults(filter({ assignee: "me" })).assigned_to).toBeUndefined();
    expect(creationDefaults(filter({ assignee: "unassigned" })).assigned_to).toBeUndefined();
  });
});

describe("filter summaries", () => {
  it("isUnfiltered ignores the default open-tasks constraint", () => {
    expect(isUnfiltered(DEFAULT_FILTER)).toBe(true);
    expect(isUnfiltered(filter({ planIds: [1] }))).toBe(false);
  });

  it("activeFilterCount counts the done axis only when it is not the default", () => {
    expect(activeFilterCount(DEFAULT_FILTER)).toBe(0);
    expect(activeFilterCount(filter({ done: "all" }))).toBe(1);
    expect(activeFilterCount(filter({ planIds: [1], due: "today" }))).toBe(2);
  });
});
