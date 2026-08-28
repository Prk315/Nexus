import { describe, it, expect } from "vitest";
import { generateJSON } from "@tiptap/core";
import { mdToHtml, inlineMd, escapeHtml } from "./mdToHtml";
import { buildNoteExtensions } from "../extensions/noteExtensions";

const exts = buildNoteExtensions();
/** What the editor will actually make of it — the only thing that matters. */
const asDoc = (md: string) => generateJSON(mdToHtml(md), exts) as any;
const types = (md: string) => asDoc(md).content.map((n: any) => n.type);
const text = (md: string) => JSON.stringify(asDoc(md));

describe("safety", () => {
  // ⚠️ Escaped BEFORE any markup is emitted. Tiptap's parser would drop an
  // unknown tag anyway, but "would be dropped downstream" is not a reason to
  // generate it — this HTML is handed to a DOM parser.
  it("escapes before it emits, so markup in the source stays text", () => {
    expect(mdToHtml("<script>alert(1)</script>")).not.toContain("<script>");
    expect(mdToHtml("<script>x</script>")).toContain("&lt;script&gt;");
    expect(mdToHtml("**<b>bold</b>**")).toContain("&lt;b&gt;");
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("never produces an empty document", () => {
    expect(mdToHtml("")).toBe("<p></p>");
    expect(mdToHtml("\n\n\n")).toBe("<p></p>");
  });
});

describe("blocks", () => {
  it("converts headings at every level", () => {
    for (let n = 1; n <= 6; n++) {
      const doc = asDoc(`${"#".repeat(n)} Title`);
      expect(doc.content[0].type, `h${n}`).toBe("heading");
      // The schema may cap the level; what must not happen is it becoming a
      // paragraph and losing the structure entirely.
      expect(doc.content[0].attrs.level).toBeLessThanOrEqual(n);
    }
    // Not a heading: no space after the hashes.
    expect(types("#nothashtag")).toEqual(["paragraph"]);
  });

  it("converts both list kinds and closes them exactly once", () => {
    expect(types("- a\n- b")).toEqual(["bulletList"]);
    expect(asDoc("- a\n- b").content[0].content).toHaveLength(2);
    expect(types("1. a\n2. b")).toEqual(["orderedList"]);
    // A switch of kind closes the first list rather than nesting them.
    expect(types("- a\n1. b")).toEqual(["bulletList", "orderedList"]);
  });

  it("converts blockquotes and rules", () => {
    expect(types("> quoted")).toEqual(["blockquote"]);
    expect(types("---")).toEqual(["horizontalRule"]);
    expect(types("***")).toEqual(["horizontalRule"]);
    // Three chars minimum — a single dash is a list, not a rule.
    expect(types("- item")).toEqual(["bulletList"]);
  });

  it("separates paragraphs on blank lines", () => {
    expect(types("one\n\ntwo")).toEqual(["paragraph", "paragraph"]);
  });
});

describe("fenced code suppresses every other rule", () => {
  // The reason this is a line walker and not a regex pass: inside a fence,
  // `# x` is code, not a heading.
  it("keeps markdown syntax inside a fence as literal code", () => {
    const doc = asDoc("```\n# not a heading\n- not a list\n**not bold**\n```");
    expect(doc.content[0].type).toBe("codeBlock");
    const code = doc.content[0].content[0].text;
    expect(code).toContain("# not a heading");
    expect(code).toContain("**not bold**");
  });

  it("carries the language", () => {
    expect(mdToHtml("```ts\nconst x = 1\n```")).toContain('class="language-ts"');
  });

  // Reinterpreting it as prose would run the inline rules over code and mangle
  // it; keeping it as code loses nothing.
  it("treats an unterminated fence as code rather than as prose", () => {
    expect(asDoc("```\nx = 1").content[0].type).toBe("codeBlock");
  });
});

describe("inline marks", () => {
  it("applies bold, italic, strike and code", () => {
    expect(text("**b**")).toContain("bold");
    expect(text("__b__")).toContain("bold");
    expect(text("*i*")).toContain("italic");
    expect(text("_i_")).toContain("italic");
    expect(text("~~s~~")).toContain("strike");
    expect(text("`c`")).toContain("code");
  });

  it("does not scan the inside of inline code for emphasis", () => {
    // `a*b*c` in code must stay literal, or every snippet with a star breaks.
    expect(inlineMd("`a*b*c`")).toBe("<code>a*b*c</code>");
  });

  it("leaves arithmetic and snake_case alone", () => {
    // The bug this guards: `a * b * c` in prose silently italicised, and
    // `some_var_name` half-italicised.
    expect(inlineMd("a * b * c")).toBe("a * b * c");
    expect(inlineMd("some_var_name")).toBe("some_var_name");
  });

  it("keeps a link's target, and reads links before emphasis", () => {
    // A URL may legitimately contain underscores.
    const html = inlineMd("[x](https://a.example/a_b_c)");
    expect(html).toContain('href="https://a.example/a_b_c"');
    expect(html).not.toContain("<em>");
  });
});

describe("what it does not cover is still recoverable", () => {
  // The converter is deliberately partial. A construct it does not understand
  // arrives as literal text — and CanvasEditor keeps the original markdown on
  // the block, which is what makes that acceptable rather than lossy.
  it("degrades an unsupported construct to text rather than dropping it", () => {
    const doc = asDoc("- [ ] a task");
    expect(JSON.stringify(doc)).toContain("[ ] a task");
    const table = asDoc("| a | b |\n| - | - |");
    expect(JSON.stringify(table)).toContain("a");
  });
});
