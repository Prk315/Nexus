import { describe, it, expect } from "vitest";
import {
  widthPct, clampHeight, spacingStep, spacingPx, cornerDrag,
  readWidthPct, readHeightPx, readSpacing,
  MIN_WIDTH_PCT, MAX_WIDTH_PCT, MIN_HEIGHT_PX, MAX_HEIGHT_PX,
  SPACING_UNIT, SPACING_STEPS,
} from "./blockSize";

describe("width is a percentage of the container", () => {
  // ⚠️ A note opens at 720px on a laptop, full-bleed on a wide screen, and
  // again on an iPad. A stored pixel width is wrong the moment the column
  // changes — same reason metaPct is a percentage and column widths are
  // weights.
  it("converts pixels to whole percent", () => {
    expect(widthPct(360, 720)).toBe(50);
    expect(widthPct(720, 720)).toBe(100);
    expect(widthPct(180, 720)).toBe(25);
  });

  it("rounds, so a document never stores 43.7184%", () => {
    expect(Number.isInteger(widthPct(317, 720))).toBe(true);
  });

  it("clamps rather than letting a drag produce a block nobody can grab", () => {
    expect(widthPct(-500, 720)).toBe(MIN_WIDTH_PCT);
    expect(widthPct(5000, 720)).toBe(MAX_WIDTH_PCT);
  });

  // A zero-width container happens during layout, before measurement.
  it("survives a container of zero width", () => {
    expect(widthPct(100, 0)).toBe(MAX_WIDTH_PCT);
    expect(widthPct(100, -1)).toBe(MAX_WIDTH_PCT);
  });
});

describe("height is pixels, and that asymmetry is deliberate", () => {
  // A 300px sketch is 300px wherever it opens; expressing it as a percentage
  // would make a drawing's aspect ratio depend on the window.
  it("clamps to a usable range", () => {
    expect(clampHeight(300)).toBe(300);
    expect(clampHeight(1)).toBe(MIN_HEIGHT_PX);
    expect(clampHeight(99_999)).toBe(MAX_HEIGHT_PX);
    expect(clampHeight(-5)).toBe(MIN_HEIGHT_PX);
  });
});

describe("spacing is a step, not a free pixel value", () => {
  // A free padding lets you reach 0 and 400 by twitching, and both are broken
  // states. A short scale keeps every block in a note the same family.
  it("maps a distance to a bounded step", () => {
    expect(spacingStep(0)).toBe(0);
    expect(spacingStep(SPACING_UNIT)).toBe(1);
    expect(spacingStep(SPACING_UNIT * 4)).toBe(4);
    expect(spacingStep(SPACING_UNIT * 999)).toBe(SPACING_STEPS[SPACING_STEPS.length - 1]);
    expect(spacingStep(-50)).toBe(0);
  });

  // ⚠️ Nearest, not truncated: truncating means the first SPACING_UNIT pixels
  // of every drag do nothing, which reads as the handle being stuck and then
  // jumping.
  it("rounds to the nearest step so a drag starts responding immediately", () => {
    expect(spacingStep(SPACING_UNIT * 0.6)).toBe(1);
    expect(spacingStep(SPACING_UNIT * 1.6)).toBe(2);
  });

  it("round-trips a step through pixels", () => {
    for (const s of SPACING_STEPS) expect(spacingStep(spacingPx(s))).toBe(s);
  });

  it("clamps a step from outside the scale", () => {
    expect(spacingPx(99)).toBe(SPACING_UNIT * (SPACING_STEPS.length - 1));
    expect(spacingPx(-3)).toBe(0);
  });
});

describe("reading a stored attribute", () => {
  // ⚠️ Absent stays absent. Writing a default on read would mean simply
  // OPENING a note rewrote every block that had never been sized — and an
  // autosave follows, so it would persist. Same rule as the aggregates.
  it("returns null for absent rather than a default", () => {
    for (const v of [undefined, null, "", "wide", {}, NaN, Infinity]) {
      expect(readWidthPct(v), String(v)).toBeNull();
      expect(readHeightPx(v), String(v)).toBeNull();
      expect(readSpacing(v), String(v)).toBeNull();
    }
  });

  it("accepts the string form an HTML attribute round-trips as", () => {
    expect(readWidthPct("50")).toBe(50);
    expect(readHeightPx("300")).toBe(300);
    expect(readSpacing("2")).toBe(2);
  });

  it("clamps a stored value that is out of range", () => {
    expect(readWidthPct(500)).toBe(MAX_WIDTH_PCT);
    expect(readWidthPct(1)).toBe(MIN_WIDTH_PCT);
    expect(readHeightPx(99_999)).toBe(MAX_HEIGHT_PX);
    expect(readSpacing(99)).toBe(SPACING_STEPS[SPACING_STEPS.length - 1]);
  });
});

describe("cornerDrag", () => {
  const origin = {
    startX: 100, startY: 100,
    startWidthPx: 360, startHeightPx: 300,
    containerPx: 720,
  };

  it("follows both axes at once, which is what a corner means", () => {
    const r = cornerDrag(origin, 280, 200);   // +180px wide, +100px tall
    expect(r.widthPct).toBe(75);
    expect(r.heightPx).toBe(400);
  });

  it("shrinks as well as grows", () => {
    const r = cornerDrag(origin, 20, 40);
    expect(r.widthPct).toBe(39);
    expect(r.heightPx).toBe(240);
  });

  it("clamps both axes", () => {
    const huge = cornerDrag(origin, 9999, 9999);
    expect(huge.widthPct).toBe(MAX_WIDTH_PCT);
    expect(huge.heightPx).toBe(MAX_HEIGHT_PX);
    const tiny = cornerDrag(origin, -9999, -9999);
    expect(tiny.widthPct).toBe(MIN_WIDTH_PCT);
    expect(tiny.heightPx).toBe(MIN_HEIGHT_PX);
  });

  // ⚠️ With the aspect locked, height comes from the WIDTH ratio and the
  // vertical movement is ignored entirely. Averaging the axes, or taking
  // whichever moved more, both feel like the handle is disobeying — the user
  // is aiming a single pointer at a corner whose left edge is fixed.
  describe("with the aspect locked", () => {
    it("scales height from the width ratio", () => {
      // 360px → 540px is ×1.5, so 300px → 450px.
      const r = cornerDrag(origin, 280, 100, true);
      expect(r.widthPct).toBe(75);
      expect(r.heightPx).toBe(450);
    });

    it("ignores the vertical movement completely", () => {
      const a = cornerDrag(origin, 280, 100, true);
      const b = cornerDrag(origin, 280, 9999, true);
      const c = cornerDrag(origin, 280, -9999, true);
      expect(b).toEqual(a);
      expect(c).toEqual(a);
    });

    it("does not divide by zero on a zero-width start", () => {
      const r = cornerDrag({ ...origin, startWidthPx: 0 }, 280, 200, true);
      expect(Number.isFinite(r.heightPx)).toBe(true);
      expect(Number.isFinite(r.widthPct)).toBe(true);
    });
  });
});
