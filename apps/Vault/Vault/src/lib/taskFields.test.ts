import { describe, it, expect } from "vitest";
import { coerceField, normalizeFieldKey, FIELD_KEY_MAX } from "./taskFields";

describe("normalizeFieldKey", () => {
  // Same rule as tags: a key differing only by case or spacing would be a
  // second column that looks exactly like the first, and the values would
  // silently split between them.
  it("collapses case and spacing", () => {
    expect(normalizeFieldKey("  Budget  ")).toBe("budget");
    expect(normalizeFieldKey("Story Points")).toBe("story_points");
    expect(normalizeFieldKey("story   points")).toBe("story_points");
  });

  it("bounds the length", () => {
    expect(normalizeFieldKey("x".repeat(200))).toHaveLength(FIELD_KEY_MAX);
  });

  it("yields an empty key for empty input, which callers refuse", () => {
    expect(normalizeFieldKey("   ")).toBe("");
  });
});

describe("coerceField", () => {
  // ⚠️ The rule the whole storage layer exists to get right. A task nobody has
  // given a budget HAS NO BUDGET — counting it as 0 drags a sum's average down
  // and makes a checkbox column claim everyone said "no".
  it("reads empty as null for every type, never as zero or false", () => {
    for (const t of ["text", "number", "check"] as const) {
      expect(coerceField("", t), t).toBeNull();
      expect(coerceField("   ", t), t).toBeNull();
      expect(coerceField(undefined, t), t).toBeNull();
    }
  });

  it("reads numbers, and refuses what is not one", () => {
    expect(coerceField("42", "number")).toBe(42);
    expect(coerceField("2.5", "number")).toBe(2.5);
    expect(coerceField("-3", "number")).toBe(-3);
    expect(coerceField("lots", "number")).toBeNull();
    // Infinity would propagate into a column sum and make the footer "∞".
    expect(coerceField("Infinity", "number")).toBeNull();
  });

  it("reads only an explicit marker as checked", () => {
    expect(coerceField("1", "check")).toBe(true);
    expect(coerceField("true", "check")).toBe(true);
    expect(coerceField("yes", "check")).toBe(true);
    // Not null: the row exists, so somebody answered — they answered no.
    expect(coerceField("0", "check")).toBe(false);
    expect(coerceField("false", "check")).toBe(false);
    expect(coerceField("maybe", "check")).toBe(false);
  });

  it("passes text through unchanged", () => {
    expect(coerceField("  a note  ", "text")).toBe("  a note  ");
  });

  // The type is a LENS, not a constraint: the value is stored as text, so
  // changing a column's type and changing it back must lose nothing.
  it("is non-destructive across a type change", () => {
    const stored = "42";
    expect(coerceField(stored, "number")).toBe(42);
    expect(coerceField(stored, "text")).toBe("42");
    expect(coerceField(stored, "check")).toBe(false);
    expect(coerceField(stored, "number")).toBe(42);
  });
});
