import { describe, it, expect } from "vitest";
import {
  axisDropValue,
  axisWriteField,
  boardColumns,
  clearedSpec,
  defaultSpec,
  deriveLabel,
  parseSpec,
  serializeSpec,
  sortColumns,
  specFilterCount,
  specIsUnfiltered,
  MAX_FILTER_TAGS,
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

  // ── Hierarchy ─────────────────────────────────────────────────────────────

  // A block written before hierarchy existed carries no `tree` key. It gets the
  // default, which nests it — that IS the intended migration, and it changes the
  // shape of the result without changing which tasks are in it.
  it("nests a spec that predates the tree field", () => {
    expect(parseSpec(JSON.stringify({ limit: 10 }), "list").tree).toBe("matched");
  });

  it("keeps a stored tree mode and rejects an unknown one", () => {
    expect(parseSpec(JSON.stringify({ tree: "off" }), "list").tree).toBe("off");
    expect(parseSpec(JSON.stringify({ tree: "full" }), "list").tree).toBe("full");
    expect(parseSpec(JSON.stringify({ tree: "sideways" }), "list").tree).toBe("matched");
  });

  // ── Vault tags ────────────────────────────────────────────────────────────

  // The store only ever holds lowercased tags, so a spec carrying "Reading"
  // would match nothing while looking perfectly correct on screen.
  it("re-normalises stored tags rather than trusting them", () => {
    const spec = parseSpec(JSON.stringify({ tags: ["Reading", " thesis ", "reading", ""] }), "list");
    expect(spec.tags).toEqual(["reading", "thesis"]);
  });

  it("caps the tag list so one block cannot outgrow SPEC_MAX_CHARS", () => {
    const many = Array.from({ length: MAX_FILTER_TAGS + 25 }, (_, i) => `tag-${i}`);
    expect(parseSpec(JSON.stringify({ tags: many }), "list").tags).toHaveLength(MAX_FILTER_TAGS);
  });

  it("defaults the tag mode and the two tag toggles", () => {
    const spec = parseSpec("{}", "list");
    expect(spec.tagMode).toBe("any");
    expect(spec.untaggedOnly).toBe(false);
    expect(spec.showTags).toBe(false);
    expect(parseSpec(JSON.stringify({ tagMode: "sideways" }), "list").tagMode).toBe("any");
    expect(parseSpec(JSON.stringify({ tagMode: "none" }), "list").tagMode).toBe("none");
  });
});

describe("specFilterCount / specIsUnfiltered", () => {
  // The badge on the ⚙ button and the "Clear filters" empty state both read from
  // these. Missing the tag axes is a specific, confusing bug: a block filtered
  // to one tag would show no badge, say "No open tasks", and offer a Clear
  // button that clears everything EXCEPT the thing hiding the rows.
  it("counts the Vault tag axes, which @nexus/core cannot see", () => {
    const base = defaultSpec("list");
    expect(specFilterCount(base)).toBe(0);
    expect(specFilterCount({ ...base, tags: ["reading"] })).toBe(1);
    expect(specFilterCount({ ...base, untaggedOnly: true })).toBe(1);
    expect(specFilterCount({ ...base, tags: ["a", "b"], untaggedOnly: true })).toBe(2);
  });

  it("does not call a tag-filtered block unfiltered", () => {
    const base = defaultSpec("list");
    expect(specIsUnfiltered(base)).toBe(true);
    expect(specIsUnfiltered({ ...base, tags: ["reading"] })).toBe(false);
    expect(specIsUnfiltered({ ...base, untaggedOnly: true })).toBe(false);
  });
});

describe("clearedSpec", () => {
  it("clears both PathFinder's axes and Vault's tags", () => {
    const spec = {
      ...defaultSpec("list"),
      filter: { ...DEFAULT_FILTER, planIds: [3], due: "overdue" as const, search: "x" },
      tags: ["reading"],
      untaggedOnly: true,
    };
    const cleared = clearedSpec(spec);
    expect(cleared.filter.planIds).toEqual([]);
    expect(cleared.filter.due).toBe("any");
    expect(cleared.filter.search).toBe("");
    expect(cleared.tags).toEqual([]);
    expect(cleared.untaggedOnly).toBe(false);
  });

  // "Clear filters" must not silently undo a different decision. `done` is a
  // view choice, and so are the display fields.
  it("leaves display choices alone", () => {
    const spec = {
      ...defaultSpec("table"),
      filter: { ...DEFAULT_FILTER, done: "all" as const },
      tree: "full" as const,
      compact: true,
      showTags: true,
      columns: ["title" as const, "due" as const],
    };
    const cleared = clearedSpec(spec);
    expect(cleared.filter.done).toBe("all");
    expect(cleared.tree).toBe("full");
    expect(cleared.compact).toBe(true);
    expect(cleared.showTags).toBe(true);
    expect(cleared.columns).toEqual(["title", "due"]);
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
