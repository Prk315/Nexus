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
  withColumn,
  withoutColumn,
  moveColumn,
  columnWidths,
  columnWeight,
  COL_WEIGHT_MAX,
  COL_WEIGHT_MIN,
  listColumns,
  LIST_COLUMNS,
  META_PCT_MAX,
  META_PCT_MIN,
  specFilterCount,
  specIsUnfiltered,
  MAX_FILTER_TAGS,
  SPEC_MAX_LIMIT,
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

  // This test used to assert the OPPOSITE — that parseSpec normalised the order
  // — and that is precisely what made column placement unstorable: a
  // hand-ordered table snapped back to canonical order on the next load.
  //
  // The property that assertion was really protecting ("toggling a column off
  // and on again does not move it") has not been dropped; it moved to
  // `withColumn`, which inserts at the canonical position RELATIVE to the
  // columns already shown. It is asserted there, under "column placement".
  it("preserves a hand-set column order instead of normalising it", () => {
    const spec = parseSpec(JSON.stringify({ columns: ["due", "title", "done"] }), "table");
    expect(spec.columns).toEqual(["due", "title", "done"]);
    expect(spec.columns).not.toEqual(sortColumns(spec.columns));
  });

  it("still seeds a fresh block in canonical order", () => {
    expect(defaultSpec("table").columns).toEqual(sortColumns(defaultSpec("table").columns));
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

describe("listColumns", () => {
  const withCols = (cols: string[]) =>
    parseSpec(JSON.stringify({ columns: cols }), "list");

  it("keeps only what a list row can actually draw", () => {
    const cols = listColumns(withCols(["title", "plan", "assignee", "urgency", "stage"]));
    expect([...cols].sort()).toEqual(["assignee", "plan", "title"]);
  });

  // The spec is shared across views by design ("a configured list becomes a
  // configured board without being rebuilt"), so a table-only column must
  // survive being invisible in the list rather than be quietly dropped.
  it("does not discard table-only columns from the spec itself", () => {
    const spec = withCols(["title", "urgency"]);
    expect(spec.columns).toContain("urgency");
    expect(listColumns(spec).has("urgency" as never)).toBe(false);
  });

  it("never loses the title", () => {
    // parseSpec puts `title` back even when asked not to.
    expect(listColumns(withCols(["plan"])).has("title")).toBe(true);
  });

  it("offers nothing the list cannot draw", () => {
    for (const c of LIST_COLUMNS) {
      expect(listColumns(withCols([...LIST_COLUMNS])).has(c)).toBe(true);
    }
    expect(LIST_COLUMNS).not.toContain("urgency");
    expect(LIST_COLUMNS).not.toContain("stage");
  });
});

describe("spec.metaPct", () => {
  const pct = (v: unknown) => parseSpec(JSON.stringify({ metaPct: v }), "list").metaPct;

  it("defaults to 0 — auto width, the behaviour before the split existed", () => {
    expect(defaultSpec("list").metaPct).toBe(0);
    expect(parseSpec("{}", "list").metaPct).toBe(0);
  });

  it("keeps a value inside the band", () => {
    expect(pct(30)).toBe(30);
    expect(pct(META_PCT_MIN)).toBe(META_PCT_MIN);
    expect(pct(META_PCT_MAX)).toBe(META_PCT_MAX);
  });

  // Neither side of the split may vanish: below the floor a drag becomes a
  // delete, and the user cannot get the column back because there is nothing
  // left to grab.
  it("clamps rather than letting either side vanish", () => {
    expect(pct(1)).toBe(META_PCT_MIN);
    expect(pct(99)).toBe(META_PCT_MAX);
  });

  it("treats 0 and negatives as auto rather than as a tiny column", () => {
    expect(pct(0)).toBe(0);
    expect(pct(-20)).toBe(0);
  });

  it("falls back to auto on anything that is not a finite number", () => {
    // A hand-edited document, or a paste from a build that stored something else.
    expect(pct("40%")).toBe(0);
    expect(pct(null)).toBe(0);
    expect(pct(NaN)).toBe(0);
    expect(pct(Infinity)).toBe(0);
    expect(pct({})).toBe(0);
  });

  it("survives a serialize/parse round trip", () => {
    const spec = { ...defaultSpec("list"), metaPct: 42 };
    expect(parseSpec(serializeSpec(spec), "list").metaPct).toBe(42);
  });
});

describe("column placement", () => {
  it("re-enables a column at its canonical position, not at the end", () => {
    // The property sortColumns used to give for free. Without it, one stray
    // double-click on a chip silently rearranges the table.
    expect(withColumn(["done", "title", "due"], "plan")).toEqual(["done", "title", "plan", "due"]);
  });

  it("appends when nothing canonical comes after it", () => {
    expect(withColumn(["done", "title"], "type")).toEqual(["done", "title", "type"]);
  });

  it("is a no-op for a column already shown", () => {
    const cols = ["done", "title"] as const;
    expect(withColumn([...cols], "title")).toEqual([...cols]);
  });

  it("refuses to remove the title — a table with no labels is not a table", () => {
    expect(withoutColumn(["done", "title", "due"], "title")).toEqual(["done", "title", "due"]);
    expect(withoutColumn(["done", "title", "due"], "due")).toEqual(["done", "title"]);
  });

  it("moves a column to where the target sits", () => {
    expect(moveColumn(["done", "title", "plan", "due"], "due", "title"))
      .toEqual(["done", "due", "title", "plan"]);
    expect(moveColumn(["done", "title", "plan", "due"], "done", "due"))
      .toEqual(["title", "plan", "due", "done"]);
  });

  it("ignores a move that cannot happen", () => {
    const cols = ["done", "title"] as const;
    expect(moveColumn([...cols], "title", "title")).toEqual([...cols]);
    expect(moveColumn([...cols], "plan", "title")).toEqual([...cols]);
    expect(moveColumn([...cols], "title", "plan")).toEqual([...cols]);
  });

  // The regression that made placement unstorable: parseSpec forced canonical
  // order on every load, so a hand-ordered table snapped back on refresh.
  it("survives a serialize/parse round trip in the order the user set", () => {
    const spec = { ...defaultSpec("table"), columns: ["due", "title", "done"] as never };
    expect(parseSpec(serializeSpec(spec), "table").columns).toEqual(["due", "title", "done"]);
  });
});

describe("column widths", () => {
  const W = (o: Record<string, number>) => parseSpec(JSON.stringify({ colWeights: o }), "table").colWeights;

  it("defaults every column to an equal share", () => {
    const { data } = columnWidths(["title", "plan", "due"], {});
    expect(data[0]).toBeCloseTo(data[1]);
    expect(data[1]).toBeCloseTo(data[2]);
  });

  it("always leaves room for the actions column", () => {
    const { data, actions } = columnWidths(["title", "plan"], {});
    expect(actions).toBeGreaterThan(0);
    expect(data.reduce((a, b) => a + b, 0) + actions).toBeCloseTo(100);
  });

  it("gives a heavier column proportionally more", () => {
    const { data } = columnWidths(["title", "plan"], { title: 3 });
    expect(data[0]).toBeCloseTo(data[1] * 3);
  });

  // Weights renormalise, which is the whole reason they are not percentages:
  // adding a column must not require rewriting every other one.
  it("renormalises when a column is added", () => {
    const two = columnWidths(["title", "plan"], {});
    const three = columnWidths(["title", "plan", "due"], {});
    expect(three.data[0]).toBeLessThan(two.data[0]);
    expect(three.data.reduce((a, b) => a + b, 0) + three.actions).toBeCloseTo(100);
  });

  it("clamps a stored weight into the band", () => {
    expect(columnWeight(W({ title: 99 }), "title")).toBe(COL_WEIGHT_MAX);
    expect(columnWeight(W({ title: 0.01 }), "title")).toBe(COL_WEIGHT_MIN);
  });

  it("drops junk rather than rendering a broken table", () => {
    expect(W({ title: NaN })).toEqual({});
    expect(W({ title: "wide" as never })).toEqual({});
    expect(W({ notAColumn: 2 })).toEqual({});
    expect(parseSpec(JSON.stringify({ colWeights: [1, 2] }), "table").colWeights).toEqual({});
    expect(parseSpec(JSON.stringify({ colWeights: null }), "table").colWeights).toEqual({});
  });

  it("does not store the default weight", () => {
    // 1 is what a missing entry means; writing it is bytes against SPEC_MAX_CHARS.
    expect(W({ title: 1 })).toEqual({});
  });

  it("never divides by zero on an empty table", () => {
    const { data, actions } = columnWidths([], {});
    expect(data).toEqual([]);
    expect(actions).toBeGreaterThan(0);
  });
});
