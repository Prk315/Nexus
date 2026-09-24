import { describe, it, expect } from "vitest";
import {
  breadcrumb,
  containingFolder,
  descendantSubgraph,
  folderGraph,
  layoutRadial,
  projectIso,
  tagSubgraph,
} from "./subgraph";
import { buildGraph, uniGraph } from "./testGraph";

describe("descendantSubgraph", () => {
  it("is the folder plus everything below it, and nothing beside it", () => {
    const g = uniGraph();
    const sub = descendantSubgraph(g, "Mathematics");
    expect(new Set(sub.nodeIds)).toEqual(
      new Set([
        "Mathematics",
        "Mathematics-c1",
        "Mathematics-c2",
        "Mathematics-c3",
        "Mathematics-c4",
        "Mathematics-c5",
        "Kalkulus (reader)",
      ]),
    );
    // Six edges out of Mathematics, and no edge reaching a hidden node.
    expect(sub.edges).toHaveLength(6);
    expect(sub.edges.every(([a, b]) => sub.nodeIds.includes(a) && sub.nodeIds.includes(b))).toBe(true);
  });

  it("takes the unknown-kind reader node with it", () => {
    expect(descendantSubgraph(uniGraph(), "Mathematics").nodeIds).toContain("Kalkulus (reader)");
  });

  it("never walks upward into the parent's other branches", () => {
    const sub = descendantSubgraph(uniGraph(), "Mathematics");
    expect(sub.nodeIds).not.toContain("UNI");
    expect(sub.nodeIds).not.toContain("Robotics");
  });

  it("is empty for a node that is not there", () => {
    expect(descendantSubgraph(uniGraph(), "nope")).toEqual({ nodeIds: [], edges: [] });
  });

  it("does not hang on a cycle", () => {
    const g = buildGraph([{ id: "A", children: [{ id: "B", children: [{ id: "C" }] }] }]);
    g.edges["C"] = ["A"];
    g.back_edges["A"] = ["C"];
    expect(new Set(descendantSubgraph(g, "A").nodeIds)).toEqual(new Set(["A", "B", "C"]));
  });
});

describe("tagSubgraph", () => {
  it("is exactly the nodes carrying the tag", () => {
    const g = uniGraph();
    const sub = tagSubgraph(g, "robots");
    expect(new Set(sub.nodeIds)).toEqual(
      new Set(["Robotics", "Robotics-c1", "Robotics-c2", "Robotics-c3", "Robotics-c4", "Robotics-c5"]),
    );
    expect(sub.edges).toHaveLength(5);
  });

  it("does not pull in untagged neighbours", () => {
    expect(tagSubgraph(uniGraph(), "robots").nodeIds).not.toContain("UNI");
  });

  it("is empty for an unused tag", () => {
    expect(tagSubgraph(uniGraph(), "nothing-has-this").nodeIds).toEqual([]);
  });
});

describe("folderGraph", () => {
  it("keeps folders and folder→folder edges only", () => {
    const g = uniGraph();
    const sub = folderGraph(g);
    expect(sub.nodeIds).not.toContain("Kalkulus (reader)");
    expect(sub.nodeIds).toHaveLength(25); // UNI + 4 subjects + 20 courses
    expect(sub.edges).toHaveLength(24);
  });

  it("drops a note sitting between two folders rather than bridging through it", () => {
    const g = buildGraph([
      { id: "Root", children: [{ id: "Note", kind: "Note", children: [{ id: "Deep" }] }] },
    ]);
    const sub = folderGraph(g);
    expect(sub.nodeIds.sort()).toEqual(["Deep", "Root"]);
    expect(sub.edges).toEqual([]);
  });
});

describe("layoutRadial", () => {
  it("places every member once, inside the unit cube", () => {
    const g = uniGraph();
    const sub = folderGraph(g);
    const placed = layoutRadial(g, sub);
    expect(placed).toHaveLength(sub.nodeIds.length);
    expect(new Set(placed.map((p) => p.id)).size).toBe(sub.nodeIds.length);
    for (const p of placed) {
      for (const v of [p.x, p.y, p.z]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("puts a lone root in the middle and ranks depth outward", () => {
    const g = uniGraph();
    const placed = layoutRadial(g, folderGraph(g));
    const at = (id: string) => placed.find((p) => p.id === id)!;
    expect(at("UNI")).toMatchObject({ x: 0.5, y: 0.5, z: 0.5, depth: 0 });
    expect(at("Mathematics").depth).toBe(1);
    expect(at("Mathematics-c1").depth).toBe(2);
  });

  it("spreads a ring through z, so the map is a solid and not a disc", () => {
    const g = uniGraph();
    const placed = layoutRadial(g, folderGraph(g));
    const ring = placed.filter((p) => p.depth === 2).map((p) => p.z);
    expect(Math.max(...ring) - Math.min(...ring)).toBeGreaterThan(0.1);
  });

  it("is deterministic — a minimap that reshuffles is not a map", () => {
    const g = uniGraph();
    const sub = folderGraph(g);
    expect(layoutRadial(g, sub)).toEqual(layoutRadial(g, sub));
  });
});

describe("projectIso", () => {
  const box = { width: 100, height: 100, pad: 10 };

  it("keeps every point inside the box, padding included", () => {
    for (const z of [0, 0.5, 1]) {
      for (const x of [0, 0.5, 1]) {
        const p = projectIso({ x, y: x, z }, box);
        expect(p.x).toBeGreaterThanOrEqual(10);
        expect(p.x).toBeLessThanOrEqual(90);
        expect(p.y).toBeGreaterThanOrEqual(10);
        expect(p.y).toBeLessThanOrEqual(90);
      }
    }
  });

  it("pushes a near point further from centre than a far one — the depth cue", () => {
    const near = projectIso({ x: 1, y: 0.5, z: 1 }, box);
    const far = projectIso({ x: 1, y: 0.5, z: 0 }, box);
    expect(near.x).toBeGreaterThan(far.x);
    expect(near.near).toBe(1);
    expect(far.near).toBe(0);
  });

  it("leaves the centre of the map at the centre of the box", () => {
    const p = projectIso({ x: 0.5, y: 0.5, z: 0.5 }, box);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(50);
  });
});

describe("breadcrumb", () => {
  it("runs root-first and ends at the node", () => {
    expect(breadcrumb(uniGraph(), "Mathematics-c3")).toEqual(["UNI", "Mathematics", "Mathematics-c3"]);
  });

  it("does not hang on a cycle", () => {
    const g = buildGraph([{ id: "A", children: [{ id: "B" }] }]);
    g.back_edges["A"] = ["B"];
    expect(breadcrumb(g, "B")).toEqual(["A", "B"]);
  });
});

describe("containingFolder", () => {
  it("is the folder itself for a folder", () => {
    expect(containingFolder(uniGraph(), "Mathematics")).toBe("Mathematics");
  });

  it("is the nearest folder above anything else — the reader node included", () => {
    expect(containingFolder(uniGraph(), "Kalkulus (reader)")).toBe("Mathematics");
  });

  it("is null for nothing selected, and for an orphan", () => {
    const g = buildGraph([{ id: "Loose", kind: "Note" }]);
    expect(containingFolder(g, null)).toBeNull();
    expect(containingFolder(g, "Loose")).toBeNull();
  });
});
