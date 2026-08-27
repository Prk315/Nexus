import { describe, it, expect } from "vitest";
import { diffContent, diffLines, formatBytes, noteLines, relativeTime } from "./versionDiff";

const doc = (...content: unknown[]) => JSON.stringify({ type: "doc", content });
const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const heading = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});

describe("noteLines", () => {
  it("returns nothing for empty content", () => {
    expect(noteLines("")).toEqual([]);
  });

  it("flattens paragraphs and marks heading level", () => {
    expect(noteLines(doc(heading(2, "Plan"), para("First"), para("Second")))).toEqual([
      "## Plan",
      "First",
      "Second",
    ]);
  });

  it("drops empty paragraphs — spacing is not content", () => {
    expect(noteLines(doc(para("a"), { type: "paragraph" }, para("b")))).toEqual(["a", "b"]);
  });

  it("clamps a heading level that the schema would not allow", () => {
    // Stored JSON can predate or postdate this build. "#".repeat(-1) throws.
    expect(noteLines(doc({ type: "heading", attrs: { level: -3 }, content: [{ type: "text", text: "x" }] })))
      .toEqual(["# x"]);
    expect(noteLines(doc({ type: "heading", attrs: {}, content: [{ type: "text", text: "y" }] })))
      .toEqual(["# y"]);
  });

  it("marks atom blocks so deleting an image is visible", () => {
    expect(noteLines(doc(para("before"), { type: "image", attrs: { src: "x" } }, para("after"))))
      .toEqual(["before", "⟨image⟩", "after"]);
  });

  it("recurses into containers and bullets list items", () => {
    const lines = noteLines(
      doc({
        type: "bulletList",
        content: [
          { type: "listItem", content: [para("one")] },
          { type: "listItem", content: [para("two")] },
        ],
      })
    );
    expect(lines).toEqual(["• one", "• two"]);
  });

  // Indentation follows LIST nesting, not tree depth — a top-level bullet
  // inside a callout inside a column is still a top-level bullet.
  it("indents by list nesting only", () => {
    const lines = noteLines(
      doc({
        type: "calloutBlock",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  para("outer"),
                  { type: "bulletList", content: [{ type: "listItem", content: [para("inner")] }] },
                ],
              },
            ],
          },
        ],
      })
    );
    expect(lines).toEqual(["• outer", "  • inner"]);
  });

  it("reaches text inside a callout inside a column", () => {
    const lines = noteLines(
      doc({
        type: "columnBlock",
        content: [
          { type: "column", content: [{ type: "calloutBlock", content: [para("nested")] }] },
          { type: "column", content: [para("sibling")] },
        ],
      })
    );
    expect(lines).toEqual(["nested", "sibling"]);
  });

  it("renders inline math as latex rather than dropping it", () => {
    const lines = noteLines(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "let " },
          { type: "inlineMath", attrs: { latex: "x^2" } },
        ],
      })
    );
    expect(lines).toEqual(["let $x^2$"]);
  });

  it("accepts the { doc: … } envelope some writers use", () => {
    expect(noteLines(JSON.stringify({ doc: { type: "doc", content: [para("hi")] } }))).toEqual(["hi"]);
  });

  // A version this build cannot parse is exactly when history matters most.
  it("degrades to stripped text for legacy HTML instead of showing nothing", () => {
    expect(noteLines("<h1>Title</h1><p>Body text</p>")).toEqual(["Title", "Body text"]);
  });

  it("never throws on malformed JSON", () => {
    expect(() => noteLines("{ not json")).not.toThrow();
    expect(noteLines("{ not json").length).toBeGreaterThan(0);
  });
});

describe("diffLines", () => {
  it("marks nothing when the documents match", () => {
    const d = diffLines(["a", "b"], ["a", "b"]);
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.rows.every((r) => r.kind === "same")).toBe(true);
  });

  // Direction is load-bearing for the UI copy: `add` = in the note now,
  // `del` = only in the old version. Restoring undoes the adds.
  it("calls a line only in the current note an add", () => {
    const d = diffLines(["a"], ["a", "b"]);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(0);
    expect(d.rows).toEqual([
      { kind: "same", text: "a" },
      { kind: "add", text: "b" },
    ]);
  });

  it("calls a line only in the old version a del", () => {
    const d = diffLines(["a", "gone"], ["a"]);
    expect(d.removed).toBe(1);
    expect(d.rows[1]).toEqual({ kind: "del", text: "gone" });
  });

  it("keeps the common subsequence rather than rewriting the whole doc", () => {
    const d = diffLines(["one", "two", "three"], ["one", "TWO", "three"]);
    expect(d.rows.filter((r) => r.kind === "same").map((r) => r.text)).toEqual(["one", "three"]);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
  });

  it("handles an empty side", () => {
    expect(diffLines([], ["a", "b"]).added).toBe(2);
    expect(diffLines(["a", "b"], []).removed).toBe(2);
  });

  // Rows must never be silently unmarked-but-actually-different: the panel says
  // "too long to compare" when this flag is set.
  it("flags rather than stalls on a very long document", () => {
    const long = Array.from({ length: 1500 }, (_, i) => `line ${i}`);
    const d = diffLines(long, ["different"]);
    expect(d.truncated).toBe(true);
    expect(d.rows).toHaveLength(1500);
  });
});

describe("diffContent", () => {
  it("compares two whole stored documents", () => {
    const before = doc(heading(1, "Notes"), para("kept"), para("dropped"));
    const after = doc(heading(1, "Notes"), para("kept"), para("brand new"));
    const d = diffContent(before, after);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
  });
});

describe("formatBytes", () => {
  it("scales", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 kB");
    expect(formatBytes(300_000)).toBe("293 kB");
    expect(formatBytes(2_500_000)).toBe("2.4 MB");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-08-27T12:00:00Z");
  it("reads as a person would say it", () => {
    expect(relativeTime("2026-08-27T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-08-27T11:45:00Z", now)).toBe("15 min ago");
    expect(relativeTime("2026-08-27T09:00:00Z", now)).toBe("3 h ago");
    expect(relativeTime("2026-08-26T12:00:00Z", now)).toBe("yesterday");
    expect(relativeTime("2026-08-24T12:00:00Z", now)).toBe("3 days ago");
  });
  it("does not throw on a bad timestamp", () => {
    expect(relativeTime("not-a-date", now)).toBe("unknown");
  });
});
