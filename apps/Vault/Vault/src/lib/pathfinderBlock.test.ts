import { describe, it, expect } from "vitest";
import {
  axisDropValue,
  axisWriteField,
  boardColumns,
  defaultSpec,
  deriveLabel,
  parseSpec,
  serializeSpec,
  sortColumns,
  SPEC_MAX_LIMIT,
  PF_COLUMNS,
} from "./pathfinderBlock";
import { DEFAULT_FILTER } from "@nexus/core/pathfinder";

describe("parseSpec", () => {
  it("returns defaults for empty, malformed or non-object input", () => {
    expect(parseSpec("", "list")).toEqual(defaultSpec("list"));
    expect(parseSpec("not json", "list")).toEqual(defaultSpec("list"));
    expect(parseSpec("42", "list")).toEqual(defaultSpec("list"));
    expect(parseSpec(null, "board")).toEqual(defaultSpec("board"));
  });

  it("round-trips a spec through serialize", () => {
    const spec = defaultSpec("table");
    expect(parseSpec(serializeSpec(spec), "table")).toEqual(spec);
  });

  // The reason every field is validated separately: this attribute is text in a
  // document. A paste from a newer build, or a hand-edited import, must not be
  // able to discard the rest of the block's configuration.
  it("falls back per FIELD, not to a whole default spec", () => {
    const raw = JSON.stringify({
      filter: { ...DEFAULT_FILTER, planIds: [7], due: "wat", priorities: ["nonsense", "high"] },
      sort: { key: "not-a-key", dir: "desc" },
      limit: 12,
    });
    const spec = parseSpec(raw, "list");
    expect(spec.filter.planIds).toEqual([7]);      // kept
    expect(spec.filter.due).toBe("any");            // reset
    expect(spec.filter.priorities).toEqual(["high"]); // bad member dropped, good kept
    expect(spec.sort.key).toBe(defaultSpec("list").sort.key);
    expect(spec.sort.dir).toBe("desc");             // kept
    expect(spec.limit).toBe(12);
  });

  it("drops non-number plan ids and de-duplicates", () => {
    const raw = JSON.stringify({ filter: { planIds: [1, 1, "2", null, 3] } });
    expect(parseSpec(raw, "list").filter.planIds).toEqual([1, 3]);
  });

  it("clamps the limit and treats 0 as uncapped", () => {
    expect(parseSpec(JSON.stringify({ limit: 99999 }), "list").limit).toBe(SPEC_MAX_LIMIT);
    expect(parseSpec(JSON.stringify({ limit: 0 }), "list").limit).toBe(0);
    expect(parseSpec(JSON.stringify({ limit: -5 }), "list").limit).toBe(0);
    expect(parseSpec(JSON.stringify({ limit: "x" }), "list").limit).toBe(defaultSpec("list").limit);
  });

  it("always keeps the title column, even if the stored spec dropped it", () => {
    const spec = parseSpec(JSON.stringify({ columns: ["due", "plan"] }), "table");
    expect(spec.columns).toContain("title");
  });

  it("normalises column order so toggling one off and on does not move it", () => {
    const spec = parseSpec(JSON.stringify({ columns: ["due", "title", "done"] }), "table");
    expect(spec.columns).toEqual(sortColumns(spec.columns));
    expect(PF_COLUMNS.indexOf(spec.columns[0])).toBeLessThan(PF_COLUMNS.indexOf(spec.columns[1]));
  });

  it("keeps opaque team and assignee identifiers as-is", () => {
    const raw = JSON.stringify({ filter: { teamIds: ["t-1", "t-1", 3, ""], assignee: "uid-x" } });
    const spec = parseSpec(raw, "list");
    expect(spec.filter.teamIds).toEqual(["t-1"]);
    expect(spec.filter.assignee).toBe("uid-x");
  });

  it("defaults an unknown ownership scope rather than the whole filter", () => {
    const spec = parseSpec(JSON.stringify({ filter: { scope: "nope", teamIds: ["t"] } }), "list");
    expect(spec.filter.scope).toBe("any");
    expect(spec.filter.teamIds).toEqual(["t"]);
  });

  it("showFilters defaults to on and survives an explicit false", () => {
    expect(parseSpec("{}", "list").showFilters).toBe(true);
    expect(parseSpec(JSON.stringify({ showFilters: false }), "list").showFilters).toBe(false);
  });
});

describe("serializeSpec", () => {
  // A config that silently becomes invalid JSON is worse than one that visibly
  // resets, and it would share the note's save budget with its prose.
  it("reverts to a default rather than emitting a truncated string", () => {
    const huge = defaultSpec("list");
    huge.filter.kanbanStatuses = Array.from({ length: 5000 }, (_, i) => `status-${i}`);
    const out = serializeSpec(huge);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(JSON.parse(out).filter.kanbanStatuses).toEqual([]);
  });
});

describe("board axes", () => {
  it("offers writes only on axes that can actually be written", () => {
    expect(axisWriteField("kanban_status")).toBe("kanban_status");
    expect(axisWriteField("stage")).toBe("stage");
    expect(axisWriteField("assignee")).toBe("assigned_to");
    // task_type is a GENERATED column; plan has goal-linkage consequences.
    expect(axisWriteField("task_type")).toBeNull();
    expect(axisWriteField("plan")).toBeNull();
  });

  // Writing the literal "__unassigned__" would assign the task to a person who
  // does not exist — invisible to everyone, and indistinguishable from unassigned.
  it("maps the unassigned column to null, not to its key", () => {
    expect(axisDropValue("assignee", "__unassigned__")).toBeNull();
    expect(axisDropValue("assignee", "all")).toBe("all");
    expect(axisDropValue("assignee", "uid-1")).toBe("uid-1");
    expect(axisDropValue("kanban_status", "doing")).toBe("doing");
  });

  it("de-duplicates a person who is on two teams into one column", () => {
    const members = [
      { team_id: "a", user_id: "u1", display_name: "Bastian" },
      { team_id: "b", user_id: "u1", display_name: "Bastian" },
      { team_id: "a", user_id: "u2", display_name: "Josefine" },
    ];
    const cols = boardColumns("assignee", [], members);
    expect(cols.filter((c) => c.key === "u1")).toHaveLength(1);
    // Unassigned leads: it is the column work needs moving OUT of.
    expect(cols[0].key).toBe("__unassigned__");
  });

  it("kanban columns are a fixed list, not discovered from the data", () => {
    expect(boardColumns("kanban_status", []).map((c) => c.key))
      .toEqual(["backlog", "todo", "doing", "done"]);
  });
});

describe("deriveLabel", () => {
  const teams = [{ id: "t1", name: "Household", created_by: "u1" }];
  const members = [{ team_id: "t1", user_id: "u2", display_name: "Josefine" }];

  it("names the unfiltered cases plainly", () => {
    expect(deriveLabel(defaultSpec("list"), "list", [], [])).toBe("Open tasks");
    const all = defaultSpec("list");
    all.filter = { ...all.filter, done: "all" };
    expect(deriveLabel(all, "list", [], [])).toBe("All tasks");
  });

  it("leads with whose work it is", () => {
    const spec = defaultSpec("list");
    spec.filter = { ...spec.filter, assignee: "u2", due: "overdue" };
    expect(deriveLabel(spec, "list", [], [], teams, members)).toBe("Josefine · overdue");
  });

  it("names a single team and counts several", () => {
    const one = defaultSpec("board");
    one.filter = { ...one.filter, teamIds: ["t1"] };
    expect(deriveLabel(one, "board", [], [], teams, members)).toBe("Household");

    const many = defaultSpec("board");
    many.filter = { ...many.filter, teamIds: ["t1", "t2"] };
    expect(deriveLabel(many, "board", [], [], teams, members)).toBe("2 teams");
  });

  it("falls back to a uid prefix for an unknown member", () => {
    const spec = defaultSpec("list");
    spec.filter = { ...spec.filter, assignee: "abcdef0123456789" };
    expect(deriveLabel(spec, "list", [], [], teams, members)).toBe("Abcdef01");
  });

  it("uses the plan title when filtered to one plan", () => {
    const spec = defaultSpec("table");
    spec.filter = { ...spec.filter, planIds: [3] };
    const plans = [{ id: 3, goal_id: null, title: "Thesis", status: "active", deadline: null, team_id: null }];
    expect(deriveLabel(spec, "table", plans, [])).toBe("Thesis");
  });
});
