import { describe, it, expect } from "vitest";
import {
  EXTERNAL_DRAG_DEFAULT_DURATION_MIN, EXTERNAL_DRAG_MAX_DURATION_MIN, EXTERNAL_DRAG_MIN_DURATION_MIN,
  HOUR_PX, HOUR_PX_MAX, HOUR_PX_MIN, clampHourPx, externalDragDurationMin, makePxToTime, minutesToPx,
  pxToMinutes, pxToTime, snapMinutes, zoomHourPx,
} from "./_shared";

describe("clampHourPx", () => {
  it("passes values already inside the range through unchanged", () => {
    expect(clampHourPx(56)).toBe(56);
    expect(clampHourPx(HOUR_PX_MIN)).toBe(HOUR_PX_MIN);
    expect(clampHourPx(HOUR_PX_MAX)).toBe(HOUR_PX_MAX);
  });

  it("clamps below the floor and above the ceiling", () => {
    expect(clampHourPx(1)).toBe(HOUR_PX_MIN);
    expect(clampHourPx(0)).toBe(HOUR_PX_MIN);
    expect(clampHourPx(-40)).toBe(HOUR_PX_MIN);
    expect(clampHourPx(9999)).toBe(HOUR_PX_MAX);
  });

  it("falls back to the default for a non-finite value — a corrupt or cleared localStorage read", () => {
    expect(clampHourPx(NaN)).toBe(HOUR_PX);
    expect(clampHourPx(Infinity)).toBe(HOUR_PX);
    expect(clampHourPx(-Infinity)).toBe(HOUR_PX);
  });
});

describe("zoomHourPx", () => {
  it("zooms in on a negative deltaY (wheel up / pinch out) and out on positive", () => {
    expect(zoomHourPx(56, -100)).toBeGreaterThan(56);
    expect(zoomHourPx(56, 100)).toBeLessThan(56);
  });

  it("is a no-op for a zero delta", () => {
    expect(zoomHourPx(56, 0)).toBe(56);
  });

  it("never leaves the clamped range no matter how large the delta", () => {
    expect(zoomHourPx(56, -100000)).toBe(HOUR_PX_MAX);
    expect(zoomHourPx(56, 100000)).toBe(HOUR_PX_MIN);
  });

  it("repeated zoom-in steps from the floor climb monotonically toward the ceiling", () => {
    let px = HOUR_PX_MIN;
    for (let i = 0; i < 50; i++) {
      const next = zoomHourPx(px, -50);
      expect(next).toBeGreaterThanOrEqual(px);
      px = next;
    }
    expect(px).toBeLessThanOrEqual(HOUR_PX_MAX);
  });
});

describe("snapMinutes", () => {
  it("rounds to the nearest 5 minutes by default", () => {
    expect(snapMinutes(602)).toBe(600);
    expect(snapMinutes(603)).toBe(605);
    expect(snapMinutes(600)).toBe(600);
  });

  it("supports a custom step (30-minute click-to-create uses this shape)", () => {
    expect(snapMinutes(614, 30)).toBe(600);
    expect(snapMinutes(616, 30)).toBe(630);
  });

  it("is unclamped — negative or past-grid-end values snap but aren't bounded", () => {
    expect(snapMinutes(-3)).toBe(-5);
    expect(snapMinutes(1442)).toBe(1440);
  });
});

describe("pxToMinutes / minutesToPx — inverse at any zoom scale", () => {
  it.each([28, 56, 100, 160])("round-trips at hourPx=%i", (hourPx) => {
    for (const min of [0, 90, 300, 600, 1000, 1439]) {
      const px = minutesToPx(min, hourPx);
      expect(pxToMinutes(px, hourPx)).toBeCloseTo(min, 6);
    }
  });

  it("defaults to the unzoomed HOUR_PX scale when no scale is passed", () => {
    expect(minutesToPx(60)).toBe(minutesToPx(60, HOUR_PX));
    expect(pxToMinutes(56)).toBeCloseTo(pxToMinutes(56, HOUR_PX), 6);
  });

  it("scales linearly with hourPx — doubling the scale doubles the pixel offset", () => {
    expect(minutesToPx(120, 112)).toBeCloseTo(minutesToPx(120, 56) * 2, 6);
  });
});

describe("pxToTime — hourPx-parameterized", () => {
  it("matches the default-scale result when hourPx is omitted", () => {
    expect(pxToTime(140, 1400)).toBe(pxToTime(140, 1400, HOUR_PX));
  });

  it("resolves the same clock time regardless of zoom, given the equivalent pixel offset", () => {
    // 10:00 is 600 minutes in; at hourPx=112 that's twice the pixel offset of hourPx=56.
    const containerAt56 = 24 * 56;
    const containerAt112 = 24 * 112;
    expect(pxToTime(minutesToPx(600, 56), containerAt56, 56)).toBe("10:00");
    expect(pxToTime(minutesToPx(600, 112), containerAt112, 112)).toBe("10:00");
  });

  it("still clamps to the grid's last selectable half-hour slot (23:30) at any scale", () => {
    expect(pxToTime(999999, 24 * 160, 160)).toBe("23:30");
  });
});

describe("makePxToTime — bound factory", () => {
  it("produces identical results to calling pxToTime directly with the same scale", () => {
    const bound = makePxToTime(80);
    for (const px of [0, 55, 320, 1500]) {
      expect(bound(px, 24 * 80)).toBe(pxToTime(px, 24 * 80, 80));
    }
  });

  it("two factories bound to different scales diverge on the same pixel offset", () => {
    const at56 = makePxToTime(56);
    const at160 = makePxToTime(160);
    // The same raw pixel offset lands at a much earlier clock time on the
    // zoomed-in (larger hourPx) scale.
    expect(at56(300, 24 * 56)).not.toBe(at160(300, 24 * 160));
  });
});

describe("externalDragDurationMin — U3 Part A's drag-to-schedule duration heuristic", () => {
  it("prefers unscheduled minutes when there's any", () => {
    expect(externalDragDurationMin(45, 90)).toBe(45);
  });

  it("falls back to the time estimate once nothing is left unscheduled", () => {
    expect(externalDragDurationMin(0, 90)).toBe(90);
  });

  it("falls back to the flat default when both are empty", () => {
    expect(externalDragDurationMin(0, null)).toBe(EXTERNAL_DRAG_DEFAULT_DURATION_MIN);
    expect(externalDragDurationMin(0, 0)).toBe(EXTERNAL_DRAG_DEFAULT_DURATION_MIN);
  });

  it("clamps a short result up to the floor", () => {
    expect(externalDragDurationMin(5, null)).toBe(EXTERNAL_DRAG_MIN_DURATION_MIN);
  });

  it("clamps a long result down to the ceiling", () => {
    expect(externalDragDurationMin(600, null)).toBe(EXTERNAL_DRAG_MAX_DURATION_MIN);
    expect(externalDragDurationMin(0, 500)).toBe(EXTERNAL_DRAG_MAX_DURATION_MIN);
  });

  it("passes an in-range value through unchanged", () => {
    expect(externalDragDurationMin(60, null)).toBe(60);
  });
});
