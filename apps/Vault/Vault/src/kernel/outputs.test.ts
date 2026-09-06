import { describe, it, expect } from "vitest";
import { CELL_OUTPUT_MAX_CHARS, capOutputs, outputsSize } from "./outputs";
import type { OutputChunk } from "./types";

const text = (n: number, ch = "x"): OutputChunk => ({ type: "text", content: ch.repeat(n) });
const image = (n: number): OutputChunk => ({ type: "image", content: "A".repeat(n) });

describe("capOutputs", () => {
  it("leaves small output untouched", () => {
    const chunks = [text(10), image(100)];
    expect(capOutputs(chunks)).toEqual(chunks);
  });

  it("keeps the result inside the budget", () => {
    const huge = [image(200_000), image(200_000), image(200_000)];
    expect(outputsSize(huge)).toBeGreaterThan(CELL_OUTPUT_MAX_CHARS);
    const capped = capOutputs(huge);
    // The explanatory note is added after the budget is spent, so allow a
    // little slack for it rather than asserting a number that would break the
    // moment the wording changes.
    expect(outputsSize(capped)).toBeLessThan(CELL_OUTPUT_MAX_CHARS + 500);
  });

  // The reason this module exists at all. A note is refused above 2 MB by
  // saveContent, one note holds many cells, and on a shared note every byte
  // also enters a CRDT whose state never shrinks. A `for` loop that plots per
  // iteration must not be able to make a note unsaveable.
  it("bounds a cell that emits plot after plot", () => {
    const runaway = Array.from({ length: 50 }, () => image(120_000));
    expect(outputsSize(capOutputs(runaway))).toBeLessThan(CELL_OUTPUT_MAX_CHARS + 500);
  });

  it("says what it dropped rather than silently shortening", () => {
    const capped = capOutputs([image(200_000), image(200_000)]);
    const last = capped[capped.length - 1];
    expect(last.type).toBe("text");
    expect(last.content).toMatch(/dropped/i);
  });

  // A half-written base64 string is not a smaller picture, it is a broken one —
  // it would render as a silently missing image instead of an explanation.
  it("drops an oversized image whole, never truncating it", () => {
    const capped = capOutputs([text(100), image(500_000)]);
    const images = capped.filter((c) => c.type === "image");
    expect(images).toHaveLength(0);
    expect(capped[0]).toEqual(text(100));
  });

  it("truncates long text in the MIDDLE so a traceback keeps its last line", () => {
    const body = "start" + "\n".repeat(60_000) + "SyntaxError: the actual message";
    const [chunk] = capOutputs([{ type: "error", content: body }]);
    expect(chunk.content.startsWith("start")).toBe(true);
    expect(chunk.content).toContain("SyntaxError: the actual message");
    expect(chunk.content).toContain("omitted");
    expect(chunk.content.length).toBeLessThan(body.length);
  });

  it("still shows an error when the cell also produced too much output", () => {
    const capped = capOutputs([image(300_000), { type: "error", content: "boom" }]);
    expect(capped.some((c) => c.content.includes("boom"))).toBe(true);
  });

  it("normalises one oversized chunk even when the total already fits", () => {
    const [chunk] = capOutputs([text(50_000)]);
    expect(chunk.content.length).toBeLessThan(50_000);
  });

  it("handles no output at all", () => {
    expect(capOutputs([])).toEqual([]);
    expect(outputsSize([])).toBe(0);
  });
});
