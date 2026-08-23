import { describe, expect, it } from "vitest";
import {
  AXIS_LEVELS,
  IMPORTANCE_DOT,
  IMPORTANCE_LABEL,
  URGENCY_FILL,
  URGENCY_LABEL,
  axisCompleteness,
  axisSummary,
  cellAdvice,
  isPlaced,
  normalizeAxis,
} from "./axes";

describe("normalizeAxis", () => {
  it("accepts the three levels", () => {
    expect(normalizeAxis("high")).toBe("high");
    expect(normalizeAxis("medium")).toBe("medium");
    expect(normalizeAxis("low")).toBe("low");
  });

  it("tolerates case and surrounding space", () => {
    expect(normalizeAxis("  High ")).toBe("high");
    expect(normalizeAxis("LOW")).toBe("low");
  });

  it("returns null for anything undetermined — never 'medium'", () => {
    // The single mistake this module exists to prevent. PathFinder's columns
    // are `not null default 'medium'`; mail's are not, and "not determined"
    // must stay distinguishable from "determined to be middling".
    expect(normalizeAxis(null)).toBeNull();
    expect(normalizeAxis(undefined)).toBeNull();
    expect(normalizeAxis("")).toBeNull();
    expect(normalizeAxis("   ")).toBeNull();
    expect(normalizeAxis("critical")).toBeNull();
    expect(normalizeAxis("2")).toBeNull();
  });
});

describe("axis presentation mirrors PathFinder", () => {
  it("covers every level on both axes", () => {
    for (const level of AXIS_LEVELS) {
      expect(IMPORTANCE_LABEL[level]).toBeTruthy();
      expect(URGENCY_LABEL[level]).toBeTruthy();
      expect(IMPORTANCE_DOT[level]).toBeTruthy();
      expect(URGENCY_FILL[level]).toBeGreaterThan(0);
    }
  });

  it("uses PathFinder's per-axis wording, which differs by axis on purpose", () => {
    expect(IMPORTANCE_LABEL.high).toBe("High");
    expect(URGENCY_LABEL.high).toBe("Urgent");
    expect(URGENCY_LABEL.medium).toBe("Soon");
    expect(URGENCY_LABEL.low).toBe("Whenever");
  });

  it("keeps the urgency fill counts PathFinder's meter expects", () => {
    expect(URGENCY_FILL).toEqual({ high: 3, medium: 2, low: 1 });
  });

  it("encodes the two axes in different forms, not two colour ramps", () => {
    // Importance is a colour; urgency is a count. If urgency ever grows a
    // colour map this assertion is the thing that should stop it.
    expect(Object.values(IMPORTANCE_DOT).every((c) => c.startsWith("bg-"))).toBe(true);
    expect(Object.values(URGENCY_FILL).every((n) => typeof n === "number")).toBe(true);
  });
});

describe("cellAdvice", () => {
  it("matches PathFinder's four corners", () => {
    expect(cellAdvice("high", "high")).toBe("Do now");
    expect(cellAdvice("high", "low")).toBe("Schedule");
    expect(cellAdvice("low", "high")).toBe("Do quickly");
    expect(cellAdvice("low", "low")).toBe("Drop or defer");
  });

  it("says nothing for the non-corner cells", () => {
    expect(cellAdvice("medium", "medium")).toBe("");
    expect(cellAdvice("high", "medium")).toBe("");
  });

  it("says nothing when either axis is undetermined", () => {
    // Advice derived from a value the pipeline never produced would be an
    // invention presented to the user as a recommendation.
    expect(cellAdvice(null, "high")).toBe("");
    expect(cellAdvice("high", null)).toBe("");
    expect(cellAdvice(null, null)).toBe("");
  });
});

describe("axisSummary", () => {
  it("reads like PathFinder's tooltip when both axes are set", () => {
    expect(axisSummary("high", "high")).toBe("High importance · Urgent — Do now");
    expect(axisSummary("medium", "medium")).toBe("Medium importance · Soon");
  });

  it("names a missing axis as missing rather than omitting it", () => {
    expect(axisSummary(null, "high")).toBe("Importance not set · Urgent");
    expect(axisSummary("low", null)).toBe("Low importance · urgency not set");
    expect(axisSummary(null, null)).toBe("Importance not set · urgency not set");
  });
});

describe("isPlaced / axisCompleteness", () => {
  it("requires both axes to be on the matrix", () => {
    expect(isPlaced("high", "low")).toBe(true);
    expect(isPlaced("high", null)).toBe(false);
    expect(isPlaced(null, null)).toBe(false);
  });

  it("counts how much of the verdict exists", () => {
    expect(axisCompleteness(null, null)).toBe(0);
    expect(axisCompleteness("high", null)).toBe(1);
    expect(axisCompleteness(null, "low")).toBe(1);
    expect(axisCompleteness("high", "low")).toBe(2);
  });
});
