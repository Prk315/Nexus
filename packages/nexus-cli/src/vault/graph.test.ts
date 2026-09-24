import { describe, it, expect } from "vitest";
import { buildGraph, flattenTree, renderTree, resolveNode, roots, searchNodes, tree } from "./graph.ts";

const F = { type: "Folder" };
const N = { type: "Note" };
const node = (id: string, name: string, kind = F, tags: string[] = []) => ({ id, name, kind, tags, team_id: null, user_id: "u" });

const g = buildGraph(
  [
    node("uni", "UNI"),
    node("math", "Mathematics", F, ["math"]),
    node("is", "Information Systems", F, ["information-systems"]),
    node("la", "Linear Algebra"),
    node("n1", "Week 1 notes", N),
    node("orphan", "Orphan note", N),
    node("dup", "Mathematics", N),
  ],
  [
    { from_id: "uni", to_id: "math" },
    { from_id: "uni", to_id: "is" },
    { from_id: "math", to_id: "la" },
    { from_id: "la", to_id: "n1" },
    { from_id: "is", to_id: "n1" }, // second parent
    { from_id: "ghost", to_id: "n1" }, // edge from a node we cannot see
  ],
);

describe("graph", () => {
  it("finds roots as nodes with no incoming edge", () => {
    expect(roots(g).map((n) => n.id)).toEqual(["dup", "orphan", "uni"]);
  });

  it("drops edges whose endpoint is not visible", () => {
    expect(g.parents["n1"]).toEqual(["is", "la"]);
  });

  it("walks the tree to a depth cap, folders first", () => {
    const t = tree(g, "uni", 4, false);
    expect(flattenTree(t).map((r) => `${"  ".repeat(r.depth)}${r.name}`)).toEqual([
      "UNI",
      "  Information Systems",
      "    Week 1 notes",
      "  Mathematics",
      "    Linear Algebra",
      "      Week 1 notes",
    ]);
    expect(flattenTree(tree(g, "uni", 1, false)).map((r) => r.name)).toEqual(["UNI", "Information Systems", "Mathematics"]);
  });

  it("marks a node reached twice as a repeat instead of walking it again", () => {
    const rows = flattenTree(tree(g, "uni", 4, false));
    expect(rows.filter((r) => r.name === "Week 1 notes").map((r) => !!r.repeat)).toEqual([false, true]);
  });

  it("--folders keeps only folders", () => {
    const rows = flattenTree(tree(g, "uni", 4, true));
    expect(rows.every((r) => r.kind === "Folder")).toBe(true);
  });

  it("renders a tree with tags and ids", () => {
    const out = renderTree(tree(g, "math", 4, false), true);
    expect(out.split("\n")).toEqual([
      "Mathematics  math  #math",
      "└─ Linear Algebra  la",
      "   └─ Week 1 notes (Note)  n1",
    ]);
  });

  it("resolves by id, then exact name, and refuses ambiguity", () => {
    expect(resolveNode(g, "uni")).toEqual({ node: g.nodes.uni });
    expect(resolveNode(g, "Information Systems")).toEqual({ node: g.nodes.is });
    expect(resolveNode(g, "information systems")).toEqual({ node: g.nodes.is });
    expect(resolveNode(g, "Mathematics")).toMatchObject({ error: expect.stringContaining("matches 2 nodes") });
    expect(resolveNode(g, "nope")).toMatchObject({ error: expect.stringContaining("no node") });
  });

  it("searches names case-insensitively", () => {
    expect(searchNodes(g, "math").map((n) => n.id)).toEqual(["dup", "math"]);
  });
});
