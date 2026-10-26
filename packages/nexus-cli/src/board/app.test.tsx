// Every write the board can make, driven by real keystrokes, against a MOCKED
// PathfinderApi.
//
// This is the test that discharges the sandbox rule: the board's write path is
// exercised end to end — key → mode → action → api → refetch → status line —
// and the only thing on the other side of the api is a `vi.fn()`. Nothing here
// can reach the personal account, and the assertions say exactly which method
// was called with which arguments.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "ink-testing-library";
import type { PathfinderApi, PfTask } from "@nexus/core/pathfinder";
import { SchedulingGateError } from "@nexus/core/pathfinder";
import { BoardApp } from "./app.tsx";
import { buildModel, type BoardModel } from "./data.ts";
import { FIXTURE_BRIEF, FIXTURE_GOALS, FIXTURE_PLANS, FIXTURE_TASKS, FIXTURE_TODAY } from "./fixture.ts";

const ENTER = "\r";
const ESC = "";
const BACKSPACE = "";

const WHO = { profileName: "me", email: "owner@example.com", userId: "uid-me" };

function model(tasks: PfTask[] = FIXTURE_TASKS): BoardModel {
  return buildModel({
    tasks,
    plans: FIXTURE_PLANS,
    goals: FIXTURE_GOALS,
    brief: FIXTURE_BRIEF,
    today: FIXTURE_TODAY,
    loadedAt: new Date(2026, 8, 24, 9, 0, 0),
  });
}

function mockApi(over: Partial<PathfinderApi> = {}): PathfinderApi {
  const echo = async (id: number) => FIXTURE_TASKS.find((t) => t.id === id) ?? FIXTURE_TASKS[0];
  return {
    loadTasks: vi.fn(async () => ({ tasks: FIXTURE_TASKS, capped: false })),
    loadPlans: vi.fn(async () => FIXTURE_PLANS),
    loadGoals: vi.fn(async () => FIXTURE_GOALS),
    loadTeams: vi.fn(async () => ({ teams: [], members: [] })),
    getTask: vi.fn(echo),
    createTask: vi.fn(async (input) => ({ ...FIXTURE_TASKS[0], id: 999, title: input.title })),
    patchTask: vi.fn(async (id: number, patch: Record<string, unknown>) => ({ ...(await echo(id)), ...patch }) as PfTask),
    toggleTask: vi.fn(async (id: number, done: boolean) => ({ ...(await echo(id)), done })),
    setKanbanStatus: vi.fn(async (id: number, status: string) => ({ ...(await echo(id)), kanban_status: status })),
    setStage: vi.fn(async (id: number) => echo(id)),
    deleteTask: vi.fn(async () => {}),
    reorderTasks: vi.fn(async () => {}),
    ...over,
  };
}

/** Lets React flush the state updates a keystroke caused, plus any awaited api call. */
const settle = async (times = 4) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
};

function setup(api: PathfinderApi = mockApi()) {
  const load = vi.fn(async () => model());
  const app = render(
    <BoardApp who={WHO} api={api} load={load} initialModel={model()} columns={100} rowLines={20} />,
  );
  return { api, load, ...app };
}

const plain = (s: string | undefined) => (s ?? "").replace(/\[[0-9;]*m/g, "");

/** The write methods. A test that asserts "nothing was written" asserts all of them. */
const WRITERS = ["createTask", "patchTask", "toggleTask", "setKanbanStatus", "setStage", "deleteTask", "reorderTasks"] as const;

function expectNoWrites(api: PathfinderApi): void {
  for (const m of WRITERS) expect(api[m], `${m} must not have been called`).not.toHaveBeenCalled();
}

beforeEach(() => vi.useRealTimers());
afterEach(() => cleanup());

describe("the board opens on Current", () => {
  it("shows the profile and email, and the overdue task first", async () => {
    const { lastFrame } = setup();
    await settle();
    const f = plain(lastFrame());
    expect(f).toContain("[me <owner@example.com>]");
    expect(f).toContain("2 Current •");
    expect(f).toContain("Write the README");
  });

  it("writes nothing while only navigating", async () => {
    const { api, stdin } = setup();
    for (const k of ["j", "k", "1", "2", "3", "4", "\t", "r", ENTER, ESC, "q"]) {
      stdin.write(k);
      await settle(1);
    }
    await settle();
    expectNoWrites(api);
  });
});

describe("d — toggle done", () => {
  it("toggles the selected task and refetches", async () => {
    const { api, load, stdin, lastFrame } = setup();
    await settle();
    stdin.write("d");
    await settle();
    expect(api.toggleTask).toHaveBeenCalledWith(110, true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(plain(lastFrame())).toContain("done: 110 Write the README");
  });

  it("refuses on a row that is not a task, and says why", async () => {
    const { api, stdin, lastFrame } = setup();
    await settle();
    stdin.write("1"); // Roadmap — the first row is a goal
    await settle();
    stdin.write("d");
    await settle();
    expectNoWrites(api);
    expect(plain(lastFrame())).toContain("select a task row first");
  });
});

describe("D — delete behind a confirm", () => {
  it("never deletes without the y", async () => {
    const { api, stdin, lastFrame } = setup();
    await settle();
    stdin.write("D");
    await settle();
    expect(plain(lastFrame())).toContain("delete 110 Write the README and its subtree? (y/n)");
    stdin.write("n");
    await settle();
    expect(api.deleteTask).not.toHaveBeenCalled();
    expect(plain(lastFrame())).toContain("delete cancelled");
  });

  it("escape is a cancel too", async () => {
    const { api, stdin } = setup();
    await settle();
    stdin.write("D");
    await settle();
    stdin.write(ESC);
    await settle();
    expect(api.deleteTask).not.toHaveBeenCalled();
  });

  it("deletes on y", async () => {
    const { api, load, stdin, lastFrame } = setup();
    await settle();
    stdin.write("D");
    await settle();
    stdin.write("y");
    await settle();
    expect(api.deleteTask).toHaveBeenCalledWith(110);
    expect(load).toHaveBeenCalledTimes(1);
    expect(plain(lastFrame())).toContain("deleted: 110 Write the README");
  });
});

describe("s — set stage", () => {
  it("goes through setStage, never a patch", async () => {
    const { api, stdin } = setup();
    await settle();
    stdin.write("s");
    await settle();
    stdin.write("3"); // refine, schedule, active, done
    await settle();
    expect(api.setStage).toHaveBeenCalledWith(110, "active");
    expect(api.patchTask).not.toHaveBeenCalled();
  });

  it("shows the scheduling gate's refusal verbatim", async () => {
    const message = "Schedule calendar time for this task before starting it.";
    const { stdin, lastFrame } = setup(
      mockApi({
        setStage: vi.fn(async () => {
          throw new SchedulingGateError(message);
        }),
      }),
    );
    await settle();
    stdin.write("s");
    await settle();
    stdin.write("3");
    await settle();
    expect(plain(lastFrame())).toContain(message);
  });

  it("escape leaves the menu without writing", async () => {
    const { api, stdin } = setup();
    await settle();
    stdin.write("s");
    await settle();
    stdin.write(ESC);
    await settle();
    expectNoWrites(api);
  });
});

describe("x — set kanban status", () => {
  it("goes through setKanbanStatus", async () => {
    const { api, stdin, lastFrame } = setup();
    await settle();
    stdin.write("x");
    await settle();
    stdin.write("3"); // backlog, todo, doing, done
    await settle();
    expect(api.setKanbanStatus).toHaveBeenCalledWith(110, "doing");
    expect(plain(lastFrame())).toContain("status → doing: 110");
  });
});

describe("a — add a task", () => {
  it("inherits the plan of the selected row", async () => {
    const { api, stdin } = setup();
    await settle();
    stdin.write("a");
    await settle();
    for (const ch of "Write the abstract") stdin.write(ch);
    await settle();
    stdin.write(ENTER);
    await settle();
    // Row 110 is in plan 10.
    expect(api.createTask).toHaveBeenCalledWith({ title: "Write the abstract", plan_id: 10 });
  });

  it("inherits the selected PLAN's id on the roadmap", async () => {
    const { api, stdin } = setup();
    await settle();
    stdin.write("1"); // Roadmap
    await settle();
    stdin.write(ENTER); // expand goal "Read more"
    await settle();
    stdin.write("j"); // its plan, Books (11)
    await settle();
    stdin.write("a");
    await settle();
    for (const ch of "Book: Ubik") stdin.write(ch);
    stdin.write(ENTER);
    await settle();
    expect(api.createTask).toHaveBeenCalledWith({ title: "Book: Ubik", plan_id: 11 });
  });

  it("refuses an empty title rather than creating a nameless task", async () => {
    const { api, stdin, lastFrame } = setup();
    await settle();
    stdin.write("a");
    await settle();
    stdin.write(ENTER);
    await settle();
    expect(api.createTask).not.toHaveBeenCalled();
    expect(plain(lastFrame())).toContain("an empty title is not a task");
  });

  it("escape abandons the prompt", async () => {
    const { api, stdin } = setup();
    await settle();
    stdin.write("a");
    await settle();
    for (const ch of "oops") stdin.write(ch);
    stdin.write(ESC);
    await settle();
    expectNoWrites(api);
  });
});

describe("e — edit title and due", () => {
  it("patches only what changed", async () => {
    const { api, stdin } = setup();
    await settle();
    stdin.write("e");
    await settle();
    for (let i = 0; i < "Write the README".length; i++) stdin.write(BACKSPACE);
    for (const ch of "Write the readme") stdin.write(ch);
    await settle();
    stdin.write(ENTER); // on to the due prompt, pre-filled with 2026-09-23
    await settle();
    stdin.write(ENTER);
    await settle();
    expect(api.patchTask).toHaveBeenCalledWith(110, { title: "Write the readme" });
  });

  it("clears the due date when the field is emptied", async () => {
    const { api, stdin } = setup();
    await settle();
    stdin.write("e");
    await settle();
    stdin.write(ENTER); // keep the title
    await settle();
    for (let i = 0; i < "2026-09-23".length; i++) stdin.write(BACKSPACE);
    await settle();
    stdin.write(ENTER);
    await settle();
    // Empty CLEARS (null); it is not "leave it alone".
    expect(api.patchTask).toHaveBeenCalledWith(110, { due_date: null });
  });

  it("refuses a malformed date before touching the api", async () => {
    const { api, stdin, lastFrame } = setup();
    await settle();
    stdin.write("e");
    await settle();
    stdin.write(ENTER);
    await settle();
    for (let i = 0; i < "2026-09-23".length; i++) stdin.write(BACKSPACE);
    for (const ch of "next friday") stdin.write(ch);
    await settle();
    stdin.write(ENTER);
    await settle();
    expect(api.patchTask).not.toHaveBeenCalled();
    expect(plain(lastFrame())).toContain("expected YYYY-MM-DD");
  });

  it("says so instead of writing when nothing changed", async () => {
    const { api, stdin, lastFrame } = setup();
    await settle();
    stdin.write("e");
    await settle();
    stdin.write(ENTER);
    await settle();
    stdin.write(ENTER);
    await settle();
    expect(api.patchTask).not.toHaveBeenCalled();
    expect(plain(lastFrame())).toContain("unchanged: 110");
  });
});

describe("/ — filter", () => {
  it("narrows the pane and is visible while it is on", async () => {
    const { api, stdin, lastFrame } = setup();
    await settle();
    stdin.write("3"); // Upcoming
    await settle();
    stdin.write("/");
    await settle();
    for (const ch of "sapiens") stdin.write(ch);
    stdin.write(ENTER);
    await settle();
    const f = plain(lastFrame());
    expect(f).toContain("filter: sapiens");
    expect(f).toContain("Book: Sapiens");
    expect(f).not.toContain("Fix the sink");
    expectNoWrites(api);

    stdin.write(ESC);
    await settle();
    expect(plain(lastFrame())).toContain("Fix the sink");
  });
});

describe("r — refresh", () => {
  it("refetches without writing", async () => {
    const { api, load, stdin, lastFrame } = setup();
    await settle();
    stdin.write("r");
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(plain(lastFrame())).toContain("refreshed");
    expectNoWrites(api);
  });

  it("reports a failed refetch instead of showing stale data as fresh", async () => {
    const api = mockApi();
    const load = vi.fn(async (): Promise<BoardModel> => {
      throw new Error("fetch failed");
    });
    const { stdin, lastFrame } = render(
      <BoardApp who={WHO} api={api} load={load} initialModel={model()} columns={100} rowLines={20} />,
    );
    await settle();
    stdin.write("r");
    await settle();
    expect(plain(lastFrame())).toContain("fetch failed");
  });
});
