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
  aggregate,
  formulaContext,
  formulaFieldNames,
  meterFraction,
  METER_DISPLAYS,
  MAX_STATS,
  STAT_AGGS,
  MAX_FIELDS,
  FORMULA_FIELD_NAMES,
  MAX_FORMULAS,
  creationPayload,
  movePayload,
  normalizeStatuses,
  boardStatuses,
  MAX_STATUSES,
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
import { compile } from "./formula";
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

describe("board statuses", () => {
  const spec = (statuses: unknown) => parseSpec(JSON.stringify({ statuses }), "board");

  it("falls back to the built-in four when the block sets none", () => {
    expect(boardStatuses(defaultSpec("board"))).toEqual(["backlog", "todo", "doing", "done"]);
    expect(boardColumns("kanban_status", [], [], boardStatuses(defaultSpec("board"))).map((c) => c.key))
      .toEqual(["backlog", "todo", "doing", "done"]);
  });

  it("uses the block's own list when it has one", () => {
    const s = spec(["triage", "review"]);
    expect(boardStatuses(s)).toEqual(["triage", "review"]);
    expect(boardColumns("kanban_status", [], [], boardStatuses(s)).map((c) => c.label))
      .toEqual(["Triage", "Review"]);
  });

  // The key is matched against pf_tasks.kanban_status by exact string equality,
  // and every one of the 543 rows in the database is lower-case. A column
  // labelled "Doing" that does not hold the "doing" tasks looks like an empty
  // board rather than like a mismatch.
  it("lower-cases and trims so the key can match the data", () => {
    expect(normalizeStatuses(["  In Review  "])).toEqual(["in review"]);
  });

  it("drops blanks and duplicates", () => {
    expect(normalizeStatuses(["todo", "  ", "TODO", "done", ""])).toEqual(["todo", "done"]);
  });

  it("bounds the list and the length of each entry", () => {
    expect(normalizeStatuses(Array.from({ length: 40 }, (_, i) => `s${i}`)))
      .toHaveLength(MAX_STATUSES);
    expect(normalizeStatuses(["x".repeat(200)])[0]).toHaveLength(24);
  });

  it("ignores junk rather than rendering a broken board", () => {
    expect(normalizeStatuses(null)).toEqual([]);
    expect(normalizeStatuses("todo")).toEqual([]);
    expect(normalizeStatuses([1, true, null, "ok"])).toEqual(["ok"]);
  });

  it("survives a serialize/parse round trip", () => {
    const s = { ...defaultSpec("board"), statuses: ["triage", "review"] };
    expect(parseSpec(serializeSpec(s), "board").statuses).toEqual(["triage", "review"]);
  });

  // Every other axis has a closed domain, so an override must not leak into one.
  it("does not affect other axes", () => {
    expect(boardColumns("priority", [], [], ["triage"]).map((c) => c.key))
      .not.toContain("triage");
  });
});

describe("movePayload", () => {
  const withFilter = (f: Record<string, unknown>) =>
    parseSpec(JSON.stringify({ filter: f }), "list");
  const TODAY = "2026-08-28";

  it("carries what a target block constrains", () => {
    const spec = withFilter({ planIds: [4], goalIds: [7], priorities: ["high"] });
    expect(movePayload(spec, TODAY)).toMatchObject({
      plan_id: 4, goal_id: 7, priority: "high",
    });
  });

  // ⚠️ THE rule that separates a move from a creation. `category` is the ISA
  // discriminator: re-typing a `task` to a sparse kind DROPS its planning row —
  // urgency, stage, completion mode, notes — and the demotion is lossy by
  // construction. Creating a chore in a chore block is a choice; dragging a
  // planned task into one and silently deleting its plan is not.
  it("never changes what KIND of thing a task is", () => {
    const spec = withFilter({ taskTypes: ["chore"], planIds: [4] });
    expect(creationPayload(spec, TODAY).category).toBe("chore");   // creating: yes
    expect("category" in movePayload(spec, TODAY)).toBe(false);    // moving: never
    expect(movePayload(spec, TODAY).plan_id).toBe(4);              // the rest still carries
  });

  it("dates a task dropped into a today block", () => {
    expect(movePayload(withFilter({ due: "today" }), TODAY).due_date).toBe(TODAY);
    // A window is a range, not a date — only "today" is exactly one day.
    expect(movePayload(withFilter({ due: "week" }), TODAY).due_date).toBeUndefined();
  });

  it("is empty for a block that constrains nothing", () => {
    // The caller uses this to skip the write entirely, so an accidental drag
    // onto an unfiltered block costs no round trip and looks like nothing.
    expect(movePayload(parseSpec("{}", "list"), TODAY)).toEqual({});
  });

  it("inherits nothing from an ambiguous constraint", () => {
    // Same rule as creation: a filter admitting several plans names none.
    expect(movePayload(withFilter({ planIds: [4, 5] }), TODAY).plan_id).toBeUndefined();
  });

  it("still never carries stage, gated or not", () => {
    expect(movePayload(withFilter({ stages: ["active"] }), TODAY)).toEqual({});
  });
});

describe("formula columns", () => {
  const spec = (formulas: unknown) => parseSpec(JSON.stringify({ formulas }), "table");

  it("keeps a valid column", () => {
    const f = spec([{ id: "a", label: "Hours", expr: "estimate / 60", agg: "sum" }]).formulas;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ id: "a", label: "Hours", expr: "estimate / 60", agg: "sum" });
  });

  // An invalid expression is KEPT. The column shows an error, which is
  // recoverable; dropping it loses whatever the user was mid-way through
  // writing, with no explanation for why it vanished.
  it("keeps an expression that does not parse", () => {
    expect(spec([{ id: "a", expr: "estimate /" }]).formulas).toHaveLength(1);
  });

  it("drops entries with no id or no expression", () => {
    expect(spec([{ expr: "1" }, { id: "b" }, { id: "c", expr: "   " }]).formulas).toEqual([]);
  });

  it("drops duplicates and bounds the count", () => {
    expect(spec([{ id: "a", expr: "1" }, { id: "a", expr: "2" }]).formulas).toHaveLength(1);
    expect(spec(Array.from({ length: 20 }, (_, i) => ({ id: `f${i}`, expr: "1" }))).formulas)
      .toHaveLength(MAX_FORMULAS);
  });

  it("falls back to no aggregate for a nonsense one", () => {
    expect(spec([{ id: "a", expr: "1", agg: "median" }]).formulas[0].agg).toBe("none");
  });

  it("ignores junk", () => {
    expect(spec(null).formulas).toEqual([]);
    expect(spec("estimate").formulas).toEqual([]);
    expect(spec([1, null, "x"]).formulas).toEqual([]);
  });
});

describe("formulaContext", () => {
  const task = (over: Record<string, unknown> = {}) => ({
    id: 1, title: "t", done: false, priority: "medium", due_date: null,
    time_estimate: null, aggregate_estimate: null, planning: null, ...over,
  }) as never;

  it("exposes exactly the documented field names", () => {
    const ctx = formulaContext(task(), undefined, "2026-08-28");
    expect(Object.keys(ctx).sort()).toEqual([...FORMULA_FIELD_NAMES].sort());
  });

  it("turns priority and urgency into ranks, because the language has no strings", () => {
    expect(formulaContext(task({ priority: "high" }), undefined, "2026-08-28").priority).toBe(3);
    expect(formulaContext(task({ planning: { urgency: "low" } }), undefined, "2026-08-28").urgency).toBe(1);
  });

  it("computes overdue against the day it is given, not the clock", () => {
    const t = task({ due_date: "2026-08-01" });
    expect(formulaContext(t, undefined, "2026-08-28").overdue).toBe(true);
    expect(formulaContext(t, undefined, "2026-07-01").overdue).toBe(false);
  });

  it("does not call a completed task overdue", () => {
    const t = task({ due_date: "2026-08-01", done: true });
    expect(formulaContext(t, undefined, "2026-08-28").overdue).toBe(false);
  });

  it("treats a malformed due date as no due date", () => {
    // pf_tasks.due_date is TEXT with no constraint.
    expect(formulaContext(task({ due_date: "soon" }), undefined, "2026-08-28").hasDue).toBe(false);
  });
});

describe("aggregate", () => {
  // ⚠️ Nulls are skipped, never counted as zero. A task with no estimate has no
  // estimate; averaging it in as 0 quietly drags every mean down.
  it("skips nulls rather than treating them as zero", () => {
    expect(aggregate("sum", [10, null, 20])).toEqual({ value: 30, n: 2 });
    expect(aggregate("avg", [10, null, 20])).toEqual({ value: 15, n: 2 });
  });

  it("counts truthy rows, which is what makes a boolean column useful", () => {
    expect(aggregate("count", [true, false, true, null])).toEqual({ value: 2, n: 3 });
    expect(aggregate("percent", [true, false, true, false])).toEqual({ value: 50, n: 4 });
  });

  it("reports how many rows contributed, so the UI need not imply it measured all", () => {
    expect(aggregate("sum", [null, null]).n).toBe(0);
  });

  it("has no answer for an empty column rather than inventing zero", () => {
    expect(aggregate("avg", []).value).toBeNull();
    expect(aggregate("percent", []).value).toBeNull();
    expect(aggregate("none", [1, 2]).value).toBeNull();
  });
});

// ─── Stored custom columns ──────────────────────────────────────────────────
//
// The definition lives in the spec; the values live in vault_task_fields. These
// pin the join between the two halves — a stored NUMBER column is a name a
// formula reads, which is the whole point of building the two together.

describe("parseFields", () => {
  const parse = (fields: unknown) =>
    parseSpec(JSON.stringify({ ...defaultSpec("table"), fields }), "table").fields;

  it("defaults to none, on an old document with no such key at all", () => {
    expect(parseSpec(JSON.stringify({ view: "table" }), "table").fields).toEqual([]);
    expect(defaultSpec("table").fields).toEqual([]);
  });

  it("normalises the key, because the key IS the storage key", () => {
    expect(parse([{ key: "  Story Points ", label: "Story Points", type: "number" }]))
      .toEqual([{ key: "story_points", label: "Story Points", type: "number" }]);
  });

  // Two columns whose keys collide would split one column's values across two
  // headers, and the user would see half their data in each.
  it("drops a duplicate key", () => {
    expect(parse([
      { key: "budget", type: "number" },
      { key: "BUDGET", type: "text" },
    ])).toHaveLength(1);
  });

  // ⚠️ `estimate` meaning both "the task's estimate" and "this stored column"
  // inside one formula is not resolvable — so the collision is refused at the
  // door rather than shadowed one way or the other.
  it("refuses a key that collides with a built-in formula field", () => {
    for (const name of FORMULA_FIELD_NAMES) {
      expect(parse([{ key: name, type: "number" }]), name).toEqual([]);
    }
  });

  it("bounds the count and falls back to a text column for an unknown type", () => {
    const many = Array.from({ length: MAX_FIELDS + 4 }, (_, i) => ({ key: `k${i}`, type: "number" }));
    expect(parse(many)).toHaveLength(MAX_FIELDS);
    expect(parse([{ key: "a", type: "colour" }])[0].type).toBe("text");
  });

  it("survives a round trip", () => {
    const spec = { ...defaultSpec("table"), fields: [{ key: "budget", label: "Budget", type: "number" as const }] };
    expect(parseSpec(JSON.stringify(spec), "table").fields).toEqual(spec.fields);
  });
});

describe("stored fields in a formula", () => {
  const task = () => ({
    id: 1, title: "t", done: false, priority: "medium", due_date: null,
    time_estimate: null, aggregate_estimate: null, planning: null,
  }) as never;
  const cols = [
    { key: "budget", label: "", type: "number" as const },
    { key: "billed", label: "", type: "check" as const },
    { key: "owner", label: "", type: "text" as const },
  ];

  it("binds numeric and check columns, and never text", () => {
    const ctx = formulaContext(task(), undefined, "2026-08-28",
      { bag: { budget: "1200", billed: "1", owner: "me" }, cols });
    expect(ctx.budget).toBe(1200);
    expect(ctx.billed).toBe(true);
    // A text column has no numeric meaning. Binding it would make every formula
    // reading it silently blank instead of failing with a named error.
    expect(ctx.owner).toBeUndefined();
    expect(formulaFieldNames(cols)).toEqual([...FORMULA_FIELD_NAMES, "budget", "billed"]);
  });

  // ⚠️ The rule the whole feature turns on. `sum(budget)` over ten tasks where
  // two have a budget must be the sum of two — a missing value counted as 0
  // would drag every average down and look plausible while doing it.
  it("binds an absent value as null, never as zero or false", () => {
    const ctx = formulaContext(task(), undefined, "2026-08-28", { bag: undefined, cols });
    expect(ctx.budget).toBeNull();
    expect(ctx.billed).toBeNull();
    const blank = formulaContext(task(), undefined, "2026-08-28", { bag: { budget: "   " }, cols });
    expect(blank.budget).toBeNull();
  });

  it("still exposes exactly the built-ins when the block has no stored columns", () => {
    const ctx = formulaContext(task(), undefined, "2026-08-28", { bag: { x: "1" }, cols: [] });
    expect(Object.keys(ctx).sort()).toEqual([...FORMULA_FIELD_NAMES].sort());
  });

  it("compiles an expression over a stored column", () => {
    const prog = compile("budget * 1.25", formulaFieldNames(cols));
    expect(prog.ok).toBe(true);
    expect(prog.ok && prog.run(formulaContext(task(), undefined, "2026-08-28",
      { bag: { budget: "100" }, cols }))).toBe(125);
    // And an absent value propagates as null rather than as 0 * 1.25.
    expect(prog.ok && prog.run(formulaContext(task(), undefined, "2026-08-28",
      { bag: {}, cols }))).toBeNull();
  });

  it("names the error when a formula reads a column that has been removed", () => {
    expect(compile("budget * 2", formulaFieldNames([])).ok).toBe(false);
  });
});

describe("columnWidths with stored columns", () => {
  it("shares the same 100% — the table cannot claim more than its width", () => {
    const w = columnWidths(["title", "due"], {}, 2, 3);
    const total = [...w.data, ...w.fields, ...w.formulas, w.actions].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(100, 6);
    expect(w.fields).toHaveLength(3);
  });

  it("narrows the data columns as stored ones are added, rather than overflowing", () => {
    const none = columnWidths(["title", "due"], {}, 0, 0);
    const some = columnWidths(["title", "due"], {}, 0, 2);
    expect(some.data[0]).toBeLessThan(none.data[0]);
  });
});

// ─── Meters ─────────────────────────────────────────────────────────────────
//
// A computed column drawn as a bar or a ring. The rule these all circle is that
// "no value" and "zero" must never look the same.

describe("meterFraction", () => {
  it("scales against an absolute max", () => {
    expect(meterFraction(50, 100)).toBe(0.5);
    expect(meterFraction(4, 8)).toBe(0.5);
  });

  // ⚠️ The one that matters. Returning 0 here would draw an empty bar, which is
  // indistinguishable from 0% — so a task with no estimate would read as "0%
  // done" rather than "not measured". Same rule aggregate follows for nulls.
  it("returns null for a null value, so the cell can draw a dash not an empty bar", () => {
    expect(meterFraction(null, 100)).toBeNull();
    expect(meterFraction(0, 100)).toBe(0); // and a real zero is still a zero
  });

  it("clamps rather than overflowing, because a bar cannot be longer than its track", () => {
    expect(meterFraction(130, 100)).toBe(1);
    expect(meterFraction(-20, 100)).toBe(0);
  });

  // A zero scale is "there is no scale", not "everything is full" — and
  // dividing by it would give Infinity, the same trap the formula language
  // already refuses.
  it("refuses a scale of zero or less instead of dividing by it", () => {
    expect(meterFraction(5, 0)).toBeNull();
    expect(meterFraction(5, -10)).toBeNull();
    expect(Number.isFinite(meterFraction(5, 0) as number)).toBe(false);
  });

  it("reads a boolean as 0 or 1, the same way aggregate does", () => {
    expect(meterFraction(true, 1)).toBe(1);
    expect(meterFraction(false, 1)).toBe(0);
  });

  describe("auto scale", () => {
    it("scales to the largest visible value", () => {
      const col = [10, 40, null, 20];
      expect(meterFraction(40, "auto", col)).toBe(1);
      expect(meterFraction(10, "auto", col)).toBe(0.25);
    });

    // Nulls are skipped, not counted as zero — otherwise the max is right but
    // for the wrong reason, and a column of all-nulls would scale against 0.
    it("falls back to null when the column has nothing to scale against", () => {
      expect(meterFraction(5, "auto", [null, null])).toBeNull();
      expect(meterFraction(5, "auto", [])).toBeNull();
      expect(meterFraction(0, "auto", [0, 0])).toBeNull();
    });
  });
});

describe("meter fields on a formula column", () => {
  const parse = (formulas: unknown) =>
    parseSpec(JSON.stringify({ ...defaultSpec("table"), formulas }), "table").formulas;

  // An old document has neither key. 100 is the only sane default: nearly every
  // such column is a percentage.
  it("defaults an old column to a plain number scaled to 100", () => {
    const [f] = parse([{ id: "a", label: "", expr: "1", agg: "none" }]);
    expect(f.display).toBe("number");
    expect(f.max).toBe(100);
  });

  it("keeps a valid display and scale, and survives a round trip", () => {
    for (const d of METER_DISPLAYS) {
      expect(parse([{ id: "a", label: "", expr: "1", agg: "none", display: d, max: 8 }])[0].display).toBe(d);
    }
    expect(parse([{ id: "a", expr: "1", display: "bar", max: "auto" }])[0].max).toBe("auto");
  });

  it("falls back rather than storing a scale that cannot be divided by", () => {
    expect(parse([{ id: "a", expr: "1", display: "bar", max: 0 }])[0].max).toBe(100);
    expect(parse([{ id: "a", expr: "1", display: "bar", max: -5 }])[0].max).toBe(100);
    expect(parse([{ id: "a", expr: "1", display: "bar", max: "lots" }])[0].max).toBe(100);
    expect(parse([{ id: "a", expr: "1", display: "pie" }])[0].display).toBe("number");
  });
});

// ─── Summary figures ────────────────────────────────────────────────────────

describe("parseStats", () => {
  const parse = (stats: unknown) =>
    parseSpec(JSON.stringify({ ...defaultSpec("table"), stats }), "table").stats;

  it("defaults to none, and an old document has none", () => {
    expect(defaultSpec("table").stats).toEqual([]);
    expect(parseSpec(JSON.stringify({ view: "table" }), "table").stats).toEqual([]);
  });

  // A stat IS an aggregate, so "none" has nothing to mean — a card carrying it
  // would have no figure to show.
  it("never stores `none` as an aggregate", () => {
    expect(STAT_AGGS).not.toContain("none");
    expect(parse([{ id: "a", expr: "1", agg: "none" }])[0].agg).toBe("sum");
    expect(parse([{ id: "a", expr: "1", agg: "median" }])[0].agg).toBe("sum");
  });

  it("shares the meter rules with a computed column", () => {
    expect(parse([{ id: "a", expr: "1", display: "bar", max: 0 }])[0].max).toBe(100);
    expect(parse([{ id: "a", expr: "1", display: "pie" }])[0].display).toBe("number");
    expect(parse([{ id: "a", expr: "1", display: "bar", max: "auto" }])[0].max).toBe("auto");
  });

  it("keeps an invalid expression so it can be fixed, and bounds the count", () => {
    // Same reasoning as parseFormulas: dropping it loses whatever was being
    // written, with no explanation for the disappearance.
    expect(parse([{ id: "a", expr: "estimate +" }])[0].expr).toBe("estimate +");
    expect(parse(Array.from({ length: MAX_STATS + 3 }, (_, i) => ({ id: `s${i}`, expr: "1" }))))
      .toHaveLength(MAX_STATS);
  });

  it("survives a round trip", () => {
    const stats = [{ id: "a", label: "Hours", expr: "estimate / 60", agg: "sum" as const,
                     display: "bar" as const, max: 40 }];
    expect(parseSpec(JSON.stringify({ ...defaultSpec("table"), stats }), "table").stats).toEqual(stats);
  });
});
