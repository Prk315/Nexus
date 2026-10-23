// Phase 2: every PathFinder write command against a MOCKED PathfinderApi.
// These assert which API method is called with which arguments — never the
// database. The personal account is never touched by the test suite.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import type { PathfinderApi, PfTask } from "@nexus/core/pathfinder";
import { SchedulingGateError } from "@nexus/core/pathfinder";
import { registerPfCommands, parseSet, type PfSession } from "./commands.ts";
import { UserError } from "../errors.ts";

function task(id: number, extra: Partial<PfTask> = {}): PfTask {
  return {
    id, parent_id: null, title: `Task ${id}`, done: false, plan_id: null, goal_id: null, task_type: "task", sort_order: id,
    priority: "medium", due_date: null, created_at: "", time_estimate: null, aggregate_estimate: 0, kanban_status: "backlog",
    category: null, team_id: null, assigned_to: null, plan_title: null, goal_title: null,
    planning: { urgency: "medium", stage: "refine", completion_mode: "binary", target_count: null, notes: null },
    ...extra,
  };
}

function mockApi(overrides: Partial<PathfinderApi> = {}): PathfinderApi {
  return {
    loadTasks: vi.fn(async () => ({ tasks: [task(1), task(2, { parent_id: 1 }), task(3, { done: true })], capped: false })),
    loadPlans: vi.fn(async () => [{ id: 9, goal_id: null, title: "Plan", status: "active", deadline: null, team_id: null }]),
    loadGoals: vi.fn(async () => [{ id: 4, title: "Goal", status: "active" }]),
    loadTeams: vi.fn(async () => ({ teams: [], members: [] })),
    getTask: vi.fn(async (id: number) => task(id)),
    createTask: vi.fn(async (input) => task(42, { title: input.title })),
    patchTask: vi.fn(async (id: number) => task(id)),
    toggleTask: vi.fn(async (id: number, done: boolean) => task(id, { done })),
    setKanbanStatus: vi.fn(async (id: number, status: string) => task(id, { kanban_status: status })),
    setStage: vi.fn(async (id: number, stage) => task(id, { planning: { urgency: "medium", stage, completion_mode: "binary", target_count: null, notes: null } })),
    deleteTask: vi.fn(async () => {}),
    reorderTasks: vi.fn(async () => {}),
    ...overrides,
  };
}

let api: PathfinderApi;
let opened: string[];
let out: string[];
let err: string[];

function makeProgram(a: PathfinderApi): Command {
  const program = new Command().exitOverride().option("-p, --profile <name>").option("--json");
  const session: PfSession = {
    api: a,
    who: { profileName: "me", email: "me@example.com", userId: "uid-me" },
    brief: vi.fn(async () => ({ user_id: "uid-me", counts: { open_tasks: 1 }, goals: [], active: [], due_soon: [], plans: [], systems: [] })),
  };
  registerPfCommands(program, {
    open: vi.fn(async (name) => {
      opened.push(name ?? "(default)");
      return session;
    }),
  });
  return program;
}

async function run(...args: string[]): Promise<void> {
  await makeProgram(api).parseAsync(args, { from: "user" });
}

beforeEach(() => {
  api = mockApi();
  opened = [];
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((s: string) => { out.push(String(s)); return true; }) as any);
  vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => { err.push(String(s)); return true; }) as any);
});
afterEach(() => vi.restoreAllMocks());

describe("pf task add", () => {
  it("calls createTask with a typed input", async () => {
    await run("pf", "task", "add", "Write tests", "--parent", "7", "--plan", "9", "--due", "2026-10-01", "--priority", "high", "--estimate", "30");
    expect(api.createTask).toHaveBeenCalledWith({
      title: "Write tests", parent_id: 7, plan_id: 9, due_date: "2026-10-01", priority: "high", time_estimate: 30,
    });
    expect(out.join("")).toContain("[me <me@example.com>] created task 42");
  });

  it("rejects a malformed date before touching the API", async () => {
    await expect(run("pf", "task", "add", "x", "--due", "1/10/2026")).rejects.toThrow(UserError);
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it("passes --profile through to open()", async () => {
    await run("--profile", "me", "pf", "task", "add", "x");
    expect(opened).toEqual(["me"]);
  });

  it("prints JSON with --json", async () => {
    await run("pf", "task", "add", "x", "--json");
    const parsed = JSON.parse(out.join(""));
    expect(parsed.profile).toBe("me");
    expect(parsed.task.id).toBe(42);
  });
});

describe("pf task done / undone", () => {
  it("done calls toggleTask(id, true)", async () => {
    await run("pf", "task", "done", "5");
    expect(api.toggleTask).toHaveBeenCalledWith(5, true);
  });
  it("undone calls toggleTask(id, false)", async () => {
    await run("pf", "task", "undone", "5");
    expect(api.toggleTask).toHaveBeenCalledWith(5, false);
  });
  it("rejects a non-numeric id", async () => {
    await expect(run("pf", "task", "done", "abc")).rejects.toThrow(/invalid id/);
    expect(api.toggleTask).not.toHaveBeenCalled();
  });
});

describe("pf task stage", () => {
  it("calls setStage with the stage", async () => {
    await run("pf", "task", "stage", "5", "schedule");
    expect(api.setStage).toHaveBeenCalledWith(5, "schedule");
  });

  it("rejects an unknown stage before the API", async () => {
    await expect(run("pf", "task", "stage", "5", "started")).rejects.toThrow(/stage must be one of/);
    expect(api.setStage).not.toHaveBeenCalled();
  });

  it("surfaces the scheduling gate error verbatim", async () => {
    api = mockApi({ setStage: vi.fn(async () => { throw new SchedulingGateError(); }) });
    await expect(run("pf", "task", "stage", "5", "active")).rejects.toThrow("Schedule calendar time for this task before starting it.");
  });
});

describe("pf task status", () => {
  it("calls setKanbanStatus", async () => {
    await run("pf", "task", "status", "5", "doing");
    expect(api.setKanbanStatus).toHaveBeenCalledWith(5, "doing");
  });
});

describe("pf task patch", () => {
  it("calls patchTask with a typed patch", async () => {
    await run("pf", "task", "patch", "5", "--set", "title=New", "urgency=high", "time_estimate=45", "plan_id=null");
    expect(api.patchTask).toHaveBeenCalledWith(5, { title: "New", urgency: "high", time_estimate: 45, plan_id: null });
  });

  it("accepts --set repeated", async () => {
    await run("pf", "task", "patch", "5", "--set", "title=A", "--set", "notes=B");
    expect(api.patchTask).toHaveBeenCalledWith(5, { title: "A", notes: "B" });
  });

  it("refuses stage and done, pointing at the right command", () => {
    expect(() => parseSet(["stage=active"])).toThrow(/nexus pf task stage/);
    expect(() => parseSet(["done=true"])).toThrow(/nexus pf task done/);
  });

  it("refuses database-maintained and unknown fields", () => {
    expect(() => parseSet(["aggregate_estimate=5"])).toThrow(/database-maintained/);
    expect(() => parseSet(["task_type=chore"])).toThrow(/database-maintained/);
    expect(() => parseSet(["colour=red"])).toThrow(/unknown field/);
    expect(() => parseSet(["priority=urgent"])).toThrow(/high, medium or low/);
    expect(() => parseSet(["due_date=tomorrow"])).toThrow(/YYYY-MM-DD/);
    expect(() => parseSet(["nonsense"])).toThrow(/key=value/);
  });
});

describe("pf task rm", () => {
  it("refuses without --yes", async () => {
    await expect(run("pf", "task", "rm", "5")).rejects.toThrow(/--yes/);
    expect(api.deleteTask).not.toHaveBeenCalled();
  });

  it("deletes with --yes and reports the title", async () => {
    await run("pf", "task", "rm", "5", "--yes");
    expect(api.getTask).toHaveBeenCalledWith(5);
    expect(api.deleteTask).toHaveBeenCalledWith(5);
    expect(out.join("")).toContain('deleted task 5 "Task 5"');
  });
});

describe("pf reads", () => {
  it("tasks lists open tasks by default and all with --all", async () => {
    await run("pf", "tasks", "--json");
    expect(JSON.parse(out.join("")).tasks.map((t: PfTask) => t.id)).toEqual([1, 2]);
    out = [];
    await run("pf", "tasks", "--all", "--json");
    expect(JSON.parse(out.join("")).tasks.map((t: PfTask) => t.id)).toEqual([1, 2, 3]);
  });

  it("tasks --tree prints leaf counts", async () => {
    await run("pf", "tasks", "--tree", "1", "--json");
    const parsed = JSON.parse(out.join(""));
    expect(parsed).toMatchObject({ root: 1, depth: 4, nodes: 2, leaves: 1, containers: 1 });
    out = [];
    await run("pf", "tasks", "--tree", "1");
    expect(out.join("")).toContain("1 leaves (1 open, 0 done), 1 containers");
  });

  it("goals, plans and brief use the API and the header names the profile", async () => {
    await run("pf", "goals");
    await run("pf", "plans");
    await run("pf", "brief");
    expect(api.loadGoals).toHaveBeenCalled();
    expect(api.loadPlans).toHaveBeenCalled();
    const text = out.join("");
    expect(text).toContain("[me <me@example.com>] 1 goals");
    expect(text).toContain("[me <me@example.com>] 1 plans");
    expect(text).toContain("[me <me@example.com>] brief for uid-me");
  });

  it("brief --json prints the RPC result untouched", async () => {
    await run("pf", "brief", "--json");
    expect(JSON.parse(out.join(""))).toMatchObject({ user_id: "uid-me", counts: { open_tasks: 1 } });
  });
});
