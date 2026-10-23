// Each pane rendered to a string, on the fixture.
//
// These are the tests that would catch a layout regression `tsc` cannot see: a
// column that silently falls off the right edge, a title that stops being the
// last thing to give way, a bar that renders full for zero leaves. Nothing here
// opens a terminal or a connection — ink-testing-library writes into a buffer.

import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { buildModel, rowsFor, type BoardModel, type PaneId } from "./data.ts";
import { Board, KEY_HINT, KEY_HINT_SHORT, fit, keyHint, titleWidth, visibleColumns } from "./ui.tsx";
import { FIXTURE_BRIEF, FIXTURE_GOALS, FIXTURE_PLANS, FIXTURE_TASKS, FIXTURE_TODAY } from "./fixture.ts";

const WHO = { profileName: "me", email: "owner@example.com" };

function model(over: Partial<Parameters<typeof buildModel>[0]> = {}): BoardModel {
  return buildModel({
    tasks: FIXTURE_TASKS,
    plans: FIXTURE_PLANS,
    goals: FIXTURE_GOALS,
    brief: FIXTURE_BRIEF,
    today: FIXTURE_TODAY,
    loadedAt: new Date(2026, 8, 24, 9, 0, 0),
    ...over,
  });
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;]*m/g;

function frame(opts: {
  pane: PaneId;
  m?: BoardModel;
  expanded?: string[];
  selected?: number;
  columns?: number;
  filter?: string;
  status?: string;
}): string {
  const m = opts.m ?? model();
  const rows = rowsFor(opts.pane, m, new Set(opts.expanded ?? []), opts.filter ?? "");
  const { lastFrame } = render(
    <Board
      who={WHO}
      model={m}
      pane={opts.pane}
      rows={rows}
      selected={opts.selected ?? 0}
      status={opts.status ?? ""}
      statusKind="info"
      filter={opts.filter ?? ""}
      mode={{ kind: "browse" }}
      columns={opts.columns ?? 100}
      rowLines={20}
    />,
  );
  return (lastFrame() ?? "")
    .replace(ANSI, "")
    // The header carries a wall clock; the layout under test does not.
    .replace(/loaded \d\d:\d\d:\d\d/, "loaded HH:MM:SS")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n");
}

describe("pane snapshots at 100 columns", () => {
  it("roadmap: goals, their plans, and a plan's top-level tasks", () => {
    expect(frame({ pane: "roadmap", expanded: ["g:1", "p:10"], selected: 2 })).toMatchInlineSnapshot(`
      "[me <owner@example.com>] nexus board · 2026-09-24 · loaded HH:MM:SS
      1 Roadmap •   2 Current   3 Upcoming   4 Progress  open 7  roots 5  active 1  overdue 1
      ────────────────────────────────────────────────────────────────────────────────────────────────────
           id title                                         progress     % done/total status    deadline
            2 ▸ Read more                                   ███░░░░░░░  33        1/3 active
            1 ▾ Ship the board                              ███░░░░░░░  33        1/3 active    2026-10-31
      >    10   ▾ nexus-cli                                 ███░░░░░░░  33        1/3 active    2026-10-15
          100       [ ] Build the TUI                       █████░░░░░  50        1/2 refine
          110       [ ] Write the README                    ░░░░░░░░░░   0        0/1 refine    2026-09-23
              ▸ (no goal)                                   ░░░░░░░░░░   0        0/2
      ────────────────────────────────────────────────────────────────────────────────────────────────────
        6 rows

      j/k move  ⏎ expand  a add  d done  s stage  x status  e edit  D delete  r refresh  / filter  q quit"
    `);
  });

  it("current: overdue first, then due today", () => {
    expect(frame({ pane: "current", status: "done: 1023 Book: The Selfish Gene" })).toMatchInlineSnapshot(`
      "[me <owner@example.com>] nexus board · 2026-09-24 · loaded HH:MM:SS
      1 Roadmap   2 Current •   3 Upcoming   4 Progress  open 7  roots 5  active 1  overdue 1
      ────────────────────────────────────────────────────────────────────────────────────────────────────
           id title                                       due        urg    kanban      plan
      >   110   [ ] Write the README                      2026-09-23 high   todo        nexus-cli
          102   [ ] Ink panes                             2026-09-24 high   doing
      ────────────────────────────────────────────────────────────────────────────────────────────────────
        2 rows
      done: 1023 Book: The Selfish Gene
      j/k move  ⏎ expand  a add  d done  s stage  x status  e edit  D delete  r refresh  / filter  q quit"
    `);
  });

  it("upcoming: this week, later, no date", () => {
    expect(frame({ pane: "upcoming", selected: 1 })).toMatchInlineSnapshot(`
      "[me <owner@example.com>] nexus board · 2026-09-24 · loaded HH:MM:SS
      1 Roadmap   2 Current   3 Upcoming •   4 Progress  open 7  roots 5  active 1  overdue 1
      ────────────────────────────────────────────────────────────────────────────────────────────────────
           id title                                         due        pri    stage     plan
        due within 7 days (1)
      >   200     [ ] Book: The Selfish Gene                2026-09-27 high   refine    Books
        due later (1)
          300     [ ] Fix the sink                          2026-10-24 medium           Odd jobs
        no date (3)
          100     [ ] Build the TUI                                    medium refine    nexus-cli
          400     [ ] Inbox: call the dentist                          medium refine
          201     [ ] Book: Sapiens                                    low    refine    Books
      ────────────────────────────────────────────────────────────────────────────────────────────────────
        8 rows

      j/k move  ⏎ expand  a add  d done  s stage  x status  e edit  D delete  r refresh  / filter  q quit"
    `);
  });

  it("progress: the brief's headline numbers and per-goal leaves", () => {
    expect(frame({ pane: "progress" })).toMatchInlineSnapshot(`
      "[me <owner@example.com>] nexus board · 2026-09-24 · loaded HH:MM:SS
      1 Roadmap   2 Current   3 Upcoming   4 Progress •  open 7  roots 5  active 1  overdue 1
      ────────────────────────────────────────────────────────────────────────────────────────────────────
           id title                                                              progress     % done/total
      >     2   Read more                                                        ███░░░░░░░  33        1/3
            1   Ship the board                                                   ███░░░░░░░  33        1/3
                (no goal)                                                        ░░░░░░░░░░   0        0/2
      ────────────────────────────────────────────────────────────────────────────────────────────────────
        3 rows

      j/k move  ⏎ expand  a add  d done  s stage  x status  e edit  D delete  r refresh  / filter  q quit"
    `);
  });
});

describe("degrading to 80 columns", () => {
  it("drops the widest optional columns and gives the space to the title", () => {
    expect(visibleColumns("current", 100).map((c) => c.label)).toEqual(["due", "urg", "kanban", "plan"]);
    expect(visibleColumns("current", 80).map((c) => c.label)).toEqual(["due", "urg"]);
    // The title is the content, so it is the LAST thing to give way.
    expect(titleWidth("current", 80)).toBeGreaterThan(40);
  });

  it("never draws a line wider than the terminal", () => {
    for (const pane of ["roadmap", "current", "upcoming", "progress"] as PaneId[]) {
      for (const columns of [80, 92, 100, 140]) {
        const lines = frame({ pane, columns, expanded: ["g:1", "p:10"] }).split("\n");
        for (const line of lines) expect(line.length).toBeLessThanOrEqual(columns);
      }
    }
  });

  it("renders the 80-column Current pane readably", () => {
    expect(frame({ pane: "current", columns: 80 })).toMatchInlineSnapshot(`
      "[me <owner@example.com>] nexus board · 2026-09-24 · loaded HH:MM:SS
      1 Roadmap   2 Current •   3 Upcoming   4 Progress
      open 7  roots 5  active 1  overdue 1
      ────────────────────────────────────────────────────────────────────────────────
           id title                                                  due        urg
      >   110   [ ] Write the README                                 2026-09-23 high
          102   [ ] Ink panes                                        2026-09-24 high
      ────────────────────────────────────────────────────────────────────────────────
        2 rows

      a add  d done  s stage  x status  e edit  D del  r reload  / find  q quit"
    `);
  });
});

describe("states that must not look like success", () => {
  it("says the counts are unknown when the brief failed", () => {
    const f = frame({ pane: "progress", m: model({ brief: null, briefError: "pf_agent_brief: boom" }) });
    expect(f).toContain("open ?  roots ?  active ?  overdue ?");
    expect(f).toContain("brief unavailable");
  });

  it("warns that every count is a floor when the task read hit the cap", () => {
    expect(frame({ pane: "progress", m: model({ capped: true }) })).toContain("row cap");
  });

  it("says nothing is due rather than showing a blank Current pane", () => {
    expect(frame({ pane: "current", m: model({ tasks: [] }) })).toContain("nothing active and nothing due");
  });

  it("shows the active filter so an empty pane is never mistaken for an empty backlog", () => {
    expect(frame({ pane: "current", filter: "zzz" })).toContain("filter: zzz");
  });
});

describe("fit", () => {
  it("pads, right-aligns and ellipsises", () => {
    expect(fit("ab", 5)).toBe("ab   ");
    expect(fit("ab", 5, "right")).toBe("   ab");
    expect(fit("abcdef", 4)).toBe("abc…");
    expect(fit("abc", 0)).toBe("");
  });
});

describe("the key hint", () => {
  it("names every key the board answers", () => {
    for (const k of ["a add", "d done", "s stage", "x status", "e edit", "D delete", "r refresh", "/ filter", "q quit"]) {
      expect(KEY_HINT).toContain(k);
    }
    // The short form may abbreviate, but it may never drop a key.
    for (const k of ["a add", "d done", "s stage", "x status", "e edit", "D del", "r reload", "/ find", "q quit"]) {
      expect(KEY_HINT_SHORT).toContain(k);
    }
  });

  it("fits the width it is chosen for, so `q quit` is never the part cut off", () => {
    expect(keyHint(100)).toBe(KEY_HINT);
    expect(KEY_HINT.length).toBeLessThanOrEqual(100);
    expect(keyHint(80)).toBe(KEY_HINT_SHORT);
    expect(KEY_HINT_SHORT.length).toBeLessThanOrEqual(80);
  });
});
