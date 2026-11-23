import { describe, it, expect } from "vitest";
import { clampFloatRect, clampWidth, paneWidthFromPointer, parseStoredPos, parseStoredWidth } from "./paneLayout";

describe("clampWidth", () => {
  it("clamps into [min, max] and rounds", () => {
    expect(clampWidth(100, 180, 400)).toBe(180);
    expect(clampWidth(999, 180, 400)).toBe(400);
    expect(clampWidth(250.6, 180, 400)).toBe(251);
  });
  it("NaN falls back to min, never NaN px", () => {
    expect(clampWidth(Number.NaN, 180, 400)).toBe(180);
  });
});

describe("paneWidthFromPointer", () => {
  it("left pane grows as the pointer moves right of its outer (left) edge", () => {
    expect(paneWidthFromPointer("left", 48, 348, 180, 480)).toBe(300);
  });
  it("right pane grows as the pointer moves left of its outer (right) edge", () => {
    expect(paneWidthFromPointer("right", 1400, 1100, 200, 480)).toBe(300);
  });
  it("a pointer past the outer edge clamps to min instead of going negative", () => {
    expect(paneWidthFromPointer("left", 48, 0, 180, 480)).toBe(180);
    expect(paneWidthFromPointer("right", 1400, 1500, 200, 480)).toBe(200);
  });
});

describe("parseStoredWidth", () => {
  it("accepts an in-range number", () => {
    expect(parseStoredWidth("260", 180, 480, 240)).toBe(260);
  });
  it("falls back on missing, corrupt or out-of-range values", () => {
    expect(parseStoredWidth(null, 180, 480, 240)).toBe(240);
    expect(parseStoredWidth("", 180, 480, 240)).toBe(240);
    expect(parseStoredWidth("wide", 180, 480, 240)).toBe(240);
    expect(parseStoredWidth("2000", 180, 480, 240)).toBe(240);
  });
});

describe("clampFloatRect", () => {
  it("leaves an on-screen panel where it is", () => {
    expect(clampFloatRect({ x: 100, y: 100, w: 320, h: 400 }, 1440, 900))
      .toEqual({ x: 100, y: 100, w: 320, h: 400 });
  });
  it("pulls a panel dragged off the right/bottom back inside the margin", () => {
    expect(clampFloatRect({ x: 1400, y: 880, w: 320, h: 400 }, 1440, 900))
      .toEqual({ x: 1112, y: 492, w: 320, h: 400 });
  });
  it("never goes negative — the header must stay reachable", () => {
    const r = clampFloatRect({ x: -500, y: -500, w: 320, h: 400 }, 1440, 900);
    expect(r.x).toBe(8);
    expect(r.y).toBe(8);
  });
  it("shrinks a panel wider than a phone screen instead of overflowing it", () => {
    const r = clampFloatRect({ x: 0, y: 0, w: 420, h: 300 }, 375, 700);
    expect(r.w).toBe(359);
    expect(r.x).toBe(8);
  });
});

describe("parseStoredPos", () => {
  it("parses a stored position", () => {
    expect(parseStoredPos('{"x":10,"y":20}')).toEqual({ x: 10, y: 20 });
  });
  it("is null for absent or corrupt storage", () => {
    expect(parseStoredPos(null)).toBeNull();
    expect(parseStoredPos("{nope")).toBeNull();
    expect(parseStoredPos('{"x":"a","y":2}')).toBeNull();
  });
});
