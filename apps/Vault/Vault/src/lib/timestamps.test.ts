import { describe, it, expect } from "vitest";
import { sameInstant } from "./timestamps";

describe("sameInstant", () => {
  // THE regression. These two strings are what the two sides of Vault's
  // conflict guard actually hold, verified against the live database: the
  // client caches `new Date().toISOString()` after a save, and PostgREST
  // returns the same timestamptz with an explicit offset. String equality says
  // they differ, which made every note claim "changed by the other user" on its
  // second save, alone, forever.
  it("treats PostgREST's +00:00 and JavaScript's Z as the same instant", () => {
    expect(sameInstant("2026-08-27T16:47:41.628+00:00", "2026-08-27T16:47:41.628Z")).toBe(true);
  });

  // The difference that would outlive a naive suffix-normalising fix: Postgres
  // drops trailing zeros in the fractional seconds.
  it("survives Postgres trimming trailing zeros from the fraction", () => {
    expect(sameInstant("2026-08-27T16:47:41.1+00:00", "2026-08-27T16:47:41.100Z")).toBe(true);
    expect(sameInstant("2026-08-27T16:47:41+00:00", "2026-08-27T16:47:41.000Z")).toBe(true);
  });

  it("accepts any offset spelling of one instant", () => {
    expect(sameInstant("2026-08-27T18:47:41.628+02:00", "2026-08-27T16:47:41.628Z")).toBe(true);
  });

  it("still reports a genuinely different instant", () => {
    expect(sameInstant("2026-08-27T16:47:41.628Z", "2026-08-27T16:47:41.629Z")).toBe(false);
    expect(sameInstant("2026-08-27T16:47:41.628Z", "2026-08-27T16:48:41.628Z")).toBe(false);
  });

  // "I could not tell" must never read as "equal" — that would silently
  // disable the guard rather than fall through to the careful path.
  it("is false when either side is missing", () => {
    expect(sameInstant(null, "2026-08-27T16:47:41.628Z")).toBe(false);
    expect(sameInstant("2026-08-27T16:47:41.628Z", undefined)).toBe(false);
    expect(sameInstant("", "2026-08-27T16:47:41.628Z")).toBe(false);
    expect(sameInstant(null, null)).toBe(false);
  });

  it("is false when either side is unparseable", () => {
    expect(sameInstant("not a date", "2026-08-27T16:47:41.628Z")).toBe(false);
    expect(sameInstant("2026-08-27T16:47:41.628Z", "whenever")).toBe(false);
    // Not even two identical unparseable strings count as equal.
    expect(sameInstant("garbage", "garbage")).toBe(false);
  });
});
