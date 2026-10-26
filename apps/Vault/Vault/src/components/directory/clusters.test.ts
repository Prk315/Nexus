import { describe, it, expect } from "vitest";
import { hitTestClusters, tagClusters } from "./clusters";

const node = (id: string, x: number, y: number, ...tags: string[]) => ({ id, x, y, tags });

describe("tagClusters", () => {
  it("centres on the members and covers the farthest one", () => {
    const nodes = [node("a", 0, 0, "math"), node("b", 10, 0, "math")];
    const [c] = tagClusters(nodes, ["math"]);
    expect(c.x).toBe(5);
    expect(c.y).toBe(0);
    expect(c.count).toBe(2);
    expect(c.r).toBeGreaterThan(5);
  });

  it("skips a tag with too few members rather than drawing a halo round one dot", () => {
    expect(tagClusters([node("a", 0, 0, "math")], ["math"])).toEqual([]);
  });

  it("ignores nodes the simulation has not placed yet", () => {
    // (0,0) for an unplaced node would drag the centroid across the canvas.
    const nodes = [
      node("a", 100, 100, "math"),
      node("b", 110, 100, "math"),
      { id: "c", tags: ["math"] },
    ];
    const [c] = tagClusters(nodes, ["math"]);
    expect(c.count).toBe(2);
    expect(c.x).toBe(105);
  });

  it("gives every requested tag its own circle", () => {
    const nodes = [
      node("a", 0, 0, "math"),
      node("b", 10, 0, "math"),
      node("c", 0, 50, "robots"),
      node("d", 10, 50, "robots"),
    ];
    expect(tagClusters(nodes, ["math", "robots"]).map((c) => c.tag)).toEqual(["math", "robots"]);
  });
});

describe("hitTestClusters", () => {
  const big = { tag: "all", x: 0, y: 0, r: 100, count: 9 };
  const small = { tag: "robots", x: 20, y: 0, r: 20, count: 3 };

  it("finds the circle under the point", () => {
    expect(hitTestClusters([big], { x: 10, y: 10 })).toBe("all");
  });

  it("returns null outside every circle, so a background click stays a background click", () => {
    expect(hitTestClusters([big, small], { x: 500, y: 500 })).toBeNull();
  });

  it("prefers the smaller circle where two overlap", () => {
    expect(hitTestClusters([big, small], { x: 20, y: 0 })).toBe("robots");
  });
});
