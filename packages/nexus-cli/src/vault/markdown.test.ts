import { describe, it, expect } from "vitest";
import { fromMarkdown, toMarkdown, escapeText } from "./markdown.ts";
import { auditWritable, envelope, parseNoteContent, type JsonNode } from "./content.ts";

const doc = (...content: JsonNode[]): JsonNode => ({ type: "doc", content });
const para = (...content: JsonNode[]): JsonNode => (content.length ? { type: "paragraph", content } : { type: "paragraph" });
const t = (text: string, ...marks: Array<{ type: string; attrs?: Record<string, unknown> }>): JsonNode =>
  marks.length ? { type: "text", text, marks } : { type: "text", text };

/** Markdown → JSON → Markdown must be a fixed point for every supported construct. */
function mdRoundTrip(md: string): string {
  const { doc, warnings } = fromMarkdown(md);
  expect(warnings).toEqual([]);
  return toMarkdown(doc);
}

/** JSON → Markdown → JSON must give back the same document. */
function jsonRoundTrip(d: JsonNode): JsonNode {
  const { doc, warnings } = fromMarkdown(toMarkdown(d));
  expect(warnings).toEqual([]);
  return doc;
}

describe("Markdown → JSON → Markdown", () => {
  const cases: Array<[string, string]> = [
    ["paragraph", "Hello world\n"],
    ["two paragraphs", "One\n\nTwo\n"],
    ["heading 1", "# Title\n"],
    ["heading 4", "#### Deep\n"],
    ["bullet list", "- a\n- b\n- c\n"],
    ["ordered list", "1. one\n2. two\n"],
    ["ordered list with start", "3. three\n4. four\n"],
    ["nested list", "- a\n  - a1\n  - a2\n- b\n"],
    ["nested ordered in bullet", "- a\n  1. x\n  2. y\n"],
    ["list item with two paragraphs", "- first\n\n  second\n- next\n"],
    ["code block with language", "```ts\nconst x = 1;\n```\n"],
    ["code block without language", "```\nplain\n```\n"],
    ["code block with backticks inside", "````\n```\ninner\n```\n````\n"],
    ["bold", "**bold**\n"],
    ["italic", "_it_\n"],
    ["bold italic", "**_both_**\n"],
    ["inline code", "`code`\n"],
    ["link", "[text](https://example.com/a?b=1)\n"],
    ["bold link", "[**bold**](https://example.com)\n"],
    ["hard break", "line one\\\nline two\n"],
    ["mixed inline", "plain **bold** and _it_ and `code` and [l](https://x.y)\n"],
    ["everything", "# H\n\nPara **b** _i_.\n\n- one\n- two\n  - nested\n\n1. x\n\n```py\nprint(1)\n```\n"],
  ];
  for (const [name, md] of cases) {
    it(`is a fixed point for ${name}`, () => {
      expect(mdRoundTrip(md)).toBe(md);
    });
  }

  it("escapes characters that would otherwise be read as markup", () => {
    const inputs = [
      "not \\*emphasis\\*",
      "\\# not a heading",
      "\\- not a list",
      "1\\. not a list",
      "a \\_ b \\_ c",
      "snake_case stays",
      "\\`not code\\`",
      "\\[not\\](a link)",
      "\\> not a quote",
    ];
    for (const md of inputs) {
      expect(mdRoundTrip(md + "\n")).toBe(md + "\n");
    }
  });
});

describe("JSON → Markdown → JSON", () => {
  const cases: Array<[string, JsonNode]> = [
    ["paragraph", doc(para(t("hello world")))],
    ["empty paragraph is preserved as an empty doc", doc(para())],
    ["heading", doc({ type: "heading", attrs: { level: 2 }, content: [t("Title")] })],
    [
      "bullet list",
      doc({
        type: "bulletList",
        content: [
          { type: "listItem", content: [para(t("a"))] },
          { type: "listItem", content: [para(t("b"))] },
        ],
      }),
    ],
    [
      "ordered list",
      doc({ type: "orderedList", content: [{ type: "listItem", content: [para(t("one"))] }] }),
    ],
    [
      "nested list",
      doc({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              para(t("a")),
              { type: "bulletList", content: [{ type: "listItem", content: [para(t("a1"))] }] },
            ],
          },
        ],
      }),
    ],
    ["code block", doc({ type: "codeBlock", attrs: { language: "ts" }, content: [t("x = 1\ny = 2")] })],
    ["code block, no language", doc({ type: "codeBlock", attrs: { language: null }, content: [t("x")] })],
    ["bold + italic", doc(para(t("styled", { type: "bold" }, { type: "italic" })))],
    ["code mark", doc(para(t("a"), t("x", { type: "code" }), t("b")))],
    ["link", doc(para(t("a link", { type: "link", attrs: { href: "https://example.com" } })))],
    ["hard break", doc(para(t("one"), { type: "hardBreak" }, t("two")))],
    ["text with markup characters", doc(para(t("2 * 3 = 6, [x] and `y` and a_b")))],
  ];
  for (const [name, d] of cases) {
    it(`survives ${name}`, () => {
      expect(jsonRoundTrip(d)).toEqual(d);
    });
  }

  it("normalises a real link mark's extra attrs down to href", () => {
    // Shape copied from noteSchemaGuard.test.ts ("link mark").
    const real = doc({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "a link",
          marks: [{ type: "link", attrs: { href: "https://example.com", target: "_blank", rel: "noopener noreferrer nofollow", class: null, title: null } }],
        },
      ],
    });
    expect(toMarkdown(real)).toBe("[a link](https://example.com)\n");
    expect(jsonRoundTrip(real)).toEqual(doc(para(t("a link", { type: "link", attrs: { href: "https://example.com" } }))));
  });

  it("ignores a heading's collapsed attribute when reading", () => {
    const real = doc({ type: "heading", attrs: { level: 1, collapsed: true }, content: [t("H")] });
    expect(toMarkdown(real)).toBe("# H\n");
  });
});

describe("reading blocks the CLI does not write", () => {
  it("renders an unknown block as a tagged fence holding its JSON", () => {
    const block: JsonNode = { type: "calloutBlock", attrs: { variant: "warn" }, content: [para(t("careful"))] };
    const md = toMarkdown(doc(block));
    expect(md.startsWith("```vault:calloutBlock\n")).toBe(true);
    const json = md.split("\n").slice(1, -2).join("\n");
    expect(JSON.parse(json)).toEqual(block);
  });

  it("renders the structural blocks from noteSchemaGuard.test.ts without dropping anything", () => {
    const known = doc(
      { type: "calloutBlock", attrs: { variant: "warn" }, content: [para(t("careful"))] },
      { type: "containerBlock", attrs: { style: "card" }, content: [para(t("grouped"))] },
      {
        type: "toggleBlock",
        attrs: { open: true },
        content: [
          { type: "toggleSummary", content: [t("summary")] },
          { type: "toggleContent", content: [para(t("body"))] },
        ],
      },
    );
    const md = toMarkdown(known);
    for (const name of ["calloutBlock", "containerBlock", "toggleBlock"]) expect(md).toContain(`\`\`\`vault:${name}\n`);
    for (const word of ["careful", "grouped", "summary", "body"]) expect(md).toContain(word);
  });

  it("renders task lists, blockquotes and rules in their textual form", () => {
    const d = doc(
      {
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: false }, content: [para(t("todo"))] },
          { type: "taskItem", attrs: { checked: true }, content: [para(t("done"))] },
        ],
      },
      { type: "blockquote", content: [para(t("quoted"))] },
      { type: "horizontalRule" },
      para(t("after")),
    );
    expect(toMarkdown(d)).toBe("- [ ] todo\n- [x] done\n\n> quoted\n\n---\n\nafter\n");
  });

  it("renders an unknown inline node as a tagged code span", () => {
    const md = toMarkdown(doc(para(t("a "), { type: "inlineMath", attrs: { latex: "x^2" } }, t(" b"))));
    expect(md).toBe('a `vault:inlineMath {"type":"inlineMath","attrs":{"latex":"x^2"}}` b\n');
  });

  it("keeps the text of an unknown mark", () => {
    const md = toMarkdown(doc(para(t("hi", { type: "highlight", attrs: { color: "#ffd400" } }))));
    expect(md).toBe("hi\n");
  });
});

describe("writing constructs the CLI does not emit", () => {
  it("never produces a node or mark outside the writable set", () => {
    const md = [
      "# H5 clamp",
      "##### deep",
      "> quote with **bold**",
      "---",
      "- [ ] task",
      "![alt](https://img)",
      "<div>html</div>",
      "a <span>inline</span> b",
      "| a | b |\n|---|---|\n| 1 | 2 |",
    ].join("\n\n");
    const { doc, warnings } = fromMarkdown(md);
    expect(auditWritable(doc)).toEqual({ nodes: [], marks: [] });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes("clamped"))).toBe(true);
    expect(warnings.some((w) => w.includes("blockquote"))).toBe(true);
    expect(warnings.some((w) => w.includes("horizontal rule"))).toBe(true);
  });

  it("clamps heading 5 and 6 to level 4", () => {
    const { doc } = fromMarkdown("##### five\n\n###### six\n");
    expect(doc.content?.map((n) => n.attrs?.level)).toEqual([4, 4]);
  });

  it("keeps a task checkbox as literal text", () => {
    const { doc } = fromMarkdown("- [x] done\n");
    expect(toMarkdown(doc)).toBe("- \\[x\\] done\n");
  });

  it("refuses to write a vault:<type> fence back", () => {
    expect(() => fromMarkdown('```vault:calloutBlock\n{"type":"calloutBlock"}\n```\n')).toThrow(/cannot be written back/);
  });

  it("gives an empty document one empty paragraph", () => {
    expect(fromMarkdown("").doc).toEqual(doc(para()));
    expect(fromMarkdown("\n\n").doc).toEqual(doc(para()));
  });

  it("puts a paragraph first in a list item that starts with a nested list", () => {
    const { doc } = fromMarkdown("- - inner\n");
    const item = doc.content?.[0].content?.[0];
    expect(item?.content?.[0]).toEqual(para());
    expect(auditWritable(doc)).toEqual({ nodes: [], marks: [] });
  });
});

describe("content envelope", () => {
  it("wraps a doc as {__vault:1, doc}", () => {
    const d = doc(para(t("x")));
    expect(JSON.parse(envelope(d))).toEqual({ __vault: 1, doc: d });
  });

  it("parses the three stored shapes", () => {
    const d = doc(para(t("hi")));
    expect(parseNoteContent("")).toEqual({ kind: "empty" });
    expect(parseNoteContent(JSON.stringify(d))).toEqual({ kind: "json", doc: d, enveloped: false });
    expect(parseNoteContent(envelope(d))).toEqual({ kind: "json", doc: d, enveloped: true });
    expect(parseNoteContent("<p>legacy</p>")).toEqual({ kind: "html", html: "<p>legacy</p>" });
    expect(parseNoteContent("5").kind).toBe("html");
    expect(parseNoteContent("null").kind).toBe("html");
  });

  it("audits unknown types at any depth", () => {
    const d = doc({ type: "blockquote", content: [para(t("x", { type: "glitter" }))] });
    expect(auditWritable(d)).toEqual({ nodes: ["blockquote"], marks: ["glitter"] });
  });
});

describe("escapeText", () => {
  it("leaves intraword underscores alone", () => {
    expect(escapeText("snake_case_name", false)).toBe("snake_case_name");
    expect(escapeText("_lead", false)).toBe("\\_lead");
    expect(escapeText("trail_", false)).toBe("trail\\_");
  });
});
