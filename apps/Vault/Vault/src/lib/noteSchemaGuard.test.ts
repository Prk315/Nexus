import { describe, it, expect } from "vitest";
import { generateHTML, generateJSON, getSchema } from "@tiptap/core";
import { buildNoteExtensions, noteSchema, NoopNoteExtension } from "../extensions/noteExtensions";
import {
  parseNoteContent,
  auditNoteContent,
  auditNoteRaw,
  describeUnknown,
  NOTE_ENVELOPE_VERSION,
} from "./noteSchemaGuard";

const schema = noteSchema();
const doc = (...content: any[]) => ({ type: "doc", content });
const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("parseNoteContent", () => {
  it("reads a bare ProseMirror doc — the format we write today", () => {
    const shape = parseNoteContent(JSON.stringify(doc(para("hi"))));
    expect(shape.kind).toBe("json");
    expect((shape as any).json.type).toBe("doc");
  });

  // The envelope reader must ship at least one release before anything writes
  // it, or clients that predate it blank the note. This test is the reason.
  it("reads a {__vault, doc} envelope and unwraps it", () => {
    const raw = JSON.stringify({ __vault: NOTE_ENVELOPE_VERSION, doc: doc(para("hi")) });
    const shape = parseNoteContent(raw);
    expect(shape.kind).toBe("json");
    expect((shape as any).json).toEqual(doc(para("hi")));
  });

  it("falls back to HTML for non-JSON content", () => {
    const shape = parseNoteContent("<p>legacy import</p>");
    expect(shape).toEqual({ kind: "html", html: "<p>legacy import</p>" });
  });

  it("treats a bare JSON scalar as text, not as a document", () => {
    // JSON.parse("5") succeeds and would otherwise be walked as a doc.
    expect(parseNoteContent("5").kind).toBe("html");
    expect(parseNoteContent("null").kind).toBe("html");
  });

  it("treats empty content as empty", () => {
    expect(parseNoteContent("")).toEqual({ kind: "empty" });
  });
});

describe("auditNoteContent", () => {
  it("passes a document built only from known types", () => {
    const audit = auditNoteRaw(JSON.stringify(doc(para("hello"))), schema);
    expect(audit).toEqual({ ok: true, unknownNodes: [], unknownMarks: [] });
  });

  it("passes every node type the editor actually registers", () => {
    // Guards against a future extension whose node name the audit rejects
    // because of some special-casing (e.g. the top node, or text).
    for (const name of Object.keys(schema.nodes)) {
      const audit = auditNoteContent({ kind: "json", json: { type: "doc", content: [{ type: name }] } }, schema);
      expect(audit.unknownNodes, `node type ${name} should be known`).toEqual([]);
    }
  });

  // The whole point of Phase 1. An unknown type must be NAMED, not just
  // detected — the banner shows these strings to the user verbatim.
  it("names an unknown top-level node type", () => {
    const audit = auditNoteRaw(JSON.stringify(doc({ type: "zzNotARealBlock", content: [] })), schema);
    expect(audit.ok).toBe(false);
    expect(audit.unknownNodes).toEqual(["zzNotARealBlock"]);
  });

  it("finds unknown types nested inside known ones", () => {
    const audit = auditNoteRaw(
      JSON.stringify(doc({ type: "blockquote", content: [{ type: "zzFutureBlock", content: [para("x")] }] })),
      schema
    );
    expect(audit.unknownNodes).toEqual(["zzFutureBlock"]);
  });

  // These names are deliberately fictional. Using a real upcoming node type
  // here would make the test flip to failing the day that type ships, which
  // is churn, not signal.
  it("recognises the structural blocks this build actually ships", () => {
    const known = doc(
      { type: "calloutBlock", attrs: { variant: "warn" }, content: [para("careful")] },
      { type: "containerBlock", attrs: { style: "card" }, content: [para("grouped")] },
      {
        type: "toggleBlock",
        attrs: { open: true },
        content: [
          { type: "toggleSummary", content: [{ type: "text", text: "summary" }] },
          { type: "toggleContent", content: [para("body")] },
        ],
      }
    );
    expect(auditNoteRaw(JSON.stringify(known), schema).ok).toBe(true);
  });

  it("keeps toggle parts out of `group: block` so they can't escape a toggle", () => {
    // The containment rule is schema-enforced, not policed after the fact:
    // neither part is a `block`, so neither is placeable at the top level.
    for (const name of ["toggleSummary", "toggleContent"]) {
      expect(schema.nodes[name].isInGroup("block"), `${name} must not be a block`).toBe(false);
    }
    expect(schema.nodes.toggleBlock.isInGroup("block")).toBe(true);
  });

  // nodeFromJSON throws on the FIRST unknown type; this walk must not, or the
  // banner can only ever name one of them and the user updates, reopens, and
  // hits the next one.
  it("collects every unknown type, de-duplicated and sorted", () => {
    const audit = auditNoteRaw(
      JSON.stringify(
        doc(
          { type: "zzOuter", content: [{ type: "zzInner", content: [para("a")] }] },
          { type: "zzInner", content: [para("b")] },
          { type: "zzAnother", content: [] }
        )
      ),
      schema
    );
    expect(audit.unknownNodes).toEqual(["zzAnother", "zzInner", "zzOuter"]);
  });

  it("keeps recursing past an unknown node into its children", () => {
    const audit = auditNoteRaw(
      JSON.stringify(doc({ type: "unknownOuter", content: [{ type: "unknownInner", content: [] }] })),
      schema
    );
    expect(audit.unknownNodes).toEqual(["unknownInner", "unknownOuter"]);
  });

  it("detects unknown marks", () => {
    const audit = auditNoteRaw(
      JSON.stringify(doc({ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "glitter" }] }] })),
      schema
    );
    expect(audit.ok).toBe(false);
    expect(audit.unknownMarks).toEqual(["glitter"]);
  });

  it("does not flag HTML or empty content", () => {
    expect(auditNoteRaw("<p>x</p>", schema).ok).toBe(true);
    expect(auditNoteRaw("", schema).ok).toBe(true);
  });

  it("formats names for the banner", () => {
    expect(describeUnknown({ ok: false, unknownNodes: ["a"], unknownMarks: [] })).toBe("a");
    expect(describeUnknown({ ok: false, unknownNodes: ["a", "b"], unknownMarks: [] })).toBe("a and b");
    expect(describeUnknown({ ok: false, unknownNodes: ["a", "b"], unknownMarks: ["c"] })).toBe("a, b and c");
  });
});

describe("note schema", () => {
  it("registers the block types the editor is expected to have", () => {
    for (const name of ["doc", "paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock", "table", "inlineMath", "blockMath", "taskList", "taskItem"]) {
      expect(Object.keys(schema.nodes), `missing node ${name}`).toContain(name);
    }
    // link and underline come from StarterKit v3, not a separate install —
    // if a future StarterKit drops them the toolbar buttons silently no-op.
    for (const name of ["bold", "italic", "underline", "highlight", "link"]) {
      expect(Object.keys(schema.marks), `missing mark ${name}`).toContain(name);
    }
  });

  // The guard audits against a schema built WITHOUT the editor's callbacks.
  // If an option ever changed the schema, the guard would silently disagree
  // with the live editor — the one failure mode this whole design can't see.
  it("is identical whether or not behaviour-only options are supplied", () => {
    const plain = getSchema(buildNoteExtensions());
    const configured = getSchema(
      buildNoteExtensions({
        onMathClick: () => {},
        extra: [NoopNoteExtension],
        placeholder: "something else",
      })
    );

    expect(Object.keys(configured.nodes).sort()).toEqual(Object.keys(plain.nodes).sort());
    expect(Object.keys(configured.marks).sort()).toEqual(Object.keys(plain.marks).sort());

    // Names alone aren't enough — a changed content expression or attribute
    // set would also make the guard disagree with the live editor.
    for (const name of Object.keys(plain.nodes)) {
      expect(configured.nodes[name].spec.content, `content of ${name}`).toBe(plain.nodes[name].spec.content);
      expect(Object.keys(configured.nodes[name].spec.attrs ?? {}).sort(), `attrs of ${name}`)
        .toEqual(Object.keys(plain.nodes[name].spec.attrs ?? {}).sort());
    }
  });
});

// The highest-value tests here: a renderHTML/parseHTML mismatch is invisible to
// tsc, survives every manual click-through, and only shows up as content
// quietly disappearing on copy-paste.
describe("HTML round-trip", () => {
  const exts = buildNoteExtensions();
  const roundTrip = (json: any) => generateJSON(generateHTML(json, exts), exts);

  const cases: Array<[string, any]> = [
    ["paragraph", doc(para("hello world"))],
    ["heading", doc({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] })],
    ["bullet list", doc({ type: "bulletList", content: [{ type: "listItem", content: [para("a")] }] })],
    ["blockquote", doc({ type: "blockquote", content: [para("quoted")] })],
    ["code block", doc({ type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text: "x = 1" }] })],
    ["horizontal rule", doc({ type: "horizontalRule" }, para("after"))],
    [
      "task list",
      doc({
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: false }, content: [para("todo")] },
          { type: "taskItem", attrs: { checked: true }, content: [para("done")] },
        ],
      }),
    ],
    [
      "link mark",
      doc({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "a link",
            marks: [{ type: "link", attrs: { href: "https://example.com", target: "_blank", rel: "noopener noreferrer nofollow", class: null, title: null } }],
          },
        ],
      }),
    ],
    [
      "bold + italic marks",
      doc({
        type: "paragraph",
        content: [{ type: "text", text: "styled", marks: [{ type: "bold" }, { type: "italic" }] }],
      }),
    ],
  ];

  for (const [name, json] of cases) {
    it(`survives ${name}`, () => {
      expect(roundTrip(json)).toEqual(json);
    });
  }

  // CategoryHighlight adds a `category` attribute on top of Highlight. If its
  // renderHTML/parseHTML ever drift, highlights silently lose the category
  // that ties them to their vault_records row.
  it("preserves a highlight's category attribute", () => {
    const json = doc({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "important",
          marks: [{ type: "highlight", attrs: { color: "#ffd400", category: "Definition" } }],
        },
      ],
    });
    const back = roundTrip(json);
    const mark = back.content?.[0]?.content?.[0]?.marks?.[0];
    expect(mark?.type).toBe("highlight");
    expect(mark?.attrs?.category).toBe("Definition");
    expect(mark?.attrs?.color).toBe("#ffd400");
  });

  // Structural blocks are where a renderHTML/parseHTML mismatch actually costs
  // something: the wrapper silently vanishes on paste and the content inside
  // it merges into the surrounding document.
  for (const variant of ["note", "info", "warn", "success", "danger"]) {
    it(`survives a ${variant} callout`, () => {
      const json = doc({ type: "calloutBlock", attrs: { variant }, content: [para("body")] });
      expect(roundTrip(json)).toEqual(json);
    });
  }

  for (const style of ["plain", "card", "outline", "muted"]) {
    it(`survives a ${style} container`, () => {
      const json = doc({ type: "containerBlock", attrs: { style }, content: [para("body")] });
      expect(roundTrip(json)).toEqual(json);
    });
  }

  for (const open of [true, false]) {
    it(`survives a ${open ? "open" : "collapsed"} toggle`, () => {
      const json = doc({
        type: "toggleBlock",
        attrs: { open },
        content: [
          { type: "toggleSummary", content: [{ type: "text", text: "Summary text" }] },
          { type: "toggleContent", content: [para("hidden body"), para("second block")] },
        ],
      });
      // Collapsed state has to survive the round trip or a toggle silently
      // springs open every time a note is copied or re-parsed.
      expect(roundTrip(json)).toEqual(json);
    });
  }

  it("keeps marks inside a toggle summary", () => {
    // The reason the summary is a real node and not a string attribute.
    const json = doc({
      type: "toggleBlock",
      attrs: { open: true },
      content: [
        {
          type: "toggleSummary",
          content: [{ type: "text", text: "bold title", marks: [{ type: "bold" }] }],
        },
        { type: "toggleContent", content: [para("body")] },
      ],
    });
    expect(roundTrip(json)).toEqual(json);
  });

  it("survives a container nested inside a callout", () => {
    const json = doc({
      type: "calloutBlock",
      attrs: { variant: "info" },
      content: [
        para("intro"),
        { type: "containerBlock", attrs: { style: "muted" }, content: [para("nested")] },
      ],
    });
    expect(roundTrip(json)).toEqual(json);
  });

  // An unrecognised variant must land on a real one, or the CSS attribute
  // selector matches nothing and the callout renders as an unstyled div —
  // indistinguishable from having lost the block entirely.
  it("falls back to a valid variant when the attribute is nonsense", () => {
    const back = generateJSON(
      '<aside data-type="callout" data-variant="chartreuse"><p>x</p></aside>',
      exts
    );
    expect(back.content?.[0]?.attrs?.variant).toBe("note");
  });

  it("keeps the content when the wrapper attribute is missing entirely", () => {
    const back = generateJSON('<aside data-type="callout"><p>kept</p></aside>', exts);
    expect(back.content?.[0]?.type).toBe("calloutBlock");
    expect(back.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe("kept");
  });

  it("round-trips a document through the guard unchanged", () => {
    const json = doc(para("one"), { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Two" }] });
    const raw = JSON.stringify(json);
    expect(auditNoteRaw(raw, schema).ok).toBe(true);
    expect(parseNoteContent(raw)).toEqual({ kind: "json", json });
  });
});
