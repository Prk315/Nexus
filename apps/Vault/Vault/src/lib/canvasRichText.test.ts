import { describe, it, expect } from "vitest";
import { editorContent, isConverted, afterEdit, projectText } from "./canvasRichText";

const richDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("editorContent", () => {
  it("prefers the converted document once there is one", () => {
    const r = richDoc("new");
    expect(editorContent({ content: "old markdown", rich: r })).toBe(r);
  });

  // Plain markdown through an HTML parser is literal asterisks, so an
  // unconverted block is run through the markdown converter first.
  it("converts markdown for a block that has never been converted", () => {
    const html = editorContent({ content: "# Title\n\n- a" });
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<ul>");
  });

  it("gives an empty block nothing rather than an empty paragraph string", () => {
    expect(editorContent({ content: "" })).toBe("");
    expect(editorContent({ content: "   " })).toBe("");
  });
});

describe("afterEdit", () => {
  // ⚠️ The rule the whole design turns on. `content` must stay a readable
  // STRING, because an older build renders it in a textarea and saves it back —
  // raw ProseMirror JSON there is not "shows oddly", it is data loss on the
  // next save.
  it("leaves content a plain-text projection, never JSON", () => {
    const next = afterEdit({ content: "old" }, richDoc("hello world"));
    expect(next.content).toBe("hello world");
    expect(next.content).not.toContain("{");
    expect(next.content).not.toContain('"type"');
  });

  it("keeps the original markdown on first conversion", () => {
    const next = afterEdit({ content: "# original" }, richDoc("edited"));
    expect(next.md).toBe("# original");
  });

  // ⚠️ Overwriting `md` on the second edit defeats the point: its value is that
  // it predates the conversion. One more keystroke would replace it with a
  // projection of the converted document.
  it("never overwrites the original markdown afterwards", () => {
    const first = afterEdit({ content: "# original" }, richDoc("a"));
    const second = afterEdit({ ...first, content: first.content! } as never, richDoc("b"));
    expect(second.md).toBe("# original");
    const third = afterEdit({ ...second, content: second.content! } as never, richDoc("c"));
    expect(third.md).toBe("# original");
  });

  it("records no original for a block that was empty to begin with", () => {
    // "" would be indistinguishable from "converted from an empty block", and
    // storing it is a field per block for no information.
    expect(afterEdit({ content: "" }, richDoc("typed")).md).toBeUndefined();
  });

  it("marks the block converted", () => {
    expect(isConverted({ content: "x" })).toBe(false);
    expect(isConverted({ content: "x", rich: "" })).toBe(false);
    expect(isConverted(afterEdit({ content: "x" }, richDoc("y")) as never)).toBe(true);
  });
});

describe("projectText", () => {
  it("flattens a document to lines", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", content: [{ type: "text", text: "body" }] },
      ],
    });
    expect(projectText(doc).split("\n").join(" ")).toContain("Title");
    expect(projectText(doc)).toContain("body");
  });

  // A projection must never cost the edit that produced it.
  it("returns empty rather than throwing on anything unparseable", () => {
    for (const bad of ["", "not json", "{", "null", "[1,2]"]) {
      expect(() => projectText(bad), bad).not.toThrow();
    }
  });
});
