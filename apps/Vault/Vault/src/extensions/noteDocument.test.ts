import { describe, it, expect } from "vitest";
import { getSchema, generateHTML, generateJSON } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { buildNoteExtensions, noteSchema } from "./noteExtensions";
import { auditNoteRaw } from "../lib/noteSchemaGuard";
import { NOTE_WIDTHS, DEFAULT_NOTE_WIDTH, NOTE_TEXT_SIZES, DEFAULT_NOTE_TEXT } from "./noteDocument";
import { INLINE_TEXT_SIZES } from "./blockRegistry";

const schema = noteSchema();
const exts = buildNoteExtensions();
const para = (t = "x") => ({ type: "paragraph", content: [{ type: "text", text: t }] });

describe("per-note width", () => {
  it("defaults to auto when the attribute is absent", () => {
    const d = schema.nodeFromJSON({ type: "doc", content: [para()] });
    expect(d.attrs.width).toBe(DEFAULT_NOTE_WIDTH);
  });

  it("accepts every offered width", () => {
    for (const w of NOTE_WIDTHS) {
      const d = schema.nodeFromJSON({ type: "doc", attrs: { width: w }, content: [para()] });
      expect(d.attrs.width).toBe(w);
    }
  });

  // This is the path that matters: EditorPane stores
  // JSON.stringify(editor.getJSON()), so JSON round-tripping is what decides
  // whether the setting persists.
  it("survives the JSON round trip, which is how notes are stored", () => {
    for (const w of NOTE_WIDTHS) {
      const json = { type: "doc", attrs: { width: w }, content: [para("body")] };
      const back = schema.nodeFromJSON(json).toJSON();
      expect(back.attrs?.width, `width ${w}`).toBe(w);
    }
  });

  // Worth pinning so nobody later "fixes" a bug that isn't one: HTML cannot
  // carry this. DOMSerializer serializes the doc's CONTENT, never the doc node
  // itself, so there is no element for a doc attribute to live on. That only
  // affects copy-paste of a whole document — where the width of the note you
  // copied from is not something you'd want applied to the note you paste
  // into anyway — and never affects storage.
  it("is not carried by HTML, and that is fine", () => {
    const html = generateHTML({ type: "doc", attrs: { width: "full" }, content: [para()] }, exts);
    expect(html).not.toContain("data-note-width");
    expect(generateJSON(html, exts).attrs?.width ?? DEFAULT_NOTE_WIDTH).toBe(DEFAULT_NOTE_WIDTH);
  });

  it("falls back to the default for a nonsense stored value", () => {
    const back = schema.nodeFromJSON({ type: "doc", attrs: { width: "enormous" }, content: [para()] });
    // ProseMirror keeps whatever was stored; the CSS attribute selectors only
    // match the three known values, so an unknown one renders as the default.
    expect(NOTE_WIDTHS).not.toContain(back.attrs.width);
  });

  it("passes the schema guard", () => {
    const json = JSON.stringify({ type: "doc", attrs: { width: "full" }, content: [para()] });
    expect(auditNoteRaw(json, schema).ok).toBe(true);
  });
});

// The claim this feature rests on: adding a doc attribute is safe to ship
// before every client has it. Unlike an unknown NODE type — which makes
// createNodeFromContent return an EMPTY document and can cost you the note —
// an unknown ATTRIBUTE is dropped silently, because Node.fromJSON builds attrs
// by iterating the *type's* declared attributes and never looks for extras.
describe("per-note text size", () => {
  it("defaults to normal when the attribute is absent", () => {
    const d = schema.nodeFromJSON({ type: "doc", content: [para()] });
    expect(d.attrs.textSize).toBe(DEFAULT_NOTE_TEXT);
  });

  it("accepts every offered size and survives the JSON round trip", () => {
    for (const t of NOTE_TEXT_SIZES) {
      const d = schema.nodeFromJSON({ type: "doc", attrs: { textSize: t }, content: [para()] });
      expect(d.attrs.textSize).toBe(t);
      expect(schema.nodeFromJSON(d.toJSON()).attrs.textSize).toBe(t);
    }
  });

  it("falls back to the default for a nonsense stored value", () => {
    const d = schema.nodeFromJSON({ type: "doc", attrs: { textSize: "gigantic" }, content: [para()] });
    // nodeFromJSON takes the stored value verbatim; the guard is in parseHTML
    // and in the toolbar, which only offers the four. What matters here is that
    // it does not throw and the content survives.
    expect(d.content.childCount).toBe(1);
  });

  // The two settings are independent: choosing large text must not re-flow the
  // note, and choosing full width must not resize the type.
  it("is independent of width", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      attrs: { width: "full", textSize: "large" },
      content: [para()],
    });
    expect(d.attrs.width).toBe("full");
    expect(d.attrs.textSize).toBe("large");
  });

  it("passes the schema guard", () => {
    const raw = JSON.stringify({ type: "doc", attrs: { textSize: "xlarge" }, content: [para()] });
    expect(auditNoteRaw(raw, schema).ok).toBe(true);
  });
});

// Inline size rides the TextStyle MARK, not the doc node — but the safety
// property is the same one, and it is the reason this could ship without
// waiting for the iPad: a build without the FontSize extension drops the
// attribute and renders the run at the normal size. It does not blank the note.
describe("inline text size", () => {
  const styled = (size: string) => ({
    type: "doc",
    content: [{
      type: "paragraph",
      content: [{ type: "text", text: "aside", marks: [{ type: "textStyle", attrs: { fontSize: size } }] }],
    }],
  });

  it("survives the JSON round trip, which is how notes are stored", () => {
    for (const size of ["0.85em", "1.25em"]) {
      const d = schema.nodeFromJSON(styled(size));
      const mark = d.firstChild!.firstChild!.marks[0];
      expect(mark.attrs.fontSize).toBe(size);
      expect(schema.nodeFromJSON(d.toJSON()).firstChild!.firstChild!.marks[0].attrs.fontSize).toBe(size);
    }
  });

  // The claim the release order rests on. A schema WITHOUT FontSize must keep
  // the text and lose only the size.
  it("is dropped, not fatal, on a build that lacks the extension", () => {
    const older = getSchema([StarterKit]);
    const d = older.nodeFromJSON({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "aside" }] }],
    });
    expect(d.textContent).toBe("aside");
    // And the real schema still reads its own output.
    expect(schema.nodeFromJSON(styled("0.85em")).textContent).toBe("aside");
  });

  it("passes the schema guard", () => {
    expect(auditNoteRaw(JSON.stringify(styled("1.25em")), schema).ok).toBe(true);
  });

  // em, never px: the note has its own size and the same note opens on an iPad,
  // so a run pinned to 11px would ignore both.
  it("is expressed relative to the surrounding text", () => {
    for (const z of INLINE_TEXT_SIZES) {
      if (z.value) expect(z.value).toMatch(/em$/);
    }
  });
});

describe("an older client without the attribute", () => {
  const oldSchema = getSchema([StarterKit]);

  it("reads a note carrying width without throwing, and keeps the content", () => {
    const json = { type: "doc", attrs: { width: "full" }, content: [para("survives")] };
    let node: any;
    expect(() => { node = oldSchema.nodeFromJSON(json); }).not.toThrow();
    expect(node.textContent).toBe("survives");
    // The attribute is simply not there — the note renders at that build's
    // default measure rather than blanking.
    expect(node.attrs.width).toBeUndefined();
  });

  it("contrasts with an unknown NODE type, which does throw", () => {
    const json = { type: "doc", content: [{ type: "calloutBlock", content: [para()] }] };
    expect(() => oldSchema.nodeFromJSON(json)).toThrow();
  });
});

// Pins the behaviour that made NoteEditor's content effect need a follow-up
// transaction: setContent replaces the content RANGE, so the doc node — and
// therefore every doc-level attribute — survives it untouched.
describe("setContent and doc attributes", () => {
  it("does not carry doc attrs, which is why the width needs an explicit dispatch", () => {
    const state = EditorState.create({
      doc: schema.nodeFromJSON({ type: "doc", attrs: { width: "full" }, content: [para("a")] }),
      schema,
    });
    const incoming = schema.nodeFromJSON({ type: "doc", attrs: { width: "wide" }, content: [para("b")] });

    // Exactly what setContent does under the hood.
    const tr = state.tr.replaceWith(0, state.doc.content.size, incoming.content);
    const after = state.apply(tr);

    expect(after.doc.textContent).toBe("b");        // content replaced
    expect(after.doc.attrs.width).toBe("full");     // ...but the attr did NOT follow

    // Which is what the follow-up transaction fixes.
    const fixed = after.apply(after.tr.setDocAttribute("width", "wide"));
    expect(fixed.doc.attrs.width).toBe("wide");
  });
});
