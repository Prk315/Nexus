import { describe, it, expect } from "vitest";
import { distinctCategories, groupByCategory, normKey, parseChoreInput, parseShoppingInput } from "./quickItems";

describe("parseShoppingInput", () => {
  it("a plain title stays a plain title", () => {
    expect(parseShoppingInput("milk")).toEqual({ title: "milk", quantity: null, store: null });
  });

  it("reads count, x-count, unit and store together", () => {
    expect(parseShoppingInput("2x milk @netto")).toEqual({ title: "milk", quantity: "2", store: "netto" });
    expect(parseShoppingInput("2 milk")).toEqual({ title: "milk", quantity: "2", store: null });
    expect(parseShoppingInput("500g flour")).toEqual({ title: "flour", quantity: "500 g", store: null });
    expect(parseShoppingInput("1,5 l milk @ Rema 1000")).toEqual({ title: "milk", quantity: "1,5 l", store: "Rema 1000" });
  });

  it("reads a trailing x-count", () => {
    expect(parseShoppingInput("eggs x12")).toEqual({ title: "eggs", quantity: "12", store: null });
    expect(parseShoppingInput("eggs ×12 @lidl")).toEqual({ title: "eggs", quantity: "12", store: "lidl" });
  });

  it("does not eat digits that are part of a word", () => {
    expect(parseShoppingInput("7up")).toEqual({ title: "7up", quantity: null, store: null });
    expect(parseShoppingInput("3d glasses").title).toBe("3d glasses");
  });

  it("never produces an empty title", () => {
    expect(parseShoppingInput("@netto")).toEqual({ title: "@netto", quantity: null, store: null });
    expect(parseShoppingInput("  bread  ")).toEqual({ title: "bread", quantity: null, store: null });
  });

  it("splits on the LAST @ only", () => {
    expect(parseShoppingInput("gift for a@b @ føtex").store).toBe("føtex");
  });
});

describe("parseChoreInput", () => {
  it("lifts a #area tag out of the title, anywhere in it", () => {
    expect(parseChoreInput("wipe counters #kitchen")).toEqual({ title: "wipe counters", area: "kitchen" });
    expect(parseChoreInput("#bad clean mirror")).toEqual({ title: "clean mirror", area: "bad" });
    expect(parseChoreInput("vacuum #living-room now")).toEqual({ title: "vacuum now", area: "living-room" });
  });

  it("handles non-ASCII area names", () => {
    expect(parseChoreInput("vask op #køkken").area).toBe("køkken");
  });

  it("a lone tag stays a title rather than a blank chore", () => {
    expect(parseChoreInput("#kitchen")).toEqual({ title: "#kitchen", area: null });
  });

  it("a # inside a word is not a tag", () => {
    expect(parseChoreInput("fix C#-script")).toEqual({ title: "fix C#-script", area: null });
  });
});

describe("groupByCategory", () => {
  const items = [
    { t: "a", s: "Netto" }, { t: "b", s: null }, { t: "c", s: "netto " },
    { t: "d", s: "Aldi" }, { t: "e", s: "" },
  ];

  it("merges case/whitespace variants into one bucket, keeping the first spelling", () => {
    const g = groupByCategory(items, (x) => x.s);
    expect(g.map((x) => x.label)).toEqual(["Aldi", "Netto", null]);
    expect(g[1].items.map((x) => x.t)).toEqual(["a", "c"]);
  });

  it("puts the uncategorised bucket last and treats '' as uncategorised", () => {
    const g = groupByCategory(items, (x) => x.s);
    expect(g[g.length - 1].key).toBeNull();
    expect(g[g.length - 1].items.map((x) => x.t)).toEqual(["b", "e"]);
  });

  it("returns no groups for no items", () => {
    expect(groupByCategory([], () => "x")).toEqual([]);
  });
});

describe("normKey / distinctCategories", () => {
  it("normKey: blank is null, never ''", () => {
    expect(normKey("  ")).toBeNull();
    expect(normKey(undefined)).toBeNull();
    expect(normKey(" Netto ")).toBe("netto");
  });

  it("distinctCategories dedupes case-insensitively and sorts", () => {
    expect(distinctCategories(["netto", "Aldi", "Netto", null, " ", "aldi"])).toEqual(["Aldi", "netto"]);
  });
});
