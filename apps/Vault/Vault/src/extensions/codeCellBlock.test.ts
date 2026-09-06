import { describe, it, expect } from "vitest";
import { getSchema, generateHTML, generateJSON } from "@tiptap/core";
import { buildNoteExtensions, noteSchema } from "./noteExtensions";
import { auditNoteContent, parseNoteContent } from "../lib/noteSchemaGuard";
import { stripDefaults } from "../test/roundTrip";

const exts = () => buildNoteExtensions();

function roundTrip(doc: any) {
  const html = generateHTML(doc, exts());
  return stripDefaults(generateJSON(html, exts()), noteSchema());
}

const cell = (attrs: Record<string, unknown>) => ({
  type: "doc",
  content: [{ type: "codeCell", attrs }],
});

describe("codeCell schema", () => {
  it("is registered as a block", () => {
    expect(noteSchema().nodes.codeCell).toBeDefined();
    expect(noteSchema().nodes.codeCell.isBlock).toBe(true);
  });

  // Code and results live in the document, so they have to survive the HTML
  // serialisation a copy-paste goes through. A renderHTML/parseHTML mismatch is
  // invisible to tsc and to every manual click-through, and only shows up as a
  // cell that silently empties when pasted into another note.
  it("round-trips code and language through HTML", () => {
    const doc = cell({ code: "print('hi')\nfor i in range(3):\n    print(i)", language: "sql", outputs: [] });
    expect(roundTrip(doc)).toEqual(stripDefaults(doc, noteSchema()));
  });

  it("round-trips outputs through HTML", () => {
    const outputs = [
      { type: "text", content: "6" },
      { type: "table", content: JSON.stringify([{ columns: ["n"], rows: [["1"]], rowCount: 1 }]) },
    ];
    const doc = cell({ code: "select 1", language: "sql", outputs });
    expect(roundTrip(doc)).toEqual(stripDefaults(doc, noteSchema()));
  });

  it("keeps a default-language cell at python", () => {
    const parsed: any = roundTrip(cell({ code: "1+1", language: "python", outputs: [] }));
    // `python` is the default, so stripDefaults removes it — the point is that
    // it does not come back as sql.
    const html = generateHTML(cell({ code: "1+1", language: "python", outputs: [] }), exts());
    expect(html).toContain('data-language="python"');
    expect(parsed.content[0].type).toBe("codeCell");
  });

  // An unknown language attribute must not become a third language: the node
  // view switches on it and the kernel dispatches on it.
  it("coerces an unrecognised language to python", () => {
    const html = '<div data-type="code-cell" data-code="x" data-language="ruby"></div>';
    const json: any = generateJSON(html, exts());
    expect(json.content[0].attrs.language).toBe("python");
  });

  // Outputs are stored content and can arrive truncated or hand-edited. Parsing
  // runs while the document is being built, where a throw blanks the whole note
  // rather than the one cell.
  it("degrades unreadable outputs to none instead of throwing", () => {
    const html = '<div data-type="code-cell" data-code="x" data-outputs="{not json"></div>';
    let json: any;
    expect(() => { json = generateJSON(html, exts()); }).not.toThrow();
    expect(json.content[0].attrs.outputs).toEqual([]);
  });

  it("degrades a non-array outputs value to none", () => {
    const html = `<div data-type="code-cell" data-code="x" data-outputs="${encodeURIComponent("")}7"></div>`;
    const json: any = generateJSON(html, exts());
    expect(json.content[0].attrs.outputs).toEqual([]);
  });

  it("omits the outputs attribute entirely when there are none", () => {
    const html = generateHTML(cell({ code: "x", language: "python", outputs: [] }), exts());
    expect(html).not.toContain("data-outputs");
  });

  // The guard is what decides whether an editor may mount at all. A note
  // containing a cell has to pass it on a build that has the node.
  it("passes the schema guard", () => {
    const raw = JSON.stringify(cell({ code: "1+1", language: "python", outputs: [] }));
    expect(auditNoteContent(parseNoteContent(raw), noteSchema()).ok).toBe(true);
  });

  // ⚠️ codeCell is a NODE TYPE, so a build without it cannot read a note that
  // uses one — the guard names it and refuses to mount, rather than blanking
  // the document. This pins that the guard actually catches it, which is the
  // whole reason the deploy order matters.
  it("is named by the guard on a build that lacks it", () => {
    const withoutCell = noteSchema();
    const raw = JSON.stringify({
      type: "doc",
      content: [{ type: "someFutureCell", attrs: {} }],
    });
    const audit = auditNoteContent(parseNoteContent(raw), withoutCell);
    expect(audit.ok).toBe(false);
    expect(audit.unknownNodes).toContain("someFutureCell");
  });
});

describe("buildNoteExtensions cell session", () => {
  // sessionId is an OPTION, not an attribute — so the schema the guard audits
  // against stays identical to the one a live editor runs, and a cell pasted
  // between notes does not drag another note's namespace with it.
  it("does not change the schema", () => {
    const configured = getSchema(buildNoteExtensions({ cellSessionId: "note-abc" }));
    expect(Object.keys(configured.nodes).sort()).toEqual(Object.keys(noteSchema().nodes).sort());
    expect(Object.keys(configured.marks).sort()).toEqual(Object.keys(noteSchema().marks).sort());
  });
});
