import { describe, it, expect } from "vitest";
import { generateHTML, generateJSON } from "@tiptap/core";
import { buildNoteExtensions, noteSchema } from "../noteExtensions";
import { auditNoteRaw } from "../../lib/noteSchemaGuard";
import { collectShares } from "../../lib/sharedBlocks";

const schema = noteSchema();
const exts = buildNoteExtensions();

const para = (t = "x") => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const doc = (...c: any[]) => ({ type: "doc", content: c });

const container = (attrs: Record<string, any>, ...c: any[]) =>
  ({ type: "containerBlock", attrs: { style: "card", color: null, ...attrs }, content: c });
const callout = (attrs: Record<string, any>, ...c: any[]) =>
  ({ type: "calloutBlock", attrs: { variant: "note", color: null, ...attrs }, content: c });
const toggle = (attrs: Record<string, any>, body: any) => ({
  type: "toggleBlock",
  attrs: { open: true, ...attrs },
  content: [
    { type: "toggleSummary", content: [{ type: "text", text: "s" }] },
    { type: "toggleContent", content: [body] },
  ],
});

/** The clipboard path, as far as ProseMirror is concerned: a slice is
 *  serialised to HTML and parsed back. This is the only thing that makes
 *  "copy the block into the other note" carry the share. */
const roundTrip = (json: any) => generateJSON(generateHTML(json, exts), exts);

describe("shareId survives the clipboard", () => {
  // ⚠️ The highest-value test for this feature. A renderHTML/parseHTML mismatch
  // is invisible to tsc, survives every manual click-through of ONE note, and
  // shows up only as "I pasted the block into the other note and they don't
  // sync" — with the block looking completely correct.
  it("round-trips through HTML on every shareable container", () => {
    for (const node of [
      container({ shareId: "abc123def456" }, para("body")),
      callout({ shareId: "abc123def456" }, para("body")),
      toggle({ shareId: "abc123def456" }, para("body")),
    ]) {
      const back = roundTrip(doc(node));
      expect([...collectShares(back as any).keys()], JSON.stringify(node.type))
        .toEqual(["abc123def456"]);
    }
  });

  it("keeps the share alongside the block's own attributes", () => {
    const back: any = roundTrip(doc(container({ shareId: "keepme01", color: "amber" }, para())));
    expect(back.content[0].attrs.shareId).toBe("keepme01");
    expect(back.content[0].attrs.color).toBe("amber");
  });

  it("survives being nested inside a column", () => {
    const back = roundTrip(doc({
      type: "columnBlock",
      content: [
        { type: "column", attrs: { width: null }, content: [container({ shareId: "nested01" }, para())] },
        { type: "column", attrs: { width: null }, content: [para()] },
      ],
    }));
    expect([...collectShares(back as any).keys()]).toEqual(["nested01"]);
  });

  it("leaves an unshared container without the attribute in the HTML", () => {
    // Emitting `data-share=""` would make every ordinary container look shared
    // to a parser, and `collectShares` would then key one on the empty string.
    const html = generateHTML(doc(container({}, para())), exts);
    expect(html).not.toContain("data-share");
    expect(collectShares(roundTrip(doc(container({}, para()))) as any).size).toBe(0);
  });
});

describe("an older client is not harmed", () => {
  // ⚠️ The reason this is an ATTRIBUTE and not a new node type. ProseMirror
  // drops an attribute it does not know and BLANKS a document whose node type
  // it does not know — so a note containing a shared block opens correctly on a
  // Mac or iPad build that predates the feature, merely without syncing. As a
  // `sharedBlock` node type it would have wiped the note.
  it("parses as an ordinary container when the attribute is unknown", () => {
    const html = generateHTML(doc(container({ shareId: "future01" }, para("kept"))), exts);
    // Stand in for the older build: a schema whose container declares no
    // shareId. Node.fromJSON builds attrs by iterating the TYPE's declared
    // attributes and never looks for extras, which is exactly why this is safe.
    const older = generateJSON(html, exts);
    const stripped = JSON.parse(JSON.stringify(older), (k, v) => (k === "shareId" ? undefined : v));
    const node = schema.nodeFromJSON(stripped);
    expect(() => node.check()).not.toThrow();
    // And the CONTENT is still there — the whole point of storing the blocks in
    // the note as well as in the share row.
    expect(JSON.stringify(stripped)).toContain("kept");
  });

  it("the schema guard accepts a shared note, so it still opens", () => {
    const json = doc(container({ shareId: "guard001" }, para("body")));
    expect(auditNoteRaw(JSON.stringify(json), schema).ok).toBe(true);
  });
});
