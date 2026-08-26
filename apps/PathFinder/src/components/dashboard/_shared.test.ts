import { describe, it, expect } from "vitest";
import { DC_HOUR_PX, dcMinToTime, dcSnapDropStartMin } from "./_shared";

// The day column starts at 05:00 and one hour is DC_HOUR_PX tall.

describe("dcSnapDropStartMin", () => {
  it("maps the column top to 05:00", () => {
    expect(dcSnapDropStartMin(0, 30)).toBe(5 * 60);
  });

  it("snaps to 5-minute slots", () => {
    // 100px into the column at 48px/h = 125 min past 05:00 = 425 raw.
    expect(dcSnapDropStartMin((125 / 60) * DC_HOUR_PX, 30)).toBe(425);
    // 2px shy of that rounds to the same slot.
    expect(dcSnapDropStartMin((123 / 60) * DC_HOUR_PX, 30)).toBe(425);
    // Halfway between slots rounds to the nearest one.
    expect(dcSnapDropStartMin((122 / 60) * DC_HOUR_PX, 30)).toBe(420);
  });

  it("clamps above the grid to 05:00", () => {
    expect(dcSnapDropStartMin(-500, 30)).toBe(5 * 60);
  });

  it("clamps at the bottom so the WHOLE block fits before 24:00", () => {
    expect(dcSnapDropStartMin(1e6, 30)).toBe(24 * 60 - 30);
    expect(dcSnapDropStartMin(1e6, 240)).toBe(24 * 60 - 240);
  });

  it("a long block near the bottom is pulled up, not truncated", () => {
    // Pointer at 23:30, 2h block → starts at 22:00 so it ends at 24:00.
    const relY = ((23.5 - 5) * 60 / 60) * DC_HOUR_PX;
    expect(dcSnapDropStartMin(relY, 120)).toBe(22 * 60);
  });
});

describe("dcMinToTime", () => {
  it("formats minutes as zero-padded HH:MM", () => {
    expect(dcMinToTime(5 * 60)).toBe("05:00");
    expect(dcMinToTime(9 * 60 + 5)).toBe("09:05");
    expect(dcMinToTime(23 * 60 + 55)).toBe("23:55");
  });

  it("renders the grid bottom as 24:00, never wrapping to 00:00", () => {
    expect(dcMinToTime(24 * 60)).toBe("24:00");
  });
});
