import { describe, it, expect } from "vitest";
import {
  contains, frameOf, hiddenBlockIds, visibleAnchor, foldedRect, firstLine,
  FOLDED_FRAME_HEIGHT, type BlockLike, type FrameLike,
} from "./canvasFrames";

const frame = (id: string, x: number, y: number, w: number, h: number, folded = false): FrameLike =>
  ({ id, type: "frame", x, y, width: w, height: h, folded });
const block = (id: string, x: number, y: number, w = 20, h = 20): BlockLike =>
  ({ id, type: "text", x, y, width: w, height: h });

describe("contains", () => {
  // Fully contained, not merely overlapping: a block half in and half out is
  // not "in" a frame in any sense a user would agree with, and folding would
  // make half a diagram vanish for a reason nobody could point at.
  it("requires full containment, not overlap", () => {
    const f = frame("f", 0, 0, 100, 100);
    expect(contains(f, block("b", 10, 10))).toBe(true);
    expect(contains(f, block("b", 90, 10))).toBe(false);  // pokes out right
    expect(contains(f, block("b", -1, 10))).toBe(false);  // pokes out left
    expect(contains(f, block("b", 10, 90))).toBe(false);  // pokes out bottom
  });

  it("counts a block flush with the edge as inside", () => {
    const f = frame("f", 0, 0, 100, 100);
    expect(contains(f, block("b", 0, 0))).toBe(true);
    expect(contains(f, block("b", 80, 80))).toBe(true);
  });
});

describe("frameOf", () => {
  // ⚠️ Frames nest — "Sprint 1" inside "Q3". Without a tie-break a block
  // belongs to both, so folding the outer then the inner hides it twice, and
  // unfolding one reveals it while the other still claims to be closed.
  it("gives the innermost frame, so membership is a function", () => {
    const outer = frame("outer", 0, 0, 400, 400);
    const inner = frame("inner", 10, 10, 100, 100);
    expect(frameOf([outer, inner], block("b", 20, 20))?.id).toBe("inner");
    // …and the outer one when only it contains the block.
    expect(frameOf([outer, inner], block("b", 300, 300))?.id).toBe("outer");
  });

  it("never makes a frame contain itself", () => {
    const f = frame("f", 0, 0, 100, 100);
    expect(frameOf([f], f)).toBeNull();
  });

  it("returns null for a block on the open canvas", () => {
    expect(frameOf([frame("f", 0, 0, 50, 50)], block("b", 500, 500))).toBeNull();
  });
});

describe("hiddenBlockIds", () => {
  it("hides nothing while no frame is folded", () => {
    const blocks = [frame("f", 0, 0, 200, 200), block("a", 10, 10)];
    expect(hiddenBlockIds(blocks).size).toBe(0);
  });

  it("hides a folded frame's contents but not the frame itself", () => {
    const blocks = [frame("f", 0, 0, 200, 200, true), block("a", 10, 10), block("b", 500, 500)];
    const hidden = hiddenBlockIds(blocks);
    expect(hidden.has("a")).toBe(true);
    // The frame still renders — as a title bar. Hiding it would make an
    // unfold impossible from the canvas.
    expect(hidden.has("f")).toBe(false);
    // …and a block outside is untouched.
    expect(hidden.has("b")).toBe(false);
  });

  // ⚠️ Without the transitive step, folding an outer frame leaves the inner
  // frames' contents floating on the canvas with nothing around them.
  it("hides transitively through a nested frame", () => {
    const blocks = [
      frame("outer", 0, 0, 400, 400, true),
      frame("inner", 10, 10, 100, 100),          // not folded itself
      block("deep", 20, 20),                     // innermost frame is `inner`
    ];
    const hidden = hiddenBlockIds(blocks);
    expect(hidden.has("inner")).toBe(true);
    expect(hidden.has("deep")).toBe(true);
    expect(hidden.has("outer")).toBe(false);
  });

  it("terminates on two exactly coincident frames", () => {
    // frameOf can be symmetric here, which is the shape that would loop.
    const blocks = [frame("a", 0, 0, 100, 100, true), frame("b", 0, 0, 100, 100, true)];
    expect(() => hiddenBlockIds(blocks)).not.toThrow();
  });

  it("keeps both folded frames visible when one nests the other", () => {
    const blocks = [
      frame("outer", 0, 0, 400, 400, true),
      frame("inner", 10, 10, 100, 100, true),
      block("deep", 20, 20),
    ];
    const hidden = hiddenBlockIds(blocks);
    expect(hidden.has("outer")).toBe(false);
    // The inner frame IS hidden — it is inside a folded frame. Folding both
    // must not resurrect it.
    expect(hidden.has("inner")).toBe(true);
    expect(hidden.has("deep")).toBe(true);
  });
});

describe("visibleAnchor", () => {
  // An arrow that simply vanished would read as "this connection was deleted",
  // which is a worse lie than "it points at the closed group".
  it("re-anchors an arrow to the folded frame the block is inside", () => {
    const blocks = [frame("f", 0, 0, 200, 200, true), block("a", 10, 10)];
    const hidden = hiddenBlockIds(blocks);
    expect(visibleAnchor(blocks, hidden, "a")).toBe("f");
  });

  it("leaves a visible block alone", () => {
    const blocks = [frame("f", 0, 0, 200, 200), block("a", 10, 10)];
    expect(visibleAnchor(blocks, new Set(), "a")).toBe("a");
  });

  it("walks out to the OUTERMOST visible frame through nesting", () => {
    const blocks = [
      frame("outer", 0, 0, 400, 400, true),
      frame("inner", 10, 10, 100, 100, true),
      block("deep", 20, 20),
    ];
    const hidden = hiddenBlockIds(blocks);
    // `inner` is itself hidden, so anchoring there would draw to nothing.
    expect(visibleAnchor(blocks, hidden, "deep")).toBe("outer");
  });

  it("returns null when there is nothing visible to point at", () => {
    const blocks = [block("a", 10, 10)];
    expect(visibleAnchor(blocks, new Set(["a"]), "a")).toBeNull();
  });
});

describe("foldedRect", () => {
  // The stored height is untouched, so unfolding is a flag flip rather than a
  // restore that can get the number wrong.
  it("shortens a folded frame without changing what is stored", () => {
    const f = frame("f", 5, 6, 300, 400, true);
    expect(foldedRect(f)).toEqual({ ...f, height: FOLDED_FRAME_HEIGHT });
    expect(f.height).toBe(400);
  });

  it("leaves an unfolded frame exactly as it is", () => {
    const f = frame("f", 5, 6, 300, 400);
    expect(foldedRect(f)).toEqual(f);
  });
});

describe("firstLine", () => {
  it("takes the first line that has anything on it", () => {
    expect(firstLine("\n\n  Hello  \nworld")).toBe("Hello");
  });

  // "Untitled" asserts a name the block does not have. Saying nothing is
  // honest and lets the caller decide what to show.
  it("returns null rather than inventing a title", () => {
    expect(firstLine("")).toBeNull();
    expect(firstLine("   \n  ")).toBeNull();
    expect(firstLine(undefined)).toBeNull();
  });

  it("truncates with an ellipsis", () => {
    const long = "x".repeat(200);
    const out = firstLine(long, 10)!;
    expect(out).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
  });
});
