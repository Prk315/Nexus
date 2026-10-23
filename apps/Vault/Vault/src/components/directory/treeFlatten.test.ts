import { describe, it, expect } from "vitest";
import { draftGuides, flattenTree, guideHighlight, rootNodeIds, subtreeEnd } from "./treeFlatten";
import { buildGraph, uniGraph } from "./testGraph";

const expand = (...ids: string[]) => new Set(ids);

describe("rootNodeIds", () => {
  it("is the nodes with no parent, by name", () => {
    const g = buildGraph([{ id: "Zoo" }, { id: "Attic", children: [{ id: "Box" }] }]);
    expect(rootNodeIds(g)).toEqual(["Attic", "Zoo"]);
  });

  it("puts a node shared WITH me in the same list, not its own section", () => {
    const g = buildGraph([
      { id: "Mine" },
      { id: "Theirs", team_id: "team-1", user_id: "someone-else" },
    ]);
    expect(rootNodeIds(g)).toEqual(["Mine", "Theirs"]);
  });
});

describe("flattenTree", () => {
  it("shows only expanded subtrees", () => {
    const g = uniGraph();
    expect(flattenTree(g, ["UNI"], expand()).map((r) => r.nodeId)).toEqual(["UNI"]);

    const open = flattenTree(g, ["UNI"], expand("UNI")).map((r) => r.nodeId);
    expect(open).toEqual([
      "UNI",
      "Mathematics",
      "Information Systems",
      "Robotics",
      "Quantum Engineering",
    ]);
  });

  it("carries depth without any indentation decision in it", () => {
    const g = uniGraph();
    const rows = flattenTree(g, ["UNI"], expand("UNI", "Mathematics"));
    const maths = rows.find((r) => r.nodeId === "Mathematics")!;
    const course = rows.find((r) => r.nodeId === "Mathematics-c1")!;
    expect(maths.depth).toBe(1);
    expect(course.depth).toBe(2);
    expect(course.ancestorIds).toEqual(["UNI", "Mathematics"]);
    // One guide column per level — that IS the depth cue.
    expect(maths.guides).toHaveLength(1);
    expect(course.guides).toHaveLength(2);
  });

  it("turns the innermost guide into the row, and the last child stops halfway", () => {
    const g = uniGraph();
    const rows = flattenTree(g, ["UNI"], expand("UNI"));
    const maths = rows.find((r) => r.nodeId === "Mathematics")!;
    const last = rows.find((r) => r.nodeId === "Quantum Engineering")!;
    expect(maths.guides[0].kind).toBe("branch");
    expect(maths.isLast).toBe(false);
    expect(last.guides[0].kind).toBe("last");
    expect(last.isLast).toBe(true);
  });

  it("runs a trunk through levels whose ancestor still has siblings, and nothing through those that don't", () => {
    const g = uniGraph();
    const rows = flattenTree(g, ["UNI"], expand("UNI", "Mathematics", "Quantum Engineering"));

    // Mathematics is NOT UNI's last child → its children keep a trunk at depth 1.
    const mathCourse = rows.find((r) => r.nodeId === "Mathematics-c1")!;
    expect(mathCourse.guides.map((x) => x.kind)).toEqual(["trunk", "branch"]);

    // Quantum Engineering IS the last child → no line continues past it.
    const qeCourse = rows.find((r) => r.nodeId === "QE-c1")!;
    expect(qeCourse.guides.map((x) => x.kind)).toEqual(["none", "branch"]);

    // Guides name the ancestor they draw, which is what lets them light up.
    expect(qeCourse.guides.map((x) => x.ancestorId)).toEqual(["UNI", "Quantum Engineering"]);
  });

  it("treats an unknown kind as an ordinary row rather than dropping or throwing", () => {
    const g = uniGraph();
    const rows = flattenTree(g, ["UNI"], expand("UNI", "Mathematics"));
    const reader = rows.find((r) => r.nodeId === "Kalkulus (reader)");
    expect(reader).toBeDefined();
    expect(reader!.depth).toBe(2);
    // It is the last child of Mathematics, after the five courses.
    expect(reader!.isLast).toBe(true);
  });

  it("marks shared nodes in place, and tells shared-by-me from shared-with-me", () => {
    const g = buildGraph([
      { id: "Mine" },
      { id: "SharedByMe", team_id: "t" },
      { id: "SharedWithMe", team_id: "t", user_id: "other" },
    ]);
    const rows = flattenTree(g, rootNodeIds(g), expand(), { currentUserId: "27eaf403-c5b4-43d5-aef4-01f37a08e590" });
    const by = (id: string) => rows.find((r) => r.nodeId === id)!;
    expect([by("Mine").shared, by("Mine").foreign]).toEqual([false, false]);
    expect([by("SharedByMe").shared, by("SharedByMe").foreign]).toEqual([true, false]);
    expect([by("SharedWithMe").shared, by("SharedWithMe").foreign]).toEqual([true, true]);
  });

  it("gives a node with two parents two rows with distinct keys", () => {
    const g = buildGraph([
      { id: "A", children: [{ id: "Shared" }] },
      { id: "B", children: [{ id: "Shared" }] },
    ]);
    const rows = flattenTree(g, ["A", "B"], expand("A", "B"));
    const keys = rows.filter((r) => r.nodeId === "Shared").map((r) => r.key);
    expect(keys).toEqual(["A/Shared", "B/Shared"]);
  });

  it("does not hang on a cycle", () => {
    const g = buildGraph([{ id: "A", children: [{ id: "B" }] }]);
    g.edges["B"] = ["A"];
    g.back_edges["A"] = ["B"];
    const rows = flattenTree(g, ["A"], expand("A", "B"));
    expect(rows.map((r) => r.nodeId)).toEqual(["A", "B"]);
  });
});

describe("subtreeEnd", () => {
  it("skips past every descendant, so a new child lands after them", () => {
    const g = uniGraph();
    const rows = flattenTree(g, ["UNI"], expand("UNI", "Mathematics"));
    const mathsAt = rows.findIndex((r) => r.nodeId === "Mathematics");
    // Mathematics has five courses and the reader node under it.
    expect(subtreeEnd(rows, mathsAt)).toBe(mathsAt + 7);
    expect(rows[subtreeEnd(rows, mathsAt)].nodeId).toBe("Information Systems");
  });

  it("is the next row for a leaf, and the end of the list for the last row", () => {
    const g = uniGraph();
    const rows = flattenTree(g, ["UNI"], expand("UNI"));
    expect(subtreeEnd(rows, 1)).toBe(2);
    expect(subtreeEnd(rows, rows.length - 1)).toBe(rows.length);
    expect(subtreeEnd(rows, -1)).toBe(rows.length);
  });
});

describe("draftGuides", () => {
  it("has no guides at the root — a new root node is not inside anything", () => {
    expect(draftGuides(null)).toEqual([]);
  });

  it("turns the parent's connector into a through-line and gives the draft an elbow", () => {
    const g = uniGraph();
    const rows = flattenTree(g, ["UNI"], expand("UNI"));
    const maths = rows.find((r) => r.nodeId === "Mathematics")!; // not the last child
    const qe = rows.find((r) => r.nodeId === "Quantum Engineering")!; // the last child

    expect(draftGuides(maths).map((x) => x.kind)).toEqual(["trunk", "last"]);
    expect(draftGuides(qe).map((x) => x.kind)).toEqual(["none", "last"]);
    // The draft is one level deeper than the folder it is going into.
    expect(draftGuides(maths)).toHaveLength(maths.depth + 1);
  });
});

describe("guideHighlight", () => {
  it("lights the path from the root down to the active row, and no further", () => {
    const g = uniGraph();
    const rows = flattenTree(g, ["UNI"], expand("UNI", "Mathematics"));
    const active = rows.find((r) => r.nodeId === "Mathematics-c2")!;
    const lit = guideHighlight(rows, active.key);

    const indexOf = (id: string) => rows.findIndex((r) => r.nodeId === id);

    // The active row's own connector, and its trunk back to UNI.
    expect(lit.has(`${indexOf("Mathematics-c2")}:0`)).toBe(true);
    expect(lit.has(`${indexOf("Mathematics-c2")}:1`)).toBe(true);
    // The row in between keeps the line running.
    expect(lit.has(`${indexOf("Mathematics-c1")}:1`)).toBe(true);
    // Below the active row the line stops.
    expect(lit.has(`${indexOf("Mathematics-c3")}:1`)).toBe(false);
    // A sibling branch is untouched.
    expect(lit.has(`${indexOf("Mathematics")}:0`)).toBe(true);
    expect(lit.has(`${indexOf("Robotics")}:0`)).toBe(false);
  });

  it("is empty when nothing is active, or the active row is gone", () => {
    const g = uniGraph();
    const rows = flattenTree(g, ["UNI"], expand("UNI"));
    expect(guideHighlight(rows, null).size).toBe(0);
    expect(guideHighlight(rows, "UNI/Nonexistent").size).toBe(0);
  });
});
