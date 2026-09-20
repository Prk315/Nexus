import { describe, expect, it } from "vitest";
import { conceptHtml } from "./ConceptPanel";

describe("conceptHtml", () => {
  it("renders latex through katex", () => {
    const h = conceptHtml("Let $x \\perp y$ hold.");
    expect(h).toContain("katex");
    expect(h).not.toContain("$");
  });
  it("does NOT eat literal numbers in prose", () => {
    // The bug this pins: a spaced-number placeholder collides with real
    // numbers, injecting 'undefined' wherever a statement says '40'.
    const h = conceptHtml("We have 40 items and $k$ classes with 7 left.");
    expect(h).toContain("40 items");
    expect(h).toContain("7 left");
    expect(h).not.toContain("undefined");
  });
  it("escapes HTML in the prose", () => {
    expect(conceptHtml("a <script> b")).toContain("&lt;script&gt;");
  });
  it("italics never fire inside math", () => {
    const h = conceptHtml("norm $\\|x^*\\|$ and *real emphasis*");
    expect(h).toContain("<em>real emphasis</em>");
    expect((h.match(/<em>/g) || []).length).toBe(1);
  });
  it("splits paragraphs on blank lines", () => {
    expect(conceptHtml("one\n\ntwo")).toBe("<p>one</p><p>two</p>");
  });
});
